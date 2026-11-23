// Гео-контур мониторинга: координаты городов из адресов рейсов, дистанции,
// направление движения и интерполяция маршрута. Используется сервером
// (/api/monitor — «до выгрузки осталось N км») и симулятором приложения.

export type LatLng = [number, number] // [широта, долгота]

// Города, встречающиеся в заявках/плечах (Краснодарский край и соседи).
// Координаты — центры населённых пунктов (OSM), точности адреса не требуется:
// используется для расчёта остатка км и отрисовки трека.
const CITY_GEO: Record<string, LatLng> = {
  'абинск': [44.8684, 38.1587],
  'краснодар': [45.0355, 38.9753],
  'славянск-на-кубани': [45.2585, 38.1256],
  'крымск': [44.9308, 37.9909],
  'динская': [45.2065, 39.2333],
  'кореновск': [45.4708, 38.6272],
  'горячий ключ': [44.6303, 39.1337],
  'усть-лабинск': [45.2158, 39.6889],
  'новороссийск': [44.7239, 37.7688],
  'анапа': [44.8908, 37.3164],
  'геленджик': [44.5622, 38.0848],
  'сочи': [43.5855, 39.7231],
  'армавир': [44.9892, 41.1266],
  'тихорецк': [45.8567, 40.1265],
  'кропоткин': [45.4333, 40.575],
  'темрюк': [45.2717, 37.3822],
  'ейск': [46.7053, 38.2756],
  'ростов-на-дону': [47.2357, 39.7015],
  'таганрог': [47.2362, 38.8969],
  'ставрополь': [45.0428, 41.9734],
  'майкоп': [44.6098, 40.1006],
  'лабинск': [44.6383, 40.7303],
  // федеральные города и областные центры — встречаются в грузах ATI.SU
  // (сделки Москвы/Воронежа/Казани и расчёт возврата на базу из них)
  'москва': [55.7558, 37.6173],
  'санкт-петербург': [59.9311, 30.3609],
  'воронеж': [51.672, 39.1843],
  'казань': [55.7963, 49.1088],
  'самара': [53.1959, 50.1002],
  'волгоград': [48.708, 44.5133],
  'саратов': [51.5336, 46.0343],
  'тула': [54.1961, 37.6182],
  'липецк': [52.6031, 39.5708],
  'курск': [51.7373, 36.1874],
  'белгород': [50.5952, 36.5872],
  'брянск': [53.2521, 34.3717],
  'орёл': [52.9668, 36.0625],
}

// Имена городов, отсортированные по длине (сначала длинные — «Ростов-на-Дону»
// раньше «Ростов», «Славянск-на-Кубани» раньше «Славянск»)
const CITY_KEYS = Object.keys(CITY_GEO).sort((a, b) => b.length - a.length)

/** Из строки адреса («Абинск (АЭМЗ)», «Краснодар, ул. Тополиная, 8») — координаты города */
export function cityGeo(point: string | null | undefined): LatLng | null {
  if (!point) return null
  const norm = point.toLowerCase().replace('ё', 'е').trim()
  for (const key of CITY_KEYS) {
    if (norm.startsWith(key)) return CITY_GEO[key]
  }
  return null
}

/** Краткое имя города из адреса (для подписей на карте) */
export function cityLabel(point: string | null | undefined): string {
  if (!point) return '—'
  const norm = point.toLowerCase().replace('ё', 'е').trim()
  for (const key of CITY_KEYS) {
    if (norm.startsWith(key)) {
      return point.slice(0, key.length).replace(/^./, (c) => c.toUpperCase())
    }
  }
  return point.split(',')[0]?.trim() ?? point
}

const R_EARTH_KM = 6371
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** Расстояние по большому кругу, км */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0])
  const dLng = rad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Азимут из a на b, градусы 0–360 (курс движения) */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]))
  const x =
    Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
    Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]))
  return (deg(Math.atan2(y, x)) + 360) % 360
}

/** Точка на отрезке a→b с долей t (0..1) — линейная интерполяция маршрута */
export function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
  const clamped = Math.max(0, Math.min(1, t))
  return [a[0] + (b[0] - a[0]) * clamped, a[1] + (b[1] - a[1]) * clamped]
}

/** Доля пути a→b, на которой находится точка p (проекция на отрезок, 0..1) */
export function progressOnSegment(a: LatLng, b: LatLng, p: LatLng): number {
  const total = haversineKm(a, b)
  if (total < 0.001) return 1
  const t = haversineKm(a, p) / total
  return Math.max(0, Math.min(1, t))
}
