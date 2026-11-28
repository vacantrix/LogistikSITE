'use client'

/**
 * Вид «Сейчас» объединённого раздела «Планирование» — доска занятости одним экраном.
 * Выделена из прежнего раздела «Занятость»: шапка с поиском, общие фильтры-чипы и
 * KPI-плитки переехали на уровень общего экрана (PlanningPanel) и работают
 * для обоих видов («Сейчас» и «График»). Здесь осталась сама доска групп
 * и правая колонка: «Ждёт планирования» (общая колонка) + «Готовность · 7 дней»
 * и «Техника» (уникальные для этого вида).
 *
 * Статусы не вводятся вручную — они выводятся из уже заведённых данных платформы:
 *   «на линии»    — активный рейс (назначение и плечи из «Заявок»);
 *   «назначен»    — рейс составлен, выезд ещё по плану;
 *   «свободен»    — активный водитель без рейса (состав — из закреплений);
 *   «недоступен»  — отметка справочника (больничный/отпуск/отгул) либо ремонт техники.
 * Расчёт занятости (busy/free/off) делает PlanningPanel тем же движком
 * (src/lib/kontur/planner.ts), что рисует график, — доска и график не расходятся.
 */
import { useMemo, type ReactNode } from 'react'
import { CalendarClock, CalendarDays, ClipboardList, Link2, Route, UserCheck, UserX, Wrench } from 'lucide-react'
import { Card, CardContent } from '@/components/kontur/ui/card'
import { Button } from '@/components/kontur/ui/button'
import { InfoTip, Pill, StatusChip } from '@/components/kontur/proto/bits'
import { CallButton } from '@/components/kontur/proto/CallButton'
import type { Driver, Leg, StateResponse, Trip } from '@/lib/kontur/client-types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full'

/** Общий фильтр-чип раздела: статусы доски + «просрочка» (вид «График») */
export type PlanChip = 'all' | 'on_trip' | 'assigned' | 'free' | 'off' | 'overdue'

/** Отметки недоступности из справочника водителей — цвета согласованы со «Справочниками»:
 *  больничный — amber (внеплановая недоступность, требует замены), отпуск/отгул — slate */
export const OFF_META: Record<string, { label: string; dot: string }> = {
  sick: { label: 'Больничный', dot: 'bg-amber-500' },
  vacation: { label: 'Отпуск', dot: 'bg-slate-400' },
  other: { label: 'Отгул', dot: 'bg-slate-300' },
}

/** Строка доски для занятого водителя (активный или назначенный рейс) */
export type BusyRow = {
  kind: 'on_trip' | 'assigned'
  trip: Trip
  curLeg: Leg | null // текущее открытое плечо (для назначенного — первое незакрытое)
  freesAt: Date | null
  freesPoint: string | null
  customer: string | null
}

export type WeekDay = { from: Date; n: number; loads: number; today: boolean }

