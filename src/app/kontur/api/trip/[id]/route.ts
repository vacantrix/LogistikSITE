import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'

export const dynamic = 'force-dynamic'

// Карточка рейса: плечи, таймлайн (status_events + trip_events), документы, аудит
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const trip = await db.trip.findUnique({ where: { id } })
  if (!trip) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Рейс не найден' } }, { status: 404 })

  const [legs, statusEvents, tripEvents, files, audit] = await Promise.all([
    db.leg.findMany({ where: { tripId: id }, orderBy: { seq: 'asc' } }),
    db.statusEvent.findMany({ where: { legId: { in: (await db.leg.findMany({ where: { tripId: id }, select: { id: true } })).map((l) => l.id) } }, orderBy: { serverTs: 'asc' } }),
    db.tripEvent.findMany({ where: { tripId: id }, orderBy: { at: 'asc' } }),
    db.fileRec.findMany({ where: { ownerType: 'leg', ownerId: { in: (await db.leg.findMany({ where: { tripId: id }, select: { id: true } })).map((l) => l.id) } }, orderBy: { createdAt: 'asc' } }),
    db.auditLog.findMany({ where: { object: 'leg', objectId: { in: (await db.leg.findMany({ where: { tripId: id }, select: { id: true } })).map((l) => l.id) } }, orderBy: { at: 'desc' }, take: 20 }),
  ])

  const [driver, vehicle, trailer] = await Promise.all([
    db.driver.findUnique({ where: { id: trip.driverId } }),
    db.vehicle.findUnique({ where: { id: trip.vehicleId } }),
    trip.trailerId ? db.trailer.findUnique({ where: { id: trip.trailerId } }) : null,
  ])

  return NextResponse.json({ trip, legs, statusEvents, tripEvents, files, audit, driver, vehicle, trailer })
}
