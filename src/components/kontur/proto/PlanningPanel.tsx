'use client'

/**
 * Раздел «Планирование» — единый экран работы парка АЭМЗ с двумя видами одной доски:
 *
 *   «Сейчас» — вертикальный срез «кто чем занят» (бывший раздел «Занятость»):
 *   статусы водителей выводятся из данных платформы, звонки, отметки
 *   недоступности, «Готовность · 7 дней», «Техника». Вид доступен по праву
 *   section:ownOccupancy (право прежнего раздела сохранено).
 *
 *   «График» — горизонтальный срез «во времени»: доска Ганта 3/7 дней, рейсы
 *   полосами от погрузки до возврата на базу, ручной план логиста (✓/↺/×),
 *   планирование кликом по дорожке, «+» в шапке дня, «Ждут состава».
 *
 * Общее у видов: один поиск (водитель/госномер/маршрут), общие фильтры-чипы
 * и одна лента KPI-плиток (7 плиток вместо прежних 16) — клик по плитке
 * фильтрует текущий вид, а «Недоступны»/«Просрочено» сами переключают вид.
 * Одна общая колонка «Ждёт планирования»: заявки 1С + сделки ATI.SU + грузы
 * в плане + обратки. Вид запоминается в браузере (localStorage).
 *
 * СИСТЕМА ПРОСРОЧКИ (вид «График»): событие, чей срок прошёл, а факт не закрыт,
 * ПУЛЬСИРУЕТ И СВЕТИТСЯ КРАСНЫМ — погрузка/выгрузка рейса без факта, план
 * логиста без отметки «выполнено», груз без состава с истёкшим окном.
 * Закрытое событие становится СЕРЫМ — «прошло и всё в порядке».
 *
 * Расчёт времён — общий движок src/lib/kontur/planner.ts, поэтому «Заявки»,
 * доска «Сейчас» и график сходятся в одну картину и никогда не расходятся.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import {
  CalendarClock, CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, ClipboardList, FileCheck2,
  Hourglass, Inbox, ListChecks, Plus, RefreshCw, RotateCcw, Search, X,
} from 'lucide-react'
import { Card, CardContent } from '@/components/kontur/ui/card'
import { Button } from '@/components/kontur/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/kontur/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/kontur/ui/select'
import { Input } from '@/components/kontur/ui/input'
import { InfoTip, Pill } from '@/components/kontur/proto/bits'
import { KpiTile } from '@/components/platform/common'
import { PlanDealDialog } from '@/components/kontur/proto/PlanDealDialog'
import { PlanEntryDialog, isoDate } from '@/components/kontur/proto/PlanEntryDialog'
import { buildPlan, fmtWhen, type PlanResult } from '@/lib/kontur/planner'
import { tripFrees } from '@/lib/kontur/availability'
import { authFetch } from '@/lib/kontur/session-token'
import { useCan } from '@/components/platform/perms'
import { useToast } from '@/hooks/use-toast'
import type { AtiDealDto, Driver, StateResponse } from '@/lib/kontur/client-types'
import { OccupancyBoard, OFF_META, type BusyRow, type PlanChip, type WeekDay } from '@/components/kontur/proto/OccupancyPanel'

const DAY_MS = 86400000
const HOUR_MS = 3600000
const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full'

function shortName(full: string): string {
  const [fam, im, ot] = full.split(' ')
  return ot ? `${fam} ${im?.[0] ?? ''}.${ot[0]}.` : im ? `${fam} ${im[0]}.` : fam
}

/** Русское множественное число: 1 состав / 2 состава / 5 составов */
function pluralSostav(n: number): string {
  const d10 = n % 10
  const d100 = n % 100
  if (d10 === 1 && d100 !== 11) return 'состав'
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'состава'
  return 'составов'
}

