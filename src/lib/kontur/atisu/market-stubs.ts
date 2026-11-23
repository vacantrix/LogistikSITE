// Витрина-заглушка «Биржа ATI.SU» (демо-режим платформы АЭМЗ).
// Данные генерируются детерминированно (seeded) и имитируют выдачу
// Поиска грузов ATI.SU той же формы, что в реальном API: после покупки
// подписки и лицензий витрина переключается на /api/atisu (free + платные
// методы) без изменения UI. Реальных запросов к api.ati.su витрина не делает.

// ---------------------------------------------------------------------------
// Гео-справочник: города с координатами (для расчёта плеча обратки)
// ---------------------------------------------------------------------------

type CityGeo = { name: string; region: string; lat: number; lon: number; base?: boolean }

const CITIES: CityGeo[] = [
  { name: 'Абинск', region: 'Краснодарский край', lat: 44.8682, lon: 38.4695, base: true },
  { name: 'Краснодар', region: 'Краснодарский край', lat: 45.0355, lon: 38.9753 },
  { name: 'Новороссийск', region: 'Краснодарский край', lat: 44.7239, lon: 37.7688 },
  { name: 'Москва', region: 'Москва и область', lat: 55.7558, lon: 37.6173 },
  { name: 'Санкт-Петербург', region: 'Ленинградская область', lat: 59.9343, lon: 30.3351 },
  { name: 'Ростов-на-Дону', region: 'Ростовская область', lat: 47.2357, lon: 39.7015 },
  { name: 'Воронеж', region: 'Воронежская область', lat: 51.6608, lon: 39.2003 },
  { name: 'Волгоград', region: 'Волгоградская область', lat: 48.708, lon: 44.5133 },
  { name: 'Ставрополь', region: 'Ставропольский край', lat: 45.0428, lon: 41.9734 },
  { name: 'Сочи', region: 'Краснодарский край', lat: 43.5855, lon: 39.7231 },
  { name: 'Екатеринбург', region: 'Свердловская область', lat: 56.8389, lon: 60.6057 },
  { name: 'Казань', region: 'Татарстан', lat: 55.7963, lon: 49.1088 },
  { name: 'Нижний Новгород', region: 'Нижегородская область', lat: 56.3269, lon: 44.0059 },
  { name: 'Самара', region: 'Самарская область', lat: 53.1959, lon: 50.1002 },
  { name: 'Уфа', region: 'Башкортостан', lat: 54.7388, lon: 55.9721 },
  { name: 'Тюмень', region: 'Тюменская область', lat: 57.153, lon: 65.5343 },
  { name: 'Тула', region: 'Тульская область', lat: 54.1961, lon: 37.6182 },
  { name: 'Липецк', region: 'Липецкая область', lat: 52.6031, lon: 39.5708 },
]

export const MARKET_CITIES = CITIES.map((c) => c.name)

/** Координаты города выдачи [широта, долгота] — для карты маршрута (Яндекс.Карты) */
export function marketCityGeo(name: string): [number, number] | null {
  const c = CITIES.find((x) => x.name === name)
  return c ? [c.lat, c.lon] : null
}

