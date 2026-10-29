/**
 * Подсказки проформы водителя: адрес регистрации и место рождения — из карты
 * OpenStreetMap (геокодер Photon), «Кем выдан» — по региону адреса и значениям,
 * уже введённым в базе. Здесь только форматирование — сетевой запрос делает /api/suggest.
 */

export type SuggestKind = 'address' | 'place' | 'reverse' | 'issuer'

export interface Suggestion {
  /** текст, который подставляется в поле */
  label: string
  /** вторая строка в списке: индекс, страна */
  hint?: string
  region?: string
  county?: string
  lat?: number
  lon?: number
  /** источник подсказки: DaData (ФИАС) или карта OSM — для пометки в выпадающем списке */
  source?: 'dadata' | 'osm'
}

/** Свойства объекта из ответа Photon (GeoJSON properties) */
export interface PhotonProps {
  name?: string
  housenumber?: string
  street?: string
  city?: string
  county?: string
  state?: string
  country?: string
  countrycode?: string
  postcode?: string
  osm_key?: string
  osm_value?: string
}

export interface PhotonFeature {
  properties: PhotonProps
  geometry?: { coordinates?: [number, number] }
}

const STREET_ABBR: Record<string, string> = {
  улица: 'ул.', переулок: 'пер.', проспект: 'пр-т', шоссе: 'ш.', площадь: 'пл.', бульвар: 'б-р',
  проезд: 'пр-д', набережная: 'наб.', микрорайон: 'мкр.', тупик: 'туп.', аллея: 'ал.',
}

/** «Интернациональная улица» → «ул. Интернациональная», как в штампе регистрации */
export function shortStreet(s: string): string {
  const words = s.trim().split(/\s+/)
  const i = words.findIndex((w) => STREET_ABBR[w.toLowerCase()])
  if (i < 0) return s.trim()
  const abbr = STREET_ABBR[words[i].toLowerCase()]
  words.splice(i, 1)
  return `${abbr} ${words.join(' ')}`
}

/** Район без «городского округа»: тот повторяет название города */
function shortCounty(county?: string): string {
  if (!county || /городской округ/i.test(county)) return ''
  return county.replace(/\s+район$/i, ' р-н')
}

/** «г.» — только у крупных городов: в OSM «town» бывает и городом (Абинск), и станицей (Холмская) */
const settlementName = (p: PhotonProps) => (p.osm_value === 'city' ? `г. ${p.name}` : p.name ?? '')
const PLACE_VALUES = ['city', 'town', 'village', 'hamlet', 'isolated_dwelling', 'locality']

/** Порядок в подсказках места рождения: сначала города, потом сёла и хутора */
export const placeRank = (p: PhotonProps) => {
  const i = PLACE_VALUES.indexOf(p.osm_value ?? '')
  return i < 0 ? PLACE_VALUES.length : i
}

const coords = (f: PhotonFeature) => {
  const c = f.geometry?.coordinates
  return c ? { lon: c[0], lat: c[1] } : {}
}

/** Адрес регистрации: регион, район, населённый пункт, улица, дом */
export function formatAddress(f: PhotonFeature): Suggestion | null {
  const p = f.properties
  const isPlace = p.osm_key === 'place' && PLACE_VALUES.includes(p.osm_value ?? '')
  const city = isPlace ? settlementName(p) : p.city
  const street = p.street ?? (p.osm_key === 'highway' ? p.name : undefined)
  if (!city && !street) return null
  const parts = [
    p.state && p.state !== p.city && p.state !== p.name ? p.state : '',
    shortCounty(p.county),
    city ?? '',
    street ? shortStreet(street) : '',
    street && p.housenumber ? `д. ${p.housenumber}` : '',
  ].filter(Boolean)
  return {
    label: parts.join(', '),
    hint: [p.postcode ? `индекс ${p.postcode}` : '', p.countrycode && p.countrycode !== 'RU' ? p.country : ''].filter(Boolean).join(' · ') || undefined,
    region: p.state, county: p.county, ...coords(f),
  }
}

