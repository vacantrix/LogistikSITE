// Рождение рейса (интеграционная точка №2, раздел 3.4 и 5.3 ТЗ).
// Назначение диспетчером выполняется В ОДНОЙ ТРАНЗАКЦИИ БД:
// валидации → ASSIGNED + StatusHistory → Trip + TripPoint → SyncJournal (TRIP, TRIP_POINT) → SystemNote (+ в SyncJournal).
// Если записи плана обмена не появятся в той же транзакции — водитель не увидит назначение.
import type { Prisma } from '@prisma/client'
import { db, withWriteLock } from '../db'
import { logEvent } from './journal'
import { driverIssues, vehicleIssues } from './eligibility'
import { computeRoute } from './route'
import { tripSnapshot, tripPointSnapshot, systemNoteSnapshot } from '../bus/snapshots'
import { journalWrite } from '../bus/syncWriter'

export type AssignResult =
  | { ok: true; requestId: string; tripId: string; number: string }
  | { ok: false; errors: string[] }

export async function assignRequest(
  requestId: string,
  input: { vehicleId: string; trailerId?: string | null; driverId: string },
  actor = 'Диспетчер',
): Promise<AssignResult> {
  // 1. Валидации проведения (вне транзакции — только чтение)
  const request = await db.transportRequest.findUnique({
    where: { id: requestId },
    include: { fromLocation: true, toLocation: true },
  })
  if (!request) return { ok: false, errors: ['Заявка не найдена'] }
  if (request.status !== 'DISPATCH')
    return { ok: false, errors: [`Заявка в статусе ${request.status} — назначение возможно только из статуса DISPATCH`] }

  const vehicle = await db.vehicle.findUnique({ where: { id: input.vehicleId } })
  if (!vehicle) return { ok: false, errors: ['ТС не найдено'] }

  const driver = await db.driver.findUnique({ where: { id: input.driverId } })
  if (!driver) return { ok: false, errors: ['Водитель не найден'] }

  let trailer: { id: string; type: string } | null = null
  if (input.trailerId) {
    trailer = await db.trailer.findUnique({ where: { id: input.trailerId } })
    if (!trailer) return { ok: false, errors: ['Прицеп не найден'] }
  }

  const errors: string[] = [
    ...vehicleIssues(vehicle, { cargo: request.cargo, weightT: request.weightT }).map((i) => i.text),
    ...(trailer && trailer.type !== vehicle.bodyType
      ? ['Тип прицепа не совпадает с типом кузова ТС']
      : []),
    ...(await driverIssues(db, driver)).map((i) => i.text),
  ]
  if (errors.length > 0) {
    await withWriteLock(() =>
      db.$transaction(async (tx) => {
        await logEvent(tx, {
          user: actor,
          action: 'ASSIGN_REJECTED',
          entity: 'TransportRequest',
          entityId: request.number,
          level: 'warning',
        })
      }),
    )
    return { ok: false, errors }
  }

  // 2. Роутинг не блокирует транзакцию: сначала считаем маршрут (с заглушкой при недоступности)
  const route = await computeRoute(
    { lat: request.fromLocation.lat, lon: request.fromLocation.lon },
    { lat: request.toLocation.lat, lon: request.toLocation.lon },
  )

  // 3. Атомарное назначение — одна транзакция
  try {
    const result = await withWriteLock(() =>
      db.$transaction(
        async (tx) => {
        // повторная проверка статуса внутри транзакции (гонки между диспетчерами)
        const fresh = await tx.transportRequest.findUnique({ where: { id: requestId }, select: { status: true, number: true } })
        if (!fresh || fresh.status !== 'DISPATCH') throw new Error('Заявка уже назначена или отменена')

        const busy = await tx.trip.findFirst({
          where: { driverId: driver.id, status: { in: ['assigned', 'in_progress'] } },
          select: { id: true },
        })
        if (busy) throw new Error(`Водитель занят в другом незавершённом рейсе`)

        await tx.transportRequest.update({
          where: { id: requestId },
          data: {
            status: 'ASSIGNED',
            vehicleId: vehicle.id,
            trailerId: trailer?.id ?? null,
            driverId: driver.id,
            assignedBy: actor,
            assignedAt: new Date(),
          },
        })
        await tx.statusHistory.create({
          data: {
            requestId,
            fromStatus: 'DISPATCH',
            toStatus: 'ASSIGNED',
            actor,
            comment: `${vehicle.model} · ${vehicle.plate}${trailer ? ` + прицеп` : ''}`,
          },
        })

        const trip =
          (await tx.trip.findUnique({ where: { tripCode: fresh.number } })) ??
          (await tx.trip.create({
            data: { tripCode: fresh.number, status: 'assigned', driverId: driver.id, vehicleId: vehicle.id },
          }))
        await tx.trip.update({
          where: { id: trip.id },
          data: {
            status: 'assigned',
            driverId: driver.id,
            vehicleId: vehicle.id,
            plannedStartAt: request.loadingAt,
            plannedFinishAt: new Date(request.loadingAt.getTime() + route.routeDurationS * 1000),
            routeGeoJson: route.routeGeoJson,
            routeStepsJson: route.routeStepsJson,
            routeDistanceM: route.routeDistanceM,
            routeDurationS: route.routeDurationS,
            routeMinLat: route.routeMinLat,
            routeMinLon: route.routeMinLon,
            routeMaxLat: route.routeMaxLat,
            routeMaxLon: route.routeMaxLon,
          },
        })
        await tx.transportRequest.update({ where: { id: requestId }, data: { tripId: trip.id } })

        // Точки маршрута: погрузка и выгрузка
        const prevPoints = await tx.tripPoint.findMany({ where: { tripId: trip.id }, select: { id: true } })
        if (prevPoints.length > 0) await tx.tripPoint.deleteMany({ where: { tripId: trip.id } })
        const point1 = await tx.tripPoint.create({
          data: {
            tripId: trip.id, seqNo: 1, kind: 'loading',
            name: request.fromLocation.name, address: request.fromLocation.address,
            lat: request.fromLocation.lat, lon: request.fromLocation.lon,
            geofenceRadiusM: request.fromLocation.geofenceRadiusM,
            plannedArrivalAt: request.loadingAt,
            plannedDepartureAt: new Date(request.loadingAt.getTime() + 40 * 60000),
          },
        })
        const point2 = await tx.tripPoint.create({
          data: {
            tripId: trip.id, seqNo: 2, kind: 'unloading',
            name: request.toLocation.name, address: request.toLocation.address,
            lat: request.toLocation.lat, lon: request.toLocation.lon,
            geofenceRadiusM: request.toLocation.geofenceRadiusM,
            plannedArrivalAt: new Date(request.loadingAt.getTime() + route.routeDurationS * 1000),
          },
        })

        const freshTrip = await tx.trip.findUniqueOrThrow({ where: { id: trip.id } })

        // Записи плана обмена — в той же транзакции (требование каркаса)
        await journalWrite(tx, driver.id, 'TRIP', 'UPSERT', tripSnapshot(freshTrip))
        await journalWrite(tx, driver.id, 'TRIP_POINT', 'UPSERT', tripPointSnapshot(point1))
        await journalWrite(tx, driver.id, 'TRIP_POINT', 'UPSERT', tripPointSnapshot(point2))

        const note = await tx.systemNote.create({
          data: {
            driverId: driver.id,
            kind: 'ORDER_ASSIGNED',
            body: `Вам назначена заявка ${fresh.number}: ${request.cargo}, ${request.fromLocation.name} → ${request.toLocation.name}. Погрузка ${request.loadingAt.toLocaleString('ru-RU')}.`,
            ref: JSON.stringify({ requestId, tripId: trip.id }),
          },
        })
        await journalWrite(tx, driver.id, 'SYSTEM_NOTE', 'UPSERT', systemNoteSnapshot(note))

        await logEvent(tx, { user: actor, action: 'ASSIGN', entity: 'TransportRequest', entityId: fresh.number })
        return { requestId, tripId: trip.id, number: fresh.number }
      },
        { timeout: 15000 },
      ),
    )
    return { ok: true, ...result }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Ошибка проведения назначения'
    await withWriteLock(() =>
      db.$transaction(async (tx) => {
        await logEvent(tx, { user: actor, action: 'ASSIGN_REJECTED', entity: 'TransportRequest', entityId: requestId, level: 'warning' })
      }),
    )
    return { ok: false, errors: [message] }
  }
}
