// Умный подбор под заявку (подсказчик логиста). По клику на заявку кабинет
// считает, кто и какой рейс подойдёт идеально, и объясняет почему:
//
//   1) «Рейсы в работе» — активные рейсы, к которым заявку выгодно добавить
//      плечом: машина всё равно выгружается рядом с погрузкой заявки или
//      освобождается к нужному часу (меньше порожнего пробега);
//   2) «Свободный состав» — водитель + тягач + прицеп под новый рейс:
//      свободные сейчас на базе и освобождающиеся к дате погрузки.
//
// Факторы скоринга: дата/время (успевает ли на окно погрузки), география
// (км от точки освобождения до пункта погрузки), грузоподъёмность (вес из
// строк 1С против ёмкости тягача), документы (ВУ водителя, ТО тягача/прицепа
// на весь период рейса), онлайн-статус водителя из мониторинга и закрепление
// состава (водитель ↔ тягач ↔ прицеп: «родная» машина получает приоритет
// при раздаче свободной техники и бонус к баллу).
// Жёсткие запреты (водитель в отпуске, ВУ истекло, ТС в ремонте, не успевает
// на погрузку) исключают кандидата полностью — показываются только жизнеспособные.
import { db } from '@/lib/kontur/db'
import { cityGeo, cityLabel, haversineKm } from '@/lib/kontur/geo'
import { tripFrees, type FreesInfo } from '@/lib/kontur/availability'

// Момент освобождения состава считается в общем модуле availability.ts —
// ту же формулу использует доска «Занятость», чтобы разделы не расходились.
export { tripFrees }
export type { FreesInfo }

// ——— типы контракта (клиент зеркалит их в RequestsPanel) ———

export type MatchReason = { kind: 'plus' | 'warn'; text: string }
export type MatchGrade = 'ideal' | 'good' | 'risky'

export type MatchCandidate = {
  kind: 'trip' | 'composition'
  score: number // 0..100
  grade: MatchGrade
  tripId?: string // для kind=trip
  driver: { id: string; fullName: string; phone: string }
  vehicle: { id: string; brand: string; plate: string; capacityT: number | null }
  trailer: { id: string; brand: string; plate: string; type: string } | null
  pinned: boolean // состав закреплён за водителем (кнопка «Закрепить»)
  usual: { vehicleBrand: string; vehiclePlate: string; trailerPlate: string | null } | null
  freesAt: string | null // ISO: когда состав освобождается (null = свободен сейчас)
  freesAtPoint: string | null // пункт, где состав освобождается
  deadheadKm: number | null // порожний пробег до пункта погрузки заявки
  nowRoute: string | null // текущее плечо рейса (для kind=trip)
  nowStatus: string | null // статус онлайн-мониторинга водителя
  reasons: MatchReason[]
}

export type MatchResult = {
  order: {
    id: string
    number: string
    weightT: number
    weightSource: 'lines' | 'estimate'
    loadAt: string // ISO — расчётное окно погрузки
    loadPoint: string
    unloadPoint: string
  }
  trips: MatchCandidate[]
  compositions: MatchCandidate[]
  meta: {
    generatedAt: string
    activeTrips: number
    freeDrivers: number
    freeVehicles: number
    notes: string[]
  }
}

// ——— параметры подбора (эмпирика локальных плеч АЭМЗ, юг России) ———

const MATCH = {
  AVG_SPEED_KMH: 55, // средняя скорость тягача на трассе — оценка прибытия
  LATE_TOLERANCE_H: 1, // насколько позже окна погрузки ещё допустимо освобождение
  DEADHEAD_KM_PENALTY: 5, // минус балл за каждые N км порожнего пробега (рейсы)
  DEADHEAD_KM_PENALTY_COMP: 8, // то же для свободного состава (строже)
  TOP_N: 4, // сколько кандидатов каждого типа показывать
  GEO_NEUTRAL_SCORE: 25, // км между городами не посчитать — нейтральная оценка
  PINNED_BONUS_TRIP: 6, // бонус «состав закреплён за водителем» (рейсы/освобождающиеся)
  PINNED_BONUS_COMP: 8, // то же для свободного состава (водитель знает свою машину)
} as const

