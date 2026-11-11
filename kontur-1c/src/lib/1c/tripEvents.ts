// События рейса (TripEvent): авто-закрытие интервалов и автостатусы рейса.
// Новое событие закрывает открытую «открывашку»; lastEventType/At рейса пересчитываются;
// DEPARTURE → in_progress, TRIP_DONE → completed. Все записи — в журнале водителя (SyncJournal).
import type { Prisma } from '@prisma/client'
import { tripSnapshot, tripEventSnapshot } from '../bus/snapshots'
import { journalWrite } from '../bus/syncWriter'

export const EVENT_OPENS_INTERVAL = new Set(['DEPARTURE', 'ARRIVAL_LOADING', 'LOADING_DONE', 'REST_START', 'REST_END', 'ARRIVAL_UNLOADING', 'UNLOADING_DONE'])

export async function applyTripEvent(
  tx: Prisma.TransactionClient,
  input: {
    tripId: string
    type: string
    driverId: string
    vehicleId: string
    tripPointId?: string | null
    deviceId?: string | null
    source: 'GEOFENCE' | 'MANUAL' | 'MANUAL_BACKDATED'
    occurredAt?: Date
    lat?: number | null
    lon?: number | null
    note?: string | null
  },
): Promise<{ eventId: string; closedEventId: string | null }> {
  const trip = await tx.trip.findUnique({ where: { id: input.tripId } })
  if (!trip) throw new Error('Рейс не найден')

  // авто-закрытие: новое событие закрывает последнюю открытую «открывашку»
  const lastOpen = await tx.tripEvent.findFirst({
    where: { tripId: input.tripId, intervalClosedAt: null },
    orderBy: { occurredAt: 'desc' },
  })

  const occurredAt = input.occurredAt ?? new Date()
  const ev = await tx.tripEvent.create({
    data: {
      tripId: input.tripId,
      tripPointId: input.tripPointId ?? null,
      driverId: input.driverId,
      vehicleId: input.vehicleId,
      deviceId: input.deviceId ?? null,
      type: input.type,
      occurredAt,
      source: input.source,
      lat: input.lat ?? null,
      lon: input.lon ?? null,
      note: input.note ?? null,
      intervalClosedAt: lastOpen ? occurredAt : null,
      intervalClosedBy: lastOpen ? input.type : null,
      intervalAutoClosed: lastOpen ? true : null,
    },
  })
  if (lastOpen) {
    await tx.tripEvent.update({
      where: { id: lastOpen.id },
      data: { intervalClosedAt: occurredAt, intervalClosedBy: input.type, intervalAutoClosed: true },
    })
  }

  // автостатусы рейса
  const status =
    input.type === 'DEPARTURE' ? 'in_progress' : input.type === 'TRIP_DONE' ? 'completed' : trip.status
  await tx.trip.update({
    where: { id: input.tripId },
    data: { status, lastEventType: input.type, lastEventAt: occurredAt },
  })

  // снимки в план обмена: событие + обновлённый рейс
  const freshTrip = await tx.trip.findUniqueOrThrow({ where: { id: input.tripId } })
  await journalWrite(tx, input.driverId, 'TRIP_EVENT', 'UPSERT', tripEventSnapshot({ ...ev, intervalClosedAt: lastOpen ? occurredAt : null, intervalClosedBy: lastOpen ? input.type : null, intervalAutoClosed: lastOpen ? true : null }))
  await journalWrite(tx, input.driverId, 'TRIP', 'UPSERT', tripSnapshot(freshTrip))

  return { eventId: ev.id, closedEventId: lastOpen?.id ?? null }
}
