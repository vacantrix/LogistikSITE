'use client'

/**
 * «Заявки» — единый контур работы логиста (v1.12, система статусов заявки):
 * клик по строке реестра открывает модальную карточку (маршрут + карта, плитки
 * полей документа 1С, строки рейса, блок рейса и действия по статусу). Статусы —
 * жизненный цикл: Новая → К планированию → Запланирована → В рейсе → Выполнена,
 * отдельная красная ветка — Карантин (ошибка приёма из 1С).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { authFetch } from '@/lib/kontur/session-token'
import { withBasePath } from '@/lib/kontur/base-path'
import {
  ArrowDownUp, CalendarDays, Check, ClipboardList, ExternalLink, MapPin, Pin, RefreshCw, Route, ScanLine,
  Smartphone, Sparkles, TriangleAlert, Truck, UserX, Warehouse,
} from 'lucide-react'
import { Button } from '@/components/kontur/ui/button'
import { Card, CardContent } from '@/components/kontur/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/kontur/ui/dialog'
import { Input } from '@/components/kontur/ui/input'
import { Label } from '@/components/kontur/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/kontur/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/kontur/ui/table'
import { useToast } from '@/hooks/use-toast'
import { TRIP_STATUS_LABELS, ACK_LABELS, MONITOR_STATUSES } from '@/lib/kontur/constants'
import type { Leg, MatchCandidate, MatchResponse, Order, StateResponse, Trip } from '@/lib/kontur/client-types'
import { DotWord, InfoTip, Pill, StatusChip } from './bits'
import { TripView } from './TripView'
import { CallButton } from './CallButton'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full'

// Система статусов заявки: точка + слово (как статусы рейсов в bits.tsx).
// В БД хранится стадия new/ready_to_plan/planned/quarantine; «planned» уточняется
// по состоянию рейса — так реестр показывает честный жизненный цикл.
type DisplayStatus = 'new' | 'ready_to_plan' | 'planned' | 'in_trip' | 'done' | 'quarantine'

const ORDER_STATUS: Record<DisplayStatus, { dot: string; tone?: 'danger'; label: string }> = {
  new: { dot: 'bg-sky-500', label: 'Новая' },
  ready_to_plan: { dot: 'bg-emerald-500', label: 'К планированию' },
  planned: { dot: 'bg-blue-500', label: 'Запланирована' },
  in_trip: { dot: 'bg-amber-500', label: 'В рейсе' },
  done: { dot: 'bg-slate-400', label: 'Выполнена' },
  quarantine: { dot: 'bg-red-500', tone: 'danger', label: 'Карантин' },
}

// Стадии лестницы B5.1, на которых рейс уже выполняется
const MOVING_LEG = new Set(['en_route_to_loading', 'at_loading', 'loaded', 'en_route', 'at_unloading', 'unloaded'])

// Порядок реестра: сначала то, что требует действия, затем по ходу исполнения
const ORDER_RANK: Record<DisplayStatus, number> = { quarantine: 0, new: 1, ready_to_plan: 2, planned: 3, in_trip: 4, done: 5 }

type StatusFilter = 'all' | DisplayStatus
type DateFilter = 'all' | 'today' | 'tomorrow' | 'week'

const DATE_FILTERS: { value: DateFilter; label: string }[] = [
  { value: 'all', label: 'Все даты погрузки' },
  { value: 'today', label: 'Сегодня' },
  { value: 'tomorrow', label: 'Завтра' },
  { value: 'week', label: 'Неделя' },
]

/** Плитка сводки: счётчик + подпись, клик = фильтр реестра */
function StatTile({ count, label, dot, hint, active, onClick }: {
  count: number
  label: string
  dot: string
  hint: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-pressed={active}
      className={`rounded-xl border bg-white p-4 text-left shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
        active ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200'
      }`}
    >
      {/* точка-индикатор — в правом верхнем углу, как в KPI-плитках «Мониторинга» */}
      <div className="flex w-full items-center justify-between">
        <span className="text-2xl font-bold tabular-nums text-slate-900">{count}</span>
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      </div>
      <div className="mt-1 text-sm font-medium text-slate-700">{label}</div>
    </button>
  )
}

const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const fmtCreated = (iso?: string | null): string =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

/** Данные рейса, привязанного к заявке (плечо с orderId) */
interface OrderTrip {
  trip: Trip
  leg: Leg
}

/** Отображаемый статус заявки: стадия из БД + уточнение по состоянию рейса */
function displayStatus(o: Order, link?: OrderTrip): DisplayStatus {
  if (o.status === 'new') return 'new'
  if (o.status === 'ready_to_plan') return 'ready_to_plan'
  if (o.status === 'quarantine') return 'quarantine'
  if (link?.trip.status === 'completed') return 'done'
  if (link && MOVING_LEG.has(link.leg.status)) return 'in_trip'
  return 'planned'
}

/** Строки продукции из extra, записанных симулятором/1С */
interface ExtraLines {
  lines?: { product?: string; qty?: number; point?: string; spec?: string; customer?: string }[]
  loadWindow?: string
  customers?: string[]
}

function parseExtra(raw?: string | null): ExtraLines | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

const fmtT = (v?: number): string =>
  v ? v.toLocaleString('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : ''

// Регион в начале адреса («Краснодарский край, Динской р-н, Динск») — не город
const REGION_RE = /(край|область|республика|автономн|а\.о\.)/i

/** Точка маршрута для карточки: главный населённый пункт + остальной адрес */
function splitPoint(p: string): { main: string; rest?: string } {
  const parts = p.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length <= 1) return { main: p }
  if (REGION_RE.test(parts[0])) return { main: parts[parts.length - 1], rest: parts.slice(0, -1).join(', ') }
  return { main: parts[0], rest: parts.slice(1).join(', ') }
}