function haversineKm(a: CityGeo, b: CityGeo): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Плечи между городами справочника, км. Источник — реальная дорожная сеть
// (маршрутизатор OSRM на данных OpenStreetMap) между центрами городов;
// округление до 5 км. Пары, проверенные в Яндекс.Картах в грузовом профиле
// (rtt=truck), закреплены точными яндексовскими значениями: Москва–Казань
// = 840, Москва–Краснодар = 1380. Если Яндекс покажет иное по какой-то ещё
// паре — достаточно дописать её в PINNED скрипта scripts/build_road_km.py
// и перегенерировать таблицу. Ключ «А|B» читается в любом порядке:
// roadKm проверяет обе перестановки.
const ROAD_KM: Record<string, number> = {
  'Абинск|Волгоград': 780,
  'Абинск|Воронеж': 905,
  'Абинск|Екатеринбург': 2480,
  'Абинск|Казань': 1825,
  'Абинск|Краснодар': 55,
  'Абинск|Липецк': 1020,
  'Абинск|Москва': 1415,
  'Абинск|Нижний Новгород': 1615,
  'Абинск|Новороссийск': 95,
  'Абинск|Ростов-на-Дону': 345,
  'Абинск|Самара': 1590,
  'Абинск|Санкт-Петербург': 2130,
  'Абинск|Сочи': 335,
  'Абинск|Ставрополь': 355,
  'Абинск|Тула': 1245,
  'Абинск|Тюмень': 2815,
  'Абинск|Уфа': 2060,
  'Волгоград|Екатеринбург': 1675,
  'Волгоград|Казань': 1040,
  'Волгоград|Липецк': 650,
  'Волгоград|Нижний Новгород': 990,
  'Волгоград|Самара': 785,
  'Волгоград|Сочи': 990,
  'Волгоград|Ставрополь': 565,
  'Волгоград|Тула': 880,
  'Волгоград|Тюмень': 2010,
  'Волгоград|Уфа': 1255,
  'Воронеж|Волгоград': 580,
  'Воронеж|Екатеринбург': 1765,
  'Воронеж|Казань': 1045,
  'Воронеж|Липецк': 120,
  'Воронеж|Нижний Новгород': 740,
  'Воронеж|Самара': 935,
  'Воронеж|Сочи': 1115,
  'Воронеж|Ставрополь': 895,
  'Воронеж|Тула': 345,
  'Воронеж|Тюмень': 2095,
  'Воронеж|Уфа': 1345,
  'Екатеринбург|Казань': 865,
  'Екатеринбург|Липецк': 1680,
  'Екатеринбург|Нижний Новгород': 1265,
  'Екатеринбург|Самара': 890,
  'Екатеринбург|Тула': 1835,
  'Екатеринбург|Тюмень': 330,
  'Екатеринбург|Уфа': 535,
  'Казань|Липецк': 960,
  'Казань|Нижний Новгород': 395,
  'Казань|Самара': 360,
  'Казань|Тула': 1005,
  'Казань|Тюмень': 1200,
  'Казань|Уфа': 530,
  'Краснодар|Волгоград': 710,
  'Краснодар|Воронеж': 835,
  'Краснодар|Екатеринбург': 2415,
  'Краснодар|Казань': 1755,
  'Краснодар|Липецк': 955,
  'Краснодар|Москва': 1380,
  'Краснодар|Нижний Новгород': 1545,
  'Краснодар|Новороссийск': 150,
  'Краснодар|Ростов-на-Дону': 275,
  'Краснодар|Самара': 1525,
  'Краснодар|Санкт-Петербург': 2060,
  'Краснодар|Сочи': 295,
  'Краснодар|Ставрополь': 300,
  'Краснодар|Тула': 1175,
  'Краснодар|Тюмень': 2745,
  'Краснодар|Уфа': 1990,
  'Москва|Волгоград': 970,
  'Москва|Воронеж': 515,
  'Москва|Екатеринбург': 1665,
  'Москва|Казань': 840,
  'Москва|Липецк': 465,
  'Москва|Нижний Новгород': 435,
  'Москва|Ростов-на-Дону': 1075,
  'Москва|Самара': 1095,
  'Москва|Санкт-Петербург': 705,
  'Москва|Сочи': 1625,
  'Москва|Ставрополь': 1405,
  'Москва|Тула': 185,
  'Москва|Тюмень': 1995,
  'Москва|Уфа': 1330,
  'Нижний Новгород|Липецк': 610,
  'Нижний Новгород|Самара': 700,
  'Нижний Новгород|Тула': 610,
  'Нижний Новгород|Тюмень': 1595,
  'Нижний Новгород|Уфа': 930,
  'Новороссийск|Волгоград': 865,
  'Новороссийск|Воронеж': 990,
  'Новороссийск|Екатеринбург': 2565,
  'Новороссийск|Казань': 1910,
  'Новороссийск|Липецк': 1105,
  'Новороссийск|Москва': 1505,
  'Новороссийск|Нижний Новгород': 1700,
  'Новороссийск|Ростов-на-Дону': 430,
  'Новороссийск|Самара': 1675,
  'Новороссийск|Санкт-Петербург': 2215,
  'Новороссийск|Сочи': 285,
  'Новороссийск|Ставрополь': 445,
  'Новороссийск|Тула': 1330,
  'Новороссийск|Тюмень': 2900,
  'Новороссийск|Уфа': 2145,
  'Ростов-на-Дону|Волгоград': 475,
  'Ростов-на-Дону|Воронеж': 570,
  'Ростов-на-Дону|Екатеринбург': 2145,
  'Ростов-на-Дону|Казань': 1490,
  'Ростов-на-Дону|Липецк': 685,
  'Ростов-на-Дону|Нижний Новгород': 1280,
  'Ростов-на-Дону|Самара': 1255,
  'Ростов-на-Дону|Сочи': 555,
  'Ростов-на-Дону|Ставрополь': 345,
  'Ростов-на-Дону|Тула': 910,
  'Ростов-на-Дону|Тюмень': 2480,
  'Ростов-на-Дону|Уфа': 1725,
  'Самара|Липецк': 850,
  'Самара|Тула': 1045,
  'Самара|Тюмень': 1225,
  'Самара|Уфа': 470,
  'Санкт-Петербург|Волгоград': 1685,
  'Санкт-Петербург|Воронеж': 1230,
  'Санкт-Петербург|Екатеринбург': 2360,
  'Санкт-Петербург|Казань': 1530,
  'Санкт-Петербург|Липецк': 1175,
  'Санкт-Петербург|Нижний Новгород': 1135,
  'Санкт-Петербург|Ростов-на-Дону': 1790,
  'Санкт-Петербург|Самара': 1790,
  'Санкт-Петербург|Сочи': 2340,
  'Санкт-Петербург|Ставрополь': 2120,
  'Санкт-Петербург|Тула': 895,
  'Санкт-Петербург|Тюмень': 2695,
  'Санкт-Петербург|Уфа': 2025,
  'Сочи|Екатеринбург': 2690,
  'Сочи|Казань': 2035,
  'Сочи|Липецк': 1230,
  'Сочи|Нижний Новгород': 1825,
  'Сочи|Самара': 1800,
  'Сочи|Тула': 1450,
  'Сочи|Тюмень': 3025,
  'Сочи|Уфа': 2270,
  'Ставрополь|Екатеринбург': 2235,
  'Ставрополь|Казань': 1600,
  'Ставрополь|Липецк': 1015,
  'Ставрополь|Нижний Новгород': 1550,
  'Ставрополь|Самара': 1345,
  'Ставрополь|Сочи': 480,
  'Ставрополь|Тула': 1235,
  'Ставрополь|Тюмень': 2570,
  'Ставрополь|Уфа': 1815,
  'Тула|Липецк': 290,
  'Тюмень|Липецк': 2005,
  'Тюмень|Тула': 2165,
  'Уфа|Липецк': 1260,
  'Уфа|Тула': 1500,
  'Уфа|Тюмень': 865,
}

