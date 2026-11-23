// Бесплатные методы ATI.SU — реальные вызовы api.ati.su (проверены живыми запросами).
// Платные сервисы — в paid-stubs.ts (заглушки, запросы не отправляются).
import { atiGet, atiPost } from './client'
import type { AtiBalance, AtiBoardLoad, AtiBoardLoadsPage, AtiCity, AtiDictionaryItem, AtiTruck, AtiTrucksCount } from './types'

// ---- Словари (v1.0/dictionaries/*) — кэш на 24 часа ----

export const DICTIONARIES = ['cargoTypes', 'carTypes', 'loadingTypes', 'packTypes', 'ownerships', 'moneyTypes'] as const
export type DictionaryName = (typeof DICTIONARIES)[number]

const dictCache = new Map<string, { at: number; items: AtiDictionaryItem[] }>()
const DICT_TTL_MS = 24 * 3600 * 1000

export async function getDictionary(name: DictionaryName): Promise<AtiDictionaryItem[]> {
  const hit = dictCache.get(name)
  if (hit && Date.now() - hit.at < DICT_TTL_MS) return hit.items
  const items = await atiGet<AtiDictionaryItem[]>(`/v1.0/dictionaries/${name}`)
  dictCache.set(name, { at: Date.now(), items })
  return items
}

// ---- Гео-словарь городов (by-ids), кэш ----

const cityCache = new Map<number, AtiCity>()

export async function getCitiesByIds(ids: number[]): Promise<Map<number, AtiCity>> {
  const missing = [...new Set(ids)].filter((id) => !cityCache.has(id))
  if (missing.length > 0) {
    try {
      const res = await atiPost<{ cities: AtiCity[] }>('/gw/gis-dict/v1/cities/by-ids', { ids: missing })
      for (const c of res.cities ?? []) cityCache.set(c.city_id, c)
    } catch {
      // гео-словарь недоступен — имена городов остаются неопределёнными (деградация)
    }
  }
  const out = new Map<number, AtiCity>()
  for (const id of new Set(ids)) {
    const c = cityCache.get(id)
    if (c) out.set(id, c)
  }
  return out
}

// ---- Баланс (биллинг) ----

export function getBalance(): Promise<AtiBalance> {
  return atiGet<AtiBalance>('/v1.0/balance')
}

// ---- Ваши машины (публикация своей техники — бесплатно) ----

export function getTrucks(): Promise<AtiTruck[]> {
  return atiGet<AtiTruck[]>('/gw/trucks/integrator/v1/trucks')
}

export function getTrucksCount(): Promise<AtiTrucksCount> {
  return atiGet<AtiTrucksCount>('/gw/trucks/integrator/v1/trucks/count')
}

// ---- Поиск грузов на закрытых площадках (биржа в поиск не входит) ----

export type BoardLoadsQuery = {
  boardIds?: string[]
  updatedSince?: Date
  skip?: number
  take?: number
}

export async function searchLoadsByBoards(q: BoardLoadsQuery = {}): Promise<AtiBoardLoadsPage> {
  const params = new URLSearchParams()
  for (const id of q.boardIds ?? []) params.append('board_ids', id)
  if (q.updatedSince) params.set('updated_since', q.updatedSince.toISOString())
  params.set('skip', String(q.skip ?? 0))
  params.set('take', String(Math.min(q.take ?? 50, 100)))
  return atiGet<AtiBoardLoadsPage>(`/gw/search_loads/integration/v1/loads/search/by-boards?${params.toString()}`)
}

/** Имена городов погрузки/разгрузки для выдачи (one-shot обогащение) */
export async function enrichLoadsWithCities<T extends AtiBoardLoad>(loads: T[]): Promise<(T & { loadingCity?: string; unloadingCity?: string })[]> {
  const ids = loads.flatMap((l) => [l.route?.loading?.city_id, l.route?.unloading?.city_id]).filter((x): x is number => typeof x === 'number')
  const cities = await getCitiesByIds(ids)
  return loads.map((l) => ({
    ...l,
    loadingCity: cities.get(l.route?.loading?.city_id ?? -1)?.name,
    unloadingCity: cities.get(l.route?.unloading?.city_id ?? -1)?.name,
  }))
}

// ---- Заготовка публикации машины на обратку (DRY-RUN: только тело запроса,
// отправка не выполняется — метод POST /gw/trucks/integrator/v1/trucks выключен
// до решения о выходе на биржу; ATISU_ALLOW_WRITES=false в .env) ----

export type TruckPublishDraft = {
  endpoint: string
  method: 'POST'
  dryRun: true
  note: string
  payload: Record<string, unknown>
}

/**
 * Сборка тела публикации машины (POST /gw/trucks/integrator/v1/trucks) из данных
 * рейса: машина ищет груз с города выгрузки к базе АЭМЗ. Поля — по официальной
 * схеме ATI.SU; city_id заполняются, если город найден в гео-словаре выдачи.
 */
export function buildTruckPublishDraft(input: {
  vehicleBrand: string
  plate: string
  capacityT?: number | null
  volumeM3?: number | null
  trailerVolumeM3?: number | null
  fromCityName: string
  toCityName: string
  fromCityId?: number
  toCityId?: number
  firstDate?: Date
  lastDate?: Date
  rateSum?: number | null
  contactNote?: string
}): TruckPublishDraft {
  const first = (input.firstDate ?? new Date()).toISOString()
  const last = (input.lastDate ?? new Date(Date.now() + 2 * 86400000)).toISOString()
  return {
    endpoint: '/gw/trucks/integrator/v1/trucks',
    method: 'POST',
    dryRun: true,
    note: 'Черновик: публикация машины на бирже ATI.SU. Отправка выключена (ATISU_ALLOW_WRITES=false).',
    payload: {
      contact_id1: null, // ID контакта АЭМЗ в ATI.SU — подставляется при включении публикации
      department_id: null,
      note: input.contactNote ?? `Обратная загрузка: ${input.fromCityName} → ${input.toCityName}. ${input.vehicleBrand} (${input.plate}).`,
      first_date: first,
      last_date: last,
      periodicity_id: 0,
      date_type: 1,
      is_team_driving: false,
      transport: {
        car_type: 1, // тент (справочник carTypes) — уточняется при публикации
        car_type_mask: 1,
        body_type: 0,
        loading_type: 1,
        weight: input.capacityT ?? null,
        volume: input.volumeM3 ?? input.trailerVolumeM3 ?? null,
        truck_length: null,
        trailer_length: null,
        hydrolift: false,
        partial_load: true, // готовы к догрузу на обратке
        koniki: false,
        tir: false,
        ekmt: false,
        adr_types: 0,
        is_tracking: false,
      },
      loading: {
        city_id: input.fromCityId ?? null, // null = город не найден в гео-словаре, подставить вручную
        radius: 50,
      },
      payment: {
        rate_sum: input.rateSum ?? null,
        currency_id: 1, // рубль
        cashless: true,
        nds: true,
        card: false,
        nal: false,
      },
      unloading: {
        point_type: 1, // город
        point_id: input.toCityId ?? null,
        radius: 100,
      },
    },
  }
}
