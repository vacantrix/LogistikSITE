import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'
import { db as platformDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Карточка рейса: плечи, таймлайн (status_events + trip_events), документы, аудит.
// Аудит — из единого журнала платформы (PlatformLog, контур dispatcher):
// отдельной таблицы аудита контура больше нет.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const trip = await db.trip.findUnique({ where: { id } })
  if (!trip) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Рейс не найден' } }, { status: 404 })

  const legIds = (await db.leg.findMany({ where: { tripId: id }, select: { id: true } })).map((l) => l.id)
  const [legs, statusEvents, tripEvents, files, audit] = await Promise.all([
    db.leg.findMany({ where: { tripId: id }, orderBy: { seq: 'asc' } }),
    db.statusEvent.findMany({ where: { legId: { in: legIds } }, orderBy: { serverTs: 'asc' } }),
    db.tripEvent.findMany({ where: { tripId: id }, orderBy: { at: 'asc' } }),
    db.fileRec.findMany({ where: { ownerType: 'leg', ownerId: { in: legIds } }, orderBy: { createdAt: 'asc' } }),
    legIds.length
      ? platformDb.platformLog.findMany({
          where: { contour: 'dispatcher', objectType: 'leg', objectId: { in: legIds } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }).then((rows) => rows.map((r) => ({
          id: r.id,
          actorRole: r.actorRole ?? 'system',
          actorName: r.actorName,
          object: r.objectType ?? 'leg',
          objectId: r.objectId ?? '',
          field: r.type?.includes('.') ? r.type.split('.').slice(1).join('.') : null,
          was: r.before,
          became: r.after,
          comment: r.message,
          at: r.createdAt.toISOString(),
        })))
      : Promise.resolve([]),
  ])

  const [driver, vehicle, trailer] = await Promise.all([
    db.driver.findUnique({ where: { id: trip.driverId } }),
    db.vehicle.findUnique({ where: { id: trip.vehicleId } }),
    trip.trailerId ? db.trailer.findUnique({ where: { id: trip.trailerId } }) : null,
  ])

  return NextResponse.json({ trip, legs, statusEvents, tripEvents, files, audit, driver, vehicle, trailer })
}