function fmtHM(ms: number): string {
  return new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function fmtDM(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
}

/**
 * Просрочена ли запись плана логиста: срок прошёл (30 минут допуска для
 * точного времени, конец дня — для «в течение дня»), а закрытия (факта) нет.
 * Единая формула для плитки «Просрочено», бейджа строки и списка планов.
 */
function manualEntryOverdue(p: { date: string; time?: string | null; closedAt?: string | null }, now: number): boolean {
  if (p.closedAt) return false
  const [y, m, dd] = p.date.split('-').map(Number)
  const dayStart = new Date(y, m - 1, dd).getTime()
  const ms = p.time
    ? dayStart + Number(p.time.slice(0, 2)) * HOUR_MS + Number(p.time.slice(3, 5)) * 60000
    : dayStart + 12 * HOUR_MS
  const deadline = p.time ? ms + 30 * 60000 : dayStart + DAY_MS
  return deadline < now
}

// ——— раскраска полос графика ———

type SegKind = 'deadhead' | 'load' | 'run1c' | 'runAti' | 'unload' | 'base'

/** Состояние события: впереди/сейчас · прошло и закрыто (серое) · просрочка (красный пульс) */
export type SegState = 'active' | 'done' | 'overdue'

/**
 * Высота блока кодирует тип («брус» — движение, «квадрат» — операция),
 * цвет — состояние: рабочие цвета — впереди; серое — прошло и закрыто;
 * красное с пульсом — срок прошёл, а факт не закрыт (просрочка).
 */
function segCls(kind: SegKind, state: SegState): string {
  const square = kind === 'load' || kind === 'unload'
  if (state === 'overdue') {
    return `${square ? 'h-6 min-w-[12px] rounded-[5px]' : 'h-5 rounded-full'} bg-red-500 shadow-sm anim-overdue`
  }
  if (state === 'done') {
    if (kind === 'deadhead') return 'h-4 rounded-full border border-dashed border-slate-300 bg-slate-100'
    if (square) return 'h-6 min-w-[12px] rounded-[5px] bg-slate-300 shadow-sm'
    return 'h-5 rounded-full bg-slate-300'
  }
  switch (kind) {
    case 'load':
      return 'h-6 min-w-[12px] rounded-[5px] bg-blue-500 shadow-sm'
    case 'unload':
      return 'h-6 min-w-[12px] rounded-[5px] bg-amber-500 shadow-sm'
    case 'run1c':
      return 'h-5 rounded-full bg-emerald-500'
    case 'runAti':
      return 'h-5 rounded-full bg-violet-500'
    case 'base':
      return 'h-5 rounded-full bg-teal-600'
    case 'deadhead':
      return 'h-4 rounded-full border border-dashed border-slate-400 bg-slate-200'
  }
}

/** Метка плана логиста: синий пунктир (впереди) · красный пульс (просрочка) · серое (выполнено) */
function manualCls(state: SegState): string {
  if (state === 'overdue') return 'border-red-400 bg-red-50 text-red-700 shadow-sm anim-overdue'
  if (state === 'done') return 'border-slate-300 bg-slate-50 text-slate-400'
  return 'border-dashed border-blue-400 bg-white/95 text-blue-800 shadow-sm'
}

const LANE_STATUS: Record<string, { dot: string; label: string }> = {
  on_trip: { dot: 'bg-emerald-500', label: 'на линии' },
  assigned: { dot: 'bg-blue-600', label: 'по плану' },
  free: { dot: 'bg-slate-300', label: 'на базе' },
}

const MANUAL_KIND_LABEL: Record<string, string> = {
  load: 'Погрузка',
  unload: 'Выгрузка',
  return: 'Возврат на АЭМЗ',
  note: 'Заметка',
}

/** Вид раздела: «Сейчас» (доска занятости) или «График» (Гант). Запоминается в браузере */
type PlanView = 'now' | 'gantt'
const VIEW_STORAGE_KEY = 'aemz.plan.view'

// ——— модель строки графика ———

type Seg = {
  key: string
  kind: SegKind
  start: number // ms, обрезано окном
  end: number
  ms: number // исходное начало (для метки времени)
  label: string // текст внутри полосы — только если влезает
  title: string
  tripId?: string
  state: SegState // активная · серое «прошло-закрыто» · красный пульс «просрочка»
  showLabel: boolean
  timeLabel: number | null // px-позиция метки времени над блоком; null — скрыть
}

type Manual = { id: string; ms: number; time: string | null; label: string; title: string; state: SegState }

type Lane = {
  driverId: string
  name: string
  sub: string
  status: 'on_trip' | 'assigned' | 'free'
  overdueCount: number // просроченных событий (рейсы + план логиста) — бейдж «!N»
  segs: Seg[]
  manuals: Manual[]
}

type Ghost = {
  key: string
  ms: number
  time: string | null
  overdue: boolean // окно погрузки прошло, а состава всё нет
  tip: string
  cls: string
  labelCls: string
  onClick: () => void
  labelX: number | null
}

// ——— объединённый раздел ———

export function PlanningPanel({ state, onChanged, onOpenTrip, onOpenAtiDeals, onFindOrder }: {
  state: StateResponse
  onChanged: () => void
  onOpenTrip: (tripId: string) => void
  onOpenAtiDeals: () => void
  onFindOrder: (number: string) => void
}) {
  const { toast } = useToast()
  const can = useCan()
  // право прежнего раздела «Занятость» теперь открывает вид «Сейчас»;
  // без него раздел открывается сразу в виде «График»
  const canOccupy = can('section:ownOccupancy')
  const [nowTick, setNowTick] = useState(() => Date.now())
  // общий поиск раздела: фильтрует и доску «Сейчас», и дорожки графика
  const [query, setQuery] = useState('')
  // общий фильтр-чип раздела
  const [chip, setChip] = useState<PlanChip>('all')
  // вид доски: «Сейчас» или «График» (запоминается; без права ownOccupancy — только «График»)
  const [view, setView] = useState<PlanView>('now')

  // ——— диалог «Отметить недоступность» (общая база со «Справочниками») ———
  const [markOpen, setMarkOpen] = useState(false)
  const [markDriver, setMarkDriver] = useState<Driver | null>(null)
  const [markKind, setMarkKind] = useState('sick')
  const [markComment, setMarkComment] = useState('')
  const [markQuery, setMarkQuery] = useState('')
  const [markBusy, setMarkBusy] = useState(false)
  // ——— диалог «В план» (назначение состава на груз ATI.SU) и «Запланировать работу» ———
  const [planDeal, setPlanDeal] = useState<AtiDealDto | null>(null)
  const [entryOpen, setEntryOpen] = useState(false)
  const [entryDate, setEntryDate] = useState(() => isoDate(new Date()))
  const [entryDriverId, setEntryDriverId] = useState<string | null>(null)
  const [unplanBusy, setUnplanBusy] = useState<string | null>(null)

  // тик каждую минуту: моменты «освободится», «обновлено» и линия «сейчас» не протухают
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  // вид запоминается: восстанавливаем выбор браузера; без права на «Сейчас» — только «График»
  useEffect(() => {
    if (!canOccupy) {
      setView('gantt')
      return
    }
    let saved: string | null = null
    try { saved = localStorage.getItem(VIEW_STORAGE_KEY) } catch { /* приватный режим */ }
    if (saved === 'now' || saved === 'gantt') setView(saved)
  }, [canOccupy])

  // единый план с «Заявками», ATI.SU и доской занятости: один движок (src/lib/kontur/planner.ts)
  const plan = useMemo(() => buildPlan(state, nowTick), [state, nowTick])

  // ——— разбор занятости из рейсов (данные вида «Сейчас» и плиток) ———
  const ordersById = useMemo(() => new Map(state.orders.map((o) => [o.id, o])), [state.orders])
  const dealById = useMemo(() => new Map(state.deals.map((d) => [d.id, d])), [state.deals])
  const bindingByDriver = useMemo(() => new Map(state.bindings.map((b) => [b.driverId, b])), [state.bindings])
  const vehicleById = useMemo(() => new Map(state.vehicles.map((v) => [v.id, v])), [state.vehicles])
  const trailerById = useMemo(() => new Map(state.trailers.map((t) => [t.id, t])), [state.trailers])

  const busy = useMemo<BusyRow[]>(() => {
    const now = new Date(nowTick)
    const rows: BusyRow[] = []
    for (const trip of state.trips) {
      if (trip.status !== 'active' && trip.status !== 'draft') continue
      const open = [...trip.legs].sort((a, b) => a.seq - b.seq).filter((l) => l.status !== 'completed' && l.status !== 'cancelled')
      const frees = tripFrees(trip.legs, now)
      const order = open[0]?.orderId ? ordersById.get(open[0].orderId!) : null
      // груз с биржи ATI.SU — заказчик = грузовладелец из сделки (плечо с dealId)
      const deal = open[0]?.dealId ? dealById.get(open[0].dealId!) : null
      rows.push({
        kind: trip.status === 'active' ? 'on_trip' : 'assigned',
        trip,
        curLeg: open[0] ?? null,
        freesAt: frees ? frees.at : null,
        freesPoint: frees ? frees.point : null,
        customer: order?.customer ?? deal?.carrierFirm ?? null,
      })
    }
    // кто освободится раньше — тот выше
    rows.sort((a, b) => (a.freesAt?.getTime() ?? Infinity) - (b.freesAt?.getTime() ?? Infinity))
    return rows
  }, [state.trips, ordersById, dealById, nowTick])

  const busyDriverIds = useMemo(() => new Set(busy.map((r) => r.trip.driverId)), [busy])

  // Водитель без рейса на сломанной технике — фактически недоступен
  function repairReason(driverId: string): string | null {
    const b = bindingByDriver.get(driverId)
    if (!b) return null
    if (vehicleById.get(b.vehicleId)?.isRepair) return `тягач в ремонте · ${vehicleById.get(b.vehicleId)!.plate}`
    if (b.trailerId && trailerById.get(b.trailerId)?.isRepair) return `прицеп в ремонте · ${trailerById.get(b.trailerId)!.plate}`
    return null
  }

  // ——— свободный резерв: активные водители без рейса и на исправной технике ———
  const free = useMemo(() => {
    const rows = state.drivers.filter((d) => d.status === 'active' && !busyDriverIds.has(d.id) && repairReason(d.id) == null)
    rows.sort((a, b) => {
      const pa = bindingByDriver.has(a.id) ? 0 : 1
      const pb = bindingByDriver.has(b.id) ? 0 : 1
      return pa - pb || a.fullName.localeCompare(b.fullName, 'ru')
    })
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.drivers, busyDriverIds, bindingByDriver, vehicleById, trailerById])

  // ——— недоступные: отметки справочника + водители без рейса на сломанной технике ———
  const off = useMemo(() => {
    const rows = state.drivers.filter((d) => {
      if (d.status !== 'active') return true
      if (busyDriverIds.has(d.id)) return false
      return repairReason(d.id) != null
    })
    // человек-причина важнее техники: у отмеченных — их статус, у остальных — ремонт
    return rows.sort((a, b) => (a.status === 'active' ? 1 : 0) - (b.status === 'active' ? 1 : 0) || a.fullName.localeCompare(b.fullName, 'ru'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.drivers, busyDriverIds, bindingByDriver, vehicleById, trailerById])

  const counts = useMemo(() => ({
    on_trip: busy.filter((r) => r.kind === 'on_trip').length,
    assigned: busy.filter((r) => r.kind === 'assigned').length,
    free: free.length,
    off: off.length,
    total: state.drivers.length,
  }), [busy, free, off, state.drivers.length])

  // ——— недельная готовность: сколько составов вернётся по дням ———
  // плюс плановые погрузки по дням (заявки 1С + грузы ATI.SU) — фиолетовой полосой
  const week = useMemo<WeekDay[]>(() => {
    const start = new Date(nowTick); start.setHours(0, 0, 0, 0)
    const days = Array.from({ length: 7 }, (_, i) => {
      const from = new Date(start); from.setDate(from.getDate() + i)
      const to = new Date(from); to.setDate(to.getDate() + 1)
      const n = busy.filter((r) => r.freesAt && r.freesAt >= from && r.freesAt < to).length
      const loads = plan.rows.reduce(
        (acc, r) => acc + r.events.filter((e) => e.kind === 'load' && e.start >= from.getTime() && e.start < to.getTime()).length,
        0,
      )
      return { from, n, loads, today: i === 0 }
    })
    return days
  }, [busy, plan, nowTick])

  // ——— сводка просрочки: события рейсов без факта + планы логиста + грузы без состава ———
  const overdueManuals = useMemo(
    () => state.planEntries.filter((p) => manualEntryOverdue(p, nowTick)).length,
    [state.planEntries, nowTick],
  )
  const overdueWaiting = useMemo(
    () => [...plan.waitingDeals, ...plan.waitingOrders].filter((w) => w.loadAt != null && w.loadAt + 12 * HOUR_MS < nowTick).length,
    [plan, nowTick],
  )
  const overdueTotal = plan.summary.overdue + overdueManuals + overdueWaiting
  const waitingCount = plan.waitingDeals.length + plan.waitingOrders.length
  const repairCount = state.vehicles.filter((v) => v.isRepair).length + state.trailers.filter((t) => t.isRepair).length
  const backhaulRows = plan.rows.filter((r) => r.awaitingBackhaul)

  const showNow = canOccupy && view === 'now'

  function switchView(next: PlanView) {
    if (next === 'now' && !canOccupy) return
    setView(next)
    // фильтры вида: «Недоступны» есть только на доске, «Просрочка» — только в графике
    if (next === 'gantt' && chip === 'off') setChip('all')
    if (next === 'now' && chip === 'overdue') setChip('all')
    try { localStorage.setItem(VIEW_STORAGE_KEY, next) } catch { /* приватный режим */ }
  }

  // ——— отметка недоступности / возврат в строй (общая база со «Справочниками») ———
  function openMark(d: Driver | null) {
    setMarkDriver(d)
    setMarkKind(d && d.status !== 'active' ? d.status : 'sick')
    setMarkComment(d?.statusComment ?? '')
    setMarkQuery('')
    setMarkOpen(true)
  }
  function closeMark() {
    setMarkOpen(false)
    setMarkDriver(null)
    setMarkComment('')
    setMarkQuery('')
  }

  async function patchDriverStatus(id: string, status: string, statusComment: string, name: string) {
    setMarkBusy(true)
    try {
      const res = await authFetch('/api/directory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'driver', id, status, statusComment }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
      toast({ title: status === 'active' ? `${name} — снова в строю` : `${name}: ${OFF_META[status]?.label.toLowerCase() ?? status}`, description: statusComment || undefined })
      closeMark()
      onChanged()
    } catch (e) {
      toast({ title: 'Не удалось сохранить отметку', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setMarkBusy(false)
    }
  }

  function openEntry(iso: string, driverId?: string) {
    setEntryDate(iso)
    setEntryDriverId(driverId ?? null)
    setEntryOpen(true)
  }

  // ——— снять груз ATI.SU с плана (плечо отменится, состав освободится) ———
  async function unplan(dealId: string, label: string) {
    setUnplanBusy(dealId)
    try {
      const res = await authFetch('/api/atisu/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unplan', dealId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
      toast({ title: 'Груз снят с плана', description: `${label} · ${json?.message ?? ''}` })
      onChanged()
    } catch (e) {
      toast({ title: 'Не удалось снять груз с плана', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setUnplanBusy(null)
    }
  }

  // ——— общая колонка «Ждёт планирования»: сделки ATI.SU + заявки 1С + грузы в плане + обратки ———
  const waitingColumn = (
    <div className="space-y-4">
      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardContent className="space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
            <ClipboardList className="h-4 w-4 text-slate-400" aria-hidden />
            Ждёт планирования
            <Pill className="bg-slate-100 text-slate-600">{waitingCount}</Pill>
            {plan.plannedDeals.length > 0 && (
              <Pill className="bg-violet-100 text-violet-700" title="Грузы ATI.SU, уже назначенные составом">в плане {plan.plannedDeals.length}</Pill>
            )}
            <InfoTip label="Что здесь">
              Согласованные на бирже грузы ATI.SU «в силе» (кнопка «В план» назначает состав —
              общий подбор с «Заявками»), заявки 1С в статусе «к планированию» и грузы,
              уже назначенные составом («в плане» — кнопка «Снять» освободит состав).
              Предварительные сделки ждут обмена документами. Назначенный груз занимает
              состав на доске «Сейчас» и появляется полосой в графике. Их же видно
              пунктиром в строке «Ждут состава» на графике.
            </InfoTip>
            <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={onOpenAtiDeals} title="Все сделки в разделе ATI.SU · Мои заявки">
              Все сделки
            </Button>
          </div>

          {waitingCount === 0 && plan.plannedDeals.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
              Незапланированной работы нет — всё назначено
            </div>
          ) : (
            <div className={`grid grid-cols-1 gap-1.5 md:grid-cols-2 ${THIN_SCROLL} max-h-80 overflow-y-auto pr-1`}>
              {plan.waitingDeals.map((w) => {
                const full = w.deal.stage === 'full'
                return (
                  <div key={w.deal.id} className="rounded-lg border border-slate-100 px-2.5 py-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs font-semibold text-slate-900">
                        {w.deal.from} → {w.deal.to}
                      </span>
                      <Pill className={full ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-700'} title={full ? 'Документы обменяны — заявка в силе' : 'Предварительное согласование — дождитесь обмена документами'}>
                        {full ? 'ATI.SU · в силе' : 'ATI.SU · док-ты не обменяны'}
                      </Pill>
                      <span className="ml-auto shrink-0 text-[10px] text-slate-400">{fmtWhen(w.loadAt, nowTick)}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                      <span className="truncate">{w.deal.cargo}{w.deal.weightT != null ? ` · ${w.deal.weightT} т` : ''}</span>
                      {w.deal.rate != null && <span className="font-medium text-slate-700">{w.deal.rate.toLocaleString('ru-RU')} ₽</span>}
                    </div>
                    {full && (
                      <div className="mt-1.5 flex gap-1.5">
                        <Button
                          size="sm"
                          className="h-7 bg-slate-900 px-2.5 text-xs text-white hover:bg-slate-700"
                          onClick={() => setPlanDeal(w.deal)}
                          title="Назначить состав: свободный или освобождающийся — общий подбор с «Заявками»"
                        >
                          <CalendarPlus className="mr-1 h-3 w-3" aria-hidden />В план
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={onOpenAtiDeals} title="Открыть сделку в разделе ATI.SU">
                          Сделка
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
              {plan.waitingOrders.map((w) => (
                <div key={w.order.id} className="rounded-lg border border-slate-100 px-2.5 py-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs font-semibold text-slate-900">
                      {w.order.loadPoint.split(',')[0]} → {w.order.unloadPoint.split(',')[0]}
                    </span>
                    <Pill className="bg-slate-100 text-slate-600">заявка {w.order.number}</Pill>
                    <span className="ml-auto shrink-0 text-[10px] text-slate-400">{fmtWhen(w.loadAt, nowTick)}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                    <span className="truncate">{w.order.customer} · {w.order.product}</span>
                  </div>
                  <div className="mt-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2.5 text-xs"
                      onClick={() => onFindOrder(w.order.number)}
                      title="Открыть заявку в разделе «Заявки»: проверка и назначение состава"
                    >
                      <Inbox className="mr-1 h-3 w-3" aria-hidden />К заявке
                    </Button>
                  </div>
                </div>
              ))}
              {plan.plannedDeals.length > 0 && (
                <div className="col-span-full flex items-center gap-1.5 pt-1 text-[11px] font-bold text-violet-700">
                  <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
                  ATI.SU · в плане
                  <Pill className="bg-violet-100 text-violet-700">{plan.plannedDeals.length}</Pill>
                </div>
              )}
              {plan.plannedDeals.map((w) => (
                <div key={w.deal.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-violet-100 bg-violet-50/40 px-2.5 py-1.5">
                  <span className="text-xs font-semibold text-slate-900">
                    {w.deal.from} → {w.deal.to}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{w.driverName ? shortName(w.driverName) : '—'}</span>
                  {w.tripId && (
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => onOpenTrip(w.tripId!)} title="Карточка рейса в «Заявках»">
                      Рейс
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] text-slate-400 hover:text-red-700"
                    disabled={unplanBusy === w.deal.id}
                    onClick={() => void unplan(w.deal.id, `${w.deal.from} → ${w.deal.to}`)}
                    title="Снять груз с состава: плечо отменится, состав освободится"
                  >
                    Снять
                  </Button>
                </div>
              ))}
            </div>
          )}
          {plan.newOrders > 0 && (
            <p className="text-[11px] text-slate-500">
              Новых заявок из 1С: {plan.newOrders} — сначала проверьте их в «Заявках».
            </p>
          )}
        </CardContent>
      </Card>

      {/* Напоминание про возвраты, ждущие обратки (общее для обоих видов) */}
      {backhaulRows.length > 0 && (
        <Card className="rounded-xl border-slate-200 shadow-sm">
          <CardContent className="space-y-1.5 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Hourglass className="h-4 w-4 text-amber-500" aria-hidden />
              Ждут обратную загрузку
              <Pill className="bg-amber-100 text-amber-700">{backhaulRows.length}</Pill>
              <InfoTip label="Что здесь">
                Составы, которые после выгрузки остаются в пункте разгрузки без обратного
                груза: ищите обратку на бирже ATI.SU или догрузку из «Заявок» — до возврата
                на базу порожняком.
              </InfoTip>
            </div>
            {backhaulRows.map((r) => (
              <div key={r.driverId} className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-slate-50">
                <span className="w-32 shrink-0 truncate text-xs font-medium text-slate-800" title={r.driverName}>
                  {shortName(r.driverName)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">
                  {r.vehicleLabel.split(' · ')[1] ?? r.vehicleLabel} · после выгрузки в {r.events.filter((e) => e.kind === 'unload').slice(-1)[0]?.toPoint ?? '—'}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )

  const viewSegCls = (active: boolean) =>
    `h-8 px-3 text-xs font-medium transition-colors ${active ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`

  return (
    <div className="space-y-4">
      {/* Общая шапка раздела: заголовок, обновление, вид, поиск */}
      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <CalendarDays className="h-4 w-4 text-slate-400" aria-hidden />
            <span className="text-sm font-bold text-slate-900">Планирование · парк АЭМЗ</span>
            <Pill className="bg-slate-100 text-slate-600" title="Момент пересчёта доски и графика">
              обновлено {new Date(nowTick).toLocaleTimeString('ru-RU')}
            </Pill>
            <InfoTip label="Один экран: «Сейчас» и «График»">
              Раздел объединяет доску занятости (бывшая «Занятость») и график парка.
              Вид «Сейчас» — кто чем занят: статусы выводятся из уже заведённых данных
              («на линии», «назначен», «свободен», «недоступен»), звонки и отметки
              недоступности. Вид «График» — Гант 3/7 дней: рейсы полосами от погрузки
              до возврата, ручной план логиста, красный пульс — просрочка.
              Поиск, фильтры и плитки общие: клик по плитке фильтрует текущий вид,
              а «Недоступны» и «Просрочено» сами переключают вид. Увидели свободного
              водителя — переключились на график и запланировали работу в два клика.
            </InfoTip>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canOccupy && (
              <div className="flex overflow-hidden rounded-lg border border-slate-200" role="group" aria-label="Вид планирования">
                <button type="button" className={viewSegCls(showNow)} onClick={() => switchView('now')} title="Доска занятости: кто чем занят сейчас">
                  Сейчас
                </button>
                <button type="button" className={viewSegCls(!showNow)} onClick={() => switchView('gantt')} title="График парка: Гант 3/7 дней">
                  График
                </button>
              </div>
            )}
            <label className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Водитель, госномер, маршрут…"
                className="h-8 w-56 rounded-lg border border-slate-300 bg-white pl-8 pr-2 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                aria-label="Поиск по водителю, госномеру или маршруту"
              />
            </label>
            <Button size="sm" variant="outline" className="h-8" onClick={onChanged}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />Обновить
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Общие плитки-счётчики: одна лента на оба вида (7 вместо прежних 16) */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7" role="group" aria-label="Сводка планирования">
        <KpiTile value={counts.on_trip} label="В работе" dot="bg-emerald-500" hint="Составы на линии: активные рейсы из «Заявок»"
          active={chip === 'on_trip'} onClick={() => setChip(chip === 'on_trip' ? 'all' : 'on_trip')} />
        <KpiTile value={counts.assigned} label="Назначены" dot="bg-blue-600" hint="Рейсы составлены (включая грузы ATI.SU из плана), выезд по плану"
          active={chip === 'assigned'} onClick={() => setChip(chip === 'assigned' ? 'all' : 'assigned')} />
        <KpiTile value={counts.free} label="Свободны" dot="bg-slate-400" hint="В строю и без рейса — резерв для планирования (в графике — «на базе»)"
          active={chip === 'free'} onClick={() => setChip(chip === 'free' ? 'all' : 'free')} />
        <KpiTile value={counts.off} label="Недоступны" dot="bg-amber-500" hint="Отметки больничный/отпуск/отгул из справочника и водители на сломанной технике"
          active={showNow && chip === 'off'}
          onClick={canOccupy ? () => { if (!showNow) switchView('now'); setChip('off') } : undefined} />
        <KpiTile value={overdueTotal} label="Просрочено" dot="bg-red-500" hint="События, чей срок прошёл, а факт не закрыт: погрузки/выгрузки рейсов, планы логиста, грузы без состава. В графике пульсируют красным"
          active={!showNow && chip === 'overdue'}
          onClick={() => { if (showNow) switchView('gantt'); setChip('overdue') }} />
        <KpiTile value={waitingCount} label="Ждут планирования" dot="bg-violet-500" hint="Согласованные грузы ATI.SU без состава и заявки 1С «к планированию» — колонка «Ждёт планирования»" />
        <KpiTile value={repairCount} label="Ремонт" dot="bg-red-500" hint="Тягачи и прицепы с флагом ремонта в «Справочниках» — в назначение не попадают, пока флаг не снят"
          onClick={canOccupy ? () => { if (!showNow) switchView('now') } : undefined} />
      </div>

      {/* Доска выбранного вида: «Сейчас» — занятость, «График» — Гант */}
      {showNow ? (
        <OccupancyBoard
          state={state}
          nowTick={nowTick}
          busy={busy}
          free={free}
          off={off}
          counts={counts}
          week={week}
          query={query}
          filter={chip}
          onFilterChange={setChip}
          onOpenTrip={onOpenTrip}
          onMarkOpen={openMark}
          onPatchDriverStatus={(id, status, comment, name) => void patchDriverStatus(id, status, comment, name)}
          waitingColumn={waitingColumn}
        />
      ) : (
        <GanttBoard
          state={state}
          plan={plan}
          nowTick={nowTick}
          query={query}
          filter={chip}
          onFilterChange={setChip}
          onChanged={onChanged}
          onOpenTrip={onOpenTrip}
          onOpenAtiDeals={onOpenAtiDeals}
          onFindOrder={onFindOrder}
          onPlanDeal={(d) => setPlanDeal(d)}
          onOpenEntry={openEntry}
          waitingColumn={waitingColumn}
        />
      )}

      {/* Диалог «Запланировать работу» — ручной план на любую дату (график) */}
      <PlanEntryDialog
        open={entryOpen}
        initialDate={entryDate}
        initialDriverId={entryDriverId ?? undefined}
        state={state}
        onOpenChange={setEntryOpen}
        onDone={onChanged}
      />

      {/* Диалог «В план» — общий с «ATI.SU» и «Заявками»: назначение состава на груз */}
      <PlanDealDialog
        deal={planDeal}
        state={state}
        nowTick={nowTick}
        onOpenChange={(v) => { if (!v) setPlanDeal(null) }}
        onDone={() => onChanged()}
      />

      {/* Диалог отметки недоступности — общая база со «Справочниками» */}
      <Dialog open={markOpen} onOpenChange={(v) => { if (!v) closeMark() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {markDriver ? `Отметка недоступности — ${markDriver.fullName}` : 'Отметить недоступность водителя'}
            </DialogTitle>
          </DialogHeader>
          {!markDriver && (
            <div className="space-y-2">
              <Input value={markQuery} onChange={(e) => setMarkQuery(e.target.value)} placeholder="Поиск водителя…" className="h-9" />
              <div className={`max-h-44 space-y-0.5 overflow-y-auto pr-1 ${THIN_SCROLL}`}>
                {free.filter((d) => !markQuery.trim() || d.fullName.toLowerCase().includes(markQuery.trim().toLowerCase())).map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                    onClick={() => setMarkDriver(d)}
                  >
                    <span className="h-2 w-2 rounded-full bg-slate-400" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{d.fullName}</span>
                    <span className="shrink-0 text-xs text-slate-400">{bindingByDriver.get(d.id)?.vehicle?.plate ?? '—'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {markDriver && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-500">Причина</div>
                <Select value={markKind} onValueChange={setMarkKind}>
                  <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sick">Больничный</SelectItem>
                    <SelectItem value="vacation">Отпуск</SelectItem>
                    <SelectItem value="other">Отгул</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-500">Комментарий</div>
                <Input value={markComment} onChange={(e) => setMarkComment(e.target.value)} placeholder="Например: до 30 числа" className="h-9" />
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button size="sm" variant="ghost" onClick={closeMark}>Отмена</Button>
                <Button size="sm" className="h-8" disabled={markBusy}
                  onClick={() => markDriver && void patchDriverStatus(markDriver.id, markKind, markComment, markDriver.fullName)}>
                  <CalendarClock className="mr-1 h-3.5 w-3.5" />Отметить
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ——— вид «График»: доска Ганта ——

/**
 * График работы парка (бывший раздел «Планирование»): строки — ВСЕ составы парка
 * (занятые + свободный резерв; при большом парке — общий поиск раздела и быстрые
 * фильтры по статусу), время идёт слева направо, рейс — ОДНА непрерывная полоса
 * от погрузки до возврата на базу. Шапка дней и колонка составов ЗАКРЕПЛЕНЫ.
 * Планирование на любую дату: клик по свободному месту строки (день подставляется
 * сам, состав уже выбран), «+» в шапке дня или кнопка «Запланировать».
 */
function GanttBoard({ state, plan, nowTick, query, filter, onFilterChange, onChanged, onOpenTrip, onOpenAtiDeals, onFindOrder, onPlanDeal, onOpenEntry, waitingColumn }: {
  state: StateResponse
  plan: PlanResult
  nowTick: number
  query: string
  filter: PlanChip
  onFilterChange: (f: PlanChip) => void
  onChanged: () => void
  onOpenTrip: (tripId: string) => void
  onOpenAtiDeals: () => void
  onFindOrder: (number: string) => void
  /** открыть диалог «В план» для сделки ATI.SU (пунктир «ждут состава») */
  onPlanDeal: (deal: AtiDealDto) => void
  /** открыть диалог «Запланировать работу» на дату (и составу) */
  onOpenEntry: (iso: string, driverId?: string) => void
  waitingColumn: ReactNode
}) {
  const { toast } = useToast()
  const [span, setSpan] = useState<3 | 7>(3)
  const [startIso, setStartIso] = useState(() => isoDate(new Date()))
  const [removeBusy, setRemoveBusy] = useState<string | null>(null)
  const [closeBusy, setCloseBusy] = useState<string | null>(null)

  // окно графика: startIso 00:00 → +span дней (парсим локально, без UTC-сдвига)
  const startMs = useMemo(() => {
    const [y, m, d] = startIso.split('-').map(Number)
    return new Date(y, m - 1, d).getTime()
  }, [startIso])
  const winMs = span * DAY_MS
  const winEnd = startMs + winMs

  // ширина дорожки в px — для меток без наложения (меряем после монтирования)
  const laneRef = useRef<HTMLDivElement | null>(null)
  const [laneW, setLaneW] = useState(900)
  useEffect(() => {
    const update = () => setLaneW(laneRef.current?.clientWidth ?? 900)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [span])

  function shift(dir: -1 | 1) {
    setStartIso(isoDate(new Date(startMs + dir * span * DAY_MS)))
  }
  function goToday() {
    setStartIso(isoDate(new Date()))
  }

  // ——— колонки дней ———
  const days = useMemo(() => {
    const todayIso = isoDate(new Date(nowTick))
    return Array.from({ length: span }, (_, i) => {
      const ds = new Date(startMs + i * DAY_MS)
      const iso = isoDate(ds)
      const wd = ds.getDay()
      return {
        i,
        iso,
        wd: ds.toLocaleDateString('ru-RU', { weekday: 'short' }),
        dm: ds.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
        isToday: iso === todayIso,
        past: iso < todayIso,
        weekend: wd === 0 || wd === 6,
      }
    })
  }, [span, startMs, nowTick])

  // ——— дорожки составов: события рейсов + ручной план логиста ———
  const lanes = useMemo<Lane[]>(() => {
    // ручной план по водителям. Состояние записи считаем по ВСЕМ записям
    // (не только в окне графика): бейдж просрочки «!N» у строки должен гореть
    // и когда запись чуть за краем видимого окна
    const manualByDriver = new Map<string, Manual[]>()
    const overdueManualsByDriver = new Map<string, number>()
    for (const p of state.planEntries) {
      const [y, m, dd] = p.date.split('-').map(Number)
      const dayStart = new Date(y, m - 1, dd).getTime()
      const ms = p.time
        ? dayStart + Number(p.time.slice(0, 2)) * HOUR_MS + Number(p.time.slice(3, 5)) * 60000
        : dayStart + 12 * HOUR_MS // без времени — середина дня
      const closed = !!p.closedAt
      const overdue = manualEntryOverdue(p, nowTick)
      if (overdue) overdueManualsByDriver.set(p.driverId, (overdueManualsByDriver.get(p.driverId) ?? 0) + 1)
      if (ms < startMs || ms >= winEnd) continue
      const kindLabel = MANUAL_KIND_LABEL[p.kind] ?? p.kind
      const label =
        p.kind === 'note' ? (p.note?.trim() || 'Заметка')
        : p.kind === 'return' ? 'Возврат на АЭМЗ'
        : `${kindLabel} · ${p.point ?? '—'}`
      const man: Manual = {
        id: p.id,
        ms,
        time: p.time ?? null,
        label,
        state: closed ? 'done' : overdue ? 'overdue' : 'active',
        title:
          `${kindLabel}${p.point ? ` · ${p.point}` : ''}${p.note ? ` · ${p.note}` : ''}` +
          (closed
            ? ` · ВЫПОЛНЕНО${p.closedByName ? ` (${p.closedByName})` : ''}`
            : overdue
              ? ' · ПРОСРОЧКА: срок прошёл — закройте ✓ или снимите ×'
              : '') +
          ` · план логиста${p.createdByName ? ` (${p.createdByName})` : ''} · ✓ закрыть · × снять`,
      }
      const arr = manualByDriver.get(p.driverId) ?? []
      arr.push(man)
      manualByDriver.set(p.driverId, arr)
    }

    return plan.rows.map((r) => {
      const segs: Seg[] = []
      // оценка ширины текста text-[10px]: ~5.4px/символ + внутренние отступы
      const estPx = (t: string) => t.length * 5.4 + 14
      for (const e of r.events) {
        const start = Math.max(e.start, startMs)
        const end = Math.min(e.end, winEnd)
        if (end <= start) continue
        const kind: SegKind =
          e.kind === 'load' ? 'load'
          : e.kind === 'unload' ? 'unload'
          : e.kind === 'base_return' ? 'base'
          : e.kind === 'deadhead' ? 'deadhead'
          : e.source === 'ati' ? 'runAti' : 'run1c'
        const state: SegState = e.overdue ? 'overdue' : e.done ? 'done' : 'active'
        const wPx = ((end - start) / winMs) * laneW
        // подпись внутри полосы — только если точно влезает, без обрезки;
        // для узких полос хода — короткая форма «→ Город»
        let text = ''
        if (kind === 'run1c' || kind === 'runAti') {
          if (wPx >= estPx(e.label)) text = e.label
          else {
            const short = `→ ${e.label.split(' → ')[1] ?? ''}`
            if (wPx >= estPx(short)) text = short
          }
        } else if (kind === 'base') {
          if (wPx >= estPx('на базу')) text = 'на базу'
        } else if (kind === 'deadhead') {
          if (wPx >= estPx('порожняк')) text = 'порожняк'
        }
        segs.push({
          key: e.key,
          kind,
          start,
          end,
          ms: e.start,
          label: text,
          title: `${e.title}${e.fact ? ' · факт' : ''} · клик — карточка рейса`,
          tripId: e.tripId,
          state,
          showLabel: text !== '',
          timeLabel: null,
        })
      }
      // метки времени над блоками погрузки/выгрузки — слева направо, без наложения
      let lastRight = -Infinity
      for (const s of segs.filter((x) => x.kind === 'load' || x.kind === 'unload').sort((a, b) => a.ms - b.ms)) {
        const cx = ((s.ms - startMs) / winMs) * laneW
        if (cx < -30 || cx > laneW + 30) continue
        if (cx - lastRight >= 30) {
          s.timeLabel = Math.max(12, Math.min(laneW - 12, Math.max(0, cx)))
          lastRight = cx + 26
        }
      }
      return {
        driverId: r.driverId,
        name: r.driverName,
        sub: r.vehicleLabel,
        status: r.status,
        overdueCount: r.overdueCount + (overdueManualsByDriver.get(r.driverId) ?? 0),
        segs,
        manuals: (manualByDriver.get(r.driverId) ?? []).sort((a, b) => a.ms - b.ms),
      }
    })
  }, [plan, state.planEntries, startMs, winMs, winEnd, laneW, nowTick])

  // ——— грузы без состава (ждут назначения) — верхняя дорожка ———
  const ghosts = useMemo<Ghost[]>(() => {
    const list: Ghost[] = []
    // окно погрузки прошло больше полудня назад, а состава всё нет — просрочка
    const ghostOverdue = (ms: number) => ms + 12 * HOUR_MS < nowTick
    for (const w of plan.waitingDeals) {
      if (w.loadAt == null || w.loadAt < startMs || w.loadAt >= winEnd) continue
      const full = w.deal.stage === 'full'
      const overdue = ghostOverdue(w.loadAt)
      list.push({
        key: `gd-${w.deal.id}`,
        ms: w.loadAt,
        time: fmtHM(w.loadAt),
        overdue,
        tip:
          (overdue
            ? 'ПРОСРОЧКА: окно погрузки прошло, состав не назначен · '
            : full
              ? 'Груз ATI.SU в силе, состав не назначен · '
              : 'Предварительное согласование ATI.SU · ') +
          `${w.deal.from} → ${w.deal.to}${w.deal.weightT != null ? ` · ${w.deal.weightT} т` : ''}` +
          (full ? ' — клик откроет подбор состава' : ' — дождитесь обмена документами; клик откроет раздел ATI.SU'),
        cls: overdue
          ? 'border-red-400 bg-red-200 anim-overdue'
          : full ? 'border-violet-400 bg-violet-100' : 'border-amber-400 bg-amber-100',
        labelCls: overdue ? 'text-red-700' : full ? 'text-violet-700' : 'text-amber-700',
        onClick: full ? () => onPlanDeal(w.deal) : onOpenAtiDeals,
        labelX: null,
      })
    }
    for (const w of plan.waitingOrders) {
      if (w.loadAt == null || w.loadAt < startMs || w.loadAt >= winEnd) continue
      const overdue = ghostOverdue(w.loadAt)
      list.push({
        key: `go-${w.order.id}`,
        ms: w.loadAt,
        time: fmtHM(w.loadAt),
        overdue,
        tip: overdue
          ? `ПРОСРОЧКА: плановая погрузка заявки прошла, состав не назначен · ${w.order.loadPoint.split(',')[0]} → ${w.order.unloadPoint.split(',')[0]} — клик откроет заявку в «Заявках»`
          : `Заявка 1С «к планированию» · ${w.order.loadPoint.split(',')[0]} → ${w.order.unloadPoint.split(',')[0]} — клик откроет заявку в «Заявках»`,
        cls: overdue ? 'border-red-400 bg-red-200 anim-overdue' : 'border-slate-400 bg-slate-100',
        labelCls: overdue ? 'text-red-700' : 'text-slate-600',
        onClick: () => onFindOrder(w.order.number),
        labelX: null,
      })
    }
    list.sort((a, b) => a.ms - b.ms)
    let lastRight = -Infinity
    for (const g of list) {
      const cx = ((g.ms - startMs) / winMs) * laneW
      if (cx < -30 || cx > laneW + 30) {
        g.labelX = null
        continue
      }
      if (cx - lastRight >= 34) {
        g.labelX = Math.max(14, Math.min(laneW - 14, Math.max(0, cx)))
        lastRight = cx + 30
      } else {
        g.labelX = null
      }
    }
    return list
  }, [plan, startMs, winMs, winEnd, laneW, nowTick, onOpenAtiDeals, onFindOrder, onPlanDeal])

  /** позиция по времени, в % ширины дорожки */
  const xPct = (ms: number) => `${((ms - startMs) / winMs) * 100}%`
  const wPct = (a: number, b: number) => `${((b - a) / winMs) * 100}%`

  // клик по пустому месту дорожки → план на этот день для этого состава
  function laneClick(e: ReactMouseEvent<HTMLDivElement>, lane: Lane) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const dayIdx = Math.max(0, Math.min(span - 1, Math.floor((x / rect.width) * span)))
    onOpenEntry(isoDate(new Date(startMs + dayIdx * DAY_MS)), lane.driverId)
  }

  /** Закрыть событие плана (выполнено — перестаёт пульсировать, становится серым) или вернуть в план */
  async function setEntryClosed(id: string, close: boolean) {
    setCloseBusy(id)
    try {
      const res = await authFetch('/api/plan-entries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: close ? 'close' : 'reopen' }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
      toast({ title: close ? 'Событие закрыто — выполнено' : 'Возвращено в план', description: json?.message })
      onChanged()
    } catch (e) {
      toast({ title: 'Не удалось изменить запись', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setCloseBusy(null)
    }
  }

  async function removeEntry(id: string) {
    setRemoveBusy(id)
    try {
      const res = await authFetch(`/api/plan-entries?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
      toast({ title: 'Снято с плана', description: json?.message })
      onChanged()
    } catch (e) {
      toast({ title: 'Не удалось снять запись', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setRemoveBusy(null)
    }
  }

  const s = plan.summary
  const freeLaneCount = lanes.filter((l) => l.status === 'free').length
  const overdueLaneCount = lanes.filter((l) => l.overdueCount > 0).length
  // весь парк: без сворачивания — фильтруем общим поиском раздела и быстрыми фильтрами
  // («недоступны» — фильтр доски «Сейчас», в графике ведёт себя как «все»)
  const gFilter: 'all' | 'on_trip' | 'assigned' | 'free' | 'overdue' = filter === 'off' ? 'all' : filter
  const shownLanes = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return lanes.filter((l) => {
      if (needle && !`${l.name} ${l.sub}`.toLowerCase().includes(needle)) return false
      if (gFilter === 'all') return true
      if (gFilter === 'overdue') return l.overdueCount > 0
      return l.status === gFilter
    })
  }, [lanes, query, gFilter])
  const GANTT_FILTERS: { key: 'all' | 'on_trip' | 'assigned' | 'free' | 'overdue'; label: string; count: number }[] = [
    { key: 'all', label: 'Все', count: lanes.length },
    { key: 'on_trip', label: 'На линии', count: lanes.filter((l) => l.status === 'on_trip').length },
    { key: 'assigned', label: 'По плану', count: lanes.filter((l) => l.status === 'assigned').length },
    { key: 'free', label: 'На базе', count: freeLaneCount },
    { key: 'overdue', label: 'Просрочка', count: overdueLaneCount },
  ]
  const filterChipCls = (active: boolean, danger = false) =>
    `h-7 rounded-full border px-2.5 text-[11px] font-semibold transition-colors ${
      active
        ? danger
          ? 'border-red-400 bg-red-50 text-red-700'
          : 'border-blue-400 bg-blue-50 text-blue-700 ring-2 ring-blue-100'
        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
    }`
  // просрочка — верх списка, закрытые — вниз
  const entriesAll = [...state.planEntries].sort((a, b) => {
    const rank = (p: (typeof state.planEntries)[number]) => (manualEntryOverdue(p, nowTick) ? 0 : p.closedAt ? 2 : 1)
    return rank(a) - rank(b) || (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? ''))
  })
  const segClsSpan = (active: boolean) =>
    `h-8 px-3 text-xs font-medium transition-colors ${active ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`

  const nowMs = nowTick
  const showNowLine = nowMs >= startMs && nowMs < winEnd

  return (
    <div className="space-y-4">
      {/* Доска Ганта: строки — составы, полосы — рейсы */}
      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
            <ClipboardList className="h-4 w-4 text-slate-400" aria-hidden />
            График работы парка
            <Pill className="bg-slate-100 text-slate-600">
              {fmtDM(days[0]?.iso ?? startIso)} – {fmtDM(days[days.length - 1]?.iso ?? startIso)} · {span === 3 ? '3 дня' : '7 дней'}
            </Pill>
            {overdueLaneCount > 0 && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700"
                title="Составы с просроченными событиями — показаны первыми, бейдж «!N» у фамилии"
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                </span>
                просрочка у {overdueLaneCount} {pluralSostav(overdueLaneCount)}
              </span>
            )}
            {/* данные прежних плиток «сегодня»: погрузки, выгрузки, возвраты на базу */}
            <Pill className="bg-blue-50 text-blue-700" title="Плановые погрузки сегодня — заявки 1С, грузы ATI.SU и ручной план">
              погрузок сегодня: {s.loadsToday}
            </Pill>
            <Pill className="bg-amber-50 text-amber-700" title="Плановые выгрузки сегодня по всем рейсам">
              выгрузок: {s.unloadsToday}
            </Pill>
            <Pill className="bg-teal-50 text-teal-700" title={`Составы, которые вернутся на базу АЭМЗ до конца дня (завтра: ${s.returnsTomorrow})`}>
              вернутся: {s.returnsToday}
            </Pill>
            {/* Легенда: форма блока кодирует тип операции, цвет — состояние */}
            <span className="ml-auto hidden flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-medium text-slate-500 xl:flex">
              <span className="inline-flex items-center gap-1"><span className="h-3 w-2.5 rounded-[3px] bg-blue-500" aria-hidden />погрузка</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded-full bg-emerald-500" aria-hidden />ход · 1С</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded-full bg-violet-500" aria-hidden />ход · ATI.SU</span>
              <span className="inline-flex items-center gap-1"><span className="h-3 w-2.5 rounded-[3px] bg-amber-500" aria-hidden />выгрузка</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded-full bg-teal-600" aria-hidden />на базу</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded-full border border-dashed border-slate-400 bg-slate-200" aria-hidden />порожняк</span>
              <span className="inline-flex items-center gap-1"><span className="h-3 w-2.5 rounded-[3px] border border-dashed border-blue-400 bg-blue-50" aria-hidden />план логиста</span>
              <span className="inline-flex items-center gap-1"><span className="h-3 w-2.5 rounded-[3px] bg-red-500 anim-overdue" aria-hidden />просрочка</span>
              <span className="inline-flex items-center gap-1"><span className="h-3 w-2.5 rounded-[3px] bg-slate-300" aria-hidden />прошло · закрыто</span>
            </span>
          </div>

          {/* Горизонт графика: вид 3/7 дней, навигация, планирование на любую дату */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-slate-200" role="group" aria-label="Горизонт графика">
              <button type="button" className={segClsSpan(span === 3)} onClick={() => setSpan(3)} title="Быстрый вид: 3 дня">
                3 дня
              </button>
              <button type="button" className={segClsSpan(span === 7)} onClick={() => setSpan(7)} title="Быстрый вид: 7 дней">
                7 дней
              </button>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shift(-1)} title={`Назад на ${span} дн.`}>
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={goToday} title="Показать график с сегодняшнего дня">
                Сегодня
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shift(1)} title={`Вперёд на ${span} дн.`}>
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
              <Input
                type="date"
                value={startIso}
                onChange={(e) => { if (e.target.value) setStartIso(e.target.value) }}
                className="h-8 w-[150px] text-xs"
                title="Показать график с любой даты"
                aria-label="Начальная дата графика"
              />
            </div>
            <Button
              size="sm"
              className="h-8 bg-slate-900 px-3 text-xs text-white hover:bg-slate-700"
              onClick={() => onOpenEntry(startIso)}
              title="Запланировать работу состава на любую дату"
            >
              <CalendarPlus className="mr-1 h-3.5 w-3.5" aria-hidden />Запланировать
            </Button>
            <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={onChanged}>
              Пересчитать
            </Button>
          </div>

          {/* Фильтры-чипы: общие с видом «Сейчас» (фильтр по статусу составов) */}
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Фильтр составов по статусу">
            {GANTT_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => onFilterChange(gFilter === f.key ? 'all' : f.key)}
                className={filterChipCls(gFilter === f.key, f.key === 'overdue' && f.count > 0)}
                title={`Показать: ${f.label.toLowerCase()}`}
              >
                {f.label} <span className="tabular-nums opacity-70">{f.count}</span>
              </button>
            ))}
            {(query || gFilter !== 'all') && (
              <button
                type="button"
                onClick={() => onFilterChange('all')}
                className="text-[11px] font-medium text-blue-700 underline-offset-2 hover:underline"
                title="Поиск раздела очищается в общей шапке"
              >
                сбросить фильтр · показано {shownLanes.length} из {lanes.length}
              </button>
            )}
          </div>

          <div className={`overflow-auto ${THIN_SCROLL} max-h-[68vh] rounded-lg border border-slate-100`}>
            <div className={`flex ${span === 7 ? 'min-w-[1200px]' : 'min-w-[800px]'}`}>
              {/* Левая колонка: составы — закреплена при горизонтальной прокрутке */}
              <div className="sticky left-0 z-40 w-[212px] shrink-0 border-r border-slate-200 bg-white">
                <div className="sticky top-0 z-50 flex h-9 items-center gap-1.5 border-b border-slate-200 bg-white px-2">
                  <span className="text-[11px] font-bold text-slate-600">Составы</span>
                  <Pill className="bg-slate-100 text-slate-600" title="Всего строк в графике — весь парк">{lanes.length}</Pill>
                </div>
                {ghosts.length > 0 && (
                  <div className="flex h-[52px] items-center gap-1.5 border-b border-slate-100 px-2">
                    <Inbox className="h-3.5 w-3.5 shrink-0 text-violet-400" aria-hidden />
                    <span className="truncate text-[11px] font-semibold text-slate-700" title="Грузы и заявки, которым ещё не назначен состав">
                      Ждут состава
                    </span>
                    <Pill className="bg-violet-100 text-violet-700">{ghosts.length}</Pill>
                  </div>
                )}
                {shownLanes.map((l) => (
                  <div key={l.driverId} className="flex h-[52px] flex-col justify-center gap-0.5 border-b border-slate-100 px-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {l.overdueCount > 0 ? (
                        <span className="relative flex h-2 w-2 shrink-0" title="Есть просроченные события">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                        </span>
                      ) : (
                        <span className={`h-2 w-2 shrink-0 rounded-full ${LANE_STATUS[l.status].dot}`} aria-hidden />
                      )}
                      <span className="min-w-0 truncate text-xs font-semibold text-slate-800" title={l.name}>{shortName(l.name)}</span>
                      {l.overdueCount > 0 ? (
                        <span
                          className="ml-auto shrink-0 rounded-full bg-red-100 px-1.5 py-px text-[9px] font-bold tabular-nums text-red-700"
                          title={`Просроченных событий: ${l.overdueCount} — закройте факт или отметьте выполнение`}
                        >
                          !{l.overdueCount}
                        </span>
                      ) : (
                        <span className="ml-auto shrink-0 text-[9px] font-medium text-slate-400">{LANE_STATUS[l.status].label}</span>
                      )}
                    </div>
                    <div className="min-w-0 truncate pl-3.5 text-[10px] text-slate-400" title={l.sub}>{l.sub}</div>
                  </div>
                ))}
              </div>

              {/* Дорожки времени */}
              <div className="relative min-w-0 flex-1" ref={laneRef}>
                {/* сетка дней: выходные, «сегодня», вертикальные линии */}
                <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
                  {days.map((d) => (d.isToday || d.weekend) && (
                    <div
                      key={`bg-${d.iso}`}
                      className={`absolute inset-y-0 ${d.isToday ? 'bg-blue-50/50' : 'bg-slate-50/60'}`}
                      style={{ left: xPct(startMs + d.i * DAY_MS), width: wPct(startMs + d.i * DAY_MS, startMs + (d.i + 1) * DAY_MS) }}
                    />
                  ))}
                  {days.map((d) => d.i > 0 && (
                    <div
                      key={`ln-${d.iso}`}
                      className="absolute inset-y-0 w-px bg-slate-200"
                      style={{ left: xPct(startMs + d.i * DAY_MS) }}
                    />
                  ))}
                </div>

                {/* шапка дней — закреплена при вертикальной прокрутке */}
                <div className="sticky top-0 z-30 grid h-9 border-b border-slate-200 bg-white" style={{ gridTemplateColumns: `repeat(${span}, minmax(0, 1fr))` }}>
                  {days.map((d) => (
                    <div key={d.iso} className={`flex min-w-0 items-center gap-1 px-2 ${d.i > 0 ? 'border-l border-slate-100' : ''} ${d.isToday ? 'bg-blue-50/70' : ''}`}>
                      <span className={`min-w-0 truncate text-[11px] font-bold ${d.isToday ? 'text-blue-700' : d.past ? 'text-slate-400' : 'text-slate-600'}`}>
                        {d.isToday ? `Сегодня · ${d.wd} ${d.dm}` : `${d.wd}, ${d.dm}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => onOpenEntry(d.iso)}
                        title={`Запланировать работу на ${d.wd} ${d.dm}`}
                        className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-700"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>

                {/* дорожка «ждут состава» */}
                {ghosts.length > 0 && (
                  <div className="relative z-10 h-[52px] border-b border-slate-100 bg-violet-50/20">
                    {ghosts.map((g) => (
                      <Fragment key={g.key}>
                        <div className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: xPct(g.ms) }}>
                          <button
                            type="button"
                            onClick={g.onClick}
                            title={g.tip}
                            aria-label={g.tip}
                            className={`flex h-6 w-3.5 items-center justify-center rounded-[4px] border border-dashed shadow-sm transition-transform hover:scale-125 ${g.cls}`}
                          />
                        </div>
                        {g.labelX != null && (
                          <span
                            className={`pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-white/85 px-0.5 text-[9px] font-semibold leading-3 tabular-nums ${g.labelCls}`}
                            style={{ left: `${g.labelX}px` }}
                          >
                            {g.time}
                          </span>
                        )}
                      </Fragment>
                    ))}
                  </div>
                )}

                {/* дорожки составов */}
                {shownLanes.map((l) => (
                  <div
                    key={l.driverId}
                    className={`relative z-10 h-[52px] cursor-pointer border-b border-slate-100 transition-colors ${
                      l.overdueCount > 0
                        ? 'bg-red-50/30 hover:bg-red-50/60'
                        : l.status === 'free'
                          ? 'bg-emerald-50/40 hover:bg-emerald-50/80'
                          : 'hover:bg-slate-50/70'
                    }`}
                    title={`${l.name} · ${l.sub}. Клик по свободному месту — запланировать работу на этот день`}
                    onClick={(e) => laneClick(e, l)}
                  >
                    {l.status === 'free' && l.segs.length === 0 && l.manuals.length === 0 && (
                      <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center whitespace-nowrap text-[10px] font-medium text-emerald-700/60">
                        свободен — клик запланирует работу
                      </span>
                    )}
                    {l.segs.map((sg) =>
                      sg.kind === 'load' || sg.kind === 'unload' ? (
                        <Fragment key={sg.key}>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); if (sg.tripId) onOpenTrip(sg.tripId) }}
                            title={sg.title}
                            aria-label={sg.title}
                            className={`absolute top-1/2 z-10 -translate-y-1/2 transition-transform hover:z-20 hover:scale-110 ${segCls(sg.kind, sg.state)}`}
                            style={{ left: xPct(sg.start), width: wPct(sg.start, sg.end) }}
                          />
                          {sg.timeLabel != null && (
                            <span
                              className={`pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-white/85 px-0.5 text-[9px] font-semibold leading-3 tabular-nums ${
                                sg.kind === 'load' ? 'text-blue-700' : 'text-amber-700'
                              } ${sg.state === 'done' ? 'opacity-50' : ''}`}
                              style={{ left: `${sg.timeLabel}px` }}
                            >
                              {fmtHM(sg.ms)}
                            </span>
                          )}
                        </Fragment>
                      ) : (
                        <button
                          key={sg.key}
                          type="button"
                          onClick={(e) => { e.stopPropagation(); if (sg.tripId) onOpenTrip(sg.tripId) }}
                          title={sg.title}
                          aria-label={sg.title}
                          className={`absolute top-1/2 z-0 -translate-y-1/2 text-left ${segCls(sg.kind, sg.state)}`}
                          style={{ left: xPct(sg.start), width: wPct(sg.start, sg.end) }}
                        >
                          {sg.showLabel && (
                            <span
                              className={`pointer-events-none flex h-full items-center overflow-hidden px-2 text-[10px] font-medium leading-none ${
                                sg.state === 'active' ? 'text-white' : 'text-slate-600'
                              }`}
                            >
                              <span className="truncate">{sg.label}</span>
                            </span>
                          )}
                        </button>
                      ),
                    )}
                    {/* ручной план логиста: индиго-пунктир / красный пульс / серое «выполнено» */}
                    {l.manuals.map((m) => (
                      <div
                        key={m.id}
                        className="absolute top-1/2 z-20 -translate-x-1/2 -translate-y-1/2"
                        style={{ left: `min(max(${xPct(m.ms)}, 96px), calc(100% - 96px))` }}
                        title={m.title}
                      >
                        <span className={`flex items-center gap-1 rounded-md border py-0.5 pl-1.5 pr-1 text-[10px] ${manualCls(m.state)}`}>
                          {m.state === 'done' ? (
                            <Check className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                          ) : (
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.state === 'overdue' ? 'bg-red-500' : 'bg-blue-600'}`} aria-hidden />
                          )}
                          {m.time && <b className="tabular-nums">{m.time}</b>}
                          <span className={`max-w-[170px] truncate ${m.state === 'done' ? 'line-through decoration-slate-300' : ''}`}>{m.label}</span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void setEntryClosed(m.id, m.state !== 'done') }}
                            disabled={closeBusy === m.id}
                            title={m.state === 'done' ? 'Вернуть в план — снова ждёт выполнения' : 'Закрыть: событие выполнено (перестанет пульсировать, станет серым)'}
                            className={`flex items-center rounded p-px transition-colors ${
                              m.state === 'done'
                                ? 'text-slate-400 hover:bg-slate-200 hover:text-slate-600'
                                : 'text-red-500 hover:bg-red-100 hover:text-red-700'
                            }`}
                          >
                            {m.state === 'done' ? <RotateCcw className="h-3 w-3" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void removeEntry(m.id) }}
                            disabled={removeBusy === m.id}
                            title="Снять с плана"
                            className={`flex items-center rounded p-px transition-colors ${
                              m.state === 'done'
                                ? 'text-slate-400 hover:bg-slate-200 hover:text-slate-600'
                                : 'text-blue-500 hover:bg-blue-100 hover:text-blue-700'
                            }`}
                          >
                            <X className="h-3 w-3" aria-hidden />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                ))}

                {/* линия «сейчас» */}
                {showNowLine && (
                  <div className="pointer-events-none absolute inset-y-0 z-[15] w-[2px] bg-rose-500/80" style={{ left: xPct(nowMs) }}>
                    <span className="absolute left-1/2 top-[38px] -translate-x-1/2 whitespace-nowrap rounded bg-rose-500 px-1 py-px text-[9px] font-bold leading-3 text-white shadow-sm">
                      сейчас
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Общая колонка «Ждёт планирования» (сделки ATI.SU + заявки 1С + в плане + обратки) */}
        <div className="xl:col-span-2">{waitingColumn}</div>

        {/* Правая колонка: ручной план логиста */}
        <div className="space-y-4">
          <Card className="rounded-xl border-slate-200 shadow-sm">
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <ListChecks className="h-4 w-4 text-slate-400" aria-hidden />
                Планы логиста
                <Pill className="bg-blue-100 text-blue-700">{state.planEntries.length}</Pill>
                {overdueManualsTotal(state, nowTick) > 0 && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700 anim-overdue"
                    title="Записи, чей срок прошёл, а выполнения нет — вверху списка"
                  >
                    просрочка {overdueManualsTotal(state, nowTick)}
                  </span>
                )}
                <InfoTip label="Что здесь">
                  Записи, созданные кликом по строке графика, «+» в дне или кнопкой
                  «Запланировать»: погрузки, выгрузки, возвраты на АЭМЗ и заметки на
                  любую дату. ✓ закрывает событие (выполнено — серое), ↺ возвращает
                  в план, × снимает. Пока срок не прошёл — метка индиго; срок прошёл
                  и не закрыто — пульсирует красным (просрочка).
                </InfoTip>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-full text-xs"
                onClick={() => onOpenEntry(startIso)}
                title="Новая запись плана на любую дату"
              >
                <CalendarPlus className="mr-1 h-3 w-3" aria-hidden />Запланировать…
              </Button>
              {entriesAll.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
                  Ручных планов ещё нет — запланируйте работу состава на любую дату
                </div>
              ) : (
                <div className={`space-y-1 ${THIN_SCROLL} max-h-64 overflow-y-auto pr-1`}>
                  {entriesAll.map((p) => {
                    const d = state.drivers.find((x) => x.id === p.driverId)
                    const closed = !!p.closedAt
                    const overdue = manualEntryOverdue(p, nowTick)
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                          overdue ? 'border-red-200 bg-red-50/60' : closed ? 'border-slate-200 bg-slate-50' : 'border-blue-100 bg-blue-50/40'
                        }`}
                      >
                        <span className="flex w-11 shrink-0 flex-col leading-tight" title={`${p.date}${p.time ? ` в ${p.time}` : ' — в течение дня'}`}>
                          <span className={`text-[11px] font-semibold tabular-nums ${overdue ? 'text-red-700' : closed ? 'text-slate-400' : 'text-blue-700'}`}>{fmtDM(p.date)}</span>
                          <span className="text-[10px] tabular-nums text-slate-500">{p.time ?? 'день'}</span>
                        </span>
                        <span className="w-24 shrink-0 truncate text-[11px] font-medium text-slate-800" title={d?.fullName ?? ''}>
                          {d ? shortName(d.fullName) : '—'}
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate text-[11px] ${
                            closed ? 'text-slate-400 line-through decoration-slate-300' : overdue ? 'font-semibold text-red-700' : 'text-slate-600'
                          }`}
                          title={`${MANUAL_KIND_LABEL[p.kind] ?? p.kind}${p.kind !== 'note' && p.point ? ` · ${p.point}` : ''}${p.kind === 'note' && p.note ? ` · ${p.note}` : ''}${closed ? ` · выполнено${p.closedByName ? ` (${p.closedByName})` : ''}` : ''}`}
                        >
                          {MANUAL_KIND_LABEL[p.kind] ?? p.kind}
                          {p.kind !== 'note' && p.point ? ` · ${p.point}` : ''}
                          {p.kind === 'note' && p.note ? ` · ${p.note}` : ''}
                        </span>
                        {overdue && !closed && (
                          <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-px text-[9px] font-bold text-red-700" title="Срок прошёл, выполнения нет">
                            просрочка
                          </span>
                        )}
                        <button
                          type="button"
                          title={closed ? 'Вернуть в план — снова ждёт выполнения' : 'Закрыть: событие выполнено'}
                          disabled={closeBusy === p.id}
                          onClick={() => void setEntryClosed(p.id, !closed)}
                          className={`flex shrink-0 items-center rounded p-1 transition-colors ${
                            closed ? 'text-slate-400 hover:bg-slate-200 hover:text-slate-600' : 'text-red-500 hover:bg-red-100 hover:text-red-700'
                          }`}
                        >
                          {closed ? <RotateCcw className="h-3.5 w-3.5" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
                        </button>
                        <button
                          type="button"
                          title="Снять с плана"
                          disabled={removeBusy === p.id}
                          onClick={() => void removeEntry(p.id)}
                          className="flex shrink-0 items-center rounded p-1 text-slate-400 transition-colors hover:bg-blue-100 hover:text-blue-700"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** Сколько записей ручного плана просрочено (для плашки над списком) */
function overdueManualsTotal(state: StateResponse, nowTick: number): number {
  return state.planEntries.filter((p) => manualEntryOverdue(p, nowTick)).length
}
