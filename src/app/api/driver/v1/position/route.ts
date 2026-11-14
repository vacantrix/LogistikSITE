import { NextRequest, NextResponse } from 'next/server'
import { DRIVER_ID } from '@/lib/demo/route-data'
import { getPosition, getPositions, savePosition } from '@/lib/server/positions'

/**
 * Канал телеметрии для мониторинга диспетчером:
 *
 *   POST /api/driver/v1/position — приложение водителя шлёт текущий фикс
 *        {lat, lon, speedKmh, heading, tripCode?, stage?, ts} раз в 5 с
 *        во время активного рейса (заголовок X-Driver-Id обязателен);
 *   GET  /api/driver/v1/position — снимок позиций (для моста в «Контур 1С»
 *        и отладки): ?driverId=… — один водитель, ?maxAgeMs=… — фильтр
 *        свежести, по умолчанию всё.
 */
export async function POST(req: NextRequest) {
  const driverId = req.headers.get('x-driver-id') ?? DRIVER_ID
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'Некорректный JSON' }, { status: 400 })
  }

  const lat = Number(body.lat)
  const lon = Number(body.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ ok: false, error: 'lat/lon вне диапазона' }, { status: 400 })
  }

  const rec = savePosition({
    driverId,
    lat,
    lon,
    speedKmh: Math.max(0, Number(body.speedKmh) || 0),
    heading: Number.isFinite(Number(body.heading)) ? Number(body.heading) : 0,
    tripCode: typeof body.tripCode === 'string' ? body.tripCode : undefined,
    stage: typeof body.stage === 'string' ? body.stage : undefined,
    ts: Number(body.ts) || Date.now(),
    receivedAt: Date.now(),
  })
  return NextResponse.json({ ok: true, receivedAt: rec.receivedAt })
}

export async function GET(req: NextRequest) {
  const driverId = req.nextUrl.searchParams.get('driverId')
  if (driverId) {
    const one = getPosition(driverId)
    return NextResponse.json(
      { position: one },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }
  const maxAgeMs = Number(req.nextUrl.searchParams.get('maxAgeMs') ?? '0') || 0
  return NextResponse.json(
    { positions: getPositions(maxAgeMs) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
