// Мониторинг водителей: живые GPS-позиции с приложений водителей (телеметрия).
//
// Источник — драйверский сервер (:3002) GET /api/driver/v1/position: приложение
// шлёт фикс каждые 5 с, пока рейс в пути. Здесь позиции связываются со
// справочником водителей (appId) и активными рейсами: диспетчер видит машину
// на мини-карте прямо в «Контур 1С» — раздел «Управление автопарком».
import { db } from '@/lib/db'
import { jsonOffice } from '@/lib/cors'

export const dynamic = 'force-dynamic'

const DRIVER_SERVER = process.env.KONTUR_DRIVER_URL ?? 'http://127.0.0.1:3002'
/** Позиция старше этого времени считается «потерянной» (приложение закрыто). */
const STALE_MS = 5 * 60 * 1000

type PositionDto = {
  driverId: string
  lat: number
  lon: number
  speedKmh: number
  heading: number
  tripCode?: string
  stage?: string
  ts: number
  receivedAt: number
}

type TrackRow = {
  driverId: string
  driverName: string
  vehicleLabel: string | null
  tripNumber: string | null
  status: string | null
  fromName: string | null
  toName: string | null
  lat: number
  lon: number
  speedKmh: number
  heading: number
  fixAt: number
  receivedAt: number
  ageMs: number
  stale: boolean
  /** Ломаная маршрута [[lon, lat], …] для мини-карты (если рейс известен). */
  routeCoords: [number, number][]
  routeDistanceM: number | null
  points: { kind: string; name: string | null; lat: number; lon: number }[]
}

function parseRoute(geoJson: string | null | undefined): [number, number][] {
  if (!geoJson) return []
  try {
    const g = JSON.parse(geoJson) as { type?: string; coordinates?: unknown }
    if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
      return g.coordinates.filter(
        (c): c is [number, number] => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]),
      )
    }
  } catch {
    // битая геометрия — карта покажет только маркер машины
  }
  return []
}

export async function GET() {
  try {
    return await build()
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) },
      { status: 500 },
    )
  }
}

async function build() {
  let positions: PositionDto[] = []
  let sourceError: string | null = null
  try {
    const res = await fetch(`${DRIVER_SERVER}/api/driver/v1/position?maxAgeMs=${STALE_MS}`, {
      cache: 'no-store',
      headers: { 'X-Source': 'kontur-tracking' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { positions?: PositionDto[] }
    positions = data.positions ?? []
  } catch (e) {
    sourceError = e instanceof Error ? e.message : 'сервер телеметрии недоступен'
  }

  const drivers = await db.driver.findMany({ where: { appId: { not: null } } })
  const byAppId = new Map(drivers.map((d) => [d.appId as string, d]))

  const rows: TrackRow[] = []
  for (const p of positions) {
    const driver = byAppId.get(p.driverId)
    // рейс: сначала по номеру из фикса, иначе — последний незавершённый рейс водителя
    const request = await db.transportRequest.findFirst({
      where: p.tripCode
        ? { number: p.tripCode }
        : { driverId: driver?.id ?? undefined, status: { in: ['assigned', 'accepted', 'in_progress', 'PRETRIP'] } },
      include: {
        vehicle: true,
        fromLocation: true,
        toLocation: true,
        trip: { include: { points: { orderBy: { seqNo: 'asc' } } } },
      },
    })
    const ageMs = Date.now() - p.receivedAt
    rows.push({
      driverId: p.driverId,
      driverName: driver?.fullName ?? 'Водитель (без профиля)',
      vehicleLabel: request?.vehicle ? `${request.vehicle.model} · ${request.vehicle.plate}` : null,
      tripNumber: request?.number ?? p.tripCode ?? null,
      status: request?.status ?? null,
      fromName: request?.fromLocation?.name ?? null,
      toName: request?.toLocation?.name ?? null,
      lat: p.lat,
      lon: p.lon,
      speedKmh: p.speedKmh,
      heading: p.heading,
      fixAt: p.ts,
      receivedAt: p.receivedAt,
      ageMs,
      stale: ageMs > 60_000,
      routeCoords: parseRoute(request?.trip?.routeGeoJson),
      routeDistanceM: request?.trip?.routeDistanceM ?? null,
      points: (request?.trip?.points ?? []).map((pt) => ({ kind: pt.kind, name: pt.name, lat: pt.lat, lon: pt.lon })),
    })
  }

  // свежие выше, среди них — по скорости (в движении заметнее)
  rows.sort((a, b) => a.ageMs - b.ageMs)

  return jsonOffice({ rows, sourceError, serverTime: Date.now() })
}
