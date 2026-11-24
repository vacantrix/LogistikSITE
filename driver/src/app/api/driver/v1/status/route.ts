import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/server/seed'
import { DRIVER_ID } from '@/lib/demo/route-data'
import { getPosition } from '@/lib/server/positions'

/**
 * GET /api/driver/v1/status — сводка модуля водителя для панели
 * «Приложение водителя» в «АЭМЗ Поток». Без персональных данных:
 * только состояние сервиса, журнала, очереди и последняя GPS-точка.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await ensureSeeded()
  const driverId = req.headers.get('x-driver-id') ?? DRIVER_ID

  const [trips, activeTrips, events, journal, pending] = await Promise.all([
    db.trip.count({ where: { driverId } }),
    db.trip.count({ where: { driverId, status: { in: ['assigned', 'in_progress'] } } }),
    db.tripEvent.count({ where: { driverId } }),
    db.syncJournal.findFirst({ where: { driverId }, orderBy: { seq: 'desc' }, select: { seq: true } }),
    db.syncOperation.count({ where: { driverId, state: 'PENDING' } }),
  ])
  const position = getPosition(driverId)

  return NextResponse.json(
    {
      ok: true,
      service: 'aemz-driver',
      version: '0.3.2',
      driverId,
      trips,
      activeTrips,
      events,
      journalSeq: journal?.seq ?? 0,
      pendingOutbox: pending,
      position,
      now: Date.now(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