/** «Построить маршрут» — Яндекс.Карты по адресам погрузки/выгрузки */
function routeUrl(from?: string | null, to?: string | null): string {
  const clean = (s?: string | null) => (s ?? '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  const a = clean(from)
  const b = clean(to)
  if (!a || !b) return ''
  return `https://yandex.ru/maps/?rtext=${encodeURIComponent(a)}~${encodeURIComponent(b)}&rtt=auto`
}

/** Плитка-поле карточки заявки (стиль LogistikSITE: подпись сверху, значение снизу) */
function FieldCard({ label, children }: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 min-w-0 text-sm font-semibold leading-snug text-slate-900">{children}</div>
    </div>
  )
}

// ——— Умный подбор: карточка кандидата (рейс или свободный состав) ———

// Грейд кандидата — в языке статусов платформы (LogistikSITE): цвет несёт точка
const GRADE_META: Record<string, { dot: string; label: string }> = {
  ideal: { dot: 'bg-emerald-500', label: 'идеально' },
  good: { dot: 'bg-sky-500', label: 'хорошо' },
  risky: { dot: 'bg-amber-500', label: 'с риском' },
}

/** Чип причины «почему подходит / на что обратить внимание» */
function MatchReasonChip({ kind, text }: { kind: string; text: string }) {
  const plus = kind === 'plus'
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
      {plus ? <Check className="h-3 w-3 shrink-0 text-emerald-600" aria-hidden /> : <TriangleAlert className="h-3 w-3 shrink-0 text-amber-600" aria-hidden />}
      {text}
    </span>
  )
}

/** Карточка кандидата: скор + состав + когда/где освобождается + почему + действия */
function MatchCandidateCard({ cand, orderId, actionLabel, onAction, onPin, disabled, busy, pinBusy }: {
  cand: MatchCandidate
  orderId: string
  actionLabel: string
  onAction: (c: MatchCandidate) => void
  onPin?: (c: MatchCandidate) => void
  disabled: boolean
  busy: boolean
  pinBusy?: boolean
}) {
  const gm = GRADE_META[cand.grade] ?? GRADE_META.good
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill className="bg-slate-100 text-slate-700">
              <span className={`h-2 w-2 rounded-full ${gm.dot}`} aria-hidden />
              <b>{cand.score}</b>&nbsp;· {gm.label}
            </Pill>
            <span className="text-sm font-semibold text-slate-900">{cand.driver.fullName}</span>
            {cand.pinned ? (
              <Pill className="bg-slate-100 text-slate-700" title="Состав закреплён за водителем — сохранено в БД">
                <Pin className="h-3 w-3" />закреплён
              </Pill>
            ) : null}
            <CallButton phone={cand.driver.phone} name={cand.driver.fullName} driverId={cand.driver.id} orderId={orderId} />
          </div>
          <div className="mt-1 font-mono text-xs text-slate-600">
            {cand.vehicle.brand} ({cand.vehicle.plate}){cand.trailer ? ` · прицеп ${cand.trailer.plate} (${cand.trailer.type})` : ''}
          </div>
          {cand.usual && (
            <div className="mt-1 text-[11px] text-slate-500">
              Обычно работает на {cand.usual.vehicleBrand} ({cand.usual.vehiclePlate})
              {cand.usual.trailerPlate ? ` · прицеп ${cand.usual.trailerPlate}` : ''}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onPin && (
            <Button
              size="sm"
              variant="outline"
              disabled={pinBusy}
              title={cand.pinned
                ? 'Состав закреплён за водителем — нажмите, чтобы открепить'
                : 'Закрепить за водителем этот тягач и прицеп — подбор и планирование будут предлагать их в первую очередь'}
              className={cand.pinned ? 'h-8 bg-slate-100' : 'h-8'}
              onClick={() => onPin(cand)}
            >
              {pinBusy ? '…' : <Pin className={cand.pinned ? 'h-3.5 w-3.5 fill-slate-700 text-slate-900' : 'h-3.5 w-3.5'} aria-hidden />}
              {cand.pinned ? 'Закреплено' : 'Закрепить'}
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => onAction(cand)} className="shrink-0">
            {actionLabel}
          </Button>
        </div>
      </div>
      <div className="mt-1.5 space-y-0.5 text-xs text-slate-600">
        {cand.nowRoute && (
          <div className="truncate" title={cand.nowRoute}>
            Сейчас: {cand.nowRoute}
            {cand.nowStatus ? ` · ${MONITOR_STATUSES[cand.nowStatus] ?? cand.nowStatus}` : ''}
          </div>
        )}
        {cand.freesAt && (
          <div>Освобождается: {fmtCreated(cand.freesAt)}{cand.freesAtPoint ? ` · ${cand.freesAtPoint}` : ''}</div>
        )}
        {!cand.freesAt && cand.kind === 'composition' && <div>Свободен сейчас — состав на базе</div>}
        {cand.deadheadKm != null && <div>{cand.deadheadKm} км порожнего пробега до пункта погрузки</div>}
      </div>
      {cand.reasons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {cand.reasons.map((r, i) => (
            <MatchReasonChip key={i} kind={r.kind} text={r.text} />
          ))}
        </div>
      )}
    </div>
  )
}

