/**
 * Движок планирования — общий для раздела «Планирование», доски «Занятость»
 * и диалогов сделок ATI.SU. Чистый модуль без БД: работает и на сервере
 * (планирование сделок), и на клиенте (график, доска, кандидаты) — поэтому
 * «что и когда загрузится / разгрузится / вернётся на АЭМЗ» считается везде
 * одной формулой и разделы не расходятся друг с другом.
 *
 * Цепочка событий состава по рейсу:
 *   порожняк → ПОГРУЗКА → ход → ВЫГРУЗКА → … → возврат на базу АЭМЗ.
 * Времена берутся из планов плеч (факт — если уже есть), недостающее
 * досчитывается: км между городами / 55 км/ч + норматив на погрузку/выгрузку.
 * Источник плеча (заявка 1С или груз ATI.SU) виден цветом и меткой — так
 * «Заявки», «Занятость» и «ATI.SU» сходятся в один график.
 */
import { cityGeo, cityLabel, haversineKm } from '@/lib/kontur/geo'
import { tripFrees } from '@/lib/kontur/availability'
import type { AtiDealDto, Leg, Order, StateResponse, Trip } from '@/lib/kontur/client-types'

// База парка АЭМЗ (Абинск) — точка возврата составов
export const BASE_POINT = 'Абинск (АЭМЗ)'

// Нормативы планирования (эмпирика локальных плеч, как в умном подборе)
export const PLAN = {
  AVG_SPEED_KMH: 55, // средняя скорость тягача на трассе
  LOAD_H: 1.5, // норматив погрузки, ч
  UNLOAD_H: 1.5, // норматив выгрузки, ч
  RETURN_BUF_H: 1, // запас на документы/дозаправку перед возвращением
  MIN_DRIVE_H: 0.5, // минимальное время хода между соседними городами
} as const

const H = 3600000
const DAY_MS = 86400000

// ——— события и строки графика ———

export type PlanEventKind = 'deadhead' | 'load' | 'run' | 'unload' | 'base_return'
export type PlanSource = 'order' | 'ati' | 'base'

export type PlanEvent = {
  key: string
  kind: PlanEventKind
  start: number // ms
  end: number // ms
  km: number | null
  fromPoint?: string
  toPoint?: string
  done: boolean // уже прошло (или факт зафиксирован)
  fact: boolean // время из факта, а не плана
  overdue: boolean // ПРОСРОЧКА: плановый срок прошёл, а факт не закрыт
  source: PlanSource
  tripId?: string
  legId?: string
  dealId?: string | null
  label: string // короткая метка в блоке графика
  title: string // полный текст подсказки
}

export type PlanRowStatus = 'on_trip' | 'assigned' | 'free'

export type PlanRow = {
  driverId: string
  driverName: string
  phone: string | null
  vehicleId: string
  vehicleLabel: string
  trailerPlate: string | null
  status: PlanRowStatus
  tripId: string | null
  events: PlanEvent[]
  overdueCount: number // сколько событий просрочено (срок прошёл, факт не закрыт)
  freesAt: number | null // момент освобождения (та же формула, что в подборе)
  returnAt: number | null // когда состав вернётся на базу АЭМЗ
  awaitingBackhaul: boolean // ждёт обратную загрузку — возврат не планируется
  atBaseNow: boolean
}

export type DealPlanInfo = {
  deal: AtiDealDto
  loadAt: number | null
  km: number | null
  planned: boolean
  tripId: string | null
  driverName: string | null
}

export type WaitingOrder = { order: Order; loadAt: number | null }

export type PlanResult = {
  rows: PlanRow[]
  waitingDeals: DealPlanInfo[] // согласовано, но состава ещё нет
  plannedDeals: DealPlanInfo[] // назначено составом
  waitingOrders: WaitingOrder[] // заявки «к планированию» из «Заявок»
  newOrders: number
  summary: {
    busy: number
    assigned: number
    atBase: number
    loadsToday: number
    unloadsToday: number
    returnsToday: number
    returnsTomorrow: number
    overdue: number // события с истёкшим сроком без закрытого факта
  }
}

// ——— мелкие помощники ———

