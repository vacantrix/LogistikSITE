import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'

export const dynamic = 'force-dynamic'

// B7.2.2: GET /driver/trips?driverId= — только свои рейсы (B2.4 row-level).
// Рейс, переданный другому водителю, скрывается (ACCESS_REVOKED, B5.8.2)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const driverId = searchParams.get('driverId')
  if (!driverId) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'driverId обязателен' } }, { status: 400 })
  }
  const trips = await db.trip.findMany({ where: { driverId }, orderBy: { createdAt: 'desc' } })
  const legs = await db.leg.findMany({
    where: { tripId: { in: trips.map((t) => t.id) } },
    orderBy: { seq: 'asc' },
  })
  // Какие рейсы водитель потерял: активные, где он уже не водитель, но было назначение
  const activeTrips = await db.trip.findMany({ where: { status: 'active' } })
  const revoked = activeTrips.filter((t) => t.driverId !== driverId)
  return NextResponse.json({
    trips: trips.map((t) => ({ ...t, legs: legs.filter((l) => l.tripId === t.id) })),
    accessRevokedTripIds: revoked.map((t) => t.id),
  })
}
