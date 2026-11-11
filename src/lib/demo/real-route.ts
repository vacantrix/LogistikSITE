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
  source: '2gis'
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

/** Запрос маршрута у 2ГИС через серверный прокси (ключ не покидает сервер). */
export async function fetchRealRoute(signal?: AbortSignal): Promise<RealRoute | null> {
  try {
    const res = await fetch('/api/2gis/routing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        points: [
          [LOADING_POINT.lon, LOADING_POINT.lat],
          [UNLOADING_POINT.lon, UNLOADING_POINT.lat],
        ],
        transport: 'truck',
        truck_params: TRUCK_PARAMS,
        traffic_mode: 'jam',
        output: 'detailed',
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { result?: Parameters<typeof parseRealRoute>[0][] }
    const first = data?.result?.[0]
    if (!first?.maneuvers?.length) return null
    return parseRealRoute(first)
  } catch {
    return null
  }
}
