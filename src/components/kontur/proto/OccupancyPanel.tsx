'use client'

/**
 * Занятость водителей — живая диспетчерская доска одним экраном.
 * Наследник Excel-таблицы «Статус авто / Статус водителя» с панелью «Данные авто»,
 * но без ручного ввода: статусы выводятся из уже заведённых данных платформы —
 *   «на линии»    — активный рейс (назначение и плечи из «Заявок»);
 *   «назначен»    — рейс составлен, выезд ещё по плану;
 *   «свободен»    — активный водитель без рейса (состав — из закреплений);
 *   «недоступен»  — отметка справочника (больничный/отпуск/отгул) либо ремонт техники.
 * Поэтому доска синхронна с остальной работой: любое планирование в «Заявках»
 * или отметка в «Справочниках» сразу меняет картину — двойного ввода нет.
 * Момент «освободится» считается той же формулой, что и в умном подборе
 * (src/lib/availability.ts), чтобы доска и подбор никогда не расходились.
 */
import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, CalendarDays, ClipboardList, FileCheck2, Link2, RefreshCw, Route, Search, UserCheck, UserX, Users, Wrench } from 'lucide-react'
import { Card, CardContent } from '@/components/kontur/ui/card'
import { Button } from '@/components/kontur/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/kontur/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/kontur/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/kontur/ui/input'
import { InfoTip, Pill, StatusChip } from '@/components/kontur/proto/bits'
import { KpiTile } from '@/components/platform/common'
import { CallButton } from '@/components/kontur/proto/CallButton'
import { PlanDealDialog } from '@/components/kontur/proto/PlanDealDialog'
import { tripFrees } from '@/lib/kontur/availability'
import { buildPlan, fmtWhen } from '@/lib/kontur/planner'
import { authFetch } from '@/lib/kontur/session-token'
import type { AtiDealDto, Driver, Leg, StateResponse, Trip } from '@/lib/kontur/client-types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full'

// Отметки недоступности из справочника водителей (цвет — как в Excel-панели «Данные авто»)
const OFF_META: Record<string, { label: string; dot: string }> = {
  sick: { label: 'Больничный', dot: 'bg-red-500' },
  vacation: { label: 'Отпуск', dot: 'bg-slate-400' },
  other: { label: 'Отгул', dot: 'bg-slate-300' },
}

type Filter = 'all' | 'on_trip' | 'assigned' | 'free' | 'off'

