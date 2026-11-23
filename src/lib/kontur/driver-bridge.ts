/**
 * Мост «офис → приложение водителя» для APK.
 *
 * PWA получает маршрут из ленты `/api/1c/orders`, а нативное приложение —
 * из журнала синхронизации сервиса водителя (:3102). Когда офис сохраняет
 * маршрут Яндекс.Карт, мост отправляет в журнал снимок рейса и двух точек
 * (погрузка/выгрузка) с готовой геометрией и точками маршрута. APK забирает
 * запись ближайшим sync/pull или long-poll и сразу видит маршрут.
 *
 * Пилотная конфигурация — демо-водитель APK. Для реальных водителей задайте
 * DRIVER_APP_DRIVER_ID (id водителя в приложении) или карту соответствия
 * DRIVER_APP_ID_MAP='{"<id офиса>":"<id приложения>"}'.
 */

type TripLike = {
  id: string
  driverId: string
  vehicleId: string
  status: string
}

type LegLike = {
  id: string
  seq: number
  loadPoint: string
  unloadPoint: string
  loadDatePlan?: Date | null
  unloadDatePlan?: Date | null
  routeGeometry?: string | null
  routeWaypoints?: string | null
  routeDistanceM?: number | null
  routeDurationS?: number | null
}

type Waypoint = { lat: number; lng: number }

const DEMO_DRIVER_ID = '06c075d1-3088-45f2-a7ae-090e8c355447'
const DEMO_TRIP_ID = '7e6a1c2d-8a9b-4c3d-9e0f-112233445566'
const DEMO_LOADING_ID = 'p1-loading-0000-4000-8000-000000000001'
const DEMO_UNLOADING_ID = 'p2-unloading-0000-4000-8000-000000000002'
const DEFAULT_INGEST = 'http://127.0.0.1:3102/driver/api/driver/v1/ingest'

function env(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback
}

/** id офиса → id приложения; по умолчанию демо-водитель стенда. */
function appDriverId(officeDriverId: string): string | null {
  const mapRaw = env('DRIVER_APP_ID_MAP')
  if (mapRaw) {
    try {
      const map = JSON.parse(mapRaw) as Record<string, string>
      if (map[officeDriverId]) return map[officeDriverId]
    } catch {
      // карта задана с ошибкой — работаем по простому правилу ниже
    }
  }
  const demo = env('DRIVER_APP_DRIVER_ID', DEMO_DRIVER_ID)
  // Пилот с одним телефоном: офис ещё не ведёт водителей в приложении,
  // поэтому любой сохранённый маршрут уходит на демо-устройство. В парке
  // выключается (DRIVER_APP_SINGLE_DRIVER=0), и работает только точная карта.
  if (env('DRIVER_APP_SINGLE_DRIVER') === '1') return demo
  return officeDriverId === demo ? demo : null
}

function bbox(coords: [number, number][]) {
  if (coords.length === 0) return null
  const lats = coords.map((c) => c[1])
  const lons = coords.map((c) => c[0])
  return {
    minLat: Math.min(...lats),
    minLon: Math.min(...lons),
    maxLat: Math.max(...lats),
    maxLon: Math.max(...lons),
  }
}

function parseCoords(geoJson: string | null | undefined): [number, number][] {
  if (!geoJson) return []
  try {
    const obj = JSON.parse(geoJson) as { type?: string; coordinates?: unknown }
    if (obj.type !== 'LineString' || !Array.isArray(obj.coordinates)) return []
    return obj.coordinates.flatMap((c) => {
      if (!Array.isArray(c) || c.length < 2) return []
      const lng = Number(c[0])
      const lat = Number(c[1])
      return Number.isFinite(lat) && Number.isFinite(lng) ? [[lng, lat] as [number, number]] : []
    })
  } catch {
    return []
  }
}

export type DriverBridgeResult =
  | { sent: true; written: number; skipped: number; driverId: string; tripId: string }
  | { sent: false; skipped?: boolean; reason?: string; error?: string }

/**
 * Отправляет маршрут в журнал сервиса водителя. Best-effort: офис уже
 * сохранил маршрут в своей БД, поэтому недоступность моста не ошибка.
 */
