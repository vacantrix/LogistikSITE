// Типы интеграции ATI.SU (api.ati.su) — обратные рейсы, волна 2.
// Модели по официальной документации разработчиков ATI.SU (ati.su/developers).

/** Элемент словаря ATI.SU (v1.0/dictionaries/*) */
export type AtiDictionaryItem = {
  Id: number
  Id2?: string
  Name: string
  NameEng?: string
  ShortName?: string
  [key: string]: unknown
}

/** Ответ GET /v1.0/balance — баланс контакта (руб.) */
export type AtiBalance = number

/** Ответ GET /gw/trucks/integrator/v1/trucks/count */
export type AtiTrucksCount = {
  firm_trucks_count: number
  contact_trucks_count: number
  unpublished_firm_trucks_count: number
  unpublished_contact_trucks_count: number
  responses_for_contact_count: number
  responses_for_firm_count: number
}

/** Машина раздела «Ваши машины» (GET /gw/trucks/integrator/v1/trucks) */
export type AtiTruck = {
  truck_id: string
  contact_id1?: number
  contact_id2?: number | null
  department_id?: number | null
  note?: string | null
  first_date?: string | null
  last_date?: string | null
  date_type?: number
  added_at?: string | null
  updated_at?: string | null
  ati_id?: number
  is_archive_truck?: boolean
  transport?: {
    car_type?: number
    weight?: number
    volume?: number
    truck_length?: number
    trailer_length?: number
    [key: string]: unknown
  }
  loading?: { city_id?: number; radius?: number }
  payment?: { rate_sum?: number; currency_id?: number; nds?: boolean }
  [key: string]: unknown
}

/** Город гео-словаря (POST /gw/gis-dict/v1/cities/by-ids) */
export type AtiCity = {
  city_id: number
  name: string
  alt_name?: string
  region_id: number
  country_id: number
  is_regional_center: boolean
  size?: number
}

/** Груз в точке маршрута (модель вебхука cargoes.on_boards, сокращено) */
export type AtiLoadCargo = {
  name?: string
  weight?: { type?: string; quantity?: number }
  volume?: { quantity?: number }
}

/** Груз с закрытых площадок (GET /gw/search_loads/integration/v1/loads/search/by-boards) */
export type AtiBoardLoad = {
  cargo_id: string
  cargo_number: string
  added_at: string
  updated_at?: string
  refreshed_at?: string
  ati_id?: number
  route: {
    loading: {
      city_id: number
      address?: string
      dates?: { type?: string; first_date?: string; last_date?: string }
      cargos?: AtiLoadCargo[]
    }
    unloading: {
      city_id: number
      address?: string
      dates?: { first_date?: string; last_date?: string }
    }
    way_points?: unknown[]
    is_round_trip?: boolean
  }
  truck?: {
    trucks_count?: number
    load_type?: string
    body_types?: number[]
    required_capacity?: number
  }
  payment?: {
    type?: string
    rate?: number
    rate_with_vat?: number
    rates_with_vat?: { rate_with_vat: number; vat_percent: number }[]
    prepayment?: { percent?: number }
    payment_mode?: { type?: string; payment_delay_days?: number }
  }
  note?: string
  distance?: number
  offer_count?: number
  boards?: { id: string; reservation_enabled?: boolean }[]
}

/** Страница выдачи поиска грузов на площадках */
export type AtiBoardLoadsPage = {
  cargos: AtiBoardLoad[]
  total: number
}

/** Результат одного вызова ATI.SU для панели тестов */
export type AtiCallResult<T> = {
  ok: boolean
  status: number
  ms: number
  data?: T
  error?: string
}
