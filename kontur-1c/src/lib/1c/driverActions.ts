// Обратный канал действий водителя (раздел 5.4 и 6.2 ТЗ):
// ACCEPT | PRETRIP_STEP | START_ROUTE | COMPLETE_TRIP. Действие ASSIGN запрещено.
// Все действия идемпотентны на уникальных ключах и пишутся в журнал регистрации.
import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import { db, withWriteLock } from '../db'
import { logEvent } from './journal'
import { changeStatus } from './requests'
import { PRETRIP_STEP_IDS } from './statuses'
import { applyTripEvent } from './tripEvents'
import { savePhotoDataUrl } from '../photos'

export type DriverAction = 'ACCEPT' | 'PRETRIP_STEP' | 'START_ROUTE' | 'COMPLETE_TRIP'

export type DriverActionResult =
  | { ok: true; received: { at: string; orderId: string; action: DriverAction; stepId?: string } }
  | { ok: false; code: 400 | 403 | 404 | 409; error: string }

export async function driverAction(
  input: {
    orderId: string
    action: string
    stepId?: string | null
    at?: string | null
    photoDataUrl?: string | null
  },
  driver: { id: string; fullName: string } | null,
): Promise<DriverActionResult> {
  const at = input.at ? new Date(input.at) : new Date()

  if (input.action === 'ASSIGN') {
    return { ok: false, code: 400, error: 'Действие ASSIGN в обратном канале запрещено — назначение выполняет только диспетчер' }
  }

  const request = await db.transportRequest.findFirst({
    where: { OR: [{ id: input.orderId }, { number: input.orderId }] },
    include: { trip: true },
  })
  if (!request) return { ok: false, code: 404, error: 'Заявка не найдена' }
  if (driver && request.driverId && request.driverId !== driver.id)
    return { ok: false, code: 403, error: 'Заявка назначена другому водителю' }

  const actor = driver ? `driver:${driver.id}` : 'driver:<demo>'

  switch (input.action) {
    case 'ACCEPT': {
      if (!['ASSIGNED', 'ACCEPTED', 'PRETRIP'].includes(request.status))
        return { ok: false, code: 400, error: `Заявка в статусе ${request.status} — брать нельзя` }
      if (request.status === 'ASSIGNED') {
        await withWriteLock(() =>
          db.$transaction(async (tx) => {
            await changeStatus(tx, request.id, 'ACCEPTED', actor)
            await logEvent(tx, { user: actor, action: 'DRIVER_ACTION', entity: 'TransportRequest', entityId: request.number })
          }),
        )
      }
      break
    }

    case 'PRETRIP_STEP': {
      if (!['ASSIGNED', 'ACCEPTED', 'PRETRIP'].includes(request.status))
        return { ok: false, code: 400, error: `Фотофиксация недоступна: заявка в статусе ${request.status}` }
      if (!input.stepId || !PRETRIP_STEP_IDS.includes(input.stepId as never))
        return { ok: false, code: 400, error: 'Обязателен корректный stepId (veh_front, trailer_rear, selfie_docs)' }
      const photoUrl = input.photoDataUrl ? await savePhotoDataUrl(input.photoDataUrl) : null
      await withWriteLock(() =>
        db.$transaction(async (tx: Prisma.TransactionClient) => {
        const inspection = await tx.preTripInspection.upsert({
          where: { requestId: request.id },
          create: { requestId: request.id, driverId: request.driverId ?? driver?.id ?? '', vehicleId: request.vehicleId },
          update: {},
        })
        await tx.preTripStep.upsert({
          where: { inspectionId_stepId: { inspectionId: inspection.id, stepId: input.stepId! } },
          create: { inspectionId: inspection.id, stepId: input.stepId!, photoUrl, at },
          update: { photoUrl: photoUrl ?? undefined, at },
        })
        if (request.status === 'ASSIGNED' || request.status === 'ACCEPTED') {
          await changeStatus(tx, request.id, 'PRETRIP', actor)
        }
          await logEvent(tx, { user: actor, action: 'DRIVER_ACTION', entity: 'PreTripStep', entityId: `${request.number}:${input.stepId}` })
        }, { timeout: 15000 }),
      )
      break
    }

    case 'START_ROUTE': {
      if (request.status === 'IN_PROGRESS') break // повторное нажатие — идемпотентно
      if (request.status !== 'PRETRIP' && request.status !== 'ACCEPTED' && request.status !== 'ASSIGNED')
        return { ok: false, code: 400, error: `Начать маршрут нельзя: заявка в статусе ${request.status}` }
      const inspection = await db.preTripInspection.findUnique({
        where: { requestId: request.id },
        include: { steps: true },
      })
      const doneSteps = new Set(inspection?.steps.map((s) => s.stepId) ?? [])
      const missing = PRETRIP_STEP_IDS.filter((s) => !doneSteps.has(s))
      if (missing.length > 0) {
        await withWriteLock(() =>
          db.$transaction(async (tx) => {
            await logEvent(tx, {
              user: actor, action: 'DRIVER_ACTION_REJECTED', entity: 'TransportRequest',
              entityId: request.number, level: 'warning',
            })
          }),
        )
        return { ok: false, code: 409, error: `Предрейсовый осмотр не завершён. Не хватает шагов: ${missing.join(', ')}` }
      }
      if (!request.trip) return { ok: false, code: 400, error: 'У заявки нет рейса' }
      await withWriteLock(() =>
        db.$transaction(async (tx) => {
          await changeStatus(tx, request.id, 'IN_PROGRESS', actor)
          await applyTripEvent(tx, {
            tripId: request.tripId!,
            type: 'DEPARTURE',
            driverId: request.driverId ?? driver?.id ?? '',
            vehicleId: request.vehicleId ?? '',
            source: 'MANUAL',
            occurredAt: at,
          })
          await logEvent(tx, { user: actor, action: 'DRIVER_ACTION', entity: 'TransportRequest', entityId: request.number })
        }, { timeout: 15000 }),
      )
      break
    }

    case 'COMPLETE_TRIP': {
      if (request.status === 'DONE') break
      if (request.status !== 'IN_PROGRESS')
        return { ok: false, code: 400, error: `Завершить нельзя: заявка в статусе ${request.status} (нет события DEPARTURE)` }
      if (!request.trip) return { ok: false, code: 400, error: 'У заявки нет рейса' }
      await withWriteLock(() =>
        db.$transaction(async (tx) => {
          await changeStatus(tx, request.id, 'DONE', actor)
          await applyTripEvent(tx, {
            tripId: request.tripId!,
            type: 'TRIP_DONE',
            driverId: request.driverId ?? driver?.id ?? '',
            vehicleId: request.vehicleId ?? '',
            source: 'MANUAL',
            occurredAt: at,
          })
          await logEvent(tx, { user: actor, action: 'DRIVER_ACTION', entity: 'TransportRequest', entityId: request.number })
        }, { timeout: 15000 }),
      )
      break
    }

    default:
      return { ok: false, code: 400, error: `Неизвестное действие: ${input.action}` }
  }

  return {
    ok: true,
    received: {
      at: at.toISOString(),
      orderId: request.number,
      action: input.action,
      ...(input.stepId ? { stepId: input.stepId } : {}),
    },
  }
}

export function newOperationId(): string {
  return randomUUID()
}