/** Короткий человекочитаемый момент: «сегодня 14:30», «завтра 09:00», иначе «26.11» */
export function fmtFrees(d: Date, nowTick: number): string {
  const now = new Date(nowTick)
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (sameDay(d, now)) return `сегодня ${hm}`
  const tomorrow = new Date(now.getTime() + 86400000)
  if (sameDay(d, tomorrow)) return `завтра ${hm}`
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

export function OccupancyBoard({ state, nowTick, busy, free, off, counts, week, query, filter, onFilterChange, onOpenTrip, onMarkOpen, onPatchDriverStatus, waitingColumn }: {
  state: StateResponse
  nowTick: number
  /** строки занятости считает PlanningPanel (общий движок с графиком) */
  busy: BusyRow[]
  free: Driver[]
  off: Driver[]
  counts: { on_trip: number; assigned: number; free: number; off: number; total: number }
  /** недельная готовность (возвраты по дням + плановые погрузки) — считает PlanningPanel */
  week: WeekDay[]
  /** общий поиск раздела (водитель, госномер, маршрут) */
  query: string
  /** общий фильтр-чип раздела (значения «Графика» на доске ведут себя как «все») */
  filter: PlanChip
  onFilterChange: (f: PlanChip) => void
  onOpenTrip: (tripId: string) => void
  /** открыть диалог «Отметить недоступность» (null — выбор водителя из списка) */
  onMarkOpen: (driver: Driver | null) => void
  /** снять отметку недоступности («В строй») */
  onPatchDriverStatus: (id: string, status: string, statusComment: string, name: string) => void
  /** общая колонка «Ждёт планирования» (+ обратки) — рендерит PlanningPanel */
  waitingColumn: ReactNode
}) {
  const bindingByDriver = useMemo(() => new Map(state.bindings.map((b) => [b.driverId, b])), [state.bindings])
  const repairVehicles = useMemo(() => state.vehicles.filter((v) => v.isRepair), [state.vehicles])
  const repairTrailers = useMemo(() => state.trailers.filter((t) => t.isRepair), [state.trailers])
  const vehicleById = useMemo(() => new Map(state.vehicles.map((v) => [v.id, v])), [state.vehicles])
  const trailerById = useMemo(() => new Map(state.trailers.map((t) => [t.id, t])), [state.trailers])

  // Водитель без рейса на сломанной технике — фактически недоступен (причина для строки доски)
  function repairReason(driverId: string): string | null {
    const b = bindingByDriver.get(driverId)
    if (!b) return null
    if (vehicleById.get(b.vehicleId)?.isRepair) return `тягач в ремонте · ${vehicleById.get(b.vehicleId)!.plate}`
    if (b.trailerId && trailerById.get(b.trailerId)?.isRepair) return `прицеп в ремонте · ${trailerById.get(b.trailerId)!.plate}`
    return null
  }

  // ——— фильтр и поиск (общие с видом «График») ———
  // «просрочка» — фильтр графика: на доске ведёт себя как «все»
  const occFilter: 'all' | 'on_trip' | 'assigned' | 'free' | 'off' = filter === 'overdue' ? 'all' : filter
  const q = query.trim().toLowerCase()
  const matches = (...parts: (string | null | undefined)[]) => !q || parts.some((p) => p?.toLowerCase().includes(q))
  const busyVisible = busy.filter((r) => matches(r.trip.driver?.fullName, r.trip.vehicle?.plate, r.trip.trailer?.plate, r.curLeg && `${r.curLeg.loadPoint} → ${r.curLeg.unloadPoint}`, r.customer))
  const freeVisible = free.filter((d) => matches(d.fullName, bindingByDriver.get(d.id)?.vehicle?.plate, bindingByDriver.get(d.id)?.trailer?.plate))
  const offVisible = off.filter((d) => matches(d.fullName, d.statusComment, repairReason(d.id)))
  const visible: Record<'all' | 'on_trip' | 'assigned' | 'free' | 'off', boolean> = {
    all: true,
    on_trip: counts.on_trip > 0 && busyVisible.some((r) => r.kind === 'on_trip'),
    assigned: counts.assigned > 0 && busyVisible.some((r) => r.kind === 'assigned'),
    free: freeVisible.length > 0,
    off: offVisible.length > 0,
  }

  const FILTERS: { id: 'all' | 'on_trip' | 'assigned' | 'free' | 'off'; label: string; count: number }[] = [
    { id: 'all', label: 'Все', count: counts.total },
    { id: 'on_trip', label: 'На линии', count: counts.on_trip },
    { id: 'assigned', label: 'Назначены', count: counts.assigned },
    { id: 'free', label: 'Свободны', count: counts.free },
    { id: 'off', label: 'Недоступны', count: counts.off },
  ]

  const showGroup = (f: 'all' | 'on_trip' | 'assigned' | 'free' | 'off') => (occFilter === 'all' || occFilter === f) && visible[f]

  const weekMax = Math.max(1, ...week.map((d) => d.n))

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {/* Доска групп */}
      <Card className="rounded-xl border-slate-200 shadow-sm xl:col-span-2">
        <CardContent className="space-y-4 p-4">
          {/* Фильтры-чипы: общие с видом «График», клик = показать только эту группу */}
          <div className="flex flex-wrap gap-1" role="group" aria-label="Фильтр занятости">
            {FILTERS.map((f) => {
              const active = occFilter === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onFilterChange(active ? 'all' : f.id)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    active ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {f.label}
                  <span className={`rounded-full px-1.5 text-[10px] font-bold ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'}`}>{f.count}</span>
                </button>
              )
            })}
          </div>

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
              dot="bg-blue-600"
              title="Назначены"
              count={counts.assigned}
              hint="Рейс составлен в «Заявках» (включая грузы ATI.SU, взятые в план), выезд ещё по плану — состав занят под заявку."
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
              dot="bg-slate-400"
              title="Свободны · резерв для планирования"
              count={counts.free}
              hint="Водители в строю без рейса. Состав — из закреплений; «—» значит состав не закреплён, технику подберёт умный подбор в «Заявках»."
              maxH="max-h-96"
              action={
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onMarkOpen(null)}>
                  <UserX className="mr-1 h-3.5 w-3.5 text-red-600" />Отметить недоступность
                </Button>
              }
            >
              {freeVisible.map((d) => {
                const b = bindingByDriver.get(d.id)
                const rr = repairReason(d.id)
                return (
                  <div key={d.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" aria-hidden />
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
                        onClick={() => onMarkOpen(d)}>
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
              dot="bg-amber-500"
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
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          title="Снять отметку недоступности"
                          onClick={() => onPatchDriverStatus(d.id, 'active', '', d.fullName)}>
                          <UserCheck className="mr-1 h-3.5 w-3.5 text-emerald-600" />В строй
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-500"
                          onClick={() => onMarkOpen(d)}>
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
              {q ? `По запросу «${query}» никого не найдено` : 'Водителей нет'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Правая колонка: общая «Ждёт планирования» + недельная готовность + техника */}
      <div className="space-y-4">
        {waitingColumn}

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
  )
}

/** Группа доски: заголовок с точкой-цветом, счётчик и прокручиваемый список строк */
function Group({ icon, dot, title, count, hint, maxH, action, children }: {
  icon: ReactNode
  dot: string
  title: string
  count: number
  hint: string
  maxH: string
  action?: ReactNode
  children: ReactNode
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2">
      <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" aria-hidden />
      <div className="min-w-0 flex-1 basis-56">
        <div className="truncate text-sm font-medium text-slate-900">{trip.driver?.fullName ?? '—'}</div>
        <div className="truncate text-xs text-slate-500">
          {trip.vehicle ? `${trip.vehicle.brand} · ${trip.vehicle.plate}` : '—'}
          {trip.trailer ? ` + ${trip.trailer.plate}` : ''}
        </div>
      </div>
      <div className="min-w-0 flex-1 basis-64 text-xs text-slate-600">
        <div className="flex items-center gap-1.5">
          <CalendarClock className="shrink-0 h-3 w-3 text-blue-600" aria-hidden />
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