/**
 * Плечо по дорогам между городами выдачи, км. Для пар из таблицы —
 * расстояние по реальной дорожной сети (см. комментарий к ROAD_KM);
 * для пар, которых нет в таблице (новые города), — прямое расстояние
 * × 1.2 (средний коэффициент дорожной сети), округление до 5 км.
 */
export function roadKm(fromName: string, toName: string): number {
  const a = CITIES.find((c) => c.name === fromName)
  const b = CITIES.find((c) => c.name === toName)
  if (!a || !b || a === b) return 0
  const measured = ROAD_KM[`${a.name}|${b.name}`] ?? ROAD_KM[`${b.name}|${a.name}`]
  if (measured) return measured
  return Math.max(5, Math.round((haversineKm(a, b) * 1.2) / 5) * 5)
}

// ---------------------------------------------------------------------------
// Детерминированный генератор (стабильная выдача при одинаковых фильтрах)
// ---------------------------------------------------------------------------

function seeded(seedStr: string): () => number {
  let h = 2166136261
  for (const ch of seedStr) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return ((h >>> 0) % 100000) / 100000
  }
}

function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)]
}

// ---------------------------------------------------------------------------
// Справочники выдачи
// ---------------------------------------------------------------------------

export const BODIES = ['тент', 'изотерм', 'реф', 'бортовая', 'цельнометалл.', 'контейнер'] as const
export type BodyName = (typeof BODIES)[number]

export const PAYMENTS = [
  { id: 'cashless_vat', label: 'безнал с НДС' },
  { id: 'cashless', label: 'безнал без НДС' },
  { id: 'cash', label: 'наличный' },
  { id: 'card', label: 'на карту' },
] as const
export type PaymentId = (typeof PAYMENTS)[number]['id']

const CARGO_NAMES = [
  'Безалкогольные напитки, паллеты', 'Металлопрокат в пачках', 'Профиль металлический',
  'Стройматериалы (сухие смеси)', 'Бытовая химия', 'Трубы стальные, штанги', 'Арматура А500',
  'Шины грузовые', 'Промышленное оборудование', 'Пиломатериалы в пакете', 'Пластиковые изделия',
  'Мебель корпоративная', 'Кондитерские изделия', 'Синтетические волокна', 'Бумага в рулонах',
  'Автозапчасти в коробах', 'Тара и упаковка', 'Агрегаты и узлы, ящики',
]

