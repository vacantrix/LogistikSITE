/**
 * Геометрия маршрутов: расстояние «погрузка → назначение».
 *
 * Пункты заявок — строки («Абинск, АЭМЗ», «Порт СПб», «Воронеж»…),
 * координаты берутся из справочника точек (lib/points.ts).
 * Расстояние считается по большому кругу (формула гаверсинуса) —
 * в демо-контуре этого достаточно для столбца «КМ» на площадке.
 */

import { pointInfo } from '@/lib/points'

export interface LatLng {
  lat: number
  lng: number
}

/** Разбирает строку координат «широта,долгота» из PointInfo */
function parseCoords(coords: string | null): LatLng | null {
  if (!coords) return null
  const [latRaw, lngRaw] = coords.split(',')
  const lat = Number(latRaw?.trim())
  const lng = Number(lngRaw?.trim())
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

/** Координаты пункта заявки (или null, если точка не из справочника) */
export function pointCoords(raw: string): LatLng | null {
  return parseCoords(pointInfo(raw).coords)
}

/** Расстояние по большому кругу между двумя точками, км */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371 // радиус Земли, км
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * Расстояние от пункта погрузки до пункта назначения, км (по прямой).
 * Возвращает null, если хотя бы у одной точки нет координат в справочнике.
 */
export function routeDistanceKm(from: string, to: string): number | null {
  const a = pointCoords(from)
  const b = pointCoords(to)
  if (!a || !b) return null
  return Math.round(haversineKm(a, b))
}

/** «1 573 км» — целые километры с неразрывными пробелами между разрядами */
export function formatKm(km: number): string {
  const grouped = String(Math.round(km)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')
  return `${grouped} км`
}