// ——— мелкие помощники ——

/** «ДД.ММ.ГГГГ» → Date (23:59 конца дня); null если формата нет */
export function parseRuDate(s?: string | null): Date | null {
  if (!s || !/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return null
  const [d, m, y] = s.split('.').map(Number)
  const dt = new Date(y, m - 1, d, 23, 59)
  return Number.isNaN(dt.getTime()) ? null : dt
}

const DAY_MS = 86400000

/** Дней от now до даты (может быть отрицательным) */
function daysUntil(dt: Date, now: Date): number {
  return (dt.getTime() - now.getTime()) / DAY_MS
}

/** Короткое время по-русски: «сегодня 14:00», «завтра 09:30», «21.11, 14:00» */
function fmtRu(dt: Date, now: Date): string {
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const hm = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (sameDay(dt, now)) return `сегодня ${hm}`
  if (sameDay(dt, new Date(now.getTime() + DAY_MS))) return `завтра ${hm}`
  return `${dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}, ${hm}`
}

/** км между пунктами (по центрам городов); null — город не опознан */
function kmBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  const ga = cityGeo(a)
  const gb = cityGeo(b)
  if (!ga || !gb) return null
  const km = haversineKm(ga, gb)
  return km < 1 ? 0 : Math.round(km)
}

function grade(score: number): MatchGrade {
  if (score >= 85) return 'ideal'
  if (score >= 65) return 'good'
  return 'risky'
}

// ——— оценка момента освобождения рейса ———
// tripFrees и FreesInfo импортированы из общего модуля availability.ts (см. шапку файла)

type BindingRow = { driverId: string; vehicleId: string; trailerId: string | null }

/** Закрепление кандидата: этот ли состав закреплён за водителем */
function isPinned(binding: BindingRow | undefined, driverId: string, vehicleId: string, trailerId: string | null | undefined): boolean {
  if (!binding || binding.driverId !== driverId) return false
  if (binding.vehicleId !== vehicleId) return false
  return (binding.trailerId ?? null) === (trailerId ?? null)
}

/** Закрепление водителя для подсказки «обычно работает на…» (когда состав другой) */
function usualOf(
  binding: BindingRow | undefined,
  driverId: string,
  vehicleId: string,
  vehicleById: Map<string, { brand: string; plate: string }>,
): { vehicleBrand: string; vehiclePlate: string; trailerPlate: string | null } | null {
  if (!binding || binding.driverId !== driverId || binding.vehicleId === vehicleId) return null
  const v = vehicleById.get(binding.vehicleId)
  return { vehicleBrand: v?.brand ?? 'тягач', vehiclePlate: v?.plate ?? '—', trailerPlate: binding.trailerId ?? null }
}

/** Почему закреплённый тягач недоступен для нового рейса (текст подсказки) */
function pinnedVehicleWhy(
  v: { isRepair: boolean; capacityT: number | null; techTill: string | null } | undefined,
  busy: boolean,
  weight: number,
  needUntil: Date,
): string {
  if (!v) return 'снят с учёта'
  if (busy) return 'в рейсе'
  if (v.isRepair) return 'в ремонте'
  if (v.capacityT != null && v.capacityT < weight) return 'не тянет вес груза'
  const till = parseRuDate(v.techTill)
  if (till && !docsState(till, needUntil).ok) return 'ТО истекает до конца рейса'
  return 'недоступна'
}

/** Документ действителен на всю длину рейса; заодно дни запаса после выгрузки */
function docsState(validUntil: Date | null, needUntil: Date): { ok: boolean; days: number | null } {
  if (!validUntil) return { ok: true, days: null } // срока нет в справочнике — не блокируем
  const days = daysUntil(validUntil, needUntil)
  return { ok: days >= 0, days }
}

// ——— вес заявки из строк 1С (extra.lines[].qty, тонны) ———

