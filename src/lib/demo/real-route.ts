/**
 * Реальный маршрут из 2ГИС Routing API 7.0.0 (клиентский разбор detailed-ответа).
 *
 * Зачем: воркфлоу «Заявки» строит маршрут ЧЕСТНО — POST на наш серверный
 * прокси /api/2gis/routing (ключ только на сервере), ответ:
 *   result[0].total_distance / total_duration — дорога в метрах и секундах;
 *   result[0].maneuvers[] — begin/crossroad/end, у crossroad — turn_direction
 *   и comment («Поворот направо на ул. …»); outcoming_path.geometry[] —
 *   LINESTRING WKT + color: fast/normal/slow (пробочная окраска сегментов).
 *
 * Из этого собирается нормализованный маршрут:
 *   coords     — полная ломаная (для линии на карте и навигации);
 *   maneuvers  — с долей f вдоль маршрута (баннер манёвра, как у демо);
 *   segments   — склейка последовательных геометрий одного цвета (подсветка пробок).
 *
 * Деградация: API недоступен → null → приложение живёт на демо-геометрии А-146.
 */

import { LOADING_POINT, UNLOADING_POINT, haversineM } from './route-data'

export interface RealManeuver {
  /** Доля вдоль маршрута [0..1], где стоит манёвр. */
  f: number
  type: 'left' | 'right' | 'straight' | 'arrive'
  /** Улица/трасса после манёвра (из comment), для баннера. */
  street: string
  /** Исходный текст 2ГИС (для отладки и TTS в проде). */
  comment: string
  /** Длина пути ПОСЛЕ манёвра, м (из outcoming_path.distance). */
  distanceM: number
}

export type RealTrafficLevel = 'free' | 'normal' | 'slow'

export interface RealRouteSegment {
  level: RealTrafficLevel
  coords: [number, number][]
}

export interface RealRoute {
  coords: [number, number][]
  /** Длина ломаной (haversine), м — база для f и «осталось». */
  lengthM: number
  /** Дорога по 2ГИС (total_distance), м. */
  roadDistanceM: number
  /** Время в пути по 2ГИС (total_duration), с. */
  durationS: number
  maneuvers: RealManeuver[]
  segments: RealRouteSegment[]
  fetchedAt: number
  source: '2gis' | 'osrm'
}

const TRUCK_PARAMS = { mass: 28000, height: 4, width: 2.55, length: 14 }

function parseLinestring(wkt: string): [number, number][] {
  const i = wkt.indexOf('(')
  const body = wkt.slice(i + 1, wkt.lastIndexOf(')'))
  return body
    .split(',')
    .map((pair) => {
      const [lon, lat] = pair.trim().split(/\s+/).map(Number)
      return [lon, lat] as [number, number]
    })
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
}

function streetFromComment(comment: string): string {
  const m = comment.match(/\sна\s(.+)$/)
  return (m ? m[1] : comment).trim()
}

function levelOf(color: string | undefined): RealTrafficLevel {
  if (color === 'slow') return 'slow'
  if (color === 'normal') return 'normal'
  return 'free'
}