const FIRMS = [
  'ООО «Поволжье-Транс»', 'ООО «Транс-Лайн»', 'ООО «Магистраль-Кубань»', 'ИП Гареев А.Р.',
  'ООО «Байкал-Сервис»', 'ООО «ТатТранс»', 'ИП Соколов Д.В.', 'ООО «УралКарго»',
  'ООО «ЛогистикПро»', 'ИП Валеев Р.И.', 'ООО «АвтоТрейд»', 'ООО «Кубань-Авто»',
]

// Контактные лица грузов (демо): с лицензией «Перевозчик»/«Все грузы» телефон
// приходит из API; в демо-режиме генерируется правдоподобный номер.
const CONTACT_NAMES = [
  'Гареев Айрат Ринатович', 'Соколов Дмитрий Владимирович', 'Валеев Рустам Ильдарович',
  'Мельникова Ольга Петровна', 'Ткачёв Сергей Анатольевич', 'Джабраилов Аслан Хасанович',
  'Пивоваров Игорь Николаевич', 'Ларина Наталья Викторовна', 'Кузьменко Андрей Олегович',
  'Саркисян Армен Гарикович', 'Дорошенко Виктор Степанович', 'Атаев Мурат Бахтиярович',
]

/** Правдоподобный мобильный номер (демо; в реальном API приходит из груза) */
function genPhone(rnd: () => number): string {
  return `+7${pick(rnd, ['918', '961', '962', '988', '999'])} 555-${String(10 + Math.floor(rnd() * 89))}-${String(10 + Math.floor(rnd() * 89))}`
}

/**
 * Опорный город рядом с точкой маршрута — для строки «83 км от Абинск» в
 * выдаче ATI.SU. Берётся ближайший город справочника с точным дорожным
 * плечом из таблицы (40–300 км), исключая сами пункты маршрута.
 */
function refCity(point: CityGeo, exclude: string[]): { city: string; km: number } | null {
  let best: { city: string; km: number } | null = null
  for (const c of CITIES) {
    if (c.name === point.name || exclude.includes(c.name)) continue
    const km = roadKm(point.name, c.name)
    if (km < 40 || km > 350) continue
    if (!best || km < best.km) best = { city: c.name, km }
  }
  return best
}

/** 1–2 последних отзыва о фирме (демо-заглушка API отзывов) */
function makeReviews(rnd: () => number, rating: number, from: string, to: string): MarketReview[] {
  const count = rnd() < 0.5 ? 2 : 1
  const out: MarketReview[] = []
  for (let i = 0; i < count; i++) {
    const daysAgo = 3 + Math.floor(rnd() * 75)
    const d = new Date(Date.now() - daysAgo * 86400000)
    const r = Math.max(3, Math.min(5, Math.round(rating + (rnd() - 0.45))))
    out.push({
      author: pick(rnd, FIRMS),
      rating: r,
      date: d.toLocaleDateString('ru-RU'),
      route: `${from} → ${to}`,
      text: pick(rnd, REVIEW_POOL),
    })
  }
  return out
}

// Примечания грузовладельца к перевозке (как в карточке груза ATI.SU)
const NOTE_POOL = [
  'растентовка, верхняя загрузка', 'задняя загрузка, ремни в комплекте',
  'нужен гидроборт', 'паллеты, обмен паллет', 'только прямые рейсы, без перегрузов',
  'нужны санпаспорта на машину', 'боковая загрузка, 33 паллета', 'склад работает 24/7, ожидание до 2 часов',
  'загрузка по записи, с 9:00 до 18:00', 'машина под пищевую нагрузку, чистая',
  'оплата в течение 3 дней после отгрузки документов', 'вес на каждой паллете не более 1,5 т',
]

// ЗАГЛУШКА (поле «оплата горючего» выдачи ATI.SU): как и когда платят за топливо.
// В реальном API — поля оплаты груза (payment/нал. топливо/банкир. дни).
const FUEL_NOTES = [
  'через 3 б/а без горючего', 'через 3 б/а с горючим',
  'через 5 б/а без горючего', 'с предоплатой 50% на топливо',
]

// ЗАГЛУШКА (API отзывов ATI.SU): отзывы участников сделок о фирме.
// В реальном API — /v1.0/firms/{atiId}/feedback (после «Расширенного доступа»).
const REVIEW_POOL = [
  'Оплата на 2-й день после оригиналов. ТСД высылают сразу, работаем второй год.',
  'Погрузка по записи, но при раннем приезде пропускают. Склад чистый, пропуска оформляют быстро.',
  'Ставку держат, на топливо доплатили без спора. Рекомендую по этому направлению.',
  'Отменили за два часа до подачи — предупредили, издержки компенсировали.',
  'Документы через ЭДО затянулись на день, оплата без задержек.',
  'Загрузка вечером, выгрузка утром — все точки рядом с трассой, просто.',
  'Оплата через «Гарантию ATI.SU» — деньги зависли на 40 минут, всё честно.',
  'Вес в накладной не совпал с фактом, пересчёт сделали быстро и без наценки.',
]

