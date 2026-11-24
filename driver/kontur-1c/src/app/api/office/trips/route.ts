// Реестр рейсов: статусы из событий (last_event_*), открытые интервалы, предрейсовый осмотр
import { db } from '@/lib/db'
import { jsonOffice } from '@/lib/cors'
import { requestRow } from '@/lib/office/serialize'

export const dynamic = 'force-dynamic'

export const EVENT_LABELS: Record<string, string> = {
  DEPARTURE: 'в движении',
  ARRIVAL_LOADING: 'на погрузке',
  LOADING_DONE: 'погрузка завершена',
  REST_START: 'на стоянке',
  REST_END: 'выход с стоянки',
  ARRIVAL_UNLOADING: 'на выгрузке',
  UNLOADING_DONE: 'выгрузка завершена',
  TRIP_DONE: 'рейс завершён',
}

export async function GET() {
  const requests = await db.transportRequest.findMany({
    where: { tripId: { not: null } },
    include: {
      contractor: true, fromLocation: true, toLocation: true, vehicle: true, trailer: true, driver: true,
      trip: { include: { points: true, events: { orderBy: { occurredAt: 'asc' } } } },
    },
    orderBy: { number: 'desc' },
  })
  const inspections = await db.preTripInspection.findMany({ include: { steps: true } })
  const byRequest = new Map(inspections.map((i) => [i.requestId, i]))

  const trips = requests.map((r) => {
    const row = requestRow(r, byRequest.get(r.id) ?? null)
    const events = row.trip?.events ?? []
    // открытые интервалы: события без закрытия (последнее из них — текущий интервал рейса)
    const openIntervals = events.filter((e) => e.intervalClosedAt === null)
    return {
      ...row,
      lastEventLabel: row.trip?.lastEventType ? EVENT_LABELS[row.trip.lastEventType] ?? row.trip.lastEventType : null,
      openIntervals,
    }
  })
  return jsonOffice({ trips })
}
