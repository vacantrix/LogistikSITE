import { Anchor, Factory, Warehouse, type LucideIcon } from 'lucide-react'

/**
 * Точки маршрута: сырые значения из заявки («Завод», «Порт», «Склад»…)
 * разворачиваются в полные названия и адреса.
 *
 * Платформа работает в демо-контуре, поэтому адреса точек — вымышленные,
 * но правдоподобные. Маршрут в Яндекс.Картах строится по координатам,
 * так что ссылка открывает полноценный автомобильный маршрут даже для
 * придуманных адресов. Точка выгрузки названа по реальному оператору
 * Большого порта Санкт-Петербург — ООО «Терминал Святого Петра»
 * (stpetr.ru, Канонерский остров). Основная выгрузка — Петербург,
 * часть рейсов идёт через порты и склады Юга (Новороссийск, Туапсе)
 * и в города-потребители (Ставрополь, Сочи, Тихорецк и др.) — все
 * точки заведены в справочник ниже с координатами для карты и маршрутов.
 */
export interface PointInfo {
  /** Короткая подпись — город точки (для плотных мест: таблицы, списки, селекты) */
  short: string
  /** Полное название точки */
  name: string
  /** Полный адрес точки */
  address: string
  /** Иконка точки */
  icon: LucideIcon
  /** Координаты «широта,долгота» для построителя маршрута (если известны) */
  coords: string | null
  /** Строка для поиска в картах, если координат нет */
  mapQuery: string
  /** Адрес известен — маршрут строится целиком */
  known: boolean
}

const FACTORY: PointInfo = {
  short: 'Абинск',
  name: 'Абинский электрометаллургический завод',
  address: 'Краснодарский край, г. Абинск, ул. Промышленная, д. 4, лит. А',
  icon: Factory,
  coords: '44.8770,38.1552',
  mapQuery: 'Абинск, улица Промышленная, 4',
  known: true,
}

const TERMINAL_ST_PETER: PointInfo = {
  short: 'Санкт-Петербург',
  name: 'Терминал Святого Петра',
  address: 'г. Санкт-Петербург, Канонерский остров, д. 45, лит. Б',
  icon: Anchor,
  coords: '59.9289,30.2407',
  mapQuery: 'Санкт-Петербург, Канонерский остров',
  known: true,
}

const WAREHOUSE_SPB: PointInfo = {
  short: 'Санкт-Петербург',
  name: 'Складской терминал «Южный»',
  address: 'г. Санкт-Петербург, ул. Логистическая, д. 14, лит. А',
  icon: Warehouse,
  coords: '59.8451,30.3593',
  mapQuery: 'Санкт-Петербург, Шушары',
  known: true,
}

/**
 * Прочие города и населённые пункты доставки (демо-контур: адреса вымышленные,
 * координаты — реальные районы, чтобы маршрут в Яндекс.Картах строился точно).
 */