/** км между пунктами по центрам городов; null — город не опознан */
export function kmBetween(a?: string | null, b?: string | null): number | null {
  const ga = cityGeo(a)
  const gb = cityGeo(b)
  if (!ga || !gb) return null
  const km = haversineKm(ga, gb)
  return km < 1 ? 0 : Math.round(km)
}

/**
 * Дата окна погрузки сделки: ISO (2026-11-21), «21.11» или «21.11.2026»
 * → Date на 09:00 (окно дня). null — даты нет.
 */
export function parseDealDate(s?: string | null, hour = 9): Date | null {
  if (!s) return null
  const str = s.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], hour, 0)
  m = /^(\d{2})\.(\d{2})(?:\.(\d{4}))?$/.exec(str)
  if (m) return new Date(m[3] ? +m[3] : new Date().getFullYear(), +m[2] - 1, +m[1], hour, 0)
  const d = new Date(str)
  return Number.isNaN(d.getTime()) ? null : d
}

/** «сегодня 14:30», «завтра 09:00», иначе «24.11, 14:30» */
export function fmtWhen(ms: number | null | undefined, now: number | Date): string {
  if (ms == null || Number.isNaN(ms)) return '—'
  const d = new Date(ms)
  const base = now instanceof Date ? now : new Date(now)
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (sameDay(d, base)) return `сегодня ${hm}`
  if (sameDay(d, new Date(base.getTime() + DAY_MS))) return `завтра ${hm}`
  return `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}, ${hm}`
}