/** Отзыв участника сделки о фирме (демо-заглушка по форме API отзывов ATI.SU) */
export type MarketReview = {
  author: string
  rating: number
  date: string
  route: string
  text: string
}

// ---------------------------------------------------------------------------
// Типы выдачи
// ---------------------------------------------------------------------------

/** Роль фирмы на бирже ATI.SU */
export type FirmRole = 'грузовладелец' | 'экспедитор' | 'перевозчик'

/** Значки участника ATI.SU — показываются в карточке груза, значение поясняется подсказкой */
export type CarrierBadges = {
  /** ГосЛог — фирма в реестре Минтранса (с 01.03.2026 идёт регистрация экспедиторов) */
  goslog: boolean
  /** Готов к ЭТрН — работа с электронными транспортными накладными; степень I — высшая */
  etrn: 'I' | 'II' | 'III' | null
  /** Реальный перевозчик — собственный транспорт, работает напрямую */
  real_carrier: boolean
  /** Контакт подтверждён — личность контактного лица проверена */
  contact_confirmed: boolean
  /** Участник ЭДО «АТИ-Доки» с электронной подписью */
  edo: boolean
}

export type MarketCarrier = {
  firm: string
  /** Код фирмы на ATI.SU */
  firm_ati: number
  city: string
  role: FirmRole
  /** Рейтинг 1–5 (по отзывам участников сделок) */
  rating: number
  reviews: number
  on_ati_since: number
  badges: CarrierBadges
}

export type MarketLoad = {
  id: string
  /** Код груза на ATI.SU (числовой, уходит в сделки/БД) */
  ati_id: number
  /** Код груза в формате биржи (буквы+цифры, напр. «XBU300591») — для карточки */
  code: string
  from: string
  from_region: string
  to: string
  to_region: string
  km: number
  /** Оценка времени в пути, ч (плечо ÷ 80 км/ч, округление до 0,5) */
  hours_est: number
  bodies: BodyName[]
  cargo: string
  weight_t: number
  volume_m3: number
  /** Габариты груза Д×Ш×В, м; null — не указаны */
  dims_m: string | null
  /** Условия загрузки/выгрузки: «верх.», «бок.», «задн.» и сочетания */
  loading: string
  /** Дополнительные условия: «воз. догрузка», «отд. машина», «б/палл.» */
  load_extras: string[]
  date_from: string
  date_to: string
  payment: PaymentId
  nds_pct: number
  rate: number
  rate_no_vat: number
  per_km: number
  /** ₽/км без НДС */
  per_km_no_vat: number
  /** Торг по ставке: false — «без торга» (как пометка в выдаче ATI.SU) */
  bargain: boolean
  prepay_pct: number | null
  guaranteed: boolean
  contest: boolean
  ads: boolean
  regular: boolean
  adr: boolean
  offers: number
  updated_min_ago: number
  contacts_locked: boolean
  contact_name: string
  contact_phone: string
  /** Примечание грузовладельца к перевозке; null — не указано */
  note: string | null
  // —— Поля «полной выдачи» ATI.SU (демо-заглушки; после подключения реального
  // API заполняются из ответа сервера без изменения карточки) ——
  /** Расстояние, указанное грузовладельцем (красным в выдаче ATI.SU, если отличается от расчёта); null — не указано */
  km_owner: number | null
  /** Опорный город у пункта погрузки: «27 км от Москва» */
  from_ref: string | null
  from_ref_km: number | null
  /** Опорный город у пункта выгрузки: «83 км от Абинск» */
  to_ref: string | null
  to_ref_km: number | null
  /** Пометка оплаты горючего: «через 3 б/а без горючего» (заглушка) */
  fuel_note: string | null
  /** Рекомендованная ставка «ТрейРадара» за погрузку, ₽ (заглушка сервиса подсказок ставок) */
  radar_rate: number
  /** Приоритет показа груза, атис. (услуга «Приоритетный показ»); null — услуга не куплена */
  priority_atis: number | null
  /** Запись в «белом списке» ГосЛога: «p461, n1»; null — фирмы нет в реестре */
  goslog_ref: string | null
  /** Медали ATI.SU за активность и отзывы (0–3) */
  medals: number
  /** Второе контактное лицо груза (как на ATI.SU — часто два телефона); null — один */
  contact2_name: string | null
  contact2_phone: string | null
  /** Последние отзывы о фирме (заглушки, раскрываются в карточке) */
  reviews: MarketReview[]
  carrier: MarketCarrier
}