/** Место рождения: населённый пункт, район (для сёл), регион; страна — если не Россия */
export function formatPlace(f: PhotonFeature): Suggestion | null {
  const p = f.properties
  if (p.osm_key !== 'place' || !PLACE_VALUES.includes(p.osm_value ?? '') || !p.name) return null
  const parts = [
    settlementName(p),
    p.osm_value === 'city' ? '' : shortCounty(p.county),
    p.state && p.state !== p.name ? p.state : '',
    p.countrycode && p.countrycode !== 'RU' ? p.country ?? '' : '',
  ].filter(Boolean)
  return { label: parts.join(', '), region: p.state, county: p.county, ...coords(f) }
}

/**
 * Населённый пункт по точке на карте: сам пункт или город, в котором стоит найденный дом.
 * «Городской округ Краснодар» у дома или город-регион означает город — тогда с «г.»
 */
export function placeAt(f: PhotonFeature): Suggestion | null {
  const own = formatPlace(f)
  if (own) return own
  const p = f.properties
  if (!p.city || /поселение|сельсовет|округ/i.test(p.city)) return null
  const urban = /городской округ/i.test(p.county ?? '') || p.state === p.city // Москва, Санкт-Петербург
  const parts = [
    urban ? `г. ${p.city}` : p.city,
    urban ? '' : shortCounty(p.county),
    p.state && p.state !== p.city ? p.state : '',
    p.countrycode && p.countrycode !== 'RU' ? p.country ?? '' : '',
  ].filter(Boolean)
  return { label: parts.join(', '), region: p.state, county: p.county, ...coords(f) }
}

const WORD_DATIVE: Record<string, string> = {
  край: 'краю', область: 'области', округ: 'округу', Республика: 'Республике',
  автономный: 'автономному', автономная: 'автономной', Югра: 'Югре', Кузбасс: 'Кузбассу', Чувашия: 'Чувашии',
}

/** Регион в дательном падеже: «Краснодарский край» → «Краснодарскому краю» (для «… по …») */
export function regionDative(region: string): string {
  const r = region.trim()
  if (/^москва$/i.test(r)) return 'г. Москве'
  if (/^санкт-петербург$/i.test(r) || /^ленинградская область$/i.test(r)) return 'г. Санкт-Петербургу и Ленинградской области'
  if (/^севастополь$/i.test(r)) return 'г. Севастополю'
  // «Республика Северная Осетия — Алания»: склоняется только первое слово
  if (/^республика\s/i.test(r)) return r.replace(/^республика/i, 'Республике')
  return r.split(/\s+/).map((w) => WORD_DATIVE[w] ?? w.replace(/ий$/, 'ому').replace(/ая$/, 'ой')).join(' ')
}

/** Регион и район из адреса, введённого вручную: «Краснодарский край, Абинский р-н, …» */
export function regionFromText(address: string): { region?: string; county?: string } {
  const parts = address.split(',').map((s) => s.trim())
  const region = parts.find((s) => /(край|область|республик|автономн|^москва$|^санкт-петербург$|^севастополь$)/i.test(s))
  const county = parts.find((s) => /\s(район|р-н)$/i.test(s))?.replace(/\s+р-н$/i, ' район')
  return { region, county }
}

/** Типовые формулировки «Кем выдан» для региона и района адреса */
export function issuerTemplates(region?: string, county?: string): string[] {
  if (!region) return []
  const d = regionDative(region)
  const out = /республик/i.test(region) ? [`МВД по ${d}`] : [`ГУ МВД России по ${d}`, `УМВД России по ${d}`]
  const c = county && /ий (район|р-н)$/i.test(county) ? county : ''
  if (c) {
    out.push(
      `ОВМ ОМВД России по ${c.replace(/ий (район|р-н)$/i, 'ому району')}`,
      `Отделением УФМС России по ${d} в ${c.replace(/ий (район|р-н)$/i, 'ом районе')}`,
    )
  }
  out.push(`Отделом УФМС России по ${d}`)
  return out
}