function fmtRange(a: number, b: number, now: number): string {
  return `${fmtWhen(a, now)} – ${new Date(b).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
}

function isLegOpen(l: Leg): boolean {
  return l.status !== 'completed' && l.status !== 'cancelled'
}

function legSource(leg: Leg, dealIds: Set<string>): PlanSource {
  if (leg.cargoSource === 'ati' || (leg.dealId && dealIds.has(leg.dealId))) return 'ati'
  return 'order'
}

// ——— цепочка событий одного рейса ———

type TripChain = { events: PlanEvent[]; returnAt: number | null; awaitingBackhaul: boolean }

function buildTripChain(trip: Trip, dealIds: Set<string>, now: number): TripChain {
  const events: PlanEvent[] = []
  const legs = [...trip.legs].sort((a, b) => a.seq - b.seq)
  const open = legs.filter(isLegOpen)
  const doneLegs = legs.filter((l) => !isLegOpen(l))
  const lastDone = doneLegs[doneLegs.length - 1] ?? null

  // старт: сейчас; предыдущий пункт — выгрузка последнего закрытого плеча или база
  let cursor = now
  let prevPoint = lastDone ? lastDone.unloadPoint : BASE_POINT

  const push = (
    kind: PlanEventKind,
    start: number,
    end: number,
    km: number | null,
    leg: Leg | null,
    source: PlanSource,
    label: string,
    extraTitle = '',
    fromPoint?: string,
    toPoint?: string,
  ) => {
    events.push({
      key: `${trip.id}-${leg?.id ?? 'x'}-${kind}`,
      kind,
      start,
      end,
      km,
      fromPoint: fromPoint ?? leg?.loadPoint,
      toPoint: toPoint ?? leg?.unloadPoint ?? leg?.loadPoint,
      done: end <= now,
      fact: false,
      overdue: false,
      source,
      tripId: trip.id,
      legId: leg?.id,
      dealId: leg?.dealId ?? null,
      label,
      title: `${label} · ${fmtRange(start, end, now)}${km != null ? ` · ~${km} км` : ''}${extraTitle}`,
    })
  }

  // Просрочка: плановое время операции прошло, а факт не зафиксирован.
  // Сравниваем именно с ПЛАНОМ плеча, а не с пересчитанной цепочкой (цепочка
  // строится от «сейчас» и сдвигает незакрытые операции вперёд — по ней
  // опоздание не увидеть). Помечаем последний добавленный элемент.
  const markOverdue = (leg: Leg, planField: 'loadDatePlan' | 'unloadDatePlan') => {
    const factField = planField === 'loadDatePlan' ? 'loadDateFact' : 'unloadDateFact'
    if (leg[factField]) return
    const plan = leg[planField]
    if (!plan) return
    const planMs = new Date(plan).getTime()
    if (Number.isNaN(planMs) || planMs >= now) return
    const ev = events[events.length - 1]
    if (!ev) return
    ev.overdue = true
    ev.title += ` · ПРОСРОЧКА: план был ${fmtWhen(planMs, now)}, факт не зафиксирован`
  }

  for (const leg of open) {
    const src = legSource(leg, dealIds)
    const srcTitle = src === 'ati' ? ' · груз ATI.SU' : ' · заявка 1С'

    // порожняк к погрузке, если предыдущий пункт — другой город
    const dhKm = kmBetween(prevPoint, leg.loadPoint)
    if (dhKm != null && dhKm > 1) {
      const dur = Math.max(PLAN.MIN_DRIVE_H, dhKm / PLAN.AVG_SPEED_KMH) * H
      push('deadhead', cursor, cursor + dur, dhKm, leg, src, `порожняк → ${cityLabel(leg.loadPoint)}`, srcTitle, prevPoint, leg.loadPoint)
      cursor += dur
    }

    // погрузка: план (или факт), но не раньше прибытия
    const loadPlanRaw = leg.loadDateFact ?? leg.loadDatePlan ?? null
    const loadPlan = loadPlanRaw ? new Date(loadPlanRaw).getTime() : NaN
    const loadStart = Number.isNaN(loadPlan) ? cursor : Math.max(loadPlan, cursor)
    const loadEnd = loadStart + PLAN.LOAD_H * H
    const loadFact = !!leg.loadDateFact
    push('load', loadStart, loadEnd, null, leg, src, `погрузка · ${cityLabel(leg.loadPoint)}`, srcTitle, leg.loadPoint, leg.loadPoint)
    if (loadFact) events[events.length - 1].fact = true
    markOverdue(leg, 'loadDatePlan')
    cursor = loadEnd

    // ход: км из плана плеча или по городам
    const km = leg.kmPlan ?? kmBetween(leg.loadPoint, leg.unloadPoint)
    const dur = (km != null ? Math.max(PLAN.MIN_DRIVE_H, km / PLAN.AVG_SPEED_KMH) : 2) * H
    push('run', cursor, cursor + dur, km, leg, src, `${cityLabel(leg.loadPoint)} → ${cityLabel(leg.unloadPoint)}`, srcTitle, leg.loadPoint, leg.unloadPoint)
    cursor += dur

    // выгрузка: план (или факт), но не раньше прибытия
    const ulPlanRaw = leg.unloadDateFact ?? leg.unloadDatePlan ?? null
    const ulPlan = ulPlanRaw ? new Date(ulPlanRaw).getTime() : NaN
    const ulStart = Number.isNaN(ulPlan) ? cursor : Math.max(ulPlan, cursor)
    const ulEnd = ulStart + PLAN.UNLOAD_H * H
    push('unload', ulStart, ulEnd, null, leg, src, `выгрузка · ${cityLabel(leg.unloadPoint)}`, srcTitle, leg.loadPoint, leg.unloadPoint)
    if (leg.unloadDateFact) events[events.length - 1].fact = true
    markOverdue(leg, 'unloadDatePlan')
    cursor = ulEnd
    prevPoint = leg.unloadPoint
  }

  if (open.length === 0) {
    return { events, returnAt: now, awaitingBackhaul: false }
  }

  // возврат на базу АЭМЗ — если рейс не ждёт обратную загрузку
  if (trip.waitingReturn) {
    return { events, returnAt: null, awaitingBackhaul: true }
  }
  const homeKm = kmBetween(prevPoint, BASE_POINT)
  if (homeKm != null && homeKm > 1) {
    const dur = (homeKm / PLAN.AVG_SPEED_KMH + PLAN.RETURN_BUF_H) * H
    push(
      'base_return',
      cursor,
      cursor + dur,
      homeKm,
      null,
      'base',
      `возврат на базу · ${cityLabel(BASE_POINT)}`,
      ' · после закрытия документов',
      prevPoint,
      BASE_POINT,
    )
    return { events, returnAt: cursor + dur, awaitingBackhaul: false }
  }
  return { events, returnAt: cursor, awaitingBackhaul: homeKm === 0 }
}

// ——— главный расчёт плана парка ———

export type PlannerInput = Pick<StateResponse, 'trips' | 'orders' | 'drivers' | 'vehicles' | 'trailers' | 'bindings' | 'deals'>

export function buildPlan(state: PlannerInput, now: Date | number): PlanResult {
  const nowMs = now instanceof Date ? now.getTime() : now
  const dealIds = new Set(state.deals.map((d) => d.id))

  // сделки: спланирована ли (открытое плечо с dealId) и кем
  const plannedByDeal = new Map<string, { tripId: string; driverName: string | null }>()
  for (const trip of state.trips) {
    for (const leg of trip.legs) {
      if (leg.dealId && isLegOpen(leg) && !plannedByDeal.has(leg.dealId)) {
        plannedByDeal.set(leg.dealId, { tripId: trip.id, driverName: trip.driver?.fullName ?? null })
      }
    }
  }

  // рейсы → строки графика
  const rows: PlanRow[] = []
  for (const trip of state.trips) {
    if (trip.status !== 'active' && trip.status !== 'draft') continue
    const chain = buildTripChain(trip, dealIds, nowMs)
    const frees = tripFrees(trip.legs, new Date(nowMs))
    rows.push({
      driverId: trip.driverId,
      driverName: trip.driver?.fullName ?? '—',
      phone: trip.driver?.phone ?? null,
      vehicleId: trip.vehicleId,
      vehicleLabel: trip.vehicle ? `${trip.vehicle.brand} · ${trip.vehicle.plate}` : '—',
      trailerPlate: trip.trailer?.plate ?? null,
      status: trip.status === 'active' ? 'on_trip' : 'assigned',
      tripId: trip.id,
      events: chain.events,
      overdueCount: chain.events.filter((e) => e.overdue).length,
      freesAt: frees ? frees.at.getTime() : null,
      returnAt: chain.returnAt,
      awaitingBackhaul: chain.awaitingBackhaul,
      atBaseNow: false,
    })
  }
  const busyDriverIds = new Set(rows.map((r) => r.driverId))
  const busyVehicleIds = new Set(rows.map((r) => r.vehicleId))

  // свободные водители — резерв на базе
  const bindingByDriver = new Map(state.bindings.map((b) => [b.driverId, b]))
  for (const d of state.drivers) {
    if (d.status !== 'active' || busyDriverIds.has(d.id)) continue
    const b = bindingByDriver.get(d.id)
    const v = b?.vehicle ?? null
    const veh = v && !v.isRepair ? v : null
    rows.push({
      driverId: d.id,
      driverName: d.fullName,
      phone: d.phone,
      vehicleId: veh?.id ?? '',
      vehicleLabel: veh ? `${veh.brand} · ${veh.plate}` : 'состав не закреплён',
      trailerPlate: b?.trailer?.plate ?? null,
      status: 'free',
      tripId: null,
      events: [],
      overdueCount: 0,
      freesAt: nowMs,
      returnAt: nowMs,
      awaitingBackhaul: false,
      atBaseNow: true,
    })
  }

  // сортировка: сначала просрочка (самое горящее), затем занятые по
  // ближайшему событию, свободные в конец — диспетчер сразу видит проблемы
  rows.sort((a, b) => {
    if (a.overdueCount !== b.overdueCount) return b.overdueCount - a.overdueCount
    if (a.status !== 'free' && b.status === 'free') return -1
    if (a.status === 'free' && b.status !== 'free') return 1
    const ea = a.events[0]?.start ?? a.freesAt ?? Infinity
    const eb = b.events[0]?.start ?? b.freesAt ?? Infinity
    return ea - eb
  })

  // сделки: ждут планирования / уже в плане
  const allDealInfos: DealPlanInfo[] = state.deals
    .filter((d) => d.status === 'active')
    .map((d) => {
      const loadAt = parseDealDate(d.loadDateFrom)
      const planned = plannedByDeal.get(d.id)
      return { deal: d, loadAt: loadAt ? loadAt.getTime() : null, km: d.km, planned: !!planned, tripId: planned?.tripId ?? null, driverName: planned?.driverName ?? null }
    })
  const stageRank = (x: DealPlanInfo) => (x.deal.stage === 'full' ? 0 : 1)
  const waitingDeals = allDealInfos.filter((x) => !x.planned).sort((a, b) => stageRank(a) - stageRank(b) || (a.loadAt ?? Infinity) - (b.loadAt ?? Infinity))
  const plannedDeals = allDealInfos.filter((x) => x.planned)

  // заявки «к планированию»
  const waitingOrders: WaitingOrder[] = state.orders
    .filter((o) => o.status === 'ready_to_plan')
    .map((o) => ({ order: o, loadAt: o.loadDatePlan ? new Date(o.loadDatePlan).getTime() : null }))
    .sort((a, b) => (a.loadAt ?? Infinity) - (b.loadAt ?? Infinity))
  const newOrders = state.orders.filter((o) => o.status === 'new').length

  // сводка
  const dayStart = new Date(nowMs)
  dayStart.setHours(0, 0, 0, 0)
  const t0 = dayStart.getTime()
  const inDay = (ms: number | null | undefined, from: number, to: number) => ms != null && ms >= from && ms < to
  let loadsToday = 0
  let unloadsToday = 0
  for (const r of rows) {
    for (const e of r.events) {
      if (e.kind === 'load' && inDay(e.start, t0, t0 + DAY_MS)) loadsToday++
      if (e.kind === 'unload' && inDay(e.start, t0, t0 + DAY_MS)) unloadsToday++
    }
  }
  const returnsToday = rows.filter((r) => r.status !== 'free' && inDay(r.returnAt, t0, t0 + DAY_MS)).length
  const returnsTomorrow = rows.filter((r) => r.status !== 'free' && inDay(r.returnAt, t0 + DAY_MS, t0 + 2 * DAY_MS)).length
  const atBase = rows.filter((r) => r.status === 'free' && r.vehicleId).length
  const overdue = rows.reduce((acc, r) => acc + r.overdueCount, 0)

  return {
    rows,
    waitingDeals,
    plannedDeals,
    waitingOrders,
    newOrders,
    summary: {
      busy: rows.filter((r) => r.status === 'on_trip').length,
      assigned: rows.filter((r) => r.status === 'assigned').length,
      atBase,
      loadsToday,
      unloadsToday,
      returnsToday,
      returnsTomorrow,
      overdue,
    },
  }
}

// ——— кандидаты под груз ATI.SU (диалог «В план») ———

export type DealCandidate = {
  kind: 'composition' | 'trip'
  driverId: string
  driverName: string
  phone: string | null
  vehicleId: string
  vehicleLabel: string
  vehicleCapacityT: number | null
  trailerPlate: string | null
  tripId: string | null
  freesAt: number | null // null = свободен сейчас
  freesPoint: string | null
  deadheadKm: number | null
  reasons: { kind: 'plus' | 'warn'; text: string }[]
}

/** Кандидаты под сделку ATI.SU: свободный состав + рейсы, освобождающиеся к окну погрузки */
export function dealCandidates(deal: AtiDealDto, state: PlannerInput, now: Date | number): DealCandidate[] {
  const nowMs = now instanceof Date ? now.getTime() : now
  const weightT = deal.weightT ?? 20
  const loadAt = parseDealDate(deal.loadDateFrom)
  const loadAtMs = loadAt ? loadAt.getTime() : null

  const plan = buildPlan(state, nowMs)
  const busyDriverIds = new Set(plan.rows.filter((r) => r.status !== 'free').map((r) => r.driverId))
  const busyVehicleIds = new Set(plan.rows.filter((r) => r.status !== 'free').map((r) => r.vehicleId))
  const bindingByDriver = new Map(state.bindings.map((b) => [b.driverId, b]))

  const out: DealCandidate[] = []

  // 1) свободный состав: активный водитель без рейса + исправный тягач (закреплённый или свободный)
  for (const d of state.drivers) {
    if (d.status !== 'active' || busyDriverIds.has(d.id)) continue
    const b = bindingByDriver.get(d.id)
    const pinnedV = b?.vehicle ?? null
    let veh = pinnedV && !pinnedV.isRepair && !busyVehicleIds.has(pinnedV.id) ? pinnedV : null
    const reasons: DealCandidate['reasons'] = []
    if (veh && b) reasons.push({ kind: 'plus', text: 'Закреплённый состав — водитель на своей машине' })
    if (!veh) {
      // закреплённый занят/в ремонте — берём свободный тягач подходящей ёмкости
      const free = state.vehicles
        .filter((v) => !v.isRepair && !busyVehicleIds.has(v.id) && v.ownershipType === 'OWNED')
        .filter((v) => v.capacityT == null || v.capacityT >= weightT)
        .sort((a, b2) => (a.capacityT ?? 99) - (b2.capacityT ?? 99))[0]
      veh = free ?? null
      if (pinnedV) reasons.push({ kind: 'warn', text: `Закреплённый тягач ${pinnedV.plate} недоступен — предложен свободный` })
    }
    if (!veh) continue
    if (veh.capacityT != null && veh.capacityT < weightT) continue
    if (veh.capacityT != null) reasons.push({ kind: 'plus', text: `Ёмкость ${Math.round(veh.capacityT)} т ≥ ${Math.round(weightT)} т груза` })
    reasons.push({ kind: 'plus', text: 'Свободен на базе АЭМЗ — выезд по плану к погрузке' })
    if (loadAtMs != null && loadAtMs - nowMs < 12 * H) {
      reasons.push({ kind: 'warn', text: `Окно погрузки уже близко (${fmtWhen(loadAtMs, nowMs)}) — уточните готовность водителя` })
    }
    out.push({
      kind: 'composition',
      driverId: d.id,
      driverName: d.fullName,
      phone: d.phone,
      vehicleId: veh.id,
      vehicleLabel: `${veh.brand} · ${veh.plate}`,
      vehicleCapacityT: veh.capacityT ?? null,
      trailerPlate: b?.trailer?.plate ?? null,
      tripId: null,
      freesAt: null,
      freesPoint: BASE_POINT,
      deadheadKm: kmBetween(BASE_POINT, deal.from),
      reasons,
    })
  }

  // 2) рейсы в работе: освобождаются к окну погрузки — груз плечом, без порожняка
  for (const trip of state.trips) {
    if (trip.status !== 'active') continue
    const driver = trip.driver
    if (!driver || driver.status !== 'active') continue
    const frees = tripFrees(trip.legs, new Date(nowMs))
    if (!frees) continue
    // не успевает к окну погрузки (допуск +12 ч, как обратка) — не предлагаем
    if (loadAtMs != null && frees.at.getTime() > loadAtMs + 12 * H) continue
    if (loadAtMs == null && frees.at.getTime() > nowMs + 24 * H) continue
    const deadheadKm = kmBetween(frees.point, deal.from)
    const reasons: DealCandidate['reasons'] = [
      { kind: 'plus', text: `Освобождается ${fmtWhen(frees.at.getTime(), nowMs)} в ${cityLabel(frees.point)}` },
    ]
    if (deadheadKm != null && deadheadKm <= 1) {
      reasons.push({ kind: 'plus', text: 'Выгружается там же, где погрузка груза — без порожняка' })
    } else if (deadheadKm != null) {
      reasons.push({ kind: 'plus', text: `${deadheadKm} км порожнего пробега до погрузки груза` })
    }
    const vehicle = trip.vehicle
    if (vehicle?.capacityT != null && vehicle.capacityT < weightT) continue
    out.push({
      kind: 'trip',
      driverId: trip.driverId,
      driverName: driver.fullName,
      phone: driver.phone,
      vehicleId: trip.vehicleId,
      vehicleLabel: vehicle ? `${vehicle.brand} · ${vehicle.plate}` : '—',
      vehicleCapacityT: vehicle?.capacityT ?? null,
      trailerPlate: trip.trailer?.plate ?? null,
      tripId: trip.id,
      freesAt: frees.at.getTime(),
      freesPoint: frees.point,
      deadheadKm,
      reasons,
    })
  }

  // свободный состав — первым (внутри — по фамилии), затем рейсы по времени освобождения
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'composition' ? -1 : 1
    if (a.kind === 'composition') return a.driverName.localeCompare(b.driverName, 'ru')
    return (a.freesAt ?? 0) - (b.freesAt ?? 0)
  })
  return out.slice(0, 10)
}
