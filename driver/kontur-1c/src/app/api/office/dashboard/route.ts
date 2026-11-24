// Дашборд: счётчики заявок по статусам, активные рейсы, лента журнала регистрации
import { db } from '@/lib/db'
import { jsonOffice } from '@/lib/cors'
import { statusCounts } from '@/lib/1c/statusCounts'
import { REQUEST_STATUSES } from '@/lib/1c/statuses'

export const dynamic = 'force-dynamic'

export async function GET() {
  const counts = await statusCounts()
  const activeTrips = await db.trip.findMany({
    where: { status: { in: ['assigned', 'in_progress'] } },
    include: {
      points: true,
      request: { include: { contractor: true, driver: true, vehicle: true } },
    },
    orderBy: { tripCode: 'desc' },
  })
  const feed = await db.registrationLog.findMany({ orderBy: { at: 'desc' }, take: 12 })
  return jsonOffice({
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    statusOrder: REQUEST_STATUSES,
    activeTrips: activeTrips.map((t) => ({
      tripCode: t.tripCode,
      status: t.status,
      lastEventType: t.lastEventType,
      lastEventAt: t.lastEventAt?.toISOString() ?? null,
      driver: t.request?.driver?.fullName ?? '—',
      vehicle: t.request?.vehicle ? `${t.request.vehicle.model} · ${t.request.vehicle.plate}` : '—',
      from: t.points.find((p) => p.kind === 'loading')?.name ?? null,
      to: t.points.find((p) => p.kind === 'unloading')?.name ?? null,
    })),
    feed: feed.map((f) => ({ id: f.id, user: f.user, action: f.action, entity: f.entity, entityId: f.entityId, level: f.level, at: f.at.toISOString() })),
  })
}
