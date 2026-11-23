'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/kontur/ui/card'
import { Button } from '@/components/kontur/ui/button'
import { Checkbox } from '@/components/kontur/ui/checkbox'
import { Textarea } from '@/components/kontur/ui/textarea'
import { DotWord, Pill } from './bits'
import { CallButton } from './CallButton'
import { AtiVehicleHint, type VehicleHintRequest } from './AtiVehicleHint'
import { PlanDealDialog } from './PlanDealDialog'
import { fmtDateTime, type AtiDealDto, type StateResponse } from '@/lib/kontur/client-types'
import { BODIES, MARKET_CITIES, PAYMENTS, type MarketLoad } from '@/lib/kontur/atisu/market-stubs'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/kontur/session-token'
import {
  ArrowRight, CalendarClock, Calculator, ChevronDown, ClipboardList, CircleOff, Clock3, EyeOff, FileCheck2, Handshake, Info,
  Mail, MapPin, Medal, Megaphone, MessageSquare, MoreVertical, Phone, PencilLine, RotateCcw, Route as RouteIcon,
  Save, Search, ShieldCheck, SlidersHorizontal, Star, ThumbsUp, X,
} from 'lucide-react'
import { CarrierBadgesRow, LoadDetailsModal, MiniStars, openRouteTab } from './AtiLoadDetails'
import { apiFetch as fetch } from '@/lib/kontur/base-path'

// ---------------------------------------------------------------------------
// Биржа ATI.SU: поиск грузов с фильтрами, «Мои заявки» (грузы, по которым
// договорились: предварительное согласование → обмен документами → заявка
// в силе) и служебные списки (сохранённые фильтры, история, по транспорту,
// отслеживаемые). Режим задаёт родитель (AtiSuPanel) — навигация плоская.
// ---------------------------------------------------------------------------

export type MarketMode = 'search' | 'deals' | 'saved' | 'history' | 'transport' | 'tracked'
type DealFilter = 'active' | 'preliminary' | 'full' | 'cancelled'

type MarketResponse = {
  demo: boolean
  mode: string
  total: number
  loads: MarketLoad[]
  history: { id: string; at: string; from: string; to: string; bodies: string; found: number }[]
}

type Filters = {
  from: string
  to: string
  weight: number
  volume: number
  dateFromToday: boolean
  bodies: string[]
  payments: string[]
  withRate: boolean
  minRate: string
  minRatePerKm: boolean
  hideRegulars: boolean
  hideAtd: boolean
  showContests: boolean
  showAds: boolean
}

const DEFAULT_FILTERS: Filters = {
  from: 'Москва',
  to: 'Краснодар',
  weight: 21,
  volume: 83,
  dateFromToday: true,
  bodies: ['тент'],
  payments: ['cashless_vat'],
  withRate: true,
  minRate: '',
  minRatePerKm: false,
  hideRegulars: false,
  hideAtd: false,
  showContests: true,
  showAds: true,
}

type Settings = { fixed: boolean; take: number; basePerKm: number; guaranteedShare: number }
const DEFAULT_SETTINGS: Settings = { fixed: true, take: 9, basePerKm: 42, guaranteedShare: 0.35 }

const SORTS: { id: 'updated' | 'rate_desc' | 'rate_asc' | 'km_asc'; label: string }[] = [
  { id: 'updated', label: 'по времени обновления' },
  { id: 'rate_desc', label: 'по ставке: сначала выше' },
  { id: 'rate_asc', label: 'по ставке: сначала ниже' },
  { id: 'km_asc', label: 'по расстоянию' },
]

const PAY_LABEL: Record<string, string> = Object.fromEntries(PAYMENTS.map((p) => [p.id, p.label]))
const RUB = (n: number) => n.toLocaleString('ru-RU')
const shortDate = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '—')

