// Чистые функции для маршрута через Яндекс.Карты — без БД, безопасны для клиента.
//
// Формат ссылки: https://yandex.ru/maps/?rtext=55.753930%2C37.620795~59.931123%2C30.360932&rtt=auto&z=7
//   rtext — точки через «~», каждая «широта,долгота» (после decodeURIComponent «%2C» → «,»);
//   rtt   — тип маршрута auto|mt|pd|bc|tv (живёт в исходной ссылке, не блокируем);
//   um=   — ссылка на карту, а не на маршрут → отказ с подсказкой.

export type Waypoint = [number, number] // [lat, lng]

export type RouteParseResult =
  | { ok: true; waypoints: Waypoint[]; link: string } // link — ссылка для сохранения
  | { ok: false; error: string }

/** Сборка ссылки Яндекс.Карт по точкам (кнопка «Построить маршрут»). */
export function buildYandexRouteUrl(points: { lat: number; lon: number }[], rtt = 'auto'): string {
  const rtext = points.map((p) => `${p.lat},${p.lon}`).join('~')
  return `https://yandex.ru/maps/?rtext=${encodeURIComponent(rtext)}&rtt=${rtt}`
}

/**
 * Разбор вставленной ссылки: точки выдёргиваются регэкспом rtext=([^&\s]+),
 * поэтому мусор вокруг ссылки не мешает. Возвращает точки и ссылку для сохранения.
 */
export function parseYandexRouteLink(input: string): RouteParseResult {
  const text = input.trim()
  if (!text) return { ok: false, error: 'Вставьте ссылку на маршрут из Яндекс.Карт' }

  // rtext может прийти с %2C и ~ — вырезаем до ближайшего «&» или пробела
  const m = text.match(/rtext=([^&\s]+)/)
  if (!m) {
    // um= — ссылка на карту (метка/место), а не на маршрут
    if (/[?&]um=/.test(text))
      return { ok: false, error: 'Постройте маршрут и нажмите "Поделиться" → "Ссылка"' }
    return { ok: false, error: 'В ссылке нет маршрута (rtext) — скопируйте ссылку из Яндекс.Карт: «Поделиться» → «Ссылка»' }
  }

  let raw: string
  try {
    raw = decodeURIComponent(m[1])
  } catch {
    return { ok: false, error: 'Ссылка повреждена (некорректное URL-кодирование)' }
  }

  const waypoints: Waypoint[] = []
  for (const part of raw.split('~')) {
    const coords = part.split(',')
    const lat = Number.parseFloat(coords[0] ?? '')
    const lng = Number.parseFloat(coords[1] ?? '')
    if (!Number.isFinite(lat) || !Number.isFinite(lng))
      return {
        ok: false,
        error: `Точка «${part}» не распознана — ожидается «широта,долгота» (маршрут строится по пунктам заявки)`,
      }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180)
      return { ok: false, error: `Точка (${lat}, ${lng}) вне диапазона — широта −90…90, долгота −180…180` }
    waypoints.push([lat, lng])
  }
  if (waypoints.length < 2)
    return { ok: false, error: 'В маршруте меньше двух точек — маршрут не сохранён' }

  // Что сохранять как routeLink: сам URL (без мусора вокруг), а если вставили
  // голый rtext=… без адреса — собираем канонический URL из разобранных точек.
  const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i)
  const link = urlMatch ? urlMatch[0] : buildYandexRouteUrl(waypoints.map(([lat, lng]) => ({ lat, lon: lng })))
  return { ok: true, waypoints, link }
}

/** routeWaypoints (JSON [[lat,lng],...]) → массив объектов { lat, lng } для приложения водителя. */
export function waypointsForDriver(json: string | null | undefined): { lat: number; lng: number }[] | null {
  if (!json) return null
  try {
    const arr = JSON.parse(json) as unknown
    if (!Array.isArray(arr) || arr.length === 0) return null
    const pts = arr.map((p) => {
      const pair = p as [number, number]
      return { lat: pair[0], lng: pair[1] }
    })
    return pts.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)) ? pts : null
  } catch {
    return null
  }
}

/** «1 точка», «2 точки», «5 точек» — склонение для надписей. */
export function pointsLabel(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} точка`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} точки`
  return `${n} точек`
}