export function parseRealRoute(r: {
  total_distance: number
  total_duration: number
  maneuvers: Array<{
    type?: string
    turn_direction?: string | null
    comment?: string | null
    outcoming_path?: { distance?: number; geometry?: Array<{ color?: string; selection?: string }> }
  }>
}): RealRoute | null {
  const coords: [number, number][] = []
  const maneuvers: RealManeuver[] = []
  const segments: RealRouteSegment[] = []
  let cumLen = 0

  const pushCoords = (next: [number, number][]) => {
    for (const c of next) {
      const last = coords[coords.length - 1]
      if (last && last[0] === c[0] && last[1] === c[1]) continue
      if (last) cumLen += haversineM(last, c)
      coords.push(c)
    }
  }

  for (const m of r.maneuvers ?? []) {
    const geom = m.outcoming_path?.geometry ?? []
    const pathCoords = geom.flatMap((g) => (g.selection ? parseLinestring(g.selection) : []))
    const f = cumLen // манёвр стоит в начале своего outcoming_path
    if (m.type === 'end') {
      maneuvers.push({ f: 1, type: 'arrive', street: 'точка выгрузки', comment: m.comment ?? 'finish', distanceM: 0 })
    } else if (m.type === 'begin') {
      // старт маршрута — не показываем в баннере
    } else {
      const dir = (m.turn_direction ?? '').toLowerCase()
      const type: RealManeuver['type'] = dir === 'left' ? 'left' : dir === 'right' ? 'right' : 'straight'
      maneuvers.push({
        f,
        type,
        street: streetFromComment(m.comment ?? ''),
        comment: m.comment ?? '',
        distanceM: m.outcoming_path?.distance ?? 0,
      })
    }
    pushCoords(pathCoords)
    // склейка пробочных сегментов: последовательные geometry одного цвета
    for (const g of geom) {
      const level = levelOf(g.color)
      const gCoords = g.selection ? parseLinestring(g.selection) : []
      const lastSeg = segments[segments.length - 1]
      if (lastSeg && lastSeg.level === level) {
        for (const c of gCoords) {
          const last = lastSeg.coords[lastSeg.coords.length - 1]
          if (!last || last[0] !== c[0] || last[1] !== c[1]) lastSeg.coords.push(c)
        }
      } else if (gCoords.length > 1) {
        segments.push({ level, coords: gCoords })
      }
    }
  }

  if (coords.length < 2) return null
  // f копился как кумулятивные метры — нормализуем в доли [0..1]
  const totalLen = cumLen
  if (totalLen > 0) {
    for (const m of maneuvers) {
      if (m.type !== 'arrive') m.f = Math.min(0.999, m.f / totalLen)
    }
  }
  return {
    coords,
    lengthM: cumLen,
    roadDistanceM: r.total_distance ?? cumLen,
    durationS: r.total_duration ?? 0,
    maneuvers,
    segments,
    fetchedAt: Date.now(),
    source: '2gis',
  }
}

/** Точка на произвольной ломаной по доле f + азимут участка (для навигации). */
export function pointOnRoute(
  coords: [number, number][],
  f: number,
  preLen?: number,
): { lng: number; lat: number; bearing: number } {
  if (coords.length < 2) return { lng: coords[0]?.[0] ?? 0, lat: coords[0]?.[1] ?? 0, bearing: 0 }
  const total = preLen ?? polylineLengthM(coords)
  let target = Math.max(0, Math.min(1, f)) * total
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]
    const b = coords[i]
    const seg = haversineM(a, b)
    if (target <= seg || i === coords.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, target / seg)
      return {
        lng: a[0] + (b[0] - a[0]) * t,
        lat: a[1] + (b[1] - a[1]) * t,
        bearing: bearingDeg(a, b),
      }
    }
    target -= seg
  }
  const last = coords[coords.length - 1]
  return { lng: last[0], lat: last[1], bearing: 0 }
}

function polylineLengthM(coords: [number, number][]): number {
  let sum = 0
  for (let i = 1; i < coords.length; i++) sum += haversineM(coords[i - 1], coords[i])
  return sum
}

