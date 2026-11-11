// Расчёт маршрута: серверный прокси 2ГИС Routing API (GIS2_API_KEY),
// при недоступности — заглушка: прямая между пунктами, время по средней скорости.
// Роутинг никогда не блокирует транзакцию назначения.
import { haversineM } from '../epoch'

type Pt = { lat: number; lon: number }

export type RouteResult = {
  routeGeoJson: string
  routeStepsJson: string | null
  routeDistanceM: number
  routeDurationS: number
  routeMinLat: number
  routeMinLon: number
  routeMaxLat: number
  routeMaxLon: number
  provider: '2gis' | 'stub'
}

function stubRoute(a: Pt, b: Pt): RouteResult {
  const straight = haversineM(a, b)
  const distanceM = Math.round(straight * 1.2) // коэффициент извилистости автодорог
  const avgKmh = 55
  const durationS = Math.round((distanceM / 1000 / avgKmh) * 3600)
  const geo = {
    type: 'LineString',
    coordinates: [0, 0.25, 0.5, 0.75, 1].map((k) => [
      +(a.lon + (b.lon - a.lon) * k).toFixed(6),
      +(a.lat + (b.lat - a.lat) * k).toFixed(6),
    ]),
  }
  return {
    routeGeoJson: JSON.stringify(geo),
    routeStepsJson: null,
    routeDistanceM: distanceM,
    routeDurationS: durationS,
    routeMinLat: Math.min(a.lat, b.lat),
    routeMinLon: Math.min(a.lon, b.lon),
    routeMaxLat: Math.max(a.lat, b.lat),
    routeMaxLon: Math.max(a.lon, b.lon),
    provider: 'stub',
  }
}

export async function computeRoute(from: Pt, to: Pt): Promise<RouteResult> {
  const key = process.env.GIS2_API_KEY
  if (!key) return stubRoute(from, to)
  try {
    const url = `https://routing.api.2gis.com/routing/7.0.0?key=${encodeURIComponent(key)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: [
          { type: 'stop', lon: from.lon, lat: from.lat },
          { type: 'stop', lon: to.lon, lat: to.lat },
        ],
        transport: 'truck',
        traffic_mode: 'jam',
        output: 'detailed',
      }),
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return stubRoute(from, to)
    const data = (await res.json()) as {
      route?: { distance?: number; duration?: number; geometry?: string; maneuvers?: unknown[] }
    }
    const r = data.route
    if (!r || !r.distance || !r.duration) return stubRoute(from, to)
    let geometry: { type: string; coordinates: number[][] } | null = null
    if (r.geometry) {
      try {
        geometry = JSON.parse(r.geometry)
      } catch {
        geometry = null
      }
    }
    if (!geometry || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
      return stubRoute(from, to)
    }
    const lats = geometry.coordinates.map((c) => c[1])
    const lons = geometry.coordinates.map((c) => c[0])
    return {
      routeGeoJson: JSON.stringify(geometry),
      routeStepsJson: r.maneuvers ? JSON.stringify(r.maneuvers) : null,
      routeDistanceM: Math.round(r.distance),
      routeDurationS: Math.round(r.duration),
      routeMinLat: Math.min(...lats),
      routeMinLon: Math.min(...lons),
      routeMaxLat: Math.max(...lats),
      routeMaxLon: Math.max(...lons),
      provider: '2gis',
    }
  } catch {
    return stubRoute(from, to)
  }
}