const SPOTS: PointInfo[] = [
  {
    short: 'Москва',
    name: 'Логистический парк «Восток»',
    address: 'Московская обл., г. Люберцы, ул. Транспортная, д. 12, лит. А',
    icon: Warehouse, coords: '55.6752,37.8942', mapQuery: 'Люберцы', known: true,
  },
  {
    short: 'Ростов-на-Дону',
    name: 'Терминал «Донской»',
    address: 'Ростовская обл., г. Батайск, ул. Пригородная, д. 8, лит. Б',
    icon: Warehouse, coords: '47.1264,39.7522', mapQuery: 'Батайск', known: true,
  },
  {
    short: 'Краснодар',
    name: 'Терминал «Кубань»',
    address: 'г. Краснодар, ул. Дорожная, д. 23, лит. А',
    icon: Warehouse, coords: '45.0230,38.9400', mapQuery: 'Краснодар', known: true,
  },
  {
    short: 'Крымск',
    name: 'Склад «Крымский»',
    address: 'Краснодарский край, г. Крымск, ул. Складская, д. 6, лит. В',
    icon: Warehouse, coords: '44.9308,37.9907', mapQuery: 'Крымск', known: true,
  },
  {
    short: 'Геленджик',
    name: 'Склад «Геленджик»',
    address: 'Краснодарский край, г. Геленджик, ул. Портовая, д. 3, лит. А',
    icon: Warehouse, coords: '44.5622,38.0848', mapQuery: 'Геленджик', known: true,
  },
  {
    short: 'Воронеж',
    name: 'Терминал «Воронеж»',
    address: 'Воронежская обл., г. Воронеж, тер. Промзона «Северная», корп. 7, лит. А',
    icon: Warehouse, coords: '51.6320,39.1880', mapQuery: 'Воронеж', known: true,
  },
  {
    short: 'Волгоград',
    name: 'Терминал «Волга»',
    address: 'Волгоградская обл., г. Волжский, ул. Индустриальная, д. 17, лит. Б',
    icon: Warehouse, coords: '48.7855,44.7797', mapQuery: 'Волжский', known: true,
  },
  {
    short: 'Холмская',
    name: 'Склад «Холмский»',
    address: 'Краснодарский край, Абинский р-н, ст. Холмская, ул. Заводская, д. 2, лит. А',
    icon: Warehouse, coords: '44.9030,38.1500', mapQuery: 'Холмская', known: true,
  },
  {
    short: 'Ахтырский',
    name: 'Склад «Ахтырский»',
    address: 'Краснодарский край, Абинский р-н, п. Ахтырский, ул. Степная, д. 9, лит. Б',
    icon: Warehouse, coords: '44.9680,38.2500', mapQuery: 'Ахтырский', known: true,
  },
  {
    short: 'Новороссийск',
    name: 'Портовый терминал «НМТП»',
    address: 'г. Новороссийск, ул. Портовая, д. 7, лит. А',
    icon: Anchor, coords: '44.7239,37.7686', mapQuery: 'Новороссийск, порт', known: true,
  },
  {
    short: 'Туапсе',
    name: 'Склад «Туапсинский»',
    address: 'Краснодарский край, г. Туапсе, ул. Портовая, д. 12, лит. Б',
    icon: Warehouse, coords: '44.1023,39.0764', mapQuery: 'Туапсе', known: true,
  },
  {
    short: 'Ставрополь',
    name: 'Терминал «Ставрополь»',
    address: 'г. Ставрополь, ул. Индустриальная, д. 5, лит. А',
    icon: Warehouse, coords: '45.0428,41.9734', mapQuery: 'Ставрополь', known: true,
  },
  {
    short: 'Сочи',
    name: 'Склад «Сочи»',
    address: 'Краснодарский край, г. Сочи, ул. Транспортная, д. 9, лит. А',
    icon: Warehouse, coords: '43.5855,39.7231', mapQuery: 'Сочи', known: true,
  },
  {
    short: 'Тихорецк',
    name: 'Склад «Тихорецкий»',
    address: 'Краснодарский край, г. Тихорецк, ул. Заводская, д. 14, лит. В',
    icon: Warehouse, coords: '45.8547,40.1289', mapQuery: 'Тихорецк', known: true,
  },
]

const SPOT_KEYS: Array<{ keys: string[]; idx: number }> = [
  { keys: ['москв', 'люберец'], idx: 0 },
  { keys: ['ростов', 'батайск'], idx: 1 },
  { keys: ['краснодар'], idx: 2 },
  { keys: ['крымск'], idx: 3 },
  { keys: ['гелендж'], idx: 4 },
  { keys: ['воронеж'], idx: 5 },
  { keys: ['волгоград', 'волжск'], idx: 6 },
  { keys: ['холмск'], idx: 7 },
  { keys: ['ахтыр'], idx: 8 },
  { keys: ['новоросс'], idx: 9 },
  { keys: ['туапсе'], idx: 10 },
  { keys: ['ставропол'], idx: 11 },
  { keys: ['сочи'], idx: 12 },
  { keys: ['тихорецк'], idx: 13 },
]

/**
 * Справочник точек маршрута. value — то, что хранится в заявке: город точки
 * (у двух точек Петербурга — с уточнением), чтобы маршрут везде читался как
 * «Абинск → Сочи», а не «Завод → Порт». Адрес и название берутся из info.
 */
export const POINT_DIRECTORY: { value: string; info: PointInfo }[] = [
  { value: 'Абинск', info: FACTORY },
  { value: 'Санкт-Петербург', info: TERMINAL_ST_PETER },
  { value: 'Санкт-Петербург, склад «Южный»', info: WAREHOUSE_SPB },
  ...SPOTS.map((info) => ({ value: info.short, info })),
]