export function AtiSuMarketPanel({ state, mode, onModeChange, onDealsCount, onChanged, onOpenTrip }: {
  state: StateResponse
  mode: MarketMode
  onModeChange: (m: MarketMode) => void
  onDealsCount?: (active: number) => void
  /** обновление состояния после планирования груза — рейсы/занятость/график синхронны */
  onChanged?: () => void
  /** переход к карточке рейса запланированного груза в «Заявках» */
  onOpenTrip?: (tripId: string) => void
}) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [showFilters, setShowFilters] = useState(true)
  const [sort, setSort] = useState<(typeof SORTS)[number]['id']>('updated')

  const [data, setData] = useState<MarketResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [tracked, setTracked] = useState<Record<string, MarketLoad>>({})
  const [offered, setOffered] = useState<Record<string, boolean>>({})
  // --- Скрытые грузы (крестик в карточке) и заметки логиста к грузам — локально, демо ---
  const [hiddenLoads, setHiddenLoads] = useState<Record<string, MarketLoad>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  // --- Заявки: грузы, по которым договорились (хранятся в БД) ---
  const [deals, setDeals] = useState<AtiDealDto[]>([])
  const [dealsLoading, setDealsLoading] = useState(false)
  const [dealsError, setDealsError] = useState<string | null>(null)
  const [dealFilter, setDealFilter] = useState<DealFilter>('active')
  const [dealBusy, setDealBusy] = useState<string | null>(null) // id груза/заявки при выполнении действия
  const { toast } = useToast()
  const [savedList, setSavedList] = useState([
    { id: 's1', title: 'Москва → Краснодар, тент', hint: '21 т · 83 м³ · безнал с НДС' },
    { id: 's2', title: 'Новороссийск → Москва, реф', hint: 'от 90 000 ₽ за поездку' },
    { id: 's3', title: 'Из базы АЭМЗ → Ставрополь', hint: 'без ограничений по кузову' },
  ])

  const query = useCallback(
    (f: Filters = filters) => {
      const p = new URLSearchParams()
      if (f.from) p.set('from', f.from)
      if (f.to) p.set('to', f.to)
      p.set('weight', String(f.weight || 0))
      p.set('volume', String(f.volume || 0))
      p.set('bodies', f.bodies.join(','))
      p.set('payments', f.payments.join(','))
      if (f.minRate) p.set('minRate', f.minRate)
      p.set('minRatePerKm', f.minRatePerKm ? '1' : '0')
      p.set('hideRegulars', f.hideRegulars ? '1' : '0')
      p.set('hideAtd', f.hideAtd ? '1' : '0')
      p.set('showContests', f.showContests ? '1' : '0')
      p.set('showAds', f.showAds ? '1' : '0')
      p.set('sort', sort)
      p.set('take', String(settings.take))
      p.set('fixed', settings.fixed ? '1' : '0')
      p.set('basePerKm', String(settings.basePerKm))
      p.set('guaranteedShare', String(settings.guaranteedShare))
      return p.toString()
    },
    [filters, sort, settings]
  )

  const run = useCallback(
    async (f: Filters = filters, s: Settings = settings, sortOrder: (typeof SORTS)[number]['id'] = sort) => {
      setLoading(true)
      setError(null)
      try {
        const p = new URLSearchParams(query(f))
        p.set('sort', sortOrder)
        p.set('take', String(s.take))
        p.set('fixed', s.fixed ? '1' : '0')
        p.set('basePerKm', String(s.basePerKm))
        p.set('guaranteedShare', String(s.guaranteedShare))
        const res = await fetch(`/api/atisu/market?${p.toString()}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
        setData(json as MarketResponse)
      } catch (e) {
        setError(String(e))
        setData(null)
      } finally {
        setLoading(false)
      }
    },
    [query, sort]
  )

  useEffect(() => {
    void run(DEFAULT_FILTERS, DEFAULT_SETTINGS)
    // первичная загрузка витрины выполняется один раз
  }, [])

  // Заявки: на монтировании (бейдж вкладки и отметки в выдаче) и на входе в раздел
  const loadDeals = useCallback(async () => {
    setDealsLoading(true)
    try {
      const res = await authFetch('/api/atisu/deals')
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
      setDeals(json.deals as AtiDealDto[])
      setDealsError(null)
    } catch (e) {
      setDealsError(e instanceof Error ? e.message : String(e))
    } finally {
      setDealsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDeals()
    // первичная загрузка заявок выполняется один раз
  }, [loadDeals])

  useEffect(() => {
    if (mode === 'deals') void loadDeals()
  }, [mode, loadDeals])

  // количество активных заявок — для бейджа на вкладке у родителя
  const activeDealsCount = deals.filter((d) => d.status === 'active').length
  const onDealsCountRef = useRef(onDealsCount)
  useEffect(() => {
    onDealsCountRef.current = onDealsCount
  })
  useEffect(() => {
    onDealsCountRef.current?.(activeDealsCount)
  }, [activeDealsCount])

  const dealAction = useCallback(async (body: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> => {
    try {
      const res = await authFetch('/api/atisu/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
      return { ok: true, message: json.message as string | undefined }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }, [])

  /** «Договорились» в карточке груза → предварительное согласование */
  const createDeal = useCallback(
    async (l: MarketLoad) => {
      setDealBusy(l.id)
      const r = await dealAction({ action: 'create', load: l })
      setDealBusy(null)
      toast({
        title: r.ok ? 'Заявка создана · предварительное согласование' : 'Не удалось создать заявку',
        description: r.message,
      })
      if (r.ok) {
        void loadDeals()
        onChanged?.() // новая сделка сразу видна в «Занятости» и «Планировании»
      }
    },
    [dealAction, loadDeals, onChanged, toast]
  )

  /** Документы обменяны → заявка вступает в силу (полное согласование) */
  const docsDeal = useCallback(
    async (d: AtiDealDto) => {
      setDealBusy(d.id)
      const r = await dealAction({ action: 'docs', dealId: d.id })
      setDealBusy(null)
      toast({ title: r.ok ? 'Заявка вступила в силу' : 'Не удалось зафиксировать документы', description: r.message })
      if (r.ok) {
        void loadDeals()
        onChanged?.() // стадия сделки меняет списки «ждёт планирования» в других разделах
      }
    },
    [dealAction, loadDeals, onChanged, toast]
  )

  const cancelDeal = useCallback(
    async (d: AtiDealDto, reason: string) => {
      setDealBusy(d.id)
      const r = await dealAction({ action: 'cancel', dealId: d.id, reason })
      setDealBusy(null)
      toast({ title: r.ok ? 'Заявка отменена' : 'Не удалось отменить заявку', description: r.message })
      if (r.ok) {
        void loadDeals()
        onChanged?.() // каскад: назначенное плечо отменено — рейсы и занятость обновляются
      }
    },
    [dealAction, loadDeals, onChanged, toast]
  )

  const restoreDeal = useCallback(
    async (d: AtiDealDto) => {
      setDealBusy(d.id)
      const r = await dealAction({ action: 'restore', dealId: d.id })
      setDealBusy(null)
      toast({ title: r.ok ? 'Заявка возвращена в работу' : 'Не удалось вернуть заявку', description: r.message })
      if (r.ok) {
        void loadDeals()
        onChanged?.()
      }
    },
    [dealAction, loadDeals, onChanged, toast]
  )

  const noteDeal = useCallback(
    async (d: AtiDealDto, comment: string) => {
      setDealBusy(d.id)
      const r = await dealAction({ action: 'note', dealId: d.id, comment })
      setDealBusy(null)
      if (!r.ok) toast({ title: 'Не удалось сохранить условия', description: r.message })
      if (r.ok) void loadDeals()
    },
    [dealAction, loadDeals, toast]
  )

  // «Подробнее о грузе»: полная карточка груза (маршрут, расчёт, ставка, фирма)
  const [detailsLoad, setDetailsLoad] = useState<MarketLoad | null>(null)
  // «Подбор водителя»: подсказка считается ТОЛЬКО по запросу — кнопка прямо на
  // карточке заявки открывает окно и делает один POST; выдача биржи не трогается
  const [hintLoad, setHintLoad] = useState<VehicleHintRequest | null>(null)
  const askHintLoad = useCallback((l: MarketLoad) => {
    setHintLoad({
      from: l.from, to: l.to, dateFrom: l.date_from, dateTo: l.date_to,
      weightT: l.weight_t, volumeM3: l.volume_m3, rate: l.rate, perKm: l.per_km, km: l.km, cargo: l.cargo,
    })
  }, [])
  const askHintDeal = useCallback((x: AtiDealDto) => {
    setHintLoad({
      from: x.from, to: x.to, dateFrom: x.loadDateFrom, dateTo: x.loadDateTo,
      weightT: x.weightT, volumeM3: x.volumeM3, rate: x.rate, perKm: x.perKm,
      km: x.km ?? undefined, cargo: x.cargo,
    })
  }, [])

  // ——— связка с планированием: груз в плане = открытое плечо с dealId ———
  // считаем из состояния кабинета (state.trips), поэтому после «В план» в любом
  // разделе карточка здесь сразу показывает состав и кнопку «Рейс»
  const [planDeal, setPlanDeal] = useState<AtiDealDto | null>(null)
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])
  const plannedByDealId = useMemo(() => {
    const m = new Map<string, { tripId: string; driverName: string | null }>()
    for (const trip of state.trips) {
      for (const leg of trip.legs) {
        if (leg.dealId && leg.status !== 'completed' && leg.status !== 'cancelled' && !m.has(leg.dealId)) {
          m.set(leg.dealId, { tripId: trip.id, driverName: trip.driver?.fullName ?? null })
        }
      }
    }
    return m
  }, [state.trips])

  function toggleIn(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  }

  const extendedActive =
    Number(filters.bodies.length !== 1) +
    Number(filters.payments.length !== 1) +
    Number(!!filters.minRate) +
    Number(!filters.dateFromToday) +
    Number(filters.hideRegulars || filters.hideAtd || !filters.showContests || !filters.showAds || !filters.withRate)

  const loads = data?.loads ?? []
  const trackedList = Object.values(tracked)

  // заявки по грузам выдачи (отметка «уже в заявках» в поиске и отслеживаемых)
  const dealByLoadId = new Map(deals.map((d) => [d.loadId, d]))
  const activeDeals = deals.filter((d) => d.status === 'active')
  const prelimDeals = activeDeals.filter((d) => d.stage === 'preliminary')
  const fullDeals = activeDeals.filter((d) => d.stage === 'full')
  const cancelledDeals = deals.filter((d) => d.status === 'cancelled')
  const visibleDeals = deals.filter((d) =>
    dealFilter === 'active'
      ? d.status === 'active'
      : dealFilter === 'cancelled'
        ? d.status === 'cancelled'
        : d.status === 'active' && d.stage === dealFilter
  )

  return (
    <div className="space-y-4">
      {/* ===================== Шапка режима (фильтры поиска / заявки / списки) ===================== */}
      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardContent className="space-y-3 p-4">
          {mode === 'search' && (
            <>
              {/* Строка маршрута — всегда видна */}
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Откуда">
                  <select value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="h-9 w-44 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                    <option value="">любой город</option>
                    {MARKET_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <div className="pb-2.5 text-slate-300"><ArrowRight className="h-4 w-4" /></div>
                <Field label="Куда">
                  <select value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="h-9 w-44 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                    <option value="">любой город</option>
                    {MARKET_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Вес, т">
                  <input type="number" min={0} value={filters.weight || ''} onChange={(e) => setFilters((f) => ({ ...f, weight: Number(e.target.value) }))} placeholder="21" className="h-9 w-24 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                </Field>
                <Field label="Объём, м³">
                  <input type="number" min={0} value={filters.volume || ''} onChange={(e) => setFilters((f) => ({ ...f, volume: Number(e.target.value) }))} placeholder="83" className="h-9 w-24 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                </Field>
                <div className="ml-auto flex items-center gap-2 pb-0.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className={`h-9 ${showFilters ? 'border-slate-400 bg-white font-semibold text-slate-900' : ''}`}
                    onClick={() => setShowFilters((v) => !v)}
                    aria-expanded={showFilters}
                  >
                    <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
                    Фильтры{extendedActive > 0 ? ` · ${extendedActive}` : ''}
                  </Button>
                </div>
              </div>

              {/* Расширенные фильтры */}
              {showFilters && (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="grid gap-3 lg:grid-cols-3">
                    <div className="space-y-2">
                      <FilterTitle>Погрузка</FilterTitle>
                      <Check checked={filters.dateFromToday} onChange={(v) => setFilters((f) => ({ ...f, dateFromToday: v }))} label="с сегодняшнего дня" />
                    </div>
                    <div className="space-y-2">
                      <FilterTitle>Тип кузова</FilterTitle>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        {BODIES.map((b) => (
                          <Check key={b} checked={filters.bodies.includes(b)} onChange={(v) => setFilters((f) => ({ ...f, bodies: toggleIn(f.bodies, b) }))} label={b} />
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <FilterTitle>Форма оплаты</FilterTitle>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        {PAYMENTS.map((p) => (
                          <Check key={p.id} checked={filters.payments.includes(p.id)} onChange={(v) => setFilters((f) => ({ ...f, payments: toggleIn(f.payments, p.id) }))} label={p.label} />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-3 border-t border-slate-200 pt-3 lg:grid-cols-3">
                    <div className="space-y-2">
                      <FilterTitle>Ставка</FilterTitle>
                      <div className="flex items-center gap-2">
                        <input type="number" min={0} value={filters.minRate} onChange={(e) => setFilters((f) => ({ ...f, minRate: e.target.value }))} placeholder="от" className="h-9 w-32 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                        <div className="flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs">
                          <button type="button" onClick={() => setFilters((f) => ({ ...f, minRatePerKm: false }))} className={`whitespace-nowrap rounded-md px-2 py-1 ${!filters.minRatePerKm ? 'bg-slate-100 font-semibold text-slate-800' : 'text-slate-500'}`}>за поездку</button>
                          <button type="button" onClick={() => setFilters((f) => ({ ...f, minRatePerKm: true }))} className={`whitespace-nowrap rounded-md px-2 py-1 ${filters.minRatePerKm ? 'bg-slate-100 font-semibold text-slate-800' : 'text-slate-500'}`}>за км</button>
                        </div>
                        <Check checked={filters.withRate} onChange={(v) => setFilters((f) => ({ ...f, withRate: v }))} label="только с рейсом" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <FilterTitle>Показывать</FilterTitle>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        <Check checked={filters.showContests} onChange={(v) => setFilters((f) => ({ ...f, showContests: v }))} label="грузы с конкурсами" />
                        <Check checked={filters.showAds} onChange={(v) => setFilters((f) => ({ ...f, showAds: v }))} label="грузы с рекламой" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <FilterTitle>Скрывать</FilterTitle>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        <Check checked={filters.hideRegulars} onChange={(v) => setFilters((f) => ({ ...f, hideRegulars: v }))} label="постоянных заказчиков" />
                        <Check checked={filters.hideAtd} onChange={(v) => setFilters((f) => ({ ...f, hideAtd: v }))} label="опасные грузы (ADR)" />
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-3">
                    <Button type="button" size="sm" variant="ghost" className="h-9 text-slate-500" onClick={() => { setFilters(DEFAULT_FILTERS); setSort('updated'); void run(DEFAULT_FILTERS, settings) }}>
                      <RotateCcw className="mr-1 h-3.5 w-3.5" />Очистить
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => {
                      const title = `${filters.from || 'любой'} → ${filters.to || 'любой'}${filters.bodies.length ? ', ' + filters.bodies.join('/') : ''}`
                      setSavedList((s) => [{ id: `s${Date.now()}`, title, hint: `${filters.weight || '—'} т · ${filters.volume || '—'} м³` }, ...s])
                    }}>
                      <Save className="mr-1 h-3.5 w-3.5" />Сохранить как фильтр
                    </Button>
                    <Button type="button" size="sm" className="h-9 bg-[#0E1B2C] text-white hover:bg-[#16304f]" onClick={() => void run()} disabled={loading}>
                      {loading ? <span className="mr-1 h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden /> : <Search className="mr-1 h-3.5 w-3.5" />}
                      Найти грузы
                    </Button>
                  </div>
                </div>
              )}

            </>
          )}

          {mode === 'deals' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs leading-relaxed text-slate-500">
                  Грузы, по которым АЭМЗ договорилась с грузовладельцем: от предварительного согласования
                  до заявки в силе.
                </div>
                <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => void loadDeals()} disabled={dealsLoading}>
                  <RotateCcw className={`mr-1 h-3.5 w-3.5 ${dealsLoading ? 'animate-spin' : ''}`} />
                  Обновить
                </Button>
              </div>
              {/* Две ступени согласования — белые карточки, смысл несёт точка (стиль LogistikSITE) */}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-800">
                    <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
                    Предварительное · {prelimDeals.length}
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    Договорились по телефону: ставка и условия согласованы, документы ещё не обменяны.
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-800">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                    В силе · {fullDeals.length}
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    Полное согласование: документы обменяны, заявка вступила в силу.
                  </div>
                </div>
              </div>
              {/* Фильтр по стадиям */}
              <div className="flex flex-wrap gap-1.5">
                {([
                  ['active', `Активные · ${activeDeals.length}`],
                  ['preliminary', `Предварительные · ${prelimDeals.length}`],
                  ['full', `В силе · ${fullDeals.length}`],
                  ['cancelled', `Отменённые · ${cancelledDeals.length}`],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setDealFilter(id)}
                    aria-pressed={dealFilter === id}
                    className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                      dealFilter === id
                        ? 'border-slate-400 bg-white font-semibold text-slate-900 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {dealsError && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{dealsError}</div>
              )}
            </div>
          )}

          {mode === 'saved' && (
            <div className="space-y-2">
              <div className="text-xs text-slate-500">Нажмите на фильтр, чтобы применить его к поиску.</div>
              {savedList.map((s) => (
                <div key={s.id} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2.5 transition-colors">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left transition-colors hover:text-blue-700"
                    onClick={() => {
                      const [from, rest] = s.title.split(' → ')
                      const to = rest?.split(',')[0] ?? ''
                      const f: Filters = { ...DEFAULT_FILTERS, from: from.trim(), to: to.trim() }
                      setFilters(f)
                      onModeChange('search')
                      void run(f)
                    }}
                  >
                    <span className="text-sm font-semibold text-slate-800">{s.title}</span>
                    <span className="ml-3 text-xs text-slate-400">{s.hint}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Удалить фильтр «${s.title}»`}
                    title="Удалить фильтр"
                    className="rounded-md p-1 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
                    onClick={() => setSavedList((list) => list.filter((x) => x.id !== s.id))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {mode === 'history' && (
            <div className="space-y-2">
              <div className="text-xs text-slate-500">Последние поиски за сегодня.</div>
              {(data?.history ?? []).map((h) => (
                <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Clock3 className="h-3 w-3" />{h.at}</span>
                    <span className="font-semibold text-slate-800">{h.from} → {h.to}</span>
                    <span className="text-xs text-slate-500">{h.bodies}</span>
                    <span className="text-xs text-slate-400">найдено: {h.found}</span>
                  </div>
                  <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => {
                    const f: Filters = { ...DEFAULT_FILTERS, from: h.from, to: h.to, bodies: [] }
                    setFilters(f)
                    onModeChange('search')
                    void run(f)
                  }}>
                    Повторить
                  </Button>
                </div>
              ))}
            </div>
          )}

          {mode === 'transport' && (
            <div className="space-y-2">
              <div className="text-xs text-slate-500">
                Поиск грузов под конкретную машину парка — подставляем её грузоподъёмность и объём.
              </div>
              {state.vehicles.length === 0 && <div className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">В парке нет машин — добавьте в разделе «Справочники».</div>}
              {state.vehicles.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/40 disabled:opacity-50"
                  disabled={v.isRepair}
                  onClick={() => {
                    const f: Filters = { ...DEFAULT_FILTERS, weight: v.capacityT ?? 20, volume: v.volumeM3 ?? 82 }
                    setFilters(f)
                    onModeChange('search')
                    void run(f)
                  }}
                >
                  <span className="text-sm font-semibold text-slate-800">{v.brand} · {v.plate}</span>
                  <span className="text-xs text-slate-400">
                    {v.isRepair ? 'в ремонте — недоступна' : `${v.capacityT ?? '—'} т · ${v.volumeM3 ?? '—'} м³`}
                  </span>
                </button>
              ))}
            </div>
          )}

          {mode === 'tracked' && (
            <div className="space-y-2">
              <div className="text-xs text-slate-500">Грузы, отмеченные звёздочкой в выдаче поиска.</div>
              {trackedList.length === 0 && <div className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">Пока ничего не отслеживается — отметьте груз звёздочкой в результатах поиска.</div>}
              {trackedList.map((l) => (
                <LoadCard
                  key={l.id}
                  l={l}
                  tracked
                  offered={!!offered[l.id]}
                  deal={dealByLoadId.get(l.id) ?? null}
                  dealBusy={dealBusy === l.id}
                  note={notes[l.id] ?? null}
                  onTrack={untrack}
                  onOffer={offer}
                  onDeal={createDeal}
                  onMatch={askHintLoad}
                  onDetails={setDetailsLoad}
                  onNote={setNote}
                  onHide={hideLoad}
                  onOpenDeals={() => onModeChange('deals')}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===================== Мои заявки: согласованные грузы ===================== */}
      {mode === 'deals' && (
        <Card className="rounded-xl border-slate-200 shadow-sm">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-base font-bold text-slate-900">
                {dealsLoading && visibleDeals.length === 0 ? 'Загружаем заявки…' : `Заявок: ${visibleDeals.length}`}
              </div>
            </div>

            {!dealsLoading && visibleDeals.length === 0 && !dealsError && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center text-sm text-slate-500">
                {deals.length === 0
                  ? 'Пока нет согласованных грузов: найдите груз во вкладке «Поиск грузов» и нажмите «Договорились» — он попадёт сюда со стадией «предварительное».'
                  : 'В выбранном фильтре заявок нет.'}
              </div>
            )}

            <div className="space-y-2.5">
              {visibleDeals.map((d) => (
                <DealCard
                  key={d.id}
                  d={d}
                  busy={dealBusy === d.id}
                  planned={plannedByDealId.get(d.id) ?? null}
                  onDocs={docsDeal}
                  onCancel={cancelDeal}
                  onRestore={restoreDeal}
                  onNote={noteDeal}
                  onMatch={askHintDeal}
                  onPlan={setPlanDeal}
                  onOpenTrip={onOpenTrip}
                />
              ))}
            </div>

            <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
              Контакты и условия договорённости остаются в кабинете, даже когда груз уйдёт с биржи.
              Заявка «в силе» назначается составом кнопкой «В план» — груз сразу появится на доске
              «Занятость» и в графике «Планирования».
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===================== Выдача ===================== */}
      {mode === 'search' && (
        <Card className="rounded-xl border-slate-200 shadow-sm">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap items-center gap-2 text-base font-bold text-slate-900">
                {loading ? 'Ищем грузы…' : `Найдено ${data?.total ?? 0} грузов`}
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">показывать по</span>
                <select
                  value={settings.take}
                  onChange={(e) => {
                    const take = Number(e.target.value)
                    setSettings((s) => ({ ...s, take }))
                    void run(filters, { ...settings, take })
                  }}
                  className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs outline-none focus:border-blue-500"
                >
                  {[6, 9, 12, 18].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="text-xs text-slate-500">сортировка</span>
                <select
                  value={sort}
                  onChange={(e) => {
                    const v = e.target.value as typeof sort
                    setSort(v)
                    void run(filters, settings, v)
                  }}
                  className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs outline-none focus:border-blue-500"
                >
                  {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

            {loading && (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-xl border border-slate-100 bg-slate-50" aria-hidden />
                ))}
              </div>
            )}

            {!loading && loads.length === 0 && !error && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center text-sm text-slate-500">
                По заданным фильтрам грузов нет. Ослабьте условия (кузов, оплата, минимальная ставка) или очистите фильтры.
              </div>
            )}

            {!loading && loads.length > 0 && (
              <div className="space-y-2.5">
                {loads.filter((l) => !hiddenLoads[l.id]).map((l) => (
                  <LoadCard
                    key={l.id}
                    l={l}
                    tracked={!!tracked[l.id]}
                    offered={!!offered[l.id]}
                    deal={dealByLoadId.get(l.id) ?? null}
                    dealBusy={dealBusy === l.id}
                    note={notes[l.id] ?? null}
                    onTrack={track}
                    onOffer={offer}
                    onDeal={createDeal}
                    onMatch={askHintLoad}
                    onDetails={setDetailsLoad}
                    onNote={setNote}
                    onHide={hideLoad}
                    onOpenDeals={() => onModeChange('deals')}
                  />
                ))}
                {Object.keys(hiddenLoads).length > 0 && (
                  <button
                    type="button"
                    onClick={unhideAll}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-2 text-[11px] font-medium text-slate-500 transition-colors hover:border-slate-400 hover:bg-slate-100"
                    title="Вернуть скрытые крестиком грузы в выдачу"
                  >
                    <EyeOff className="h-3.5 w-3.5" aria-hidden />
                    Скрыто грузов: {Object.keys(hiddenLoads).length} — показать все
                  </button>
                )}
              </div>
            )}

          </CardContent>
        </Card>
      )}

      {/* Модалка «Подбор водителя»: сервис сам считает по данным заявки, расчёт по кнопке */}
      {hintLoad && <AtiVehicleHint load={hintLoad} onClose={() => setHintLoad(null)} />}

      {/* Модалка «В план»: назначение состава — общий диалог с «Занятостью» и «Планированием» */}
      {planDeal && (
        <PlanDealDialog
          deal={planDeal}
          state={state}
          nowTick={nowTick}
          onOpenChange={(v) => { if (!v) setPlanDeal(null) }}
          onDone={() => {
            setPlanDeal(null)
            void loadDeals()
            onChanged?.()
          }}
        />
      )}

      {/* Модалка «Подробнее о грузе»: полная карточка в общем стиле платформы */}
      {detailsLoad && (
        <LoadDetailsModal
          l={detailsLoad}
          deal={dealByLoadId.get(detailsLoad.id) ?? null}
          dealBusy={dealBusy === detailsLoad.id}
          onMatch={askHintLoad}
          onDeal={createDeal}
          onClose={() => setDetailsLoad(null)}
        />
      )}
    </div>
  )

  // ---- локальные действия витрины ----
  function track(l: MarketLoad) {
    setTracked((t) => {
      const next = { ...t }
      if (next[l.id]) delete next[l.id]
      else next[l.id] = l
      return next
    })
  }
  function untrack(l: MarketLoad) {
    setTracked((t) => {
      const next = { ...t }
      delete next[l.id]
      return next
    })
  }
  function offer(l: MarketLoad) {
    setOffered((o) => ({ ...o, [l.id]: true }))
  }
  function hideLoad(l: MarketLoad) {
    setHiddenLoads((h) => ({ ...h, [l.id]: l }))
    toast({
      title: 'Груз скрыт из выдачи',
      description: `${l.from} → ${l.to} · вернётся по кнопке «показать скрытые» (демо)`,
    })
  }
  function unhideAll() {
    const n = Object.keys(hiddenLoads).length
    setHiddenLoads({})
    toast({ title: 'Скрытые грузы показаны', description: `вернул в выдачу ${n}` })
  }
  function setNote(l: MarketLoad, text: string) {
    setNotes((n) => ({ ...n, [l.id]: text }))
  }
}

// ---------------------------------------------------------------------------
// Карточка груза (форма выдачи ATI.SU: маршрут · груз · ставка · перевозчик)
// ---------------------------------------------------------------------------

function LoadCard({ l, tracked, offered, deal, dealBusy, note, onTrack, onOffer, onDeal, onMatch, onDetails, onNote, onHide, onOpenDeals }: {
  l: MarketLoad
  tracked: boolean
  offered: boolean
  deal: AtiDealDto | null
  dealBusy: boolean
  note: string | null
  onTrack: (l: MarketLoad) => void
  onOffer: (l: MarketLoad) => void
  onDeal: (l: MarketLoad) => void
  onMatch: (l: MarketLoad) => void
  onDetails: (l: MarketLoad) => void
  onNote: (l: MarketLoad, text: string) => void
  onHide: (l: MarketLoad) => void
  onOpenDeals: () => void
}) {
  const { toast } = useToast()
  const [reviewsOpen, setReviewsOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState(note ?? '')

  const activeDeal = deal && deal.status === 'active' ? deal : null
  const full = activeDeal?.stage === 'full'
  const readyDates = `${shortDate(l.date_from)}–${shortDate(l.date_to)}`
  const perKm = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
  const priority = l.priority_atis != null ? `${l.priority_atis.toFixed(2).replace('.', ',')} атис.` : null
  const stubToast = (what: string) => toast({ title: 'Демо-заглушка', description: `${what} — после подключения API ATI.SU выполняется реально` })

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-colors hover:shadow-md">
      {/* Полоса состояния заявки АЭМЗ: белая, смысл несёт точка (стиль LogistikSITE) */}
      {activeDeal && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
          <span className={`h-2 w-2 shrink-0 rounded-full ${full ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden />
          <span className="font-semibold">{full ? 'Заявка АЭМЗ в силе' : 'Заявка АЭМЗ · предварительное согласование'}</span>
          <span className="opacity-80">с {fmtDateTime(activeDeal.agreedAt)}</span>
          {!full && <span className="opacity-80">— до обмена документами груз ещё свободен на бирже</span>}
          <button
            type="button"
            onClick={onOpenDeals}
            className="ml-auto rounded-md bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-slate-300/60 transition-colors hover:bg-white"
            title="Открыть раздел «Мои заявки»"
          >
            открыть в «Мои заявки»
          </button>
        </div>
      )}

      <div className="p-4">
        {/* Сетка выдачи ATI.SU: дистанции · груз · погрузка · выгрузка · ставка */}
        <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-[64px_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* [1] Дистанции и код груза */}
          <div className="space-y-1">
            <span className="inline-block rounded-sm bg-slate-100 px-1 text-[9px] font-bold leading-4 tracking-wide text-slate-500">RUS</span>
            <div
              className="whitespace-nowrap text-[15px] font-bold leading-none text-[#0E1B2C]"
              title="Плечо по дорогам, расчёт ATI.SU (у АЭМЗ — OSRM + Яндекс.Карты, поэтому «примерно»)"
            >
              ~{l.km} км
            </div>
            {l.km_owner != null && (
              <div className="whitespace-nowrap text-xs font-semibold leading-none text-red-600" title="Расстояние, указанное грузовладельцем, — красным, если отличается от расчёта ATI.SU">
                {l.km_owner} км
              </div>
            )}
            <div className="font-mono text-[11px] text-slate-400" title="Код груза на ATI.SU">#{l.code}</div>
            <div className="text-[10px] text-slate-400">обновлено {l.updated_min_ago} мин</div>
            {l.ads && (
              <Pill className="bg-slate-100 text-slate-500" title="Размещено как рекламное объявление">
                <Megaphone className="h-3 w-3" />реклама
              </Pill>
            )}
          </div>

          {/* [2] Кузов и груз */}
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-bold leading-tight text-slate-900">{l.bodies.join(', ')}</div>
            <div className="text-xs text-slate-500">загр./выгр.: {l.loading}{l.load_extras.length > 0 ? `, ${l.load_extras.join(', ')}` : ''}</div>
            <div className="text-sm leading-tight text-slate-800">{l.cargo}</div>
            <div className="text-xs text-slate-600">
              {l.weight_t} т / {l.volume_m3} м³
              {l.dims_m ? ` · Д×Ш×В: ${l.dims_m} м` : ''}
              {l.adr && <span className="font-semibold text-red-600"> · ADR</span>}
            </div>
          </div>

          {/* [3] Погрузка */}
          <div className="min-w-0 space-y-1">
            <div className="flex items-start gap-1 text-sm font-bold leading-tight text-slate-900">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              {l.from}
            </div>
            <div className="text-xs italic text-slate-400">{l.from_region}</div>
            {l.from_ref && (
              <div className="text-xs text-slate-500" title="Расстояние до ближайшего крупного города — как в выдаче ATI.SU">
                {l.from_ref_km} км от {l.from_ref}
              </div>
            )}
            <div className="text-xs font-semibold text-slate-700">готов {readyDates}</div>
            <div className="text-xs text-slate-500">{PAY_LABEL[l.payment] ?? l.payment}</div>
          </div>

          {/* [4] Выгрузка */}
          <div className="min-w-0 space-y-1">
            <div className="flex items-start gap-1 text-sm font-bold leading-tight text-slate-900">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              {l.to}
            </div>
            <div className="text-xs italic text-slate-400">{l.to_region}</div>
            {l.to_ref && (
              <div className="text-xs text-slate-500" title="Расстояние до ближайшего крупного города — как в выдаче ATI.SU">
                {l.to_ref_km} км от {l.to_ref}
              </div>
            )}
            <div className="text-xs text-slate-500" title="Оценка времени в пути (~) — уточняется кнопкой «Маршрут» (Яндекс.Карты)">
              ~{String(l.hours_est).replace('.', ',')} ч в пути
            </div>
          </div>

          {/* [5] Ставка и сервисы ATI.SU */}
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[15px] font-bold leading-none text-[#0E1B2C]">
                {RUB(l.rate)} ₽ <span className="text-[11px] font-semibold text-slate-400">с НДС {l.nds_pct}%</span>
              </div>
              <div className="text-xs font-semibold text-slate-600">{perKm(l.per_km)} ₽/км</div>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-sm font-bold leading-none text-slate-800">
                {RUB(l.rate_no_vat)} ₽ <span className="text-[11px] font-semibold text-slate-400">без НДС</span>
              </div>
              <div className="text-xs font-semibold text-slate-500">{perKm(l.per_km_no_vat)} ₽/км</div>
            </div>
            <div className="text-xs text-slate-500">
              {l.bargain ? 'торг' : 'без торга'}{l.fuel_note ? ` · ${l.fuel_note}` : ''}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {l.contest && (
                <Pill className="bg-violet-100 text-violet-700" title="По грузу идёт конкурс ставок">
                  <ThumbsUp className="h-3 w-3" />идёт конкурс
                </Pill>
              )}
              {l.guaranteed && (
                <Pill className="bg-emerald-100 text-emerald-700" title="Оплата по сделке гарантирована">
                  <ShieldCheck className="h-3 w-3" />оплата защищена
                </Pill>
              )}
              {l.prepay_pct != null && <Pill className="bg-emerald-50 text-emerald-700">предоплата {l.prepay_pct}%</Pill>}
              {l.regular && <Pill className="bg-slate-100 text-slate-600" title="Постоянный заказчик по этому направлению">постоянный</Pill>}
            </div>
            {/* Сервисные кнопки строки (как в выдаче ATI.SU) */}
            <div className="flex flex-col items-stretch gap-1 pt-0.5">
              {offered ? (
                <Button type="button" size="sm" variant="outline" className="h-7 text-slate-500" disabled title="Черновик встречного предложения сохранён">
                  <ThumbsUp className="mr-1 h-3 w-3" aria-hidden />Встречное отправлено
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px] font-semibold"
                  onClick={() => onOffer(l)}
                  title="Отправить грузовладельцу встречное предложение по ставке"
                >
                  <Megaphone className="mr-1 h-3 w-3" aria-hidden />
                  Отправить встречное{l.offers > 0 ? ` (${l.offers})` : ''}
                </Button>
              )}
              <button
                type="button"
                onClick={() => stubToast('Гарантия оплаты ATI.SU')}
                title="Демо-заглушка: услуга «Гарантия оплаты ATI.SU» — оплата сделки через сервис ATI.SU"
                className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
              >
                <ShieldCheck className="h-3 w-3" aria-hidden />Защитить оплату с ATI.SU
              </button>
              <button
                type="button"
                onClick={() => stubToast('ТрейРадар: рекомендация ставки')}
                title="Демо-заглушка «ТрейРадар»: рекомендованная ставка по направлению и дате погрузки"
                className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
              >
                {RUB(l.radar_rate)} ₽ за погрузку от ТрейРадар
              </button>
            </div>
          </div>
        </div>

        {/* Комментарий грузовладельца — как строка комментария в выдаче ATI.SU */}
        {l.note && (
          <div className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
            <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />
            <span className="italic">{l.note}</span>
          </div>
        )}

        {/* Владелец груза: фирма, рейтинг/отзывы, значки ATI.SU, контакты */}
        <div className="mt-3 border-t border-slate-100 pt-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5">
            <div className="min-w-0">
              <span className="text-sm font-semibold text-[#0E1B2C]">{l.carrier.firm}</span>
              <span className="ml-1.5 text-[11px] text-slate-400">
                Код:{l.carrier.firm_ati} · {l.carrier.city} · {l.carrier.role}, на АТИ с {l.carrier.on_ati_since} г.
              </span>
            </div>
            <div className="flex items-center gap-2">
              {l.medals > 0 && (
                <span className="flex items-center gap-0.5" title={`Медали ATI.SU за активность и отзывы (демо-заглушка): ${l.medals}`}>
                  {Array.from({ length: l.medals }).map((_, i) => (
                    <Medal key={i} className="h-3.5 w-3.5 fill-amber-300 text-amber-500" aria-hidden />
                  ))}
                </span>
              )}
              <MiniStars rating={Math.round(l.carrier.rating)} />
              <button
                type="button"
                onClick={() => setReviewsOpen((v) => !v)}
                className="inline-flex items-center gap-0.5 text-xs font-semibold text-slate-700 transition-colors hover:text-blue-700"
                title="Показать последние отзывы о фирме"
              >
                {l.carrier.rating.toFixed(1).replace('.', ',')} · {l.carrier.reviews} отз.
                <ChevronDown className={`h-3 w-3 transition-transform ${reviewsOpen ? 'rotate-180' : ''}`} aria-hidden />
              </button>
            </div>
          </div>

          {/* Значки ГосЛог/ЭТрН/… и контакты */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <CarrierBadgesRow b={l.carrier.badges} goslogRef={l.goslog_ref} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <button
                type="button"
                onClick={() => stubToast('Мессенджер ATI.SU «Написать»')}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 transition-colors hover:text-blue-900"
                title="Демо-заглушка: сообщение через мессенджер ATI.SU"
              >
                <Mail className="h-3.5 w-3.5" aria-hidden />Написать
              </button>
              <a
                href={`tel:${l.contact_phone.replace(/[^\d+]/g, '')}`}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 transition-colors hover:text-red-700"
                title={`Позвонить ${l.contact_name} (${l.carrier.firm})`}
              >
                <Phone className="h-3.5 w-3.5 text-red-600" aria-hidden />
                <span className="font-mono font-semibold text-red-700">{l.contact_phone}</span>
                <span>, {l.contact_name}</span>
              </a>
              {l.contact2_phone && (
                <a
                  href={`tel:${l.contact2_phone.replace(/[^\d+]/g, '')}`}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-500 transition-colors hover:text-red-700"
                  title={`Позвонить ${l.contact2_name} (${l.carrier.firm})`}
                >
                  <Phone className="h-3.5 w-3.5 text-red-600" aria-hidden />
                  <span className="font-mono font-semibold text-red-700">{l.contact2_phone}</span>
                  <span>, {l.contact2_name}</span>
                </a>
              )}
            </div>
          </div>

          {/* Отзывы о фирме (раскрывашка) */}
          {reviewsOpen && (
            <div className="mt-2.5 space-y-2 rounded-lg bg-slate-50 px-3 py-2.5">
              {l.reviews.length === 0 && <div className="text-xs text-slate-400">Отзывов пока нет.</div>}
              {l.reviews.map((r, i) => (
                <div key={i} className="text-xs leading-relaxed">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-semibold text-slate-800">{r.author}</span>
                    <MiniStars rating={r.rating} />
                    <span className="text-slate-400">{r.date} · сделка {r.route}</span>
                  </div>
                  <div className="mt-0.5 text-slate-600">{r.text}</div>
                </div>
              ))}
              <div className="text-[10px] text-slate-400">
                Демо-заглушка: всего отзывов о фирме — {l.carrier.reviews}; в реальном API подтягиваются из ATI.SU.
              </div>
            </div>
          )}

          {/* Заметка логиста (иконка карандаша) */}
          {noteOpen && (
            <div className="mt-2.5 space-y-1.5 rounded-lg border border-slate-200 bg-white p-2.5">
              <Textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={2}
                className="min-h-14 text-xs"
                placeholder="Заметка логиста к грузу: звонили, условия, кто сказал…"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 bg-[#0E1B2C] text-white hover:bg-[#16304f]"
                  onClick={() => { onNote(l, noteText.trim()); setNoteOpen(false); toast({ title: 'Заметка сохранена (демо)', description: `${l.from} → ${l.to}` }) }}
                >
                  Сохранить
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setNoteOpen(false)}>Закрыть</Button>
              </div>
            </div>
          )}
          {note && !noteOpen && (
            <div className="mt-2.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-600">
              <span className="font-semibold">Моя заметка:</span> {note}
            </div>
          )}
        </div>

        {/* Действия логиста + иконки карточки ATI.SU */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {/* Кнопка подбора прямо на заявке — фирменный тёмный primary (стиль LogistikSITE) */}
          <Button
            type="button"
            size="sm"
            className="h-8 bg-[#0E1B2C] text-white hover:bg-[#16304f]"
            onClick={() => onMatch(l)}
            title="Прямо на этой заявке: откроется подбор под этот груз — сервис сам подберёт водителя из парка (где освободится машина, подача до погрузки, сроки 500–600 км/день, ставка по кругу). Расчёт запустится по кнопке «Произвести расчёт» в открывшемся окне"
          >
            <Calculator className="mr-1 h-3.5 w-3.5" />
            Подбор водителя
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => onDetails(l)}
            title="Полная карточка груза: маршрут и груз, расчёт расстояния (время, топливо, «Платон»), тип транспорта, ставка и оплата, фирма-заказчик с контактами"
          >
            <Info className="mr-1 h-3.5 w-3.5" />
            Подробнее о грузе
          </Button>
          <CallButton
            phone={l.contact_phone}
            name={`${l.contact_name} (${l.carrier.firm})`}
            label="Позвонить"
          />
          {activeDeal ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled
              title="Груз уже в разделе «Мои заявки»: предварительное согласование → обмен документами → заявка в силе"
            >
              <span className={`mr-1 h-2 w-2 rounded-full ${full ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden />
              {full ? 'Заявка в силе' : 'Предварительное'}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => onDeal(l)}
              disabled={dealBusy}
              title="Договорились с грузовладельцем — заявка АЭМЗ уходит в «Мои заявки» со стадией «предварительное согласование»"
            >
              {dealBusy ? (
                <span className="mr-1 h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" aria-hidden />
              ) : (
                <Handshake className="mr-1 h-3.5 w-3.5" />
              )}
              Договорились
            </Button>
          )}
          <button
            type="button"
            onClick={() => openRouteTab(l.from, l.to)}
            title="Открыть маршрут в Яндекс.Картах в новой вкладке — линия пути, расстояние и время в пути (грузовой профиль)"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            <RouteIcon className="h-3 w-3" aria-hidden />
            Маршрут
          </button>

          {/* Иконки карточки (правый ряд, как в ATI.SU) + приоритет показа */}
          <div className="ml-auto flex flex-col items-end gap-1">
            <div className="flex items-center gap-0.5">
              <IconBtn active={noteOpen} onClick={() => { setNoteText(note ?? ''); setNoteOpen((v) => !v) }} title="Заметка логиста к грузу">
                <PencilLine className="h-4 w-4" />
              </IconBtn>
              <IconBtn onClick={() => onHide(l)} title="Скрыть груз из выдачи">
                <X className="h-4 w-4" />
              </IconBtn>
              <IconBtn active={tracked} onClick={() => onTrack(l)} title={tracked ? 'Убрать из отслеживаемых' : 'Отслеживать груз'}>
                <Star className="h-4 w-4" fill={tracked ? 'currentColor' : 'none'} />
              </IconBtn>
              <IconBtn onClick={() => stubToast('Меню карточки ATI.SU')} title="Меню карточки">
                <MoreVertical className="h-4 w-4" />
              </IconBtn>
            </div>
            {priority && (
              <span className="text-[10px] text-slate-400" title="Приоритетный показ груза — платная услуга грузовладельца в атисах (демо-заглушка)">
                Приоритет {priority}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Кнопка-иконка в правом ряду действий карточки (как в ATI.SU) */
function IconBtn({ children, active, onClick, title }: {
  children: React.ReactNode
  active?: boolean
  onClick: () => void
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded-md p-1.5 transition-colors ${active ? 'bg-slate-100 text-[#0E1B2C]' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'}`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Карточка заявки (груз, по которому договорились): таймлайн согласования
// (предварительное → документы обменяны), условия, контакты и действия
// ---------------------------------------------------------------------------

function DealCard({ d, busy, planned, onDocs, onCancel, onRestore, onNote, onMatch, onPlan, onOpenTrip }: {
  d: AtiDealDto
  busy: boolean
  /** груз в плане: открытый рейс с этим dealId (связка с «Занятостью»/«Планированием») */
  planned: { tripId: string; driverName: string | null } | null
  onDocs: (d: AtiDealDto) => void
  onCancel: (d: AtiDealDto, reason: string) => void
  onRestore: (d: AtiDealDto) => void
  onNote: (d: AtiDealDto, comment: string) => void
  onMatch: (d: AtiDealDto) => void
  onPlan: (d: AtiDealDto) => void
  onOpenTrip?: (tripId: string) => void
}) {
  const [confirm, setConfirm] = useState(false)
  const [reason, setReason] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState(d.comment ?? '')

  const cancelled = d.status === 'cancelled'
  const full = d.status === 'active' && d.stage === 'full'
  const preliminary = d.status === 'active' && d.stage === 'preliminary'

  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm transition-colors ${
      cancelled ? 'border-slate-200 bg-slate-50/50' : ''
    }`}>
      {/* Шапка: маршрут и стадия заявки */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-1.5 text-[15px] font-bold leading-tight text-slate-900">
            {d.from}
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {d.to}
            {planned && (
              <Pill className="bg-violet-100 text-violet-700" title="Груз назначен составу — видно в «Занятости» и графике «Планирования»">
                <CalendarClock className="h-3 w-3" aria-hidden />в плане
              </Pill>
            )}
          </div>
          <div className="text-[11px] text-slate-400" title="Плечо рассчитано примерно (~). Точный маршрут в грузовом профиле строит кнопка «Маршрут» (Яндекс.Карты)">
            {d.fromRegion || '—'} → {d.toRegion || '—'}{d.km != null && d.km > 0 ? ` · ~${d.km} км` : ''}
          </div>
        </div>
        <DotWord dot={cancelled ? 'bg-red-500' : full ? 'bg-emerald-500' : 'bg-amber-500'} tone={cancelled ? 'danger' : undefined}>
          {cancelled ? 'Заявка отменена' : full ? 'Заявка в силе' : 'Предварительное согласование'}
        </DotWord>
      </div>

      <div className="mt-3 grid gap-x-8 gap-y-3 border-t border-slate-100 pt-3 md:grid-cols-2">
        {/* Груз и условия */}
        <div className="space-y-1.5">
          <div className="text-sm font-semibold leading-snug text-slate-900">{d.cargo}</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            {d.bodies && <span className="font-medium">{d.bodies}</span>}
            {d.weightT != null && <span>{d.weightT} т</span>}
            {d.volumeM3 != null && <span>{d.volumeM3} м³</span>}
            <span>погрузка {d.loadDateFrom ? shortDate(d.loadDateFrom) : '—'}{d.loadDateTo ? `–${shortDate(d.loadDateTo)}` : ''}</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-0.5">
            {d.rate != null && <span className="text-lg font-bold leading-none text-[#0E1B2C]">{RUB(d.rate)} ₽</span>}
            {d.perKm != null && <span className="text-xs font-medium text-slate-600">{d.perKm} ₽/км</span>}
            {d.ndsPct != null && <span className="text-[11px] text-slate-400">НДС {d.ndsPct}%</span>}
          </div>
          <div className="text-[11px] text-slate-500">{d.payment ? PAY_LABEL[d.payment] ?? d.payment : 'форма оплаты не указана'}</div>
          {d.comment && !noteOpen && (
            <div className="rounded-md bg-slate-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-600">
              <span className="font-semibold">Условия:</span> {d.comment}
            </div>
          )}
          {cancelled && d.cancelReason && (
            <div className="rounded-md bg-red-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-red-700">
              <span className="font-semibold">Причина отмены:</span> {d.cancelReason}
            </div>
          )}
        </div>

        {/* Согласование: ступени, фирма, контакт */}
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Согласование</div>
          <div className="space-y-2 border-l-2 border-slate-200 pl-3">
            <div className="relative">
              <span className={`absolute -left-[19px] top-1 h-2.5 w-2.5 rounded-full ${cancelled ? 'bg-slate-300' : 'bg-amber-500'}`} aria-hidden />
              <div className="text-[11px] font-semibold text-slate-700">Предварительное согласование</div>
              <div className="text-[11px] text-slate-400">
                {fmtDateTime(d.agreedAt)}{d.createdByName ? ` · ${d.createdByName}` : ''}
              </div>
            </div>
            <div className="relative">
              <span
                className={`absolute -left-[19px] top-1 h-2.5 w-2.5 rounded-full ${
                  full ? 'bg-emerald-500' : 'bg-slate-200'
                }`}
                aria-hidden
              />
              <div className={`text-[11px] font-semibold ${full ? 'text-slate-700' : 'text-slate-400'}`}>
                {full ? 'Документы обменяны — заявка в силе' : cancelled ? 'Документы не обменяны' : 'Ожидает обмена документами'}
              </div>
              <div className="text-[11px] text-slate-400">
                {d.docsAt ? fmtDateTime(d.docsAt) : 'полное согласование ещё не зафиксировано'}
              </div>
            </div>
          </div>
          <div className="text-[11px] text-slate-500">
            <span className="font-semibold text-slate-700">{d.carrierFirm}</span>
            {d.atiId ? ` · АТИ ${d.atiId}` : ''}
            {d.carrierRating != null ? ` · рейтинг ${d.carrierRating.toFixed(1)}` : ''}
          </div>
          {d.contactPhone && (
            <div className="text-[11px] text-slate-500">
              <Phone className="mr-0.5 inline h-3 w-3" aria-hidden />
              контакт: {d.contactName ?? '—'} · <span className="font-mono">{d.contactPhone}</span>
            </div>
          )}
        </div>
      </div>

      {/* Действия */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {/* Связка с планированием: груз назначен — показать состав и рейс */}
        {planned && (
          <>
            <Pill className="bg-emerald-50 text-emerald-700" title="Состав, назначенный на груз">
              <ClipboardList className="h-3 w-3" aria-hidden />
              {planned.driverName ?? 'состав назначен'}
            </Pill>
            {onOpenTrip && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => onOpenTrip(planned.tripId)}
                title="Открыть карточку рейса в «Заявках» — план погрузки/выгрузки и возврат на базу"
              >
                <ClipboardList className="mr-1 h-3.5 w-3.5" />
                Рейс
              </Button>
            )}
          </>
        )}
        {/* Взять в план: только заявка в силе (документы обменяны) и ещё не назначена */}
        {!cancelled && !planned && full && (
          <Button
            type="button"
            size="sm"
            className="h-8 bg-violet-700 text-white hover:bg-violet-800"
            onClick={() => onPlan(d)}
            title="Назначить груз составу: свободным (новый рейс) или плечом к освобождающемуся рейсу — общий подбор с доской «Занятость» и графиком «Планирования»"
          >
            <CalendarClock className="mr-1 h-3.5 w-3.5" />
            В план
          </Button>
        )}
        {/* Подбор водителя прямо на заявке — фирменный тёмный primary */}
        {!cancelled && (
          <Button
            type="button"
            size="sm"
            className="h-8 bg-[#0E1B2C] text-white hover:bg-[#16304f]"
            onClick={() => onMatch(d)}
            title="Прямо на этой заявке: откроется подбор под этот груз — сервис сам подберёт водителя из парка (где освободится машина, подача до погрузки, сроки 500–600 км/день, ставка по кругу). Расчёт запустится по кнопке «Произвести расчёт» в открывшемся окне"
          >
            <Calculator className="mr-1 h-3.5 w-3.5" />
            Подбор водителя
          </Button>
        )}
        <button
          type="button"
          onClick={() => openRouteTab(d.from, d.to)}
          title="Открыть маршрут в Яндекс.Картах в новой вкладке — линия пути, расстояние и время в пути (грузовой профиль)"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
        >
          <RouteIcon className="h-3 w-3" aria-hidden />
          Маршрут
        </button>
        {d.contactPhone && (
          <CallButton
            phone={d.contactPhone}
            name={`${d.contactName ?? ''} (${d.carrierFirm})`}
            label="Позвонить"
          />
        )}
        {preliminary && (
          <Button
            type="button"
            size="sm"
            className="h-8 bg-[#0E1B2C] text-white hover:bg-[#16304f]"
            onClick={() => onDocs(d)}
            disabled={busy}
            title="Зафиксировать обмен документами — заявка вступает в силу (полное согласование)"
          >
            {busy ? <span className="mr-1 h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden /> : <FileCheck2 className="mr-1 h-3.5 w-3.5" />}
            Обменялись документами
          </Button>
        )}
        {d.status === 'active' && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-red-700 hover:bg-red-50"
            onClick={() => { setConfirm((v) => !v); setReason('') }}
            disabled={busy}
            title="Договорённость не состоялась — убрать заявку из активных"
          >
            <CircleOff className="mr-1 h-3.5 w-3.5" />
            Отменить
          </Button>
        )}
        {cancelled && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => onRestore(d)}
            disabled={busy}
            title="Вернуть заявку к предварительному согласованию"
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Вернуть в работу
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 text-slate-500 hover:text-slate-800"
          onClick={() => { setNoteOpen((v) => !v); setNoteText(d.comment ?? '') }}
          title="Условия договорённости: ставка, время погрузки, нюансы"
        >
          <PencilLine className="mr-1 h-3.5 w-3.5" />
          Условия
        </Button>
      </div>

      {confirm && (
        <div className="mt-3 space-y-2 rounded-lg border border-red-100 bg-red-50/60 p-2.5">
          <div className="text-xs text-red-700">
            Отменить заявку «{d.from} → {d.to}»? Причина (необязательно):
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="например: грузовладелец передумал"
            className="h-8 w-full rounded-md border border-red-200 bg-white px-2 text-xs outline-none focus:border-red-400"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="h-8 bg-red-600 text-white hover:bg-red-700"
              disabled={busy}
              onClick={() => { onCancel(d, reason); setConfirm(false) }}
            >
              Подтвердить отмену
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setConfirm(false)}>
              Не отменять
            </Button>
          </div>
        </div>
      )}

      {noteOpen && (
        <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-slate-50/60 p-2.5">
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={2}
            className="min-h-16 text-xs"
            placeholder="Условия договорённости: согласованная ставка, время погрузки, нюансы"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 bg-[#0E1B2C] text-white hover:bg-[#16304f]"
              disabled={busy}
              onClick={() => { onNote(d, noteText); setNoteOpen(false) }}
            >
              Сохранить
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setNoteOpen(false)}>
              Закрыть
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Мелкие элементы формы
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function FilterTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{children}</div>
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-700">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} className="h-3.5 w-3.5" />
      {label}
    </label>
  )
}
