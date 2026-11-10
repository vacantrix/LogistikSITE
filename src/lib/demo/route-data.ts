/**
 * Демо-данные устройства: маршрут рейса Z-1067 (Абинск → Новороссийск),
 * манёвры для навигации, улицы офлайн-поиска, константы сессии.
 * Геометрия маршрута — настоящие дороги OSM (трасса А-146, ~63 км):
 * сгенерирована скриптом scripts/bake_route.py из OSRM, см. route-geometry.ts.
 * Маршрут, манёвры и сегменты пробок идут ПО ДОРОГАМ. Коммерческие 200 км
 * рейса считаются от routeDistanceM (решение прототипа).
 */

import type { DemoStreet } from '@/lib/protocol'
import { BAKED_MANEUVERS, BAKED_START_F, ROUTE_LNGLAT, SIDE_STREET_LINES } from './route-geometry'

export { ROUTE_LNGLAT } from './route-geometry'

export const DRIVER_ID = 'a1b2c3d4-1111-4222-8333-444455556666'
export const VEHICLE_ID = 'b2c3d4e5-2222-4333-9444-555566667777'
export const DEVICE_ID = 'c3d4e5f6-3333-4444-a555-666677778888'
export const TRIP_ID = '7e6a1c2d-8a9b-4c3d-9e0f-112233445566'

export const DRIVER_NAME = 'Смирнов А. В.'
export const VEHICLE_LABEL = 'КАМАЗ 65207 • АТ 2147 23'
export const DISPATCHER_NAME = 'Соколов Д.'


export const LOADING_POINT = {
  id: 'p1-loading-0000-4000-8000-000000000001',
  lat: 44.8682,
  lon: 38.157,
  name: 'АБЗ «Абинск»',
  address: 'Абинск, ул. Северная, 4',
}

export const UNLOADING_POINT = {
  id: 'p2-unloading-0000-4000-8000-000000000002',
  lat: 44.7255,
  lon: 37.76,
  name: 'Стройплощадка «Юг»',
  address: 'Новороссийск, ул. Дорожная, 15',
}

/** Реальная длина ломаной, метры (haversine). */
export function routeLengthM(): number {
  let sum = 0
  for (let i = 1; i < ROUTE_LNGLAT.length; i++) sum += haversineM(ROUTE_LNGLAT[i - 1], ROUTE_LNGLAT[i])
  return sum
}