const norm = (s: string) => (s ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')

/** Старые значения заявок (до справочника точек) — только целиком, не по подстроке */
const LEGACY_POINTS: Record<string, PointInfo> = {
  'завод': FACTORY,
  'завод аэмз': FACTORY,
  'аэмз': FACTORY,
  'порт': TERMINAL_ST_PETER,
  'терминал': TERMINAL_ST_PETER,
  'склад': WAREHOUSE_SPB,
}

/** «Краснодарский край», «Ростовская обл.» — регион, а не город точки */
const REGION_WORDS = new Set(['край', 'область', 'обл', 'район', 'р', 'округ', 'республика', 'респ'])
/** «ул. Московская», «Ростовское ш.» — улица, а не город точки */
const STREET_WORDS = new Set(['ул', 'улица', 'пр', 'пр-т', 'проспект', 'пер', 'переулок', 'ш', 'шоссе', 'наб', 'набережная', 'б-р', 'бульвар', 'проезд', 'пл', 'площадь', 'тупик'])

/**
 * Разворачивает точку маршрута из заявки в полное название и адрес.
 * Точное значение справочника → его точка; иначе город ищется по словам адреса
 * слева направо (адрес пишется от региона к улице): «Краснодар, ул. Московская» —
 * Краснодар, «Петрозаводск» — не завод, «ул. Портовая» — не порт. Не нашли —
 * точка «по данным заявки»: адрес показывается как есть, карта ищет его текстом.
 */
export function pointInfo(raw: string): PointInfo {
  const v = norm(raw)
  const exact = POINT_DIRECTORY.find((p) => norm(p.value) === v)
  if (exact) return exact.info
  const legacy = LEGACY_POINTS[v]
  if (legacy) return legacy
  const label = (raw ?? '').trim()
  // город нашёлся по адресу: карта и подпись — по городу, адрес — тот, что в заявке
  const byAddress = (info: PointInfo): PointInfo => ({ ...info, name: label, address: label, mapQuery: label })
  // части адреса между запятыми: «улица»/«регион» определяется по соседним словам внутри части
  const parts = v.split(/[,;]/).map((p) =>
    p.split(/[^a-zа-я0-9-]+/).flatMap((w) => (STREET_WORDS.has(w) ? [w] : w.split('-'))).filter(Boolean))
  const all = parts.flat()
  const spb = all.includes('спб') || all.includes('петербург') || all.includes('канонерский')
  for (const words of parts) {
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      if (REGION_WORDS.has(words[i + 1] ?? '')) continue
      if (STREET_WORDS.has(words[i - 1] ?? '') || STREET_WORDS.has(words[i + 1] ?? '')) continue
      if (w === 'аэмз' || w.startsWith('абинск')) return byAddress(FACTORY)
      const spot = SPOT_KEYS.find(({ keys }) => keys.some((k) => w.startsWith(k)))
      if (spot) return byAddress(SPOTS[spot.idx])
      if (spb && (w === 'спб' || w === 'петербург' || w === 'канонерский')) {
        return byAddress(all.includes('склад') || all.includes('южный') ? WAREHOUSE_SPB : TERMINAL_ST_PETER)
      }
    }
  }
  return {
    short: label,
    name: label,
    address: 'адрес — по данным заявки',
    icon: Warehouse,
    coords: null,
    mapQuery: label,
    known: false,
  }
}

/** Ссылка на построение автомобильного маршрута в Яндекс.Картах */
export function routeMapUrl(from: string, to: string): string {
  const a = pointInfo(from)
  const b = pointInfo(to)
  // Координаты позволяют построить маршрут целиком, даже если адрес
  // вымышленный; без них открываем точку погрузки — маршрут пользователь
  // продолжит уже в самой карте.
  const rtext = (a.coords && b.coords) ? `${a.coords}~${b.coords}` : (a.coords ?? a.mapQuery)
  return `https://yandex.ru/maps/?rtext=${encodeURIComponent(rtext)}&rtt=auto`
}

/**
 * Значение точки для записи в заявку: город из справочника (POINT_DIRECTORY)
 * или null, если это не точка справочника. Приводятся только значения, которые
 * и есть точка: «сочи», «г. Сочи», «Новороссийск (порт)», старые «Завод»/«Порт».
 * Полный адрес («Краснодар, ул. Красная, 5» — например, из 1С) точкой не считается
 * и не переписывается: иначе улица и дом молча терялись бы.
 */
export function canonicalPoint(raw: string): string | null {
  const v = norm(raw)
  const pick = (x: string) => POINT_DIRECTORY.find((p) => norm(p.value) === x)?.value
    ?? (LEGACY_POINTS[x] ? POINT_DIRECTORY.find((p) => p.info === LEGACY_POINTS[x])?.value : undefined)
  return pick(v) ?? pick(v.replace(/^г\.\s*/, '').replace(/\s*\([^)]*\)$/, '')) ?? null
}

/**
 * Подсказки выбора точки в формах заявки (Task 64): только точки справочника —
 * маршрут, карта и расстояние КМ считаются корректно.
 */
export const POINT_SUGGESTIONS: { value: string; label: string; sub: string }[] = POINT_DIRECTORY.map((p) => ({
  value: p.value,
  label: `${p.info.short} — ${p.info.name}`,
  sub: p.info.address,
}))
