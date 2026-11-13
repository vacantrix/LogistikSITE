/**
 * Разбор ссылки на маршрут из Яндекс.Карт.
 *
 * Диспетчер строит маршрут на yandex.ru/maps, жмёт «Поделиться» → «Ссылка»
 * и вставляет её в заявку (платформа «Контур 1С») или прямо в приложение
 * водителя. Ссылка маршрута выглядит так:
 *
 *   https://yandex.ru/maps/?rtext=55.753930%2C37.620795~59.931123%2C30.360932&rtt=auto&z=7
 *
 *   rtext — точки маршрута через «~», каждая «широта,долгота»;
 *   rtt   — тип маршрута: auto (авто) | mt (общ. транспорт) | pd (пешком)
 *           | bc (велосипед) | tv (такси).
 *
 * Если в ссылке нет rtext (например, um= — сохранённая карта, а не маршрут),
 * возвращаем понятную ошибку: нужно именно «Поделиться → Ссылка» на маршруте.
 */

export type YandexRouteProfile = 'auto' | 'mt' | 'pd' | 'bc' | 'tv'

export interface ParsedYandexRoute {
  /** Точки маршрута в порядке следования: {lat, lng}. */
  waypoints: Array<{ lat: number; lng: number }>
  /** Чем строили в Яндекс.Картах. */
  profile: YandexRouteProfile
  /** Исходная ссылка (нормализованная). */
  url: string
}

export type ParseYandexResult =
  | { ok: true; route: ParsedYandexRoute }
  | { ok: false; error: string }

const PROFILE_HINTS: Record<Exclude<YandexRouteProfile, 'auto'>, string> = {
  mt: 'общественный транспорт',
  pd: 'пешком',
  bc: 'велосипед',
  tv: 'такси',
}

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

  const waypoints: Array<{ lat: number; lng: number }> = []
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

  const rtt = raw.match(/[?&]rtt=([a-z]+)/)?.[1]
  const profile = (['auto', 'mt', 'pd', 'bc', 'tv'] as const).includes(rtt as YandexRouteProfile)
    ? (rtt as YandexRouteProfile)
    : 'auto'

  return {
    ok: true,
    route: {
      waypoints,
      profile,
      url: raw,
    },
  }
}

/** Человеческая подпись профиля — показать в карточке заявки. */
export function yandexProfileHint(profile: YandexRouteProfile): string | null {
  if (profile === 'auto') return null
  return PROFILE_HINTS[profile]
}