export async function pushRouteToDriverApp(input: {
  trip: TripLike
  leg: LegLike
  waypoints: Waypoint[]
  link: string
  tripCode?: string | null
}): Promise<DriverBridgeResult> {
  const { trip, leg, waypoints, link } = input
  const driverId = appDriverId(trip.driverId)
  if (!driverId) {
    return { sent: false, skipped: true, reason: 'Рейс назначен не на демо-водителя приложения' }
  }
  if (waypoints.length < 2) {
    return { sent: false, skipped: true, reason: 'В маршруте меньше двух точек' }
  }

  const coords = parseCoords(leg.routeGeometry)
  const box = bbox(coords.length > 1 ? coords : waypoints.map((p) => [p.lng, p.lat] as [number, number]))
  const now = Date.now()
  const startMs = (leg.loadDatePlan ?? new Date()).getTime()
  const finishMs = (leg.unloadDatePlan ?? new Date(now + 6 * 3600_000)).getTime()
  const status = trip.status === 'active' ? 'in_progress' : trip.status === 'completed' ? 'completed' : 'assigned'
  const tripCode = input.tripCode?.trim() || `Z-${leg.seq}`

  // Пилот: APK работает с одним демо-рейсом; перезаписываем именно его,
  // чтобы не появилось два активных рейса. Для реального парка задайте
  // DRIVER_APP_TRIP_ID пустым — тогда используется id рейса офиса.
  const appTripId = env('DRIVER_APP_TRIP_ID', DEMO_TRIP_ID) || trip.id
  const loadingId = env('DRIVER_APP_POINT_LOADING_ID', DEMO_LOADING_ID) || `${leg.id}-load`
  const unloadingId = env('DRIVER_APP_POINT_UNLOADING_ID', DEMO_UNLOADING_ID) || `${leg.id}-unload`
  const first = waypoints[0]
  const last = waypoints[waypoints.length - 1]

  const tripSnapshot = {
    id: appTripId,
    tripCode,
    status,
    driverId,
    vehicleId: trip.vehicleId,
    plannedStartAt: startMs,
    plannedFinishAt: finishMs,
    routeGeoJson: leg.routeGeometry ?? undefined,
    routeWaypointsJson: JSON.stringify(waypoints.map((p) => [p.lat, p.lng])),
    routeDistanceM: leg.routeDistanceM ?? undefined,
    routeDurationS: leg.routeDurationS ?? undefined,
    ...(box ?? {}),
    lastEventType: 'ROUTE_SET',
    lastEventAt: now,
  }

  const points = [
    {
      id: loadingId,
      tripId: appTripId,
      seqNo: 1,
      kind: 'loading',
      name: leg.loadPoint,
      address: leg.loadPoint,
      lat: first.lat,
      lon: first.lng,
      geofenceRadiusM: 300,
      plannedArrivalAt: startMs,
    },
    {
      id: unloadingId,
      tripId: appTripId,
      seqNo: 2,
      kind: 'unloading',
      name: leg.unloadPoint,
      address: leg.unloadPoint,
      lat: last.lat,
      lon: last.lng,
      geofenceRadiusM: 300,
      plannedArrivalAt: finishMs,
    },
  ]

  const url = env('DRIVER_APP_INGEST_URL', DEFAULT_INGEST)
  const token = env('DRIVER_APP_INGEST_TOKEN', env('DRIVER_INGEST_TOKEN', 'azmz-stand-bridge-2026'))
  const entries = [
    { entity: 'TRIP', op: 'UPSERT', payload: tripSnapshot },
    { entity: 'TRIP_POINT', op: 'UPSERT', payload: points[0] },
    { entity: 'TRIP_POINT', op: 'UPSERT', payload: points[1] },
    { entity: 'SYSTEM_NOTE', op: 'UPSERT', payload: {
      id: `${appTripId}-route-${now}`,
      driverId,
      kind: 'route',
      body: `Офис обновил маршрут: ${link}`,
      createdAt: now,
    } },
  ]

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-token': token },
      body: JSON.stringify({ driverId, entries }),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
      cache: 'no-store',
    })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; written?: number; skipped?: number; error?: string } | null
    if (!res.ok || !data?.ok) {
      return { sent: false, error: data?.error ?? `HTTP ${res.status}` }
    }
    return {
      sent: true,
      written: data.written ?? 0,
      skipped: data.skipped ?? 0,
      driverId,
      tripId: appTripId,
    }
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) }
  }
}