export function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const la1 = (a[1] * Math.PI) / 180
  const la2 = (b[1] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Точка на ломаной по доле f∈[0..1] + азимут участка. */
export function pointAtFraction(f: number): { lng: number; lat: number; bearing: number } {
  const total = routeLengthM()
  let target = Math.max(0, Math.min(1, f)) * total
  for (let i = 1; i < ROUTE_LNGLAT.length; i++) {
    const seg = haversineM(ROUTE_LNGLAT[i - 1], ROUTE_LNGLAT[i])
    if (target <= seg || i === ROUTE_LNGLAT.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, target / seg)
      const a = ROUTE_LNGLAT[i - 1]
      const b = ROUTE_LNGLAT[i]
      const bearing = bearingDeg(a, b)
      return {
        lng: a[0] + (b[0] - a[0]) * t,
        lat: a[1] + (b[1] - a[1]) * t,
        bearing,
      }
    }
    target -= seg
  }
  const last = ROUTE_LNGLAT[ROUTE_LNGLAT.length - 1]
  return { lng: last[0], lat: last[1], bearing: 0 }
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
 * Манёвры навигации: реальные шаги OSRM + контрольные точки А-146
 * (генерирует scripts/bake_route.py). Первый манёвр после START_F стоит
 * в ~20 м от грузовика — баннер «Через 20 м» как в мокапе.
 */
export interface Maneuver {
  f: number
  type: 'left' | 'right' | 'straight' | 'arrive'
  street: string
}

export const MANEUVERS: Maneuver[] = BAKED_MANEUVERS

/** Позиция грузовика на старте демо: за ~20 м до первого манёвра. */
export const START_F = BAKED_START_F

/**
 * Сегменты трафика (канал 3): доли вдоль маршрута (по реальным контрольным
 * точкам А-146) + боковые улицы города (дороги OSM). baseLevel — фоновая
 * загруженность; серверная генерация накладывает детерминированную
 * «жизнь» (обновление каждую минуту).
 */
export interface TrafficSegDef {
  id: string
  title: string
  fRange?: [number, number] // участок вдоль маршрута
  sideCoords?: [number, number][] // отдельная ломаная (боковые улицы)
  baseLevel: 0 | 1 | 2 | 3
  freeFlowKmh: number
}

export const TRAFFIC_SEGMENTS: TrafficSegDef[] = [
  { id: 'tr1', title: 'А-146 · выезд из Абинска', fRange: [0, 0.15], baseLevel: 0, freeFlowKmh: 70 },
  { id: 'tr2', title: 'А-146 · Гайдук', fRange: [0.15, 0.33], baseLevel: 1, freeFlowKmh: 70 },
  { id: 'tr3', title: 'А-146 · Верхнебаканский', fRange: [0.33, 0.43], baseLevel: 1, freeFlowKmh: 65 },
  { id: 'tr4', title: 'А-146 · ремонт моста', fRange: [0.43, 0.52], baseLevel: 3, freeFlowKmh: 65 },
  { id: 'tr5', title: 'А-146 · перегон к Новороссийску', fRange: [0.52, 0.72], baseLevel: 1, freeFlowKmh: 60 },
  { id: 'tr6', title: 'А-146 · объездная Новороссийска', fRange: [0.72, 0.92], baseLevel: 0, freeFlowKmh: 60 },
  { id: 'tr7', title: 'Анапское шоссе · въезд в город', fRange: [0.92, 1], baseLevel: 2, freeFlowKmh: 50 },
  { id: 'ts1', title: 'ул. Ленина · центр', sideCoords: SIDE_STREET_LINES.ts1, baseLevel: 2, freeFlowKmh: 50 },
  { id: 'ts2', title: 'ул. Гагарина', sideCoords: SIDE_STREET_LINES.ts2, baseLevel: 1, freeFlowKmh: 50 },
  { id: 'ts3', title: 'ул. Советов · съезд к порту', sideCoords: SIDE_STREET_LINES.ts3, baseLevel: 3, freeFlowKmh: 45 },
]

/** Улицы офлайн-поиска (PMTiles-коридор z14–z17). */
export const DEMO_STREETS: DemoStreet[] = [
  { name: 'ул. Промышленная, Новороссийск', lat: 44.7285, lon: 37.774 },
  { name: 'ул. Дорожная, 15, Новороссийск', lat: 44.7255, lon: 37.76 },
  { name: 'ул. Строительная, Новороссийск', lat: 44.731, lon: 37.782 },
  { name: 'ул. Лесная, Новороссийск', lat: 44.735, lon: 37.792 },
  { name: 'ул. Белинского, Новороссийск', lat: 44.733, lon: 37.779 },
  { name: 'ул. Ленина, Новороссийск', lat: 44.7238, lon: 37.7689 },
  { name: 'ул. Гагарина, Новороссийск', lat: 44.7266, lon: 37.7837 },
  { name: 'ул. Советов, Новороссийск', lat: 44.7298, lon: 37.7871 },
  { name: 'Центральный парк, Новороссийск', lat: 44.7315, lon: 37.7813 },
  { name: 'Абинск, ул. Северная, 4', lat: 44.8682, lon: 38.157 },
]

/** GeoJSON LineString из ломаной. */
export function toGeoJSON(coords: [number, number][]): string {
  return JSON.stringify({ type: 'LineString', coordinates: coords })
}

/** Срез ломаной по доле [f1..f2] — для сегмента пробки. */
export function sliceFraction(f1: number, f2: number): [number, number][] {
  const total = routeLengthM()
  const a = Math.min(f1, f2) * total
  const b = Math.max(f1, f2) * total
  const out: [number, number][] = []
  let acc = 0
  for (let i = 1; i < ROUTE_LNGLAT.length; i++) {
    const prev = ROUTE_LNGLAT[i - 1]
    const cur = ROUTE_LNGLAT[i]
    const seg = haversineM(prev, cur)
    const segStart = acc
    const segEnd = acc + seg
    if (segEnd >= a && out.length === 0) {
      const t = seg === 0 ? 0 : Math.min(1, Math.max(0, (a - segStart) / seg))
      out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t])
    }
    if (out.length > 0 && segEnd > a) {
      out.push([...cur])
    }
    if (segEnd >= b && out.length > 0) {
      const t = seg === 0 ? 0 : Math.min(1, Math.max(0, (b - segStart) / seg))
      out[out.length - 1] = [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]
      break
    }
    acc = segEnd
  }
  if (out.length < 2) out.push([...ROUTE_LNGLAT[ROUTE_LNGLAT.length - 1]])
  return out
}
