// Разбор ссылки на маршрут из Яндекс.Карт — чистый модуль без Prisma:
// импортируется и сервером (доменный сервис), и клиентом (DispatchScreen).
//
// Диспетчер строит маршрут на yandex.ru/maps, жмёт «Поделиться» → «Ссылка»
// и вставляет её в заявку. Ссылка маршрута выглядит так:
//
//   https://yandex.ru/maps/?rtext=55.753930%2C37.620795~59.931123%2C30.360932&rtt=auto&z=7
//
//   rtext — точки маршрута через «~», каждая «широта,долгота»;
//   rtt   — тип маршрута: auto (авто) | mt (общ. транспорт) | pd (пешком) | bc (вел) | tv (такси).
//
// Если в ссылке нет rtext (например, um= — сохранённая карта, а не маршрут),
// возвращаем понятную ошибку: нужно именно «Поделиться → Ссылка» на маршруте.

export type YandexRouteProfile = 'auto' | 'mt' | 'pd' | 'bc' | 'tv'

export type Waypoint = { lat: number; lng: number }

export interface ParsedYandexRoute {
  /** Точки маршрута в порядке следования. */
  waypoints: Waypoint[]
  /** Чем строили в Яндекс.Картах. */
  profile: YandexRouteProfile
  /** Исходная ссылка (как вставил диспетчер). */
  url: string
}

export type ParseYandexResult =
  | { ok: true; route: ParsedYandexRoute }
  | { ok: false; error: string }

export function parseYandexRouteLink(input: string): ParseYandexResult {
  const raw = (input ?? '').trim()
  if (!raw) return { ok: false, error: 'Вставьте ссылку на маршрут из Яндекс.Карт' }

  // выдёргиваем rtext даже из «грязного» текста вокруг ссылки
  const m = raw.match(/rtext=([^&\s]+)/)
  if (!m) {
    if (/[?&]um=/.test(raw)) {
      return {
        ok: false,
        error: 'Это ссылка на сохранённую карту, а не на маршрут. Постройте маршрут и нажмите «Поделиться» → «Ссылка».',
      }
    }
    return {
      ok: false,
      error: 'В ссылке нет точек маршрута (rtext). Скопируйте ссылку кнопкой «Поделиться» на построенном маршруте.',
    }
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(m[1])
  } catch {
    decoded = m[1]
  }

  const waypoints: Waypoint[] = []
  for (const part of decoded.split('~')) {
    // «55.75,37.62» (возможно, с мусором/именем точки после запятой — берём первые два числа)
    const nums = part.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/)
    if (!nums) continue
    const lat = Number(nums[1])
    const lng = Number(nums[2])
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) continue
    waypoints.push({ lat, lng })
  }

  if (waypoints.length === 0) {
    return { ok: false, error: 'Не удалось прочитать координаты точек из ссылки' }
  }
  if (waypoints.length < 2) {
    return { ok: false, error: 'В маршруте меньше двух точек — постройте маршрут от А до Б' }
  }

  const rtt = raw.match(/[?&]rtt=([a-z]+)/)?.[1]
  const profile = (['auto', 'mt', 'pd', 'bc', 'tv'] as const).includes(rtt as YandexRouteProfile)
    ? (rtt as YandexRouteProfile)
    : 'auto'

  return { ok: true, route: { waypoints, profile, url: raw } }
}

/** Ссылка Яндекс.Карт по точкам — «Построить маршрут» в диспетчерской. */
export function buildYandexRouteUrl(waypoints: Waypoint[]): string {
  const rtext = waypoints.map((w) => `${w.lat},${w.lng}`).join('~')
  return `https://yandex.ru/maps/?rtext=${encodeURIComponent(rtext)}&rtt=auto`
}

/** «2 точки» / «5 точек» — плюрализация для бейджа. */
export function pointsLabel(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} точка`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} точки`
  return `${n} точек`
}