function bearingDeg(a: [number, number], b: [number, number]): number {
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const la1 = (a[1] * Math.PI) / 180
  const la2 = (b[1] * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos(la2)
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/**
 * Маршрут — публичный OSRM (данные OpenStreetMap, без API-ключей).
 * 2ГИС убран из демо по решению пилота: запрос маршрута больше не зависит
 * от 2ГИС Routing API и его ключа. Контракт RealRoute сохранён, поэтому
 * карта, ETA и баннеры живут без изменений. В проде OSRM поднимается
 * рядом с бэкендом каркаса (своя выгрузка OSM РФ) — адрес в одной переменной.
 */
export async function fetchRealRoute(
  signal?: AbortSignal,
  waypoints?: { lat: number; lng: number }[],
): Promise<RealRoute | null> {
  // Офисный маршрут: строим линию через ВСЕ точки Яндекс.Карт по порядку,
  // а не от фиксированных демо-точек. Так маршрут в приложении повторяет
  // маршрут, который диспетчер построил в Яндексе.
  if (waypoints && waypoints.length >= 2) {
    const through = await fetchOsrmThrough(waypoints, signal)
    if (through) return through
  }
  const variants = await fetchOsrmVariants(
    { lat: LOADING_POINT.lat, lng: LOADING_POINT.lon },
    { lat: UNLOADING_POINT.lat, lng: UNLOADING_POINT.lon },
    signal,
  )
  const main = variants[0]
  if (!main) return null
  return {
    coords: main.coords,
    lengthM: main.lengthM,
    roadDistanceM: main.lengthM,
    durationS: main.durationS,
    maneuvers: [],
    segments: [],
    fetchedAt: Date.now(),
    source: 'osrm',
  }
}

/** RealRoute из готовой линии офиса ([[lon,lat],…]) — без запроса к сети. */
export function routeFromCoords(
  coords: [number, number][],
  distanceM?: number | null,
  durationS?: number | null,
): RealRoute | null {
  if (!Array.isArray(coords) || coords.length < 2) return null
  const lengthM = polylineLengthM(coords)
  return {
    coords,
    lengthM,
    roadDistanceM: distanceM && distanceM > 0 ? distanceM : lengthM,
    durationS: durationS && durationS > 0 ? durationS : lengthM / (55_000 / 3600),
    maneuvers: [],
    segments: [],
    fetchedAt: Date.now(),
    source: 'osrm',
  }
}

/**
 * Маршрут по заявке: сначала готовая линия офиса (мгновенно, работает даже
 * при недоступном OSRM), затем построение через точки офиса, затем демо.
 */
export async function fetchRouteForOrder(
  order: {
    routeCoords?: [number, number][]
    routeWaypoints?: { lat: number; lng: number }[]
    routeDistanceM?: number | null
    routeDurationS?: number | null
  },
  signal?: AbortSignal,
): Promise<RealRoute | null> {
  const direct = routeFromCoords(order.routeCoords ?? [], order.routeDistanceM, order.routeDurationS)
  if (direct) return direct
  return fetchRealRoute(signal, order.routeWaypoints)
}

/**
 * OSRM через все точки по порядку. alternatives=false: с промежуточными
 * точками сервер не гарантирует варианты, а офисный маршрут должен быть
 * один — ровно тот, что построил диспетчер.
 */
export async function fetchOsrmThrough(
  waypoints: { lat: number; lng: number }[],
  signal?: AbortSignal,
): Promise<RealRoute | null> {
  if (waypoints.length < 2) return null
  const path =
    waypoints.map((p) => `${p.lng},${p.lat}`).join(';') +
    '?overview=full&geometries=geojson&alternatives=false&steps=false'
  for (const base of OSRM_BASES) {
    if (signal?.aborted) return null
    try {
      const res = await fetch(`${base}${path}`, { signal: osrmSignal(signal) })
      if (!res.ok) continue
      const data = (await res.json()) as {
        code?: string
        routes?: Array<{
          distance: number
          duration: number
          geometry: { coordinates: [number, number][] }
        }>
      }
      const r = data.code === 'Ok' ? data.routes?.[0] : undefined
      if (!r?.geometry?.coordinates?.length) continue
      return routeFromCoords(r.geometry.coordinates, r.distance, r.duration)
    } catch {
      // следующий адрес OSRM
    }
  }
  return null
}

export interface OsrmVariant {
  coords: [number, number][]
  lengthM: number
  durationS: number
}

/**
 * Сначала свой origin: Caddy на vacantrix.ru проксирует /osrm/* на OSRM.
 * С мобильных сетей РФ публичный router.project-osrm.org часто недоступен,
 * поэтому он оставлен вторым адресом для стендов без прокси.
 */
const OSRM_BASES = [
  '/osrm/route/v1/driving/',
  'https://router.project-osrm.org/route/v1/driving/',
]

/** Таймаут запроса маршрута: без него «Строим маршрут…» может висеть вечно. */
const OSRM_TIMEOUT_MS = 9000

function osrmSignal(signal?: AbortSignal): AbortSignal | undefined {
  if (signal) return signal
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(OSRM_TIMEOUT_MS)
  }
  return undefined
}

/**
 * Варианты поездки от точки до точки: [0] — рекомендованный, далее альтернативы
 * (alternatives=true). Ничего не вернул (нет сети / офлайн / таймаут) — пустой
 * список, вызывающий остаётся на демо-геометрии.
 */
export async function fetchOsrmVariants(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<OsrmVariant[]> {
  const path =
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    '?overview=full&geometries=geojson&alternatives=true&steps=false'
  for (const base of OSRM_BASES) {
    if (signal?.aborted) return []
    try {
      const res = await fetch(`${base}${path}`, { signal: osrmSignal(signal) })
      if (!res.ok) continue
      const data = (await res.json()) as {
        code?: string
        routes?: Array<{
          distance: number
          duration: number
          geometry: { coordinates: [number, number][] }
        }>
      }
      if (data.code !== 'Ok' || !data.routes?.length) continue
      return data.routes.map((r) => ({
        coords: r.geometry.coordinates,
        lengthM: r.distance,
        durationS: r.duration,
      }))
    } catch {
      // пробуем следующий адрес: прокси мог не ответить, публичный — ответит
    }
  }
  return []
}

/**
 * Расстояние от точки до ближайшего участка ломаной, м.
 * Основа решения «водитель отклонился → перестроить маршрут».
 */
export function distToPolylineM(
  p: { lat: number; lng: number },
  coords: [number, number][],
): number {
  if (coords.length === 0) return Number.POSITIVE_INFINITY
  let best = Number.POSITIVE_INFINITY
  for (const c of coords) {
    const d = haversineM([p.lng, p.lat], c)
    if (d < best) best = d
    if (best < 25) break // ближе некуда — дальше не считаем
  }
  return best
}

export interface RouteProjection {
  /** Пройдено вдоль маршрута до проекции точки, м. */
  distAlongM: number
  /** Отклонение точки от маршрута (до проекции), м. */
  offRouteM: number
  /** Доля вдоль маршрута [0..1]. */
  f: number
  /** Азимут сегмента, на который легла проекция, град. */
  bearing: number
}

/**
 * Проекция точки на ломаную маршрута: ГДЕ вдоль маршрута мы находимся и
 * НАСКОЛЬКО от него отклонились. На этом стоят «осталось N км», ETA и
 * финиш по фактическому приближению к точке выгрузки (вместо симуляции).
 * Локальные метры (equirectangular) — для городских расстояний точность ~0,1%.
 */
export function projectOnRoute(
  coords: [number, number][],
  p: { lat: number; lng: number },
): RouteProjection {
  if (coords.length === 0) {
    return { distAlongM: 0, offRouteM: Number.POSITIVE_INFINITY, f: 0, bearing: 0 }
  }
  if (coords.length === 1) {
    return {
      distAlongM: 0,
      offRouteM: haversineM([p.lng, p.lat], coords[0]),
      f: 0,
      bearing: 0,
    }
  }
  const cosLat0 = Math.cos((p.lat * Math.PI) / 180)
  const mx = (c: [number, number]) => c[0] * 111_320 * cosLat0 // м по долготе
  const my = (c: [number, number]) => c[1] * 110_574 // м по широте
  const px = mx([p.lng, p.lat])
  const py = my([p.lng, p.lat])
  let bestD2 = Number.POSITIVE_INFINITY
  let bestAlong = 0
  let bestBearing = 0
  let along = 0
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]
    const b = coords[i]
    const ax = mx(a)
    const ay = my(a)
    const bx = mx(b)
    const by = my(b)
    const segLen = Math.hypot(bx - ax, by - ay)
    const t =
      segLen === 0
        ? 0
        : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (segLen * segLen)))
    const cx = ax + (bx - ax) * t
    const cy = ay + (by - ay) * t
    const d2 = (px - cx) ** 2 + (py - cy) ** 2
    if (d2 < bestD2) {
      bestD2 = d2
      bestAlong = along + segLen * t
      bestBearing = bearingDeg(a, b)
    }
    along += segLen
  }
  return {
    distAlongM: bestAlong,
    offRouteM: Math.sqrt(bestD2),
    f: along > 0 ? Math.min(1, bestAlong / along) : 0,
    bearing: bestBearing,
  }
}