/** Короткий человекочитаемый момент: «сегодня 14:30», «завтра 09:00», иначе «26.11» */
function fmtFrees(d: Date, nowTick: number): string {
  const now = new Date(nowTick)
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (sameDay(d, now)) return `сегодня ${hm}`
  const tomorrow = new Date(now.getTime() + 86400000)
  if (sameDay(d, tomorrow)) return `завтра ${hm}`
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

/** Фамилия и инициалы — для компактных строк свободного резерва */
function shortName(full: string): string {
  const [fam, im, ot] = full.split(' ')
  return ot ? `${fam} ${im[0]}.${ot[0]}.` : im ? `${fam} ${im[0]}.` : fam
}

/** Строка доски для занятого водителя (активный или назначенный рейс) */
type BusyRow = {
  kind: 'on_trip' | 'assigned'
  trip: Trip
  curLeg: Leg | null // текущее открытое плечо (для назначенного — первое незакрытое)
  freesAt: Date | null
  freesPoint: string | null
  customer: string | null
}

export function OccupancyPanel({ state, onChanged, onOpenTrip, onOpenAtiDeals }: {
  state: StateResponse
  onChanged: () => void
  onOpenTrip: (tripId: string) => void
  /** переход к «Мои заявки» ATI.SU — сквозная связка разделов */
  onOpenAtiDeals: () => void
}) {
  const { toast } = useToast()
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [markOpen, setMarkOpen] = useState(false)
  const [markDriver, setMarkDriver] = useState<Driver | null>(null)
  const [markKind, setMarkKind] = useState('sick')
  const [markComment, setMarkComment] = useState('')
  const [markQuery, setMarkQuery] = useState('')
  const [markBusy, setMarkBusy] = useState(false)
  const [planDeal, setPlanDeal] = useState<AtiDealDto | null>(null)

  // Тик каждую минуту: моменты «освободится» и «обновлено» не протухают на открытом экране
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  const ordersById = useMemo(() => new Map(state.orders.map((o) => [o.id, o])), [state.orders])
  const dealById = useMemo(() => new Map(state.deals.map((d) => [d.id, d])), [state.deals])
  const bindingByDriver = useMemo(() => new Map(state.bindings.map((b) => [b.driverId, b])), [state.bindings])
  const repairVehicles = useMemo(() => state.vehicles.filter((v) => v.isRepair), [state.vehicles])
  const repairTrailers = useMemo(() => state.trailers.filter((t) => t.isRepair), [state.trailers])
  const vehicleById = useMemo(() => new Map(state.vehicles.map((v) => [v.id, v])), [state.vehicles])
  const trailerById = useMemo(() => new Map(state.trailers.map((t) => [t.id, t])), [state.trailers])

  // ——— разбор занятости из рейсов ———
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

  // Водитель без рейса на сломанной технике — фактически недоступен (причина для строки доски)
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
  }, [state.drivers, busyDriverIds, bindingByDriver])

  // ——— недоступные: отметки справочника + водители без рейса на сломанной технике ———
  const off = useMemo(() => {
    const rows = state.drivers.filter((d) => {
      if (d.status !== 'active') return true
      if (busyDriverIds.has(d.id)) return false
      return repairReason(d.id) != null
    })
    // человек-причина важнее техники: у отмеченных — их статус, у остальных — ремонт
    return rows.sort((a, b) => (a.status === 'active' ? 1 : 0) - (b.status === 'active' ? 1 : 0) || a.fullName.localeCompare(b.fullName, 'ru'))
  }, [state.drivers, busyDriverIds, bindingByDriver, vehicleById, trailerById])

  const counts = useMemo(() => ({
    on_trip: busy.filter((r) => r.kind === 'on_trip').length,
    assigned: busy.filter((r) => r.kind === 'assigned').length,
    free: free.length,
    off: off.length,
    total: state.drivers.length,
  }), [busy, free, off, state.drivers.length])

  // ——— единый план с разделом «Планирование»: сделки ATI.SU и плановые погрузки ———
  // тот же движок (src/lib/planner.ts), что рисует график работ, — доска и график не расходятся
  const plan = useMemo(() => buildPlan(state, nowTick), [state, nowTick])

  // ——— фильтры и поиск ———
  const q = query.trim().toLowerCase()
  const matches = (...parts: (string | null | undefined)[]) => !q || parts.some((p) => p?.toLowerCase().includes(q))
  const busyVisible = busy.filter((r) => matches(r.trip.driver?.fullName, r.trip.vehicle?.plate, r.trip.trailer?.plate, r.curLeg && `${r.curLeg.loadPoint} → ${r.curLeg.unloadPoint}`, r.customer))
  const freeVisible = free.filter((d) => matches(d.fullName, bindingByDriver.get(d.id)?.vehicle?.plate, bindingByDriver.get(d.id)?.trailer?.plate))
  const offVisible = off.filter((d) => matches(d.fullName, d.statusComment, repairReason(d.id)))
  const visible: Record<Filter, boolean> = {
    all: true,
    on_trip: counts.on_trip > 0 && busyVisible.some((r) => r.kind === 'on_trip'),
    assigned: counts.assigned > 0 && busyVisible.some((r) => r.kind === 'assigned'),
    free: freeVisible.length > 0,
    off: offVisible.length > 0,
  }

  // ——— недельная готовность: сколько составов вернётся по дням ———
  // плюс плановые погрузки по дням (заявки 1С + грузы ATI.SU) — фиолетовой полосой
  const week = useMemo(() => {
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
  const weekMax = Math.max(1, ...week.map((d) => d.n))

  // ——— отметка недоступности / возврат в строй (общая база со «Справочниками») ———
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
      setMarkOpen(false)
      setMarkDriver(null)
      setMarkComment('')
      onChanged()
    } catch (e) {
      toast({ title: 'Не удалось сохранить отметку', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setMarkBusy(false)
    }
  }

  const FILTERS: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'Все', count: counts.total },
    { id: 'on_trip', label: 'На линии', count: counts.on_trip },
    { id: 'assigned', label: 'Назначены', count: counts.assigned },
    { id: 'free', label: 'Свободны', count: counts.free },
    { id: 'off', label: 'Недоступны', count: counts.off },
  ]

  const showGroup = (f: Filter) => (filter === 'all' || filter === f) && visible[f]

  return (
    <div className="space-y-4">
      {/* Шапка доски: заголовок, обновление, поиск, фильтры */}
      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardContent className="space-y-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <Users className="h-4 w-4 text-slate-400" aria-hidden />
              <span className="text-sm font-bold text-slate-900">Занятость водителей · доска распределения</span>
              <Pill className="bg-slate-100 text-slate-600" title="Момент пересчёта картины занятости">
                обновлено {new Date(nowTick).toLocaleTimeString('ru-RU')}
              </Pill>
              <InfoTip label="Как считается занятость">
                Статусы не вводятся вручную — они выводятся из уже заведённых данных:
                «на линии» — активный рейс из «Заявок»; «назначен» — рейс составлен, выезд по плану
                (включая согласованные грузы ATI.SU, взятые в план); «свободен» — водитель в строю
                без рейса; «недоступен» — отметка больничного/отпуска/отгула
                (общая база со «Справочниками») или ремонт закреплённой техники.
                Момент «освободится» считается той же формулой, что и в умном подборе, —
                доска, подбор и график «Планирования» всегда согласованы.
              </InfoTip>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Водитель, авто, маршрут…"
                  className="h-8 w-56 rounded-lg border border-slate-300 bg-white pl-8 pr-2 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <Button size="sm" variant="outline" className="h-8" onClick={onChanged}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" />Обновить
              </Button>
            </div>
          </div>
          {/* Фильтры-чипы: клик = показать только эту группу (как в Excel-фильтрах) */}
          <div className="flex flex-wrap gap-1" role="group" aria-label="Фильтр занятости">
            {FILTERS.map((f) => {
              const active = filter === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(active ? 'all' : f.id)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    active ? 'bg-[#0E1B2C] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {f.label}
                  <span className={`rounded-full px-1.5 text-[10px] font-bold ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'}`}>{f.count}</span>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Плитки-счётчики: панель «Данные авто» из Excel, но живая */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-8" role="group" aria-label="Сводка занятости">
        <KpiTile value={counts.total} label="Водителей" dot="bg-slate-900" hint="Все водители справочника парка АЭМЗ"
          active={filter === 'all'} onClick={() => setFilter('all')} />
        <KpiTile value={counts.on_trip} label="На линии" dot="bg-emerald-500" hint="Водят активные рейсы — план загрузки на смену"
          active={filter === 'on_trip'} onClick={() => setFilter('on_trip')} />
        <KpiTile value={counts.assigned} label="Назначены" dot="bg-sky-500" hint="Рейс составлен (включая грузы ATI.SU из плана), выезд по плану"
          active={filter === 'assigned'} onClick={() => setFilter('assigned')} />
        <KpiTile value={counts.free} label="Свободны" dot="bg-amber-500" hint="В строю и без рейса — резерв для планирования"
          active={filter === 'free'} onClick={() => setFilter('free')} />
        <KpiTile value={state.drivers.filter((d) => d.status === 'sick').length} label="Больничные" dot="bg-red-500" hint="Отметка справочника — временно недоступен"
          active={filter === 'off'} onClick={() => setFilter('off')} />
        <KpiTile value={state.drivers.filter((d) => d.status === 'vacation').length} label="Отпуска" dot="bg-slate-400" hint="Отметка справочника — плановое отсутствие"
          active={filter === 'off'} onClick={() => setFilter('off')} />
        <KpiTile value={repairVehicles.length} label="ТС в ремонте" dot="bg-red-500" hint="Тягачи с флагом ремонта — составы из них не назначаются"
          active={filter === 'all'} onClick={() => setFilter('all')} />
        <KpiTile value={plan.plannedDeals.length} label="ATI в плане" dot="bg-violet-500" hint="Согласованные грузы ATI.SU, назначенные составом, — карточка «ATI.SU · согласовано» справа и график в «Планировании»"
          active={false} onClick={onOpenAtiDeals} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Доска групп */}
        <Card className="rounded-xl border-slate-200 shadow-sm xl:col-span-2">
          <CardContent className="space-y-4 p-4">
            {showGroup('on_trip') && (
              <Group
                icon={<Route className="h-4 w-4 text-slate-400" aria-hidden />}
                dot="bg-emerald-500"
                title="На линии"
                count={counts.on_trip}
                hint="Активные рейсы: водитель, состав, текущее плечо и момент освобождения. Кнопка «Рейс» открывает карточку в «Заявках»."
                maxH="max-h-96"
              >
                {busyVisible.filter((r) => r.kind === 'on_trip').map((r) => (
                  <OnTripRow key={r.trip.id} row={r} nowTick={nowTick} onOpenTrip={onOpenTrip} />
                ))}
              </Group>
            )}

            {showGroup('assigned') && (
              <Group
                icon={<ClipboardList className="h-4 w-4 text-slate-400" aria-hidden />}
                dot="bg-sky-500"
                title="Назначены"
                count={counts.assigned}
                hint="Рейс составлен в «Заявках», выезд ещё по плану — состав занят под заявку."
                maxH="max-h-72"
              >
                {busyVisible.filter((r) => r.kind === 'assigned').map((r) => (
                  <AssignedRow key={r.trip.id} row={r} nowTick={nowTick} onOpenTrip={onOpenTrip} />
                ))}
              </Group>
            )}

            {showGroup('free') && (
              <Group
                icon={<UserCheck className="h-4 w-4 text-slate-400" aria-hidden />}
                dot="bg-amber-500"
                title="Свободны · резерв для планирования"
                count={counts.free}
                hint="Водители в строю без рейса. Состав — из закреплений; «—» значит состав не закреплён, технику подберёт умный подбор в «Заявках»."
                maxH="max-h-96"
                action={
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setMarkOpen(true); setMarkDriver(null); setMarkKind('sick'); setMarkComment(''); setMarkQuery('') }}>
                    <UserX className="mr-1 h-3.5 w-3.5 text-red-600" />Отметить недоступность
                  </Button>
                }
              >
                {freeVisible.map((d) => {
                  const b = bindingByDriver.get(d.id)
                  const rr = repairReason(d.id)
                  return (
                    <div key={d.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden />
                      <span className="w-56 shrink-0 truncate text-sm font-medium text-slate-800" title={d.fullName}>{d.fullName}</span>
                      <span className={`min-w-0 flex-1 truncate text-xs ${rr ? 'text-red-600' : 'text-slate-500'}`} title={rr ?? (b ? `Закреплён: ${b.vehicle?.brand} · ${b.vehicle?.plate}${b.trailer ? ` + ${b.trailer.plate}` : ''}` : 'Состав не закреплён — подберёт умный подбор')}>
                        {rr ? (
                          <>
                            <Wrench className="mr-1 inline h-3 w-3" aria-hidden />
                            {rr}
                          </>
                        ) : (
                          <>
                            {b && <Link2 className="mr-1 inline h-3 w-3 text-slate-400" aria-hidden />}
                            {b ? `${b.vehicle?.brand} · ${b.vehicle?.plate}${b.trailer ? ` + ${b.trailer.plate}` : ''}` : '— состав не закреплён'}
                          </>
                        )}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <CallButton phone={d.phone} name={d.fullName} driverId={d.id} withLabel={false} className="h-7 w-7 p-0" />
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-400 hover:text-red-700"
                          title="Отметить недоступность: больничный, отпуск, отгул"
                          onClick={() => { setMarkOpen(true); setMarkDriver(d); setMarkKind('sick'); setMarkComment(d.statusComment ?? ''); setMarkQuery('') }}>
                          <UserX className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </Group>
            )}

            {showGroup('off') && (
              <Group
                icon={<UserX className="h-4 w-4 text-slate-400" aria-hidden />}
                dot="bg-red-500"
                title="Недоступны"
                count={counts.off}
                hint="Отметки больничный/отпуск/отгул из справочника и водители на сломанной технике. «В строй» снимает отметку."
                maxH="max-h-80"
              >
                {offVisible.map((d) => {
                  const meta = OFF_META[d.status] ?? { label: d.status, dot: 'bg-slate-300' }
                  const rr = d.status === 'active' ? repairReason(d.id) : null
                  return (
                    <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-100 px-2 py-1.5">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${d.status === 'active' ? 'bg-red-400' : meta.dot}`} aria-hidden />
                      <span className="w-56 shrink-0 truncate text-sm font-medium text-slate-800" title={d.fullName}>{d.fullName}</span>
                      {d.status !== 'active' && <Pill className="bg-slate-100 text-slate-600">{meta.label}</Pill>}
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                        {/* комментарий показываем, только если он не дублирует пилюлю статуса */}
                        {d.statusComment && d.statusComment.trim().toLowerCase() !== meta.label.toLowerCase()
                          ? d.statusComment
                          : rr
                            ? <span className="text-red-600"><Wrench className="mr-1 inline h-3 w-3" aria-hidden />{rr}</span>
                            : '—'}
                      </span>
                      {d.status !== 'active' ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={markBusy}
                            title="Снять отметку недоступности"
                            onClick={() => void patchDriverStatus(d.id, 'active', '', d.fullName)}>
                            <UserCheck className="mr-1 h-3.5 w-3.5 text-emerald-600" />В строй
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-500"
                            onClick={() => { setMarkOpen(true); setMarkDriver(d); setMarkKind(d.status); setMarkComment(d.statusComment ?? ''); setMarkQuery('') }}>
                            Изменить
                          </Button>
                        </div>
                      ) : (
                        <CallButton phone={d.phone} name={d.fullName} driverId={d.id} withLabel={false} className="h-7 w-7 p-0" />
                      )}
                    </div>
                  )
                })}
              </Group>
            )}

            {/* Пустой результат поиска */}
            {!Object.values(visible).some(Boolean) && (
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                {q ? `По запросу «${query}» никого не найдено` : 'Водители появятся после пересоздания демо-данных'}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Правая колонка: сделки ATI.SU, недельная готовность + техника */}
        <div className="space-y-4">
          {/* ATI.SU · согласовано — связка разделов: грузы, ждущие состава, и назначенные */}
          <Card className="rounded-xl border-slate-200 shadow-sm">
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
                <FileCheck2 className="h-4 w-4 text-slate-400" aria-hidden />
                ATI.SU · согласовано
                <Pill className="bg-violet-100 text-violet-700">{plan.waitingDeals.length + plan.plannedDeals.length}</Pill>
                <InfoTip label="Связка с ATI.SU и «Планированием»">
                  Согласованные на бирже грузы (заявки в силе) ждут состава — кнопка «В план»
                  назначает их тем же подбором, что и «Заявки»: свободным составом или плечом
                  к освобождающемуся рейсу. Назначенный груз сразу занимает состав на этой доске
                  и появляется в графике «Планирования». Предварительные сделки ждут обмена документами.
                </InfoTip>
                <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={onOpenAtiDeals} title="Все сделки в разделе ATI.SU · Мои заявки">
                  Все сделки
                </Button>
              </div>
              {plan.waitingDeals.length === 0 && plan.plannedDeals.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-400">
                  Согласованных грузов нет — найдите груз на бирже ATI.SU
                </div>
              ) : (
                <div className={`space-y-1.5 ${THIN_SCROLL} max-h-72 overflow-y-auto pr-1`}>
                  {plan.waitingDeals.map((w) => {
                    const full = w.deal.stage === 'full'
                    return (
                      <div key={w.deal.id} className="rounded-lg border border-slate-100 px-2.5 py-1.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${full ? 'bg-violet-500' : 'bg-amber-400'}`} aria-hidden />
                          <span className="text-xs font-semibold text-slate-900">{w.deal.from} → {w.deal.to}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-slate-400">{fmtWhen(w.loadAt, nowTick)}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                          <span className="min-w-0 flex-1 truncate">{w.deal.cargo}{w.deal.weightT != null ? ` · ${w.deal.weightT} т` : ''}</span>
                          {full ? (
                            <Button size="sm" className="h-6 bg-violet-700 px-2 text-[11px] text-white hover:bg-violet-800"
                              onClick={() => setPlanDeal(w.deal)}
                              title="Назначить состав — общий подбор с «Заявками» и «Планированием»">
                              В план
                            </Button>
                          ) : (
                            <Pill className="bg-amber-100 text-amber-700" title="Предварительное согласование — дождитесь обмена документами">док-ты не обменяны</Pill>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {plan.plannedDeals.map((w) => (
                    <div key={w.deal.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-violet-100 bg-violet-50/40 px-2.5 py-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" aria-hidden />
                      <span className="text-xs font-semibold text-slate-900">{w.deal.from} → {w.deal.to}</span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{w.driverName ?? '—'}</span>
                      {w.tripId && (
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => onOpenTrip(w.tripId!)} title="Карточка рейса в «Заявках»">
                          Рейс
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl border-slate-200 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <CalendarDays className="h-4 w-4 text-slate-400" aria-hidden />
                Готовность · 7 дней
                <InfoTip label="Как считается готовность">
                  Зелёное — сколько занятых составов вернётся из рейсов по дням (момент «освободится»
                  по плановым выгрузкам — та же формула, что в подборе). Фиолетовая полоска —
                  плановые погрузки этого дня (заявки 1С + грузы ATI.SU): сколько составов
                  загрузится. Столбец «сегодня» — план резерва для нового планирования в «Заявках».
                </InfoTip>
              </div>
              <div className="grid grid-cols-7 gap-1.5" role="img" aria-label="График возвращения составов и плановых погрузок на неделю">
                {week.map((d) => (
                  <div key={d.from.toISOString()} className={`flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 ${d.today ? 'bg-blue-50/70 ring-1 ring-blue-100' : ''}`}>
                    <span className={`text-xs font-bold tabular-nums ${d.n > 0 ? 'text-slate-900' : 'text-slate-300'}`}>{d.n}</span>
                    <div className="flex h-14 w-full flex-col items-stretch justify-end gap-0.5">
                      <div
                        className={`w-full rounded-sm ${d.n > 0 ? 'bg-emerald-500' : 'bg-slate-100'}`}
                        style={{ height: d.n > 0 ? `${Math.max(12, (d.n / weekMax) * 100)}%` : '4px' }}
                        aria-hidden
                      />
                      {d.loads > 0 && <div className="h-1.5 w-full rounded-sm bg-violet-500" aria-hidden title={`${d.loads} погрузок по плану`} />}
                    </div>
                    <span className={`text-[10px] leading-none ${d.today ? 'font-bold text-blue-700' : 'text-slate-400'}`}>
                      {d.from.toLocaleDateString('ru-RU', { weekday: 'short' })}
                      <br />
                      {d.from.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Зелёное — возврат составов из рейсов, фиолетовая полоска — плановые погрузки дня
                (заявки 1С и грузы ATI.SU). График работ на 3 дня — в разделе «Планирование».
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-xl border-slate-200 shadow-sm">
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Wrench className="h-4 w-4 text-slate-400" aria-hidden />
                Техника
                <InfoTip label="Резерв техники">
                  Свободные тягачи — не в рейсе и не в ремонте; из них умный подбор собирает состав
                  для новых заявок. Ремонтные — с флагом ремонта в «Справочниках», в назначение
                  не попадают, пока флаг не снят.
                </InfoTip>
              </div>
              <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 text-xs">
                <span className="text-slate-400">Тягачи</span>
                <span className="text-slate-700">
                  свободно <b>{state.vehicles.length - repairVehicles.length - counts.on_trip - counts.assigned}</b> · ремонт <b>{repairVehicles.length}</b>
                </span>
              </div>
              <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 text-xs">
                <span className="text-slate-400">Прицепы</span>
                <span className="text-slate-700">в ремонте <b>{repairTrailers.length}</b></span>
              </div>
              {(repairVehicles.length > 0 || repairTrailers.length > 0) && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {repairVehicles.slice(0, 8).map((v) => (
                    <Pill key={v.id} className="bg-slate-100 text-slate-600" title={`${v.brand} · ${v.plate} — в ремонте`}>
                      <Wrench className="h-2.5 w-2.5 text-red-500" aria-hidden />{v.plate}
                    </Pill>
                  ))}
                  {repairVehicles.length > 8 && <Pill className="bg-slate-100 text-slate-600">+{repairVehicles.length - 8}</Pill>}
                  {repairTrailers.slice(0, 4).map((t) => (
                    <Pill key={t.id} className="bg-slate-100 text-slate-500" title={`${t.brand} · ${t.plate} — в ремонте`}>
                      <Wrench className="h-2.5 w-2.5 text-red-400" aria-hidden />{t.plate}
                    </Pill>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Диалог «В план» — общий с «ATI.SU» и «Планированием»: назначение состава на груз */}
      <PlanDealDialog
        deal={planDeal}
        state={state}
        nowTick={nowTick}
        onOpenChange={(v) => { if (!v) setPlanDeal(null) }}
        onDone={() => onChanged()}
      />

      {/* Диалог отметки недоступности — общая база со «Справочниками» */}
      <Dialog open={markOpen} onOpenChange={(v) => { if (!v) { setMarkOpen(false); setMarkDriver(null); setMarkComment(''); setMarkQuery('') } }}>
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
                    <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />
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
                <Button size="sm" variant="ghost" onClick={() => { setMarkOpen(false); setMarkDriver(null); setMarkComment(''); setMarkQuery('') }}>Отмена</Button>
                <Button size="sm" className="h-8 bg-[#0E1B2C] text-white hover:bg-[#16304f]" disabled={markBusy}
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

/** Группа доски: заголовок с точкой-цветом, счётчик и прокручиваемый список строк */
function Group({ icon, dot, title, count, hint, maxH, action, children }: {
  icon: React.ReactNode
  dot: string
  title: string
  count: number
  hint: string
  maxH: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section aria-label={title}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {icon}
        <span className="text-sm font-bold text-slate-900">{title}</span>
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
        <Pill className="bg-slate-100 text-slate-600">{count}</Pill>
        <InfoTip label={title}>{hint}</InfoTip>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <div className={`space-y-1 overflow-y-auto pr-1 ${maxH} ${THIN_SCROLL}`}>{children}</div>
    </section>
  )
}

/** Строка «На линии»: водитель, состав, текущее плечо, груз, момент освобождения, действия */
function OnTripRow({ row, nowTick, onOpenTrip }: { row: BusyRow; nowTick: number; onOpenTrip: (tripId: string) => void }) {
  const { trip, curLeg } = row
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-100 px-3 py-2 transition-colors hover:border-slate-200">
      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-slate-900">{trip.driver?.fullName ?? '—'}</span>
          <CallButton phone={trip.driver?.phone} name={trip.driver?.fullName} driverId={trip.driverId} withLabel={false} className="h-6 w-6 p-0" />
        </div>
        <div className="truncate text-xs text-slate-500">
          {trip.vehicle ? `${trip.vehicle.brand} · ${trip.vehicle.plate}` : '—'}
          {trip.trailer ? ` + ${trip.trailer.plate}` : ''}
        </div>
      </div>
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex items-center gap-1.5">
          {curLeg && <StatusChip status={curLeg.status} />}
          {(curLeg?.cargoSource === 'ati' || !!curLeg?.dealId) && (
            <Pill className="bg-violet-100 text-violet-700" title="Плечо груза с биржи ATI.SU — сделка в разделе ATI.SU">ATI.SU</Pill>
          )}
          <span className="truncate text-xs text-slate-600">{curLeg ? `${curLeg.loadPoint} → ${curLeg.unloadPoint}` : 'плечи закрыты'}</span>
        </div>
        <div className="truncate text-[11px] text-slate-400">
          {[row.customer, curLeg?.cargoDesc].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-xs font-semibold text-slate-700" title="Плановое освобождение состава: выгрузка последнего плеча + запас">
          ~{row.freesAt ? fmtFrees(row.freesAt, nowTick) : '—'}
        </div>
        <div className="text-[11px] text-slate-400">{row.freesPoint ?? ''}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onOpenTrip(trip.id)} title="Открыть карточку рейса в «Заявках»">
          <ClipboardList className="mr-1 h-3.5 w-3.5" />Рейс
        </Button>
      </div>
    </div>
  )
}

/** Строка «Назначены»: рейс составлен, выезд по плану */
function AssignedRow({ row, nowTick, onOpenTrip }: { row: BusyRow; nowTick: number; onOpenTrip: (tripId: string) => void }) {
  const { trip, curLeg } = row
  const load = curLeg?.loadDatePlan ? new Date(curLeg.loadDatePlan) : null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-sky-100 bg-sky-50/40 px-3 py-2">
      <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-hidden />
      <div className="min-w-0 flex-1 basis-56">
        <div className="truncate text-sm font-medium text-slate-900">{trip.driver?.fullName ?? '—'}</div>
        <div className="truncate text-xs text-slate-500">
          {trip.vehicle ? `${trip.vehicle.brand} · ${trip.vehicle.plate}` : '—'}
          {trip.trailer ? ` + ${trip.trailer.plate}` : ''}
        </div>
      </div>
      <div className="min-w-0 flex-1 basis-64 text-xs text-slate-600">
        <div className="flex items-center gap-1.5">
          <CalendarClock className="shrink-0 h-3 w-3 text-sky-600" aria-hidden />
          <span className="truncate">
            погрузка {load ? fmtFrees(load, nowTick) : 'по окну заявки'} · {curLeg ? `${curLeg.loadPoint} → ${curLeg.unloadPoint}` : '—'}
          </span>
          {(curLeg?.cargoSource === 'ati' || !!curLeg?.dealId) && (
            <Pill className="shrink-0 bg-violet-100 text-violet-700" title="Плечо груза с биржи ATI.SU — сделка в разделе ATI.SU">ATI.SU</Pill>
          )}
        </div>
        <div className="truncate text-[11px] text-slate-400">{[row.customer, curLeg?.cargoDesc].filter(Boolean).join(' · ') || '—'}</div>
      </div>
      <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={() => onOpenTrip(trip.id)} title="Открыть карточку рейса в «Заявках»">
        <ClipboardList className="mr-1 h-3.5 w-3.5" />Рейс
      </Button>
    </div>
  )
}