export function RequestsPanel({ state, onChanged, query = '', focusTrip, onFocusTripConsumed }: {
  state: StateResponse
  onChanged: () => void
  query?: string
  focusTrip?: { id: string; ts: number } | null
  onFocusTripConsumed?: () => void
}) {
  const { toast } = useToast()

  // ——— drill-down: карточка рейса внутри раздела ———
  const [tripViewId, setTripViewId] = useState<string | null>(null)

  // Навигация из алерта-кнопки шапки: открыть карточку проблемного рейса
  useEffect(() => {
    if (!focusTrip) return
    setTripViewId(focusTrip.id)
    onFocusTripConsumed?.()
  }, [focusTrip, onFocusTripConsumed])

  // ——— фильтры реестра ———
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')

  // ——— открытая карточка заявки (модальное окно поверх реестра) ———
  const [openCardId, setOpenCardId] = useState<string | null>(null)
  const openCard = openCardId ? state.orders.find((row) => row.id === openCardId) ?? null : null

  // ——— умный подбор: кто и какой рейс подойдёт под открытую заявку ———
  const [match, setMatch] = useState<MatchResponse | null>(null)
  const [matchLoading, setMatchLoading] = useState(false)
  const [appendBusy, setAppendBusy] = useState(false)
  const [pinBusy, setPinBusy] = useState(false)

  // Подгрузка при открытии карточки и после каждого обновления состояния
  useEffect(() => {
    if (!openCardId) {
      setMatch(null)
      return
    }
    let cancelled = false
    setMatchLoading(true)
    setMatch(null)
    authFetch(`/api/match?orderId=${openCardId}`)
      .then((r) => (r.ok ? r.json() : Promise.resolve(null)))
      .then((d: MatchResponse | null) => {
        if (!cancelled) setMatch(d)
      })
      .catch(() => {
        /* подбор не критичен для карточки — просто не показываем */
      })
      .finally(() => {
        if (!cancelled) setMatchLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [openCardId, state])

  // ——— планирование состава из собственного парка ———
  const [planOrder, setPlanOrder] = useState<Order | null>(null)
  const [planVehicle, setPlanVehicle] = useState('')
  const [planTrailer, setPlanTrailer] = useState('')
  const [planDriver, setPlanDriver] = useState('')
  const [busy, setBusy] = useState(false)

  // закрепление выбранного водителя (водитель ↔ тягач ↔ прицеп)
  const planBinding = useMemo(
    () => state.bindings.find((b) => b.driverId === planDriver) ?? null,
    [state.bindings, planDriver],
  )

  // карта заявка → рейс (плечо несёт orderId)
  const tripByOrder = useMemo(() => {
    const m = new Map<string, OrderTrip>()
    for (const t of state.trips) {
      for (const l of t.legs) {
        if (l.orderId && !m.has(l.orderId)) m.set(l.orderId, { trip: t, leg: l })
      }
    }
    return m
  }, [state.trips])

  // ——— счётчики сводки (по отображаемым статусам) ———
  const counts = useMemo(() => {
    const by = new Map<DisplayStatus, number>()
    for (const o of state.orders) {
      const s = displayStatus(o, tripByOrder.get(o.id))
      by.set(s, (by.get(s) ?? 0) + 1)
    }
    return by
  }, [state.orders, tripByOrder])

  // ——— реестр: фильтрация и сортировка ———
  const orders = useMemo(() => {
    const q = query.trim().toLowerCase()
    const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const today = dayStart(new Date())
    const dayMs = 86400000
    const inRange = (iso?: string | null): boolean => {
      if (dateFilter === 'all') return true
      if (!iso) return false
      const ts = dayStart(new Date(iso))
      if (Number.isNaN(ts)) return false
      if (dateFilter === 'today') return ts === today
      if (dateFilter === 'tomorrow') return ts === today + dayMs
      return ts >= today && ts <= today + 7 * dayMs
    }
    return state.orders
      .filter((o) => {
        if (statusFilter !== 'all' && displayStatus(o, tripByOrder.get(o.id)) !== statusFilter) return false
        if (!inRange(o.loadDatePlan)) return false
        if (!q) return true
        const hay = [
          o.number, o.externalId, o.customer, o.product, o.loadPoint, o.unloadPoint, o.kp,
          tripByOrder.get(o.id)?.trip.driver?.fullName,
          tripByOrder.get(o.id)?.trip.vehicle?.plate,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
      .sort((a, b) => {
        const r = ORDER_RANK[displayStatus(a, tripByOrder.get(a.id))] - ORDER_RANK[displayStatus(b, tripByOrder.get(b.id))]
        if (r !== 0) return r
        return (a.loadDatePlan ?? '').localeCompare(b.loadDatePlan ?? '') || a.number.localeCompare(b.number)
      })
  }, [state.orders, query, statusFilter, dateFilter, tripByOrder])

  function openPlan(o: Order, pre?: { vehicleId?: string; trailerId?: string; driverId?: string }) {
    setPlanOrder(o)
    setPlanVehicle(pre?.vehicleId ?? '')
    setPlanTrailer(pre?.trailerId ?? '')
    setPlanDriver(pre?.driverId ?? '')
  }

  /** Добавить заявку плечом к активному рейсу (действие из умного подбора) */
  async function appendOrder(cand: MatchCandidate) {
    if (!openCard || !cand.tripId) return
    setAppendBusy(true)
    try {
      const res = await authFetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'append', orderId: openCard.id, tripId: cand.tripId, driverId: cand.driver.id }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ title: 'Не удалось добавить к рейсу', description: data?.error?.message, variant: 'destructive' })
        return
      }
      toast({
        title: 'Заявка добавлена плечом к рейсу',
        description: `${data?.driverName ?? cand.driver.fullName} получает плечо в приложении; заявка — «Запланирована».`,
      })
      onChanged()
    } finally {
      setAppendBusy(false)
    }
  }

  /** Закрепить/открепить состав кандидата за водителем (сохраняется в БД) */
  async function togglePin(cand: MatchCandidate) {
    setPinBusy(true)
    try {
      const res = await authFetch('/api/bindings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          cand.pinned
            ? { action: 'unpin', driverId: cand.driver.id }
            : { action: 'pin', driverId: cand.driver.id, vehicleId: cand.vehicle.id, trailerId: cand.trailer?.id ?? null },
        ),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ title: 'Закрепление не сохранено', description: data?.error?.message, variant: 'destructive' })
        return
      }
      toast({
        title: cand.pinned ? 'Закрепление снято' : 'Состав закреплён за водителем',
        description: cand.pinned
          ? `${cand.driver.fullName} — подбор больше не отдаёт приоритет этому составу`
          : data?.message ?? `${cand.driver.fullName}: ${cand.vehicle.brand} (${cand.vehicle.plate})`,
      })
      onChanged() // состояние и подбор пересчитаются с учётом закрепления
    } finally {
      setPinBusy(false)
    }
  }

  async function applyPlan() {
    if (!planOrder || !planVehicle || !planDriver) {
      toast({ title: 'Выберите ТС и водителя', description: 'Состав назначается из собственного парка АЭМЗ', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await authFetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'plan',
          orderId: planOrder.id,
          vehicleId: planVehicle,
          trailerId: planTrailer || undefined,
          driverId: planDriver,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ title: 'Назначение не выполнено', description: data?.error?.message, variant: 'destructive' })
        return
      }
      toast({
        title: 'Состав назначен из собственного парка',
        description: 'Рейс создан, заявка — «Запланирована»; водитель получит назначение в приложении (подтверждение — SLA 30 мин).',
      })
      setPlanOrder(null)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  /** Выбор водителя в диалоге планирования: закреплённый состав подставляется сам */
  function pickPlanDriver(driverId: string) {
    setPlanDriver(driverId)
    const b = state.bindings.find((x) => x.driverId === driverId)
    if (b?.vehicle) {
      setPlanVehicle(b.vehicleId)
      setPlanTrailer(b.trailerId ?? '')
    }
  }

  /** Закрепить за выбранным водителем текущий выбор тягача/прицепа */
  async function pinPlanSelection() {
    if (!planDriver || !planVehicle) return
    setPinBusy(true)
    try {
      const res = await authFetch('/api/bindings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pin', driverId: planDriver, vehicleId: planVehicle, trailerId: planTrailer || null }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ title: 'Закрепление не сохранено', description: data?.error?.message, variant: 'destructive' })
        return
      }
      toast({ title: 'Состав закреплён за водителем', description: data?.message })
      onChanged()
    } finally {
      setPinBusy(false)
    }
  }

  async function markReady(orderId: string) {
    const res = await authFetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ready', orderId }),
    })
    if (res.ok) {
      toast({ title: 'Заявка готова к планированию' })
      onChanged()
    }
  }

  // ——— карточка рейса: drill-down внутри раздела ———
  if (tripViewId) {
    return <TripView tripId={tripViewId} state={state} onChanged={onChanged} onBack={() => setTripViewId(null)} />
  }

  return (
    <div className="space-y-4">
      {/* Вводная строка раздела */}
      <div className="flex flex-wrap items-center gap-2 border-y border-slate-200 py-2.5 text-sm text-slate-700" role="status">
        <ScanLine className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <span className="min-w-0 flex-1">
          Заявки приходят из 1С автоматически: появился документ «Заказы грузоотправителей» — он же заявка здесь.
          Логист ведёт заявку до рейса: проверка → планирование состава из собственного парка → карточка рейса.
        </span>
        <Button size="sm" variant="outline" onClick={onChanged}>
          <RefreshCw className="h-3.5 w-3.5" />Обновить
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.open(withBasePath('/1c-simulator/index.html'), '_blank', 'noopener')}
          title="Демо-форма 1С «Заказы грузоотправителей»: отмеченные рейсы уходят в этот раздел"
        >
          <ExternalLink className="h-3.5 w-3.5" />Симулятор 1С
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.open(withBasePath('/phone-bridge/index.html'), '_blank', 'noopener')}
          title="Демо лёгкого приложения-моста: клик «Позвонить» в кабинете передаёт заявку на телефон логиста — там кнопка вызова без ввода номера"
        >
          <Smartphone className="h-3.5 w-3.5" />Мост на телефон
        </Button>
      </div>

      {/* Сводка: счётчики по стадиям заявки (клик = фильтр реестра) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" role="group" aria-label="Сводка по заявкам">
        <StatTile
          count={counts.get('new') ?? 0}
          label="Новые"
          dot="bg-sky-500"
          hint="Пришли из 1С и ждут проверки логиста"
          active={statusFilter === 'new'}
          onClick={() => setStatusFilter(statusFilter === 'new' ? 'all' : 'new')}
        />
        <StatTile
          count={counts.get('ready_to_plan') ?? 0}
          label="К планированию"
          dot="bg-emerald-500"
          hint="Проверены — можно назначать состав"
          active={statusFilter === 'ready_to_plan'}
          onClick={() => setStatusFilter(statusFilter === 'ready_to_plan' ? 'all' : 'ready_to_plan')}
        />
        <StatTile
          count={counts.get('planned') ?? 0}
          label="Запланирована"
          dot="bg-blue-500"
          hint="Состав назначен — ожидает подтверждения водителя и выезда"
          active={statusFilter === 'planned'}
          onClick={() => setStatusFilter(statusFilter === 'planned' ? 'all' : 'planned')}
        />
        <StatTile
          count={counts.get('in_trip') ?? 0}
          label="В рейсе"
          dot="bg-amber-500"
          hint="Рейсы выполняются — детали на карточках рейсов"
          active={statusFilter === 'in_trip'}
          onClick={() => setStatusFilter(statusFilter === 'in_trip' ? 'all' : 'in_trip')}
        />
        <StatTile
          count={counts.get('done') ?? 0}
          label="Выполнена"
          dot="bg-slate-400"
          hint="Рейсы завершены — документы закрываются"
          active={statusFilter === 'done'}
          onClick={() => setStatusFilter(statusFilter === 'done' ? 'all' : 'done')}
        />
        <StatTile
          count={counts.get('quarantine') ?? 0}
          label="Карантин"
          dot="bg-red-500"
          hint="Пришли с ошибкой — требуют исправления в 1С"
          active={statusFilter === 'quarantine'}
          onClick={() => setStatusFilter(statusFilter === 'quarantine' ? 'all' : 'quarantine')}
        />
      </div>

      {/* Фильтры реестра */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="h-9 w-[190px]" aria-label="Фильтр по статусу заявки">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="new">Новые</SelectItem>
              <SelectItem value="ready_to_plan">К планированию</SelectItem>
              <SelectItem value="planned">Запланированные</SelectItem>
              <SelectItem value="in_trip">В рейсе</SelectItem>
              <SelectItem value="done">Выполнены</SelectItem>
              <SelectItem value="quarantine">Карантин</SelectItem>
            </SelectContent>
          </Select>
          <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
            <SelectTrigger className="h-9 w-[190px]" aria-label="Фильтр по дате погрузки">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FILTERS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(statusFilter !== 'all' || dateFilter !== 'all' || query.trim()) && (
            <Button size="sm" variant="ghost" className="h-9" onClick={() => { setStatusFilter('all'); setDateFilter('all') }}>
              Сбросить
            </Button>
          )}
          <div className="ml-auto text-xs text-slate-500">
            Заявок: <b className="text-slate-700">{orders.length}</b> из {state.orders.length}
          </div>
        </div>
      </div>

      {/* Реестр заявок */}
      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <div className={`max-h-[62vh] overflow-auto ${THIN_SCROLL}`}>
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_#e2e8f0]">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[130px]">Заявка</TableHead>
                  <TableHead>Заказчик</TableHead>
                  <TableHead className="max-w-[240px]">Продукция</TableHead>
                  <TableHead>Маршрут</TableHead>
                  <TableHead className="whitespace-nowrap">Погрузка</TableHead>
                  <TableHead className="whitespace-nowrap">Ставка</TableHead>
                  <TableHead>Рейс (состав)</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="w-[150px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => {
                  const link = tripByOrder.get(o.id)
                  const d = displayStatus(o, link)
                  const meta = ORDER_STATUS[d]
                  return (
                    <TableRow
                      key={o.id}
                      data-order={o.number}
                      tabIndex={0}
                      aria-label={`Открыть карточку заявки ${o.number}`}
                      className="cursor-pointer transition-colors hover:bg-slate-50 focus-visible:bg-slate-100 focus-visible:outline-none"
                      onClick={() => setOpenCardId(o.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenCardId(o.id) } }}
                    >
                      <TableCell>
                        <div className="font-mono text-xs font-semibold text-slate-900">{o.number}</div>
                        <div className="truncate font-mono text-[10px] text-slate-400" title={o.externalId}>{o.externalId}</div>
                        {o.status === 'quarantine' && o.quarantineReason && (
                          <div className="mt-0.5 max-w-[120px] text-[10px] leading-tight text-red-600" title={o.quarantineReason}>
                            {o.quarantineReason}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-800">{o.customer}</TableCell>
                      <TableCell className="max-w-[240px]">
                        <div className="truncate text-sm text-slate-700" title={o.product}>{o.product}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-xs text-slate-700" title={o.loadPoint}>
                          <Truck className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                          <span className="max-w-[170px] truncate">{o.loadPoint}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-700" title={o.unloadPoint}>
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                          <span className="max-w-[170px] truncate">{o.unloadPoint}</span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-slate-700">
                        <div className="flex items-center gap-1.5">
                          <CalendarDays className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                          {fmtDate(o.loadDatePlan)}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-slate-800">
                        {o.tariff ? `${o.tariff.toLocaleString('ru-RU')} ₽` : '—'}
                        {o.kp && <div className="font-mono text-[10px] text-slate-400" title={`Спецификация/КП: ${o.kp}`}>{o.kp}</div>}
                      </TableCell>
                      <TableCell>
                        {link ? (
                          <div className="space-y-0.5">
                            <div className="text-sm font-medium text-slate-800">{link.trip.driver?.fullName}</div>
                            <div className="font-mono text-xs text-slate-600">
                              {link.trip.vehicle?.plate}
                              {link.trip.trailer ? ` · ${link.trip.trailer.plate}` : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">— не назначен</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <DotWord dot={meta.dot} tone={meta.tone}>{meta.label}</DotWord>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          {d === 'new' && (
                            <Button size="sm" variant="ghost" onClick={() => markReady(o.id)}>В план</Button>
                          )}
                          {d === 'ready_to_plan' && (
                            <Button size="sm" variant="outline" onClick={() => openPlan(o)}>
                              <Truck className="h-3.5 w-3.5" />Состав
                            </Button>
                          )}
                          {(d === 'planned' || d === 'in_trip' || d === 'done') && link && (
                            <Button size="sm" variant="outline" onClick={() => setTripViewId(link.trip.id)}>
                              <ClipboardList className="h-3.5 w-3.5" />Рейс
                            </Button>
                          )}
                          {d === 'quarantine' && (
                            <Button size="sm" variant="outline" onClick={() => markReady(o.id)}>Исправлено</Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {orders.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={9} className="py-10 text-center text-sm font-medium text-slate-600">
                      Заявок по фильтру нет {statusFilter === 'all' && '— отправьте рейс из симулятора 1С'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">
            <span>Клик по строке — карточка заявки</span>
            <span>Жизненный цикл: Новая → К планированию → Запланирована → В рейсе → Выполнена · Карантин — ошибка приёма из 1С</span>
            <span className="ml-auto">Обновление: {fmtCreated(state.orders[0]?.updatedAt)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Карточка заявки: модальное окно (стиль LogistikSITE: маршрут, поля, действия) */}
      <Dialog open={!!openCard} onOpenChange={(v) => !v && setOpenCardId(null)}>
        <DialogContent className="max-h-[90vh] gap-3 overflow-y-auto sm:max-w-2xl" data-order-card={openCard?.number ?? ''}>
          {openCard && (() => {
            const o = openCard
            const link = tripByOrder.get(o.id)
            const d = displayStatus(o, link)
            const extra = parseExtra(o.extra)
            const meta = ORDER_STATUS[d]
            const load = splitPoint(o.loadPoint)
            const unload = splitPoint(o.unloadPoint)
            const mapsUrl = routeUrl(o.loadPoint, o.unloadPoint)
            return (
              <>
                {/* Заголовок: номер + статус + источник */}
                <DialogHeader>
                  <DialogTitle className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-lg font-bold">
                    Заявка {o.number}
                    <DotWord dot={meta.dot} tone={meta.tone}>{meta.label}</DotWord>
                    <Pill className="bg-slate-100 text-slate-600">источник: {o.source === '1c' ? '1С' : o.source === 'manual' ? 'ручной ввод' : o.source}</Pill>
                  </DialogTitle>
                </DialogHeader>

                {/* Маршрут: погрузка → выгрузка, построение маршрута на карте */}
                <div className="space-y-1.5">
                  <div className="flex items-start gap-2 text-sm">
                    <Warehouse className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                    <div className="min-w-0">
                      {o.loadPoint ? (
                        <>
                          <div className="font-semibold leading-snug text-slate-900">{load.main}</div>
                          {load.rest && <div className="text-xs leading-snug text-slate-500">{load.rest}</div>}
                        </>
                      ) : (
                        <div className="italic leading-snug text-slate-400">Пункт погрузки не указан — документ в карантине</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                    <div className="min-w-0">
                      {o.unloadPoint ? (
                        <>
                          <div className="font-semibold leading-snug text-slate-900">{unload.main}</div>
                          {unload.rest && <div className="text-xs leading-snug text-slate-500">{unload.rest}</div>}
                        </>
                      ) : (
                        <div className="italic leading-snug text-slate-400">Пункт выгрузки не указан — документ в карантине</div>
                      )}
                    </div>
                  </div>
                  {mapsUrl && (
                    <Button size="sm" variant="outline" className="mt-1" onClick={() => window.open(mapsUrl, '_blank', 'noopener')}>
                      <Route className="h-3.5 w-3.5" />Построить маршрут
                    </Button>
                  )}
                </div>

                {/* Карантин: причина и порядок действий */}
                {o.status === 'quarantine' && o.quarantineReason && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                    <b>Карантин:</b> {o.quarantineReason}. Исправьте документ в 1С и отправьте повторно — заявка обновится.
                  </div>
                )}

                {/* Поля заявки (документ 1С) */}
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  <FieldCard label="Заказчик">
                    <div className="truncate" title={o.customer}>{o.customer}</div>
                    {extra?.customers?.length ? (
                      <div className="mt-0.5 truncate text-[11px] font-normal text-slate-500" title={extra.customers.join(', ')}>
                        грузополучатель: {extra.customers.join(', ')}
                      </div>
                    ) : null}
                  </FieldCard>
                  <FieldCard label="Груз">
                    <div className="line-clamp-2" title={o.product}>{o.product}</div>
                  </FieldCard>
                  <FieldCard label="Погрузка">
                    {fmtDate(o.loadDatePlan)}
                    {extra?.loadWindow && <div className="mt-0.5 text-[11px] font-normal text-slate-500">окно {extra.loadWindow}</div>}
                  </FieldCard>
                  <FieldCard label="Выгрузка">{fmtDate(o.unloadDatePlan)}</FieldCard>
                  <FieldCard label="Ставка">
                    {o.tariff ? `${o.tariff.toLocaleString('ru-RU')} ₽/т` : '—'}
                    {o.kp && <div className="mt-0.5 font-mono text-[11px] font-normal text-slate-500" title={`Спецификация/КП: ${o.kp}`}>{o.kp}</div>}
                  </FieldCard>
                  <FieldCard label="Документ 1С">
                    <div className="truncate font-mono text-xs" title={o.externalId}>{o.externalId}</div>
                    <div className="mt-0.5 text-[11px] font-normal text-slate-500">создан {fmtCreated(o.createdAt)}</div>
                  </FieldCard>
                </div>

                {/* Строки рейса 1С (если переданы документом) */}
                {extra?.lines?.length ? (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-1.5 text-xs font-medium text-slate-500">Строки рейса 1С (машина)</div>
                    <ul className="space-y-1 text-xs text-slate-700">
                      {extra.lines.map((l, i) => (
                        <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-medium">{l.product}</span>
                          <span className="tabular-nums text-slate-500">{fmtT(l.qty)} т</span>
                          {l.point && <span className="text-slate-400">· {l.point}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* Рейс: состав из собственного парка или подсказка к планированию */}
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Рейс</div>
                  {link ? (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <DotWord dot={link.trip.status === 'active' ? 'bg-emerald-500' : link.trip.status === 'completed' ? 'bg-emerald-600' : link.trip.status === 'cancelled' ? 'bg-red-500' : 'bg-slate-400'} tone={link.trip.status === 'cancelled' ? 'danger' : undefined}>
                          {TRIP_STATUS_LABELS[link.trip.status]}
                        </DotWord>
                        <DotWord dot={link.trip.ackStatus === 'pending' ? 'bg-amber-500' : 'bg-emerald-500'} tone={link.trip.ackStatus === 'pending' ? 'warning' : undefined}>
                          <UserX className="h-3 w-3" aria-hidden />{ACK_LABELS[link.trip.ackStatus]}
                        </DotWord>
                      </div>
                      <div className="text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-800">{link.trip.driver?.fullName}</span>
                          {link.trip.driver?.phone && (
                            <CallButton
                              phone={link.trip.driver.phone}
                              name={link.trip.driver.fullName}
                              driverId={link.trip.driver.id}
                              orderId={o.id}
                            />
                          )}
                        </div>
                        <div className="font-mono text-xs text-slate-600">
                          {link.trip.vehicle?.brand} ({link.trip.vehicle?.plate})
                          {link.trip.trailer ? ` · прицеп ${link.trip.trailer.plate}` : ''}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {link.trip.legs.map((leg) => (
                          <div key={leg.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-2.5 py-1.5">
                            <div className="flex min-w-0 items-center gap-1.5" title={`${leg.loadPoint} → ${leg.unloadPoint}`}>
                              <span className="truncate text-xs text-slate-600">
                                Плечо {leg.seq}: {leg.loadPoint} → {leg.unloadPoint}
                              </span>
                              {(leg.cargoSource === 'ati' || !!leg.dealId) && (
                                <Pill className="shrink-0 bg-violet-100 text-violet-700" title="Плечо груза с биржи ATI.SU — сделка в разделе ATI.SU">ATI.SU</Pill>
                              )}
                            </div>
                            <StatusChip status={leg.status} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <p className="text-sm text-slate-600">
                        {d === 'quarantine'
                          ? 'Заявка в карантине: сначала исправьте документ в 1С.'
                          : d === 'new'
                            ? 'Проверьте заявку и переведите её в план — после этого можно назначать состав.'
                            : 'Заявка проверена. Назначьте состав из собственного парка АЭМЗ — создастся рейс.'}
                      </p>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-600">
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" aria-hidden />
                        Состав назначается только из собственного парка АЭМЗ — тягачи, прицепы и штатные водители
                        из «Справочников». Привлечённый транспорт в контуре не используется.
                      </div>
                    </div>
                  )}
                </div>

                {/* Умный подбор: кто и какой рейс подойдёт под заявку */}
                {(d === 'new' || d === 'ready_to_plan') && (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Sparkles className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Умный подбор — кто и какой рейс подойдёт
                      </span>
                      <InfoTip label="Как считается подбор">
                        Подбор по дате и времени погрузки (успевает ли к окну), географии (порожний пробег от точки
                        освобождения до пункта погрузки), весу груза из строк 1С против ёмкости тягача, срокам ВУ
                        и техосмотра на весь период рейса, онлайн-статусу водителя из «Мониторинга» и закреплению
                        состава (водитель ↔ тягач ↔ прицеп — «родная» машина в приоритете). Балл 100 — идеальное
                        совпадение. Состав — только из собственного парка АЭМЗ.
                      </InfoTip>
                      {matchLoading && <span className="text-xs text-slate-400">считаем варианты…</span>}
                    </div>

                    {d === 'new' && (
                      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
                        Заявка ещё не проверена. Переведите её в план — и подходящий состав назначится из подсказки в один клик.
                        <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => markReady(o.id)}>В план</Button>
                      </div>
                    )}

                    {match && (
                      <div className="space-y-3">
                        <div className="text-xs text-slate-500">
                          Считаем под погрузку {fmtCreated(match.order.loadAt)} · груз {match.order.weightT.toLocaleString('ru-RU')} т{' '}
                          ({match.order.weightSource === 'lines' ? 'строки 1С' : 'оценка'})
                        </div>

                        {/* Рейсы в работе: добавить заявку плечом */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                            <Route className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                            Рейсы в работе — добавить заявку плечом
                          </div>
                          {match.trips.length === 0 ? (
                            <div className="text-xs text-slate-400">
                              Подходящих рейсов нет: машины не успевают к окну погрузки или далеко от пункта погрузки
                            </div>
                          ) : (
                            match.trips.map((c) => (
                              <MatchCandidateCard
                                key={c.tripId}
                                cand={c}
                                orderId={o.id}
                                actionLabel="Добавить к рейсу"
                                onAction={appendOrder}
                                onPin={togglePin}
                                disabled={d !== 'ready_to_plan'}
                                busy={appendBusy}
                                pinBusy={pinBusy}
                              />
                            ))
                          )}
                        </div>

                        {/* Свободный состав: новый рейс */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                            <Truck className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                            Свободный состав — новый рейс
                          </div>
                          {match.compositions.length === 0 ? (
                            <div className="text-xs text-slate-400">Свободного состава под вес заявки нет</div>
                          ) : (
                            match.compositions.map((c) => (
                              <MatchCandidateCard
                                key={c.driver.id}
                                cand={c}
                                orderId={o.id}
                                actionLabel="Назначить состав"
                                onAction={(cc) => openPlan(o, { vehicleId: cc.vehicle.id, trailerId: cc.trailer?.id, driverId: cc.driver.id })}
                                onPin={togglePin}
                                disabled={d !== 'ready_to_plan'}
                                busy={false}
                                pinBusy={pinBusy}
                              />
                            ))
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                          <span>Рейсов в работе: <b className="text-slate-600">{match.meta.activeTrips}</b></span>
                          <span>свободных водителей: <b className="text-slate-600">{match.meta.freeDrivers}</b></span>
                          <span>свободных тягачей: <b className="text-slate-600">{match.meta.freeVehicles}</b></span>
                          {match.meta.notes.map((n, i) => (
                            <span key={i} className="text-slate-500">{n}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {!match && !matchLoading && <div className="text-xs text-slate-400">Подбор сейчас недоступен — обновите карточку</div>}
                  </div>
                )}

                {/* Действия по статусу заявки */}
                <DialogFooter className="gap-2">
                  {d === 'new' && (
                    <Button size="sm" variant="outline" onClick={() => markReady(o.id)}>Перевести в план</Button>
                  )}
                  {d === 'ready_to_plan' && (
                    <Button size="sm" className="bg-[#0E1B2C] text-white hover:bg-[#16304f]" onClick={() => openPlan(o)}>
                      <Truck className="h-3.5 w-3.5" />Назначить состав
                    </Button>
                  )}
                  {(d === 'planned' || d === 'in_trip' || d === 'done') && link && (
                    <Button size="sm" className="bg-[#0E1B2C] text-white hover:bg-[#16304f]" onClick={() => { setOpenCardId(null); setTripViewId(link.trip.id) }}>
                      <ClipboardList className="h-3.5 w-3.5" />Карточка рейса
                    </Button>
                  )}
                  {d === 'quarantine' && (
                    <Button size="sm" variant="outline" onClick={() => markReady(o.id)}>Исправлено</Button>
                  )}
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Диалог назначения состава из собственного парка */}
      <Dialog open={!!planOrder} onOpenChange={(v) => !v && setPlanOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Назначение состава из собственного парка АЭМЗ</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {planOrder && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <span className="font-mono text-xs font-semibold">{planOrder.number}</span> · {planOrder.customer} · {planOrder.product}
                <div className="mt-1 text-xs text-slate-500">{planOrder.loadPoint} → {planOrder.unloadPoint}</div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Тягач (собственный парк, не в ремонте)</Label>
              <Select value={planVehicle} onValueChange={setPlanVehicle}>
                <SelectTrigger><SelectValue placeholder="Выберите ТС" /></SelectTrigger>
                <SelectContent>
                  {state.vehicles.filter((v) => v.ownership !== 'held').map((v) => {
                    const busyV = state.trips.some((t) => t.status === 'active' && t.vehicleId === v.id) || v.isRepair
                    return (
                      <SelectItem key={v.id} value={v.id} disabled={busyV}>
                        {v.brand} ({v.plate}){v.isRepair ? ' — в ремонте' : busyV ? ' — в рейсе' : ''}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Прицеп (собственный парк, необязательно)</Label>
              <Select value={planTrailer} onValueChange={setPlanTrailer}>
                <SelectTrigger><SelectValue placeholder="Без прицепа" /></SelectTrigger>
                <SelectContent>
                  {state.trailers.map((t) => {
                    const busyT = state.trips.some((tr) => tr.status === 'active' && tr.trailerId === t.id)
                    return (
                      <SelectItem key={t.id} value={t.id} disabled={busyT}>
                        {t.brand} ({t.plate}) · {t.type}{busyT ? ' — в рейсе' : ''}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Водитель (штатный состав)</Label>
              <Select value={planDriver} onValueChange={pickPlanDriver}>
                <SelectTrigger><SelectValue placeholder="Выберите водителя" /></SelectTrigger>
                <SelectContent>
                  {state.drivers.filter((d) => d.status === 'active').map((d) => {
                    const busyD = state.trips.some((t) => t.status === 'active' && t.driverId === d.id)
                    return (
                      <SelectItem key={d.id} value={d.id} disabled={busyD}>
                        {d.fullName}{busyD ? ' — в рейсе' : ''}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Закрепление состава за водителем: подстановка и управление */}
            {planDriver && (() => {
              const v = planBinding?.vehicle
              const selMatches = !!planBinding && planBinding.vehicleId === planVehicle
                && (planBinding.trailerId ?? null) === (planTrailer || null)
              if (!planBinding || !v) {
                return (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                    <Pin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                    За водителем не закреплена машина — при желании закрепите выбранный состав, тогда подбор всегда будет предлагать его первым
                    <Button
                      size="sm" variant="outline" className="ml-auto h-7" disabled={!planVehicle || pinBusy}
                      onClick={() => void pinPlanSelection()}
                    >
                      <Pin className="mr-1 h-3 w-3" aria-hidden />Закрепить выбранный состав
                    </Button>
                  </div>
                )
              }
              if (selMatches) {
                return (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                    <Pin className="h-3.5 w-3.5 shrink-0 fill-slate-700 text-slate-900" aria-hidden />
                    <span>
                      Закреплённый состав подставлен: <b>{v.brand} ({v.plate})</b>
                      {planBinding?.trailer ? <> · прицеп <b>{planBinding.trailer.plate}</b></> : ' · без прицепа'}
                    </span>
                    <Button
                      size="sm" variant="outline" className="ml-auto h-7" disabled={pinBusy}
                      onClick={async () => {
                        setPinBusy(true)
                        try {
                          const res = await authFetch('/api/bindings', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'unpin', driverId: planDriver }),
                          })
                          if (res.ok) {
                            toast({ title: 'Закрепление снято', description: 'Подбор больше не отдаёт приоритет этому составу' })
                            onChanged()
                          }
                        } finally {
                          setPinBusy(false)
                        }
                      }}
                    >
                      Открепить
                    </Button>
                  </div>
                )
              }
              return (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
                  <span>
                    Водитель закреплён за <b>{v.brand} ({v.plate})</b>
                    {planBinding?.trailer ? <> · прицеп <b>{planBinding.trailer.plate}</b></> : ''} — выбран другой состав
                  </span>
                  <div className="ml-auto flex gap-2">
                    <Button
                      size="sm" variant="outline" className="h-7" disabled={pinBusy}
                      onClick={() => {
                        setPlanVehicle(planBinding!.vehicleId)
                        setPlanTrailer(planBinding!.trailerId ?? '')
                      }}
                    >
                      Подставить закреплённые
                    </Button>
                    <Button
                      size="sm" variant="outline" className="h-7" disabled={!planVehicle || pinBusy}
                      onClick={() => void pinPlanSelection()}
                    >
                      Перекрепить на выбранный
                    </Button>
                  </div>
                </div>
              )
            })()}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <ArrowDownUp className="mr-1 inline h-3.5 w-3.5 text-emerald-600" aria-hidden />
              Состав назначается только из собственного парка АЭМЗ — транспорт, прицепы и водители штатные.
              После назначения создаётся рейс, заявка получает статус «Запланирована», а с выездом
              на погрузку — «В рейсе».
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanOrder(null)}>Отмена</Button>
            <Button onClick={applyPlan} disabled={busy}>Назначить и создать рейс</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