function orderWeightT(order: { extra: string | null; product: string }): { weight: number; source: 'lines' | 'estimate' } {
  try {
    const extra = order.extra ? (JSON.parse(order.extra) as { lines?: { qty?: number }[] }) : null
    const sum = extra?.lines?.reduce((n, l) => n + (typeof l.qty === 'number' ? l.qty : 0), 0)
    if (sum && sum > 0) return { weight: Math.round(sum * 1000) / 1000, source: 'lines' }
  } catch {
    /* extra битый — берём оценку ниже */
  }
  // Оценка: типовая загрузка металлопрокатом 20 т (полуприцеп-штора)
  return { weight: 20, source: 'estimate' }
}

// ——— главный расчёт ———

export async function buildMatchForOrder(orderId: string): Promise<MatchResult | null> {
  const order = await db.order.findUnique({ where: { id: orderId } })
  if (!order) return null

  const [drivers, vehicles, trailers, trips, legs, online, bindings] = await Promise.all([
    db.driver.findMany(),
    db.vehicle.findMany(),
    db.trailer.findMany(),
    db.trip.findMany(),
    db.leg.findMany(),
    db.driverOnline.findMany(),
    db.vehicleBinding.findMany(),
  ])

  const now = new Date()
  const notes: string[] = []

  // Окно погрузки: план заявки; если 1С не передал — считаем «сегодня до конца дня»
  let loadAt = order.loadDatePlan ? new Date(order.loadDatePlan) : null
  if (!loadAt || Number.isNaN(loadAt.getTime())) {
    loadAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0)
    notes.push('Дата погрузки в заявке не указана — подбор под сегодняшний день')
  }
  const unloadAt = order.unloadDatePlan ? new Date(order.unloadDatePlan) : new Date(loadAt.getTime() + DAY_MS)
  const latestDocNeed = unloadAt > loadAt ? unloadAt : loadAt

  const { weight, source } = orderWeightT(order)
  if (source === 'estimate') notes.push(`Вес оценочно ${weight} т — строки 1С не переданы`)

  // Индексы
  const driverById = new Map(drivers.map((d) => [d.id, d]))
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]))
  const trailerById = new Map(trailers.map((t) => [t.id, t]))
  const legsByTrip = new Map<string, typeof legs>()
  for (const l of legs) {
    const arr = legsByTrip.get(l.tripId) || []
    arr.push(l)
    legsByTrip.set(l.tripId, arr)
  }
  const onlineByDriver = new Map(online.map((o) => [o.driverId, o]))
  const bindingByDriver = new Map(bindings.map((b) => [b.driverId, b]))

  const activeTrips = trips.filter((t) => t.status === 'active')
  // Занятость — активные рейсы И назначенные (черновые, в т.ч. грузы ATI.SU,
  // взятые в план в «Планировании»): доска «Занятость» считает занятыми и тех
  // и других — здесь та же логика, чтобы подбор не предлагал занятый состав
  const openTrips = trips.filter((t) => t.status === 'active' || t.status === 'draft')
  const busyVehicleIds = new Set(openTrips.map((t) => t.vehicleId))
  const busyTrailerIds = new Set(openTrips.filter((t) => t.trailerId).map((t) => t.trailerId as string))
  const tripByDriver = new Map<string, typeof trips[number]>()
  for (const t of openTrips) tripByDriver.set(t.driverId, t)

  // ——— 1) Активные рейсы: добавить заявку плечом ———
  const tripCandidates: MatchCandidate[] = []
  for (const trip of activeTrips) {
    const tLegs = legsByTrip.get(trip.id) ?? []
    // заявка уже в этом рейсе — не предлагаем
    if (tLegs.some((l) => l.orderId === order.id)) continue

    const frees = tripFrees(tLegs, now)
    if (!frees) continue
    const driver = driverById.get(trip.driverId)
    const vehicle = vehicleById.get(trip.vehicleId)
    if (!driver || !vehicle) continue

    // Жёсткие запреты
    if (driver.status !== 'active') continue
    const lic = parseRuDate(driver.licenseUntil)
    if (!docsState(lic, latestDocNeed).ok) continue // ВУ истекает до конца рейса
    const vehTill = parseRuDate(vehicle.techTill)
    if (!docsState(vehTill, latestDocNeed).ok) continue // ТО истекает до конца рейса
    if (vehicle.capacityT != null && vehicle.capacityT < weight) continue // не везёт вес
    // Не успевает на окно погрузки (с допуском)
    const lateH = (frees.at.getTime() - loadAt.getTime()) / 3600000
    if (lateH > MATCH.LATE_TOLERANCE_H) continue

    const reasons: MatchReason[] = []
    const warnings: MatchReason[] = []

    // География: порожний пробег от выгрузки рейса до погрузки заявки
    const deadheadKm = kmBetween(frees.point, order.loadPoint)
    let geoScore: number
    if (deadheadKm == null) {
      geoScore = MATCH.GEO_NEUTRAL_SCORE
    } else if (deadheadKm === 0) {
      geoScore = 40
      reasons.push({ kind: 'plus', text: `Выгружается там же, где погрузка заявки (${cityLabel(order.loadPoint)}) — без порожняка` })
    } else {
      geoScore = Math.max(5, 40 - deadheadKm / MATCH.DEADHEAD_KM_PENALTY)
      reasons.push({ kind: 'plus', text: `${deadheadKm} км порожнего пробега до пункта погрузки` })
    }

    // Время: запас между освобождением и окном погрузки
    const gapH = (loadAt.getTime() - frees.at.getTime()) / 3600000
    let timeScore: number
    if (gapH >= -MATCH.LATE_TOLERANCE_H && gapH <= 3) {
      timeScore = 30
      reasons.push({ kind: 'plus', text: `Освобождается ${fmtRu(frees.at, now)} — точно к окну погрузки` })
    } else if (gapH > 3 && gapH <= 24) {
      timeScore = Math.max(12, 30 - (gapH - 3))
      reasons.push({ kind: 'plus', text: `Освобождается ${fmtRu(frees.at, now)} — за ${Math.round(gapH)} ч до погрузки` })
    } else if (gapH > 24) {
      timeScore = 8
      reasons.push({ kind: 'plus', text: `Освобождается ${fmtRu(frees.at, now)}` })
    } else {
      timeScore = 12 // впритык (в пределах допуска)
      warnings.push({ kind: 'warn', text: `Освобождается впритык к погрузке (${fmtRu(frees.at, now)}) — уточните у водителя` })
    }

    // Документы: запас ВУ и ТО после рейса
    let docsScore = 15
    const licDays = lic ? daysUntil(lic, latestDocNeed) : null
    const tillDays = vehTill ? daysUntil(vehTill, latestDocNeed) : null
    if ((licDays != null && licDays < 30) || (tillDays != null && tillDays < 30)) {
      docsScore = 8
      if (licDays != null && licDays < 30) warnings.push({ kind: 'warn', text: `ВУ водителя истекает через ${Math.max(0, Math.round(licDays))} дн.` })
      if (tillDays != null && tillDays < 30) warnings.push({ kind: 'warn', text: `ТО тягача истекает через ${Math.max(0, Math.round(tillDays))} дн.` })
    }

    // Ёмкость
    const capScore = 10
    if (vehicle.capacityT != null) {
      reasons.push({ kind: 'plus', text: `Ёмкость ${Math.round(vehicle.capacityT)} т ≥ ${Math.round(weight)} т груза` })
    }

    // Мониторинг: водитель уже на выгрузке / скоро завершит
    const mon = onlineByDriver.get(trip.driverId)
    let monBonus = 0
    if (mon && ['at_unload', 'unloaded', 'near_unload', 'trip_completed'].includes(mon.status)) {
      monBonus = 5
      reasons.push({ kind: 'plus', text: 'По мониторингу — на выгрузке, освобождается в ближайшее время' })
    }
    if (mon && mon.status === 'offline' && mon.appInstalled) {
      warnings.push({ kind: 'warn', text: 'Нет связи с водителем (приложение давно не выходило на связь)' })
    }

    // Закрепление: водитель работает на «своём» тягаче и прицепе
    const binding = bindingByDriver.get(trip.driverId)
    const pinnedNow = isPinned(binding, trip.driverId, trip.vehicleId, trip.trailerId)
    if (pinnedNow) {
      monBonus += MATCH.PINNED_BONUS_TRIP
      reasons.push({ kind: 'plus', text: 'Закреплённый состав — водитель работает на этой машине и прицепе' })
    }

    const score = Math.round(Math.min(100, geoScore + timeScore + docsScore + capScore + monBonus))
    tripCandidates.push({
      kind: 'trip',
      tripId: trip.id,
      score,
      grade: grade(score),
      driver: { id: driver.id, fullName: driver.fullName, phone: driver.phone },
      vehicle: { id: vehicle.id, brand: vehicle.brand, plate: vehicle.plate, capacityT: vehicle.capacityT },
      trailer: trip.trailerId
        ? (() => {
            const t = trailerById.get(trip.trailerId)
            return t ? { id: t.id, brand: t.brand, plate: t.plate, type: t.type } : null
          })()
        : null,
      pinned: pinnedNow,
      usual: usualOf(binding, trip.driverId, trip.vehicleId, vehicleById),
      freesAt: frees.at.toISOString(),
      freesAtPoint: frees.point,
      deadheadKm,
      nowRoute: frees.lastLegDesc,
      nowStatus: mon?.status ?? null,
      reasons: [...reasons, ...warnings],
    })
  }
  tripCandidates.sort((a, b) => b.score - a.score || a.driver.fullName.localeCompare(b.driver.fullName))

  // ——— 2) Свободный состав под новый рейс ———
  // Тягачи/прицепы, свободные сейчас (не в активных рейсах, не в ремонте, ТО живёт
  // дольше рейса, ёмкость тянет вес). Для каждого свободного водителя подбираем
  // самый экономный подходящий тягач (минимальная достаточная ёмкость).
  const freeVehicles = vehicles
    .filter(
      (v) =>
        v.ownership !== 'held' &&
        !v.isRepair &&
        !busyVehicleIds.has(v.id) &&
        v.capacityT != null &&
        v.capacityT >= weight &&
        docsState(parseRuDate(v.techTill), latestDocNeed).ok,
    )
    .sort((a, b) => (a.capacityT ?? 0) - (b.capacityT ?? 0))
  const freeTrailers = trailers
    .filter((t) => t.ownership !== 'held' && !t.isRepair && !busyTrailerIds.has(t.id) && docsState(parseRuDate(t.techTill), latestDocNeed).ok)
    .sort((a, b) => (a.type === 'шторный' ? 0 : 1) - (b.type === 'шторный' ? 0 : 1))

  const compCandidates: MatchCandidate[] = []

  // Рейсы, уже показанные в подсказке «добавить плечом»: их водителей не дублируем
  // в «свободном составе» — продолжение текущего рейса всегда выгоднее нового.
  const appendTripIds = new Set(tripCandidates.slice(0, MATCH.TOP_N).map((c) => c.tripId))

  // 2а) Водители без активного рейса — свободны сейчас.
  // Сначала считаем базу кандидата (готовность + ВУ + связь), сортируем — и раздаём
  // тягачи по одному: топ-кандидаты получают самые экономные подходящие машины,
  // поэтому подсказка показывает разные составы, а не одну и ту же пару.
  // Закреплённым водителям сначала отдаём их «родные» тягач и прицеп — смена
  // машины для водителя редкое явление, закреплённый состав и привычнее, и
  // получает бонус к баллу. Если родная машина занята (в рейсе/ремонте) —
  // подсказываем это и предлагаем замену из свободных.
  const FREE_POOL_LIMIT = 24 // строим варианты для топ-24, показываем лучшие
  type FreePoolRow = {
    driver: (typeof drivers)[number]
    mon: (typeof online)[number] | undefined
    lic: Date | null
    licDays: number | null
    base: number
  }
  const freePool: FreePoolRow[] = []
  for (const driver of drivers) {
    if (driver.status !== 'active') continue // отпуск/больничный — не кандидат
    if (tripByDriver.has(driver.id)) continue // занят — разбираем ниже (2б)
    const lic = parseRuDate(driver.licenseUntil)
    if (!docsState(lic, latestDocNeed).ok) continue // ВУ истекает до конца рейса
    const mon = onlineByDriver.get(driver.id)
    if (mon && mon.status === 'breakdown') continue // сломался — в ремонт

    let base = 45 // готовность: свободен сейчас
    const licDays = lic ? daysUntil(lic, latestDocNeed) : null
    if (licDays == null || licDays > 180) base += 20
    else if (licDays > 90) base += 17
    else if (licDays > 30) base += 14
    else base += 8
    if (driver.phone) base += 5
    if (mon && mon.appInstalled && mon.status === 'offline') base -= 5
    freePool.push({ driver, mon, lic, licDays, base })
  }
  freePool.sort((a, b) => b.base - a.base || a.driver.fullName.localeCompare(b.driver.fullName))

  // Пул техники: закреплённые машины резервируются за их водителями, остаток
  // раздаётся по порядку экономности (минимальная достаточная ёмкость).
  const availVehicles = [...freeVehicles]
  const availTrailers = [...freeTrailers]
  const poolSize = Math.min(freePool.length, freeVehicles.length > 0 ? FREE_POOL_LIMIT : 0)
  for (let i = 0; i < poolSize; i++) {
    const { driver, mon, licDays } = freePool[i]
    const binding = bindingByDriver.get(driver.id)

    // 1) закреплённый тягач/прицеп — если свободны и подходят под заявку
    let vehicle: (typeof vehicles)[number] | undefined
    let trailer: (typeof trailers)[number] | null | undefined
    let pinnedNow = false
    if (binding) {
      const vIdx = availVehicles.findIndex((v) => v.id === binding.vehicleId)
      if (vIdx >= 0) {
        vehicle = availVehicles.splice(vIdx, 1)[0]
        pinnedNow = true
        if (binding.trailerId) {
          const tIdx = availTrailers.findIndex((t) => t.id === binding.trailerId)
          if (tIdx >= 0) trailer = availTrailers.splice(tIdx, 1)[0]
        }
      }
    }
    // 2) иначе — самая экономная свободная машина из остатка
    if (!vehicle) vehicle = availVehicles.shift()
    if (vehicle && trailer === undefined) trailer = availTrailers.shift() ?? null
    if (!vehicle) break // свободная техника закончилась

    const reasons: MatchReason[] = []
    const warnings: MatchReason[] = []
    let score = freePool[i].base

    reasons.push({ kind: 'plus', text: 'Свободен сейчас — состав на базе' })

    // Предупреждения по ВУ
    if (licDays != null && licDays <= 30) {
      warnings.push({ kind: 'warn', text: `ВУ истекает через ${Math.max(0, Math.round(licDays))} дн. — скоро замена` })
    } else if (licDays != null && licDays <= 90) {
      warnings.push({ kind: 'warn', text: `ВУ истекает через ${Math.round(licDays)} дн. после рейса` })
    }

    // Закрепление: бонус или подсказка о замене
    if (pinnedNow) {
      score += MATCH.PINNED_BONUS_COMP
      reasons.push({ kind: 'plus', text: 'Закреплённый состав — тягач и прицеп «его» машины' })
    } else if (binding) {
      const bound = vehicleById.get(binding.vehicleId)
      const why = pinnedVehicleWhy(bound, busyVehicleIds.has(binding.vehicleId), weight, latestDocNeed)
      warnings.push({
        kind: 'warn',
        text: `Обычно работает на ${bound ? `${bound.brand} (${bound.plate})` : 'другой машине'} — ${why}, предложена замена`,
      })
    }

    // Тягач: ёмкость и ТО
    const vehTill = parseRuDate(vehicle.techTill)
    const tillDays = vehTill ? daysUntil(vehTill, latestDocNeed) : null
    score += tillDays == null || tillDays > 90 ? 15 : tillDays > 30 ? 12 : 7
    if (tillDays != null && tillDays <= 30) warnings.push({ kind: 'warn', text: `ТО тягача истекает через ${Math.max(0, Math.round(tillDays))} дн.` })
    reasons.push({ kind: 'plus', text: `${vehicle.brand} · ${Math.round(vehicle.capacityT ?? weight)} т` })

    // Прицеп
    if (trailer) {
      score += 5
      reasons.push({ kind: 'plus', text: `Прицеп ${trailer.type} ${trailer.plate}` })
    }

    // Связь
    if (mon && mon.appInstalled && mon.status === 'offline') {
      warnings.push({ kind: 'warn', text: 'Нет связи с водителем по приложению' })
    }

    compCandidates.push({
      kind: 'composition',
      score: Math.round(Math.min(100, Math.max(0, score))),
      grade: grade(Math.min(100, Math.max(0, score))),
      driver: { id: driver.id, fullName: driver.fullName, phone: driver.phone },
      vehicle: { id: vehicle.id, brand: vehicle.brand, plate: vehicle.plate, capacityT: vehicle.capacityT },
      trailer: trailer ? { id: trailer.id, brand: trailer.brand, plate: trailer.plate, type: trailer.type } : null,
      pinned: pinnedNow,
      usual: pinnedNow ? null : usualOf(binding, driver.id, vehicle.id, vehicleById),
      freesAt: null,
      freesAtPoint: null,
      deadheadKm: null,
      nowRoute: null,
      nowStatus: mon?.status ?? null,
      reasons: [...reasons, ...warnings],
    })
  }

  // 2б) Водители в рейсе, который освобождается к окну погрузки заявки
  // (кроме тех, чей рейс уже предложен выше как «добавить плечо» — без дублей)
  for (const trip of activeTrips) {
    const tLegs = legsByTrip.get(trip.id) ?? []
    if (tLegs.some((l) => l.orderId === order.id)) continue
    if (appendTripIds.has(trip.id)) continue // уже показан в «рейсах в работе»
    const frees = tripFrees(tLegs, now)
    if (!frees) continue
    const lateH = (frees.at.getTime() - loadAt.getTime()) / 3600000
    if (lateH > MATCH.LATE_TOLERANCE_H) continue // не успевает — пропускаем
    const driver = driverById.get(trip.driverId)
    const vehicle = vehicleById.get(trip.vehicleId)
    if (!driver || !vehicle || driver.status !== 'active') continue
    if (vehicle.capacityT != null && vehicle.capacityT < weight) continue

    const lic = parseRuDate(driver.licenseUntil)
    if (!docsState(lic, latestDocNeed).ok) continue
    const vehTill = parseRuDate(vehicle.techTill)
    if (!docsState(vehTill, latestDocNeed).ok) continue

    const reasons: MatchReason[] = []
    const warnings: MatchReason[] = []
    let score = 0

    // Готовность + география: освобождается к нужному часу, но не на базе —
    // порожний пробег от точки выгрузки до пункта погрузки заявки
    const deadheadKm = kmBetween(frees.point, order.loadPoint)
    if (deadheadKm == null) {
      score += 32
    } else if (deadheadKm === 0) {
      score += 40
      reasons.push({ kind: 'plus', text: `Освобождается ${fmtRu(frees.at, now)} прямо в пункте погрузки` })
    } else {
      score += Math.max(10, 40 - deadheadKm / MATCH.DEADHEAD_KM_PENALTY_COMP)
      reasons.push({ kind: 'plus', text: `Освобождается ${fmtRu(frees.at, now)} · ${deadheadKm} км до пункта погрузки` })
    }
    if (lateH > 0 && lateH <= MATCH.LATE_TOLERANCE_H) {
      warnings.push({ kind: 'warn', text: 'Освобождается впритык к окну погрузки — уточните по телефону' })
    }

    // Документы
    const licDays = lic ? daysUntil(lic, latestDocNeed) : null
    const tillDays = vehTill ? daysUntil(vehTill, latestDocNeed) : null
    score += licDays == null || licDays > 90 ? 20 : licDays > 30 ? 14 : 8
    if (licDays != null && licDays <= 30) warnings.push({ kind: 'warn', text: `ВУ истекает через ${Math.max(0, Math.round(licDays))} дн.` })
    score += tillDays == null || tillDays > 90 ? 15 : tillDays > 30 ? 12 : 7
    if (tillDays != null && tillDays <= 30) warnings.push({ kind: 'warn', text: `ТО тягача истекает через ${Math.max(0, Math.round(tillDays))} дн.` })

    // Ёмкость и телефон
    if (vehicle.capacityT != null) reasons.push({ kind: 'plus', text: `Ёмкость ${Math.round(vehicle.capacityT)} т ≥ ${Math.round(weight)} т груза` })
    score += 10
    if (driver.phone) score += 5

    // Мониторинг
    const mon = onlineByDriver.get(trip.driverId)
    if (mon && ['at_unload', 'unloaded', 'near_unload', 'trip_completed'].includes(mon.status)) {
      score += 5
      reasons.push({ kind: 'plus', text: 'По мониторингу — на выгрузке' })
    }
    if (mon && mon.status === 'offline' && mon.appInstalled) {
      warnings.push({ kind: 'warn', text: 'Нет связи с водителем' })
    }

    // Закрепление состава
    const binding = bindingByDriver.get(trip.driverId)
    const pinnedNow = isPinned(binding, trip.driverId, trip.vehicleId, trip.trailerId)
    if (pinnedNow) {
      score += MATCH.PINNED_BONUS_TRIP
      reasons.push({ kind: 'plus', text: 'Закреплённый состав — водитель работает на этой машине и прицепе' })
    }

    const trailer = trip.trailerId ? trailerById.get(trip.trailerId) : null

    compCandidates.push({
      kind: 'composition',
      score: Math.round(Math.min(100, Math.max(0, score))),
      grade: grade(Math.min(100, Math.max(0, score))),
      driver: { id: driver.id, fullName: driver.fullName, phone: driver.phone },
      vehicle: { id: vehicle.id, brand: vehicle.brand, plate: vehicle.plate, capacityT: vehicle.capacityT },
      trailer: trailer ? { id: trailer.id, brand: trailer.brand, plate: trailer.plate, type: trailer.type } : null,
      pinned: pinnedNow,
      usual: pinnedNow ? null : usualOf(binding, trip.driverId, trip.vehicleId, vehicleById),
      freesAt: frees.at.toISOString(),
      freesAtPoint: frees.point,
      deadheadKm,
      nowRoute: frees.lastLegDesc,
      nowStatus: mon?.status ?? null,
      reasons: [...reasons, ...warnings],
    })
  }
  compCandidates.sort((a, b) => b.score - a.score || a.driver.fullName.localeCompare(b.driver.fullName))

  if (freeVehicles.length === 0) notes.push('Свободных тягачей под вес заявки нет — проверьте парк и ремонты')

  return {
    order: {
      id: order.id,
      number: order.number,
      weightT: weight,
      weightSource: source,
      loadAt: loadAt.toISOString(),
      loadPoint: order.loadPoint,
      unloadPoint: order.unloadPoint,
    },
    trips: tripCandidates.slice(0, MATCH.TOP_N),
    compositions: compCandidates.slice(0, MATCH.TOP_N),
    meta: {
      generatedAt: new Date().toISOString(),
      activeTrips: activeTrips.length,
      freeDrivers: drivers.filter((d) => d.status === 'active' && !tripByDriver.has(d.id)).length,
      freeVehicles: freeVehicles.length,
      notes,
    },
  }
}
