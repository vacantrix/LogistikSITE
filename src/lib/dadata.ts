/**
 * DaData Suggest API — подсказки адресов России (ФИАС/ГАР).
 * Основной источник подсказок адреса в /api/suggest: точнее OSM на российских
 * адресах (дом, индекс, официальный формат). Ключ — DADATA_API_KEY в .env
 * сервера; без ключа /api/suggest работает через геокодер OSM (Photon).
 *
 * Бесплатный тариф: 10 000 запросов в день (dadata.ru → профиль → «Интеграции» → API-ключ).
 * Ключ живёт только на сервере: браузер обращается к /api/suggest, наружу он не отдаётся.
 */

const DADATA_URL = (process.env.DADATA_API_URL || 'https://suggestions.dadata.ru').replace(/\/$/, '') +
  '/suggestions/api/4_1_rs/suggest/address'

/** Ключ DaData из окружения сервера (пусто — подсказки идут через OSM) */
export const dadataApiKey = (): string => (process.env.DADATA_API_KEY ?? '').trim()

/** Адрес из DaData, приведённый к общему виду подсказки платформы */
export interface DadataSuggestion {
  value: string
  unrestricted_value?: string
  postal_code?: string
  region_with_type?: string
  city_with_type?: string
  street_with_type?: string
  house?: string
  geo_lat?: number | string
  geo_lon?: number | string
}

/** DaData → формат подсказки платформы (lib/suggest.ts): label + подсказка + координаты */
export function toSuggestion(s: DadataSuggestion): {
  label: string; hint?: string; region?: string; lat?: number; lon?: number; source: 'dadata'
} {
  const lat = typeof s.geo_lat === 'string' ? Number(s.geo_lat) : s.geo_lat
  const lon = typeof s.geo_lon === 'string' ? Number(s.geo_lon) : s.geo_lon
  const hint = [s.postal_code, s.region_with_type].filter(Boolean).join(' · ')
  return {
    label: s.value,
    hint: hint || undefined,
    region: s.region_with_type || undefined,
    lat: Number.isFinite(lat) ? lat : undefined,
    lon: Number.isFinite(lon) ? lon : undefined,
    source: 'dadata',
  }
}

/** Запрос к DaData Suggest. Ошибка сети/ключа → null (вызывающий код уходит в запасной источник) */
export async function dadataAddress(q: string, count = 8, timeoutMs = 5000): Promise<{
  items: ReturnType<typeof toSuggestion>[]
  /** DaData ответила отказом по ключу — можно показать подсказку про настройку */
  unauthorized?: boolean
} | null> {
  const key = dadataApiKey()
  if (!key) return null
  try {
    const res = await fetch(DADATA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Token ${key}`,
      },
      body: JSON.stringify({ query: q, count, language: 'ru' }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 401 || res.status === 403) return { items: [], unauthorized: true }
    if (!res.ok) return null
    const body = (await res.json()) as { suggestions?: DadataSuggestion[] }
    return { items: (body.suggestions ?? []).map(toSuggestion) }
  } catch {
    return null
  }
}
