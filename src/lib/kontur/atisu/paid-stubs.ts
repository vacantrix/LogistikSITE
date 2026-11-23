// Платные сервисы ATI.SU — ЗАГЛУШКИ (тестовый режим).
// Реальные запросы к платным API не отправляются: методы возвращают
// детерминированные правдоподобные данные и метаданные сервиса
// (цена, планируемый эндпоинт, что даёт покупка).
// Цены — официальный прайс ATI.SU (действуют с 01.01.2026), ₽ за 30 дней.

import { roadKm } from './market-stubs'

export type StubEnvelope<T> = {
  __stub: true
  service: string
  title: string
  price: string
  plannedEndpoint: string
  note: string
  generatedAt: string
  data: T
}

export type PaidServiceId = 'truck_search' | 'active_carriers' | 'avg_rates' | 'distance' | 'geocoding' | 'nearest_cities'

export const PAID_SERVICES: Record<PaidServiceId, { title: string; price: string; endpoint: string; note: string }> = {
  truck_search: {
    title: 'API Поиска транспорта',
    price: '8 000 ₽ / 30 дн',
    endpoint: 'api.ati.su (поиск машин на общей бирже)',
    note: 'Ищет свободные машины с контактами по направлению и параметрам груза. Нужно грузовладельцу; для обраток АЭМЗ — проверка конкурентов на направлении.',
  },
  active_carriers: {
    title: 'API Поиска активных перевозчиков',
    price: '12 000 ₽ / 30 дн',
    endpoint: 'api.ati.su (перевозчики, искавшие груз/выставлявшие машины по направлению)',
    note: 'Показывает перевозчиков, которые уже искали грузы или размещали транспорт по направлению. Аналитика конкурентности направления.',
  },
  avg_rates: {
    title: 'API Средних ставок',
    price: '15 000 ₽ / 30 дн',
    endpoint: 'api.ati.su (средние ставки участников по направлению)',
    note: 'Средние/мин/макс ставки по направлению, типу груза и кузова. Основа для оценки доходности обратки.',
  },
  distance: {
    title: 'API Расчёта расстояний',
    price: 'от 5 800 ₽ / 30 дн (1 000 з/с) до 75 000 ₽ (50 000 з/с)',
    endpoint: 'api.ati.su (маршрут: расстояние и время в пути)',
    note: 'Точный маршрут, километраж и время в пути для плеча обратки и расчёта рентабельности.',
  },
  geocoding: {
    title: 'API Геокодирования',
    price: 'от 9 000 ₽ / 30 дн (1 000 з/с) до 225 000 ₽ (50 000 з/с)',
    endpoint: 'api.ati.su (адрес ↔ координаты)',
    note: 'Координаты адресов погрузки/выгрузки для карты и сопоставления точек с заявками.',
  },
  nearest_cities: {
    title: 'API Ближайших городов в радиусе',
    price: 'от 5 800 ₽ / 30 дн (1 000 з/с) до 25 000 ₽ (10 000 з/с)',
    endpoint: 'api.ati.su (населённые пункты в радиусе по дорогам)',
    note: 'Города, достижимые из точки выгрузки — расширение поиска обратки без пустого пробега.',
  },
}

// ---- детерминированный псевдослучайный генератор (стабильные демо-данные) ----
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

function envelope<T>(service: PaidServiceId, data: T): StubEnvelope<T> {
  const meta = PAID_SERVICES[service]
  return {
    __stub: true,
    service,
    title: meta.title,
    price: meta.price,
    plannedEndpoint: meta.endpoint,
    note: meta.note,
    generatedAt: new Date().toISOString(),
    data,
  }
}

// ---- 1. Поиск транспорта (грузовладелец ищет машину) ----
export type TruckSearchRow = {
  ati_id: number
  firm: string
  rating: number
  car_type: string
  capacity_t: number
  volume_m3: number
  city: string
  date_from: string
  price_hint: number | null
}

export function stubTruckSearch(input: { from: string; to: string; weight?: number }): StubEnvelope<TruckSearchRow[]> {
  const rnd = seeded(`trucks:${input.from}:${input.to}:${input.weight ?? 0}`)
  const firms = ['ООО «Транс-Лайн»', 'ИП Гареев А.Р.', 'ООО «АвтоТрейд»', 'ООО «Байкал-Сервис»', 'ИП Соколов Д.В.', 'ООО «Магистраль»']
  const types = ['тент', 'тент', 'реф.', 'бортовая', 'тент-сцепка']
  const n = 4 + Math.floor(rnd() * 4)
  const rows: TruckSearchRow[] = Array.from({ length: n }, (_, i) => ({
    ati_id: 100000 + Math.floor(rnd() * 900000),
    firm: firms[Math.floor(rnd() * firms.length)],
    rating: Math.round((3.5 + rnd() * 1.5) * 10) / 10,
    car_type: types[Math.floor(rnd() * types.length)],
    capacity_t: Math.round((input.weight ?? 20) * (0.8 + rnd() * 0.4)),
    volume_m3: 82 + Math.floor(rnd() * 40),
    city: rnd() > 0.5 ? input.from : input.to,
    date_from: new Date(Date.now() + Math.floor(rnd() * 3 * 86400000)).toISOString().slice(0, 10),
    price_hint: rnd() > 0.4 ? Math.round((45000 + rnd() * 40000) / 500) * 500 : null,
  }))
  return envelope('truck_search', rows)
}

// ---- 2. Поиск активных перевозчиков ----
export type ActiveCarrierRow = {
  ati_id: number
  firm: string
  searches_30d: number
  trucks_published_30d: number
  last_seen: string
  own_trucks: number
}