export type MarketQuery = {
  from: string
  to: string
  weight: number
  volume: number
  dateFromToday: boolean
  bodies: string[]
  payments: string[]
  minRate: number | null
  minRatePerKm: boolean
  hideRegulars: boolean
  hideAtd: boolean
  showContests: boolean
  showAds: boolean
  sort: 'updated' | 'rate_desc' | 'rate_asc' | 'km_asc'
  take: number
  fixed: boolean
  basePerKm: number
  guaranteedShare: number
  page: number
}

// ---------------------------------------------------------------------------
// Генерация выдачи
// ---------------------------------------------------------------------------

function generateLoad(rnd: () => number, q: MarketQuery, i: number, dayKey: string): MarketLoad {
  // Направление: точное из фильтра, иначе случайное из пула (в т.ч. из базы АЭМЗ)
  let from: CityGeo
  let to: CityGeo
  if (q.from && q.to) {
    from = CITIES.find((c) => c.name === q.from) ?? CITIES[3]
    to = CITIES.find((c) => c.name === q.to) ?? CITIES[1]
  } else if (q.from) {
    from = CITIES.find((c) => c.name === q.from) ?? CITIES[3]
    to = pick(rnd, CITIES.filter((c) => c !== from))
  } else {
    from = rnd() > 0.3 ? CITIES[0] : pick(rnd, CITIES)
    to = pick(rnd, CITIES.filter((c) => c !== from))
  }
  const km = roadKm(from.name, to.name)

  // Кузов груза: 1–3 типа из справочника
  const bodiesCount = 1 + Math.floor(rnd() * 3)
  const bodies: BodyName[] = []
  while (bodies.length < bodiesCount) {
    const b = pick(rnd, BODIES)
    if (!bodies.includes(b)) bodies.push(b)
  }

  // Вес/объём: всегда «влазит» в пропускную способность фильтра
  const weightCap = q.weight || 21
  const volumeCap = q.volume || 83
  const weight_t = Math.round(weightCap * (0.35 + rnd() * 0.62) * 10) / 10
  const volume_m3 = Math.round(volumeCap * (0.4 + rnd() * 0.55))

  // Даты погрузки: с сегодня + 0–4 дня, окно 1–4 дня (60 дней вперёд, как в схеме)
  const firstOffset = Math.floor(rnd() * 5)
  const first = new Date(Date.now() + firstOffset * 86400000)
  const last = new Date(first.getTime() + (1 + Math.floor(rnd() * 4)) * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  // Оплата: в зависимости от выбранных типов
  const payPool = (q.payments.length ? q.payments : PAYMENTS.map((p) => p.id)) as PaymentId[]
  const payment = pick(rnd, payPool)

  // Ставка: плечо × ₽/км, множители кузова и типа оплаты
  const bodyMul = bodies.some((b) => b === 'реф' || b === 'изотерм') ? 1.12 : bodies.some((b) => b === 'тент') ? 1.0 : 0.95
  const payMul = payment === 'cashless_vat' ? 1.0 : payment === 'cashless' ? 0.86 : payment === 'cash' ? 0.9 : 0.92
  const perKm = Math.max(28, Math.round(q.basePerKm * bodyMul * payMul * (0.85 + rnd() * 0.4)))
  const rate = Math.round((km * perKm) / 500) * 500
  const nds_pct = 22 // НДС 2026 (прайс/выдача ATI.SU)
  const rate_no_vat = Math.round((rate / (1 + nds_pct / 100)) / 500) * 500
  const per_km = Math.round((rate / km) * 10) / 10
  const per_km_no_vat = Math.round((rate_no_vat / km) * 10) / 10
  // Оценка времени в пути — как в детальной карточке ATI.SU («610 км · ~7,5 ч»):
  // средняя для фуры ~80 км/ч, округление до получаса
  const hours_est = Math.round((km / 80) * 2) / 2
  const bargain = rnd() < 0.4
  const loading = pick(rnd, ['верх.', 'бок.', 'задн.', 'верх., бок.', 'задн., бок.'])
  const load_extras = ['воз. догрузка', 'отд. машина', 'б/палл.'].filter(() => rnd() < 0.3).slice(0, 2)
  const dims_m = rnd() < 0.8
    ? `${pick(rnd, ['6,2', '7,1', '8,2', '9,6', '10,2', '12,4', '13,6'])}×${pick(rnd, ['2,4', '2,45', '2,5'])}×${pick(rnd, ['2,4', '2,45', '2,5', '2,7', '2,9'])}`
    : null

  const guaranteed = rnd() < q.guaranteedShare
  const contest = q.showContests && rnd() < 0.22
  const ads = q.showAds && rnd() < 0.15
  const prepay = rnd() > 0.45 ? pick(rnd, [50, 90, 100]) : null

  // Примечание к грузу и владелец: роль, город, рейтинг и значки ATI.SU
  const note = rnd() < 0.6 ? pick(rnd, NOTE_POOL) : null
  const roleRoll = rnd()
  const role: FirmRole = roleRoll < 0.45 ? 'грузовладелец' : roleRoll < 0.72 ? 'экспедитор' : 'перевозчик'
  const etrnRoll = rnd()
  const carrier: MarketCarrier = {
    firm: pick(rnd, FIRMS),
    firm_ati: 1500000 + Math.floor(rnd() * 8000000),
    city: pick(rnd, CITIES).name,
    role,
    rating: Math.round((3.6 + rnd() * 1.4) * 10) / 10,
    reviews: 30 + Math.floor(rnd() * 1200),
    on_ati_since: 2006 + Math.floor(rnd() * 18),
    badges: {
      contact_confirmed: rnd() < 0.85,
      goslog: rnd() < 0.7,
      etrn: etrnRoll < 0.55 ? (['III', 'II', 'I'] as const)[Math.floor(rnd() * 3)] : null,
      real_carrier: role === 'перевозчик' ? rnd() < 0.8 : rnd() < 0.2,
      edo: rnd() < 0.55,
    },
  }

  // —— Поля полной выдачи (заглушки по форме реального API) ——
  const fromRef = refCity(from, [to.name])
  const toRef = refCity(to, [from.name])
  // Расстояние, указанное грузовладельцем: у ~35% грузов отличается от расчёта ATI (показ красным)
  const kmOwner = rnd() < 0.35 ? Math.round((km * (0.93 + rnd() * 0.14)) / 5) * 5 : null
  const fuelNote = rnd() < 0.6 ? pick(rnd, FUEL_NOTES) : null
  // ТрейРадар (заглушка): рекомендация ставки по направлению ±5% к рыночной
  const radarRate = Math.round((rate * (0.95 + rnd() * 0.1)) / 500) * 500
  // Приоритетный показ — платная услуга грузовладельца (не у всех)
  const priorityAtis = rnd() < 0.55 ? Math.round((15 + rnd() * 70) * 100) / 100 : null
  // Второе контактное лицо (как на ATI.SU — часто два телефона на грузе)
  const contact2 = rnd() < 0.4 ? { name: pick(rnd, CONTACT_NAMES), phone: genPhone(rnd) } : null

  return {
    id: `${String(first.getDate()).padStart(2, '0')}${String(first.getMonth() + 1).padStart(2, '0')}-${String(1000 + Math.floor(rnd() * 9000)).slice(1)}`,
    ati_id: 2000000 + Math.floor(rnd() * 7000000),
    // Код груза в формате ATI.SU: 3 символа (буквы/цифра) + 6 цифр, напр. «XBU300591»
    code: `${pick(rnd, 'ABEKMHOPCTXY29'.split(''))}${pick(rnd, 'ABEKMHOPCTXY29'.split(''))}${pick(rnd, 'ABEKMHOPCTXY29'.split(''))}${100000 + Math.floor(rnd() * 899999)}`,
    from: from.name,
    from_region: from.region,
    to: to.name,
    to_region: to.region,
    km,
    hours_est,
    bodies,
    cargo: pick(rnd, CARGO_NAMES),
    weight_t,
    volume_m3,
    dims_m,
    loading,
    load_extras,
    date_from: fmt(first),
    date_to: fmt(last),
    payment,
    nds_pct,
    rate,
    rate_no_vat,
    per_km,
    per_km_no_vat,
    bargain,
    prepay_pct: prepay,
    guaranteed,
    contest,
    ads,
    regular: rnd() < 0.15,
    adr: rnd() < 0.08,
    offers: Math.floor(rnd() * 14),
    updated_min_ago: 1 + Math.floor(rnd() * 140),
    contacts_locked: true, // без лицензии «Перевозчик» контакты скрыты (как на сайте)
    contact_name: pick(rnd, CONTACT_NAMES),
    contact_phone: genPhone(rnd),
    note,
    km_owner: kmOwner,
    from_ref: fromRef?.city ?? null,
    from_ref_km: fromRef?.km ?? null,
    to_ref: toRef?.city ?? null,
    to_ref_km: toRef?.km ?? null,
    fuel_note: fuelNote,
    radar_rate: radarRate,
    priority_atis: priorityAtis,
    goslog_ref: carrier.badges.goslog ? `p${300 + Math.floor(rnd() * 400)}, n${1 + Math.floor(rnd() * 9)}` : null,
    medals: Math.floor(rnd() * rnd() * 4),
    contact2_name: contact2?.name ?? null,
    contact2_phone: contact2?.phone ?? null,
    reviews: makeReviews(rnd, carrier.rating, from.name, to.name),
    carrier,
  }
}

/** Фильтрация выдачи под параметры поиска (как это делает Поиск грузов ATI.SU) */
function matches(l: MarketLoad, q: MarketQuery): boolean {
  if (q.weight > 0 && l.weight_t > q.weight + 0.5) return false
  if (q.volume > 0 && l.volume_m3 > q.volume + 1) return false
  if (q.bodies.length > 0 && !l.bodies.some((b) => q.bodies.includes(b))) return false
  if (q.payments.length > 0 && !q.payments.includes(l.payment)) return false
  if (q.minRate != null && q.minRate > 0) {
    const v = q.minRatePerKm ? l.per_km : l.rate
    if (v < q.minRate) return false
  }
  if (q.hideRegulars && l.regular) return false
  if (q.hideAtd && l.adr) return false
  return true
}

function cmpLoad(a: MarketLoad, b: MarketLoad, sort: MarketQuery['sort']): number {
  switch (sort) {
    case 'rate_desc': return b.rate - a.rate
    case 'rate_asc': return a.rate - b.rate
    case 'km_asc': return a.km - b.km
    default: return a.updated_min_ago - b.updated_min_ago
  }
}

/** Выдача витрины: детерминирована при fixed=true, обновляется при fixed=false */
export function generateMarketPage(q: MarketQuery): { total: number; loads: MarketLoad[] } {
  const rndKey = q.fixed ? `fixed:${q.from}|${q.to}|${q.weight}|${q.volume}|${q.bodies.join(',')}|${q.payments.join(',')}|${q.minRate ?? ''}|${q.basePerKm}|${q.guaranteedShare}` : `live:${Date.now()}`
  const rnd = seeded(rndKey)
  const poolSize = Math.max(48, q.take * 6)
  const pool: MarketLoad[] = []
  for (let i = 0; i < poolSize; i++) pool.push(generateLoad(rnd, q, i, rndKey))
  // Дедупликация по направлению+грузу (чтобы не выглядело как клоны)
  const seen = new Set<string>()
  const unique = pool.filter((l) => {
    const key = `${l.from}|${l.to}|${l.cargo}|${l.rate}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const matched = unique.filter((l) => matches(l, q)).sort((a, b) => cmpLoad(a, b, q.sort))
  const start = q.page * q.take
  return { total: matched.length, loads: matched.slice(start, start + q.take) }
}

// ---------------------------------------------------------------------------
// История поиска (демо) — 6 последних запросов, детерминированы за сегодня
// ---------------------------------------------------------------------------

export type MarketHistoryItem = {
  id: string
  at: string
  from: string
  to: string
  bodies: string
  found: number
}

export function generateHistory(): MarketHistoryItem[] {
  const rnd = seeded(`history:${new Date().toISOString().slice(0, 13)}`)
  const out: MarketHistoryItem[] = []
  const pairs: [string, string][] = [
    ['Москва', 'Краснодар'], ['Краснодар', 'Абинск'], ['Новороссийск', 'Москва'],
    ['Абинск', 'Ставрополь'], ['Ростов-на-Дону', 'Сочи'], ['Москва', 'Новороссийск'],
  ]
  for (let i = 0; i < pairs.length; i++) {
    const minsAgo = 8 + Math.floor(rnd() * 120) * (i + 1)
    const at = new Date(Date.now() - minsAgo * 60000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    out.push({
      id: `h${i}`,
      at,
      from: pairs[i][0],
      to: pairs[i][1],
      bodies: pick(rnd, ['тент', 'реф', 'изотерм', 'тент, реф', 'без ограничений']),
      found: 3 + Math.floor(rnd() * 26),
    })
  }
  return out
}