export function stubActiveCarriers(input: { from: string; to: string }): StubEnvelope<ActiveCarrierRow[]> {
  const rnd = seeded(`carriers:${input.from}:${input.to}`)
  const firms = ['ООО «ЛогистикПро»', 'ООО «ТатТранс»', 'ИП Валеев Р.И.', 'ООО «УралКарго»', 'ООО «Поволжье-Транс»', 'ИП Ким А.С.']
  const n = 3 + Math.floor(rnd() * 4)
  const rows: ActiveCarrierRow[] = Array.from({ length: n }, () => ({
    ati_id: 100000 + Math.floor(rnd() * 900000),
    firm: firms[Math.floor(rnd() * firms.length)],
    searches_30d: 5 + Math.floor(rnd() * 60),
    trucks_published_30d: 2 + Math.floor(rnd() * 25),
    last_seen: new Date(Date.now() - Math.floor(rnd() * 10 * 86400000)).toISOString().slice(0, 10),
    own_trucks: 1 + Math.floor(rnd() * 18),
  }))
  return envelope('active_carriers', rows)
}

// ---- 3. Средние ставки по направлению ----
export type RatesRow = {
  direction: string
  car_type: string
  avg_rate: number
  min_rate: number
  max_rate: number
  per_km: number
  samples: number
  updated: string
}

export function stubAverageRates(input: { from: string; to: string; km?: number }): StubEnvelope<RatesRow> {
  const rnd = seeded(`rates:${input.from}:${input.to}`)
  // плечо: измеренное по Яндекс.Картам (см. market-stubs), иначе оценка
  const measured = roadKm(input.from, input.to)
  const km = input.km ?? (measured > 0 ? measured : Math.round(300 + rnd() * 1200))
  const base = Math.round(km * (38 + rnd() * 22))
  const avg = Math.round(base / 500) * 500
  const data: RatesRow = {
    direction: `${input.from} → ${input.to}`,
    car_type: 'тент 20 т / 82 м³',
    avg_rate: avg,
    min_rate: Math.round((avg * (0.78 + rnd() * 0.1)) / 500) * 500,
    max_rate: Math.round((avg * (1.15 + rnd() * 0.2)) / 500) * 500,
    per_km: Math.round((avg / km) * 10) / 10,
    samples: 40 + Math.floor(rnd() * 400),
    updated: new Date().toISOString().slice(0, 10),
  }
  return envelope('avg_rates', data)
}

// ---- 4. Расчёт расстояний ----
export type DistanceRow = {
  from: string
  to: string
  distance_km: number
  duration_hours: number
  route_hint: string
}

export function stubDistance(input: { from: string; to: string }): StubEnvelope<DistanceRow> {
  const rnd = seeded(`dist:${input.from}:${input.to}`)
  // плечо и время — как у грузового маршрута Яндекс.Карт (см. market-stubs)
  const measured = roadKm(input.from, input.to)
  const km = measured > 0 ? measured : Math.round(180 + rnd() * 1500)
  const data: DistanceRow = {
    from: input.from,
    to: input.to,
    distance_km: km,
    duration_hours: Math.round((km / 65) * 10) / 10,
    route_hint: 'грузовой маршрут по трассам M-*/Р-*',
  }
  return envelope('distance', data)
}

// ---- 5. Геокодирование ----
export type GeocodeRow = { query: string; lat: number; lon: number; precision: string }

export function stubGeocode(input: { address: string }): StubEnvelope<GeocodeRow> {
  const rnd = seeded(`geo:${input.address}`)
  const data: GeocodeRow = {
    query: input.address,
    lat: Math.round((54 + rnd() * 8) * 10000) / 10000,
    lon: Math.round((38 + rnd() * 35) * 10000) / 10000,
    precision: 'house | street | city',
  }
  return envelope('geocoding', data)
}

// ---- 6. Ближайшие города в радиусе ----
export type NearestCityRow = { city: string; distance_km: number }

export function stubNearestCities(input: { city: string; radiusKm?: number }): StubEnvelope<NearestCityRow[]> {
  const rnd = seeded(`near:${input.city}:${input.radiusKm ?? 150}`)
  const radius = input.radiusKm ?? 150
  const pool = ['Зеленодольск', 'Набережные Челны', 'Нижнекамск', 'Йошкар-Ола', 'Чебоксары', 'Ульяновск', 'Саранск', 'Пенза', 'Киров', 'Ижевск']
  const n = 3 + Math.floor(rnd() * 4)
  const rows: NearestCityRow[] = Array.from({ length: n }, (_, i) => ({
    city: pool[(Math.floor(rnd() * pool.length) + i) % pool.length],
    distance_km: Math.round(radius * (0.2 + rnd() * 0.75)),
  }))
  return envelope('nearest_cities', rows)
}

/** Единая точка вызова заглушек по id сервиса */
export function runStub(service: PaidServiceId, params: { from?: string; to?: string; weight?: number; km?: number; address?: string; city?: string; radiusKm?: number }): StubEnvelope<unknown> {
  switch (service) {
    case 'truck_search':
      return stubTruckSearch({ from: params.from || 'Москва', to: params.to || 'Казань', weight: params.weight })
    case 'active_carriers':
      return stubActiveCarriers({ from: params.from || 'Москва', to: params.to || 'Казань' })
    case 'avg_rates':
      return stubAverageRates({ from: params.from || 'Москва', to: params.to || 'Казань', km: params.km })
    case 'distance':
      return stubDistance({ from: params.from || 'Москва', to: params.to || 'Казань' })
    case 'geocoding':
      return stubGeocode({ address: params.address || 'Казань, ул. Баумана, 1' })
    case 'nearest_cities':
      return stubNearestCities({ city: params.city || params.from || 'Казань', radiusKm: params.radiusKm ?? 150 })
  }
}
