// Подсказка «кому из парка отдать груз с ATI.SU» (контур обратных рейсов).
//
// Считается ТОЛЬКО по запросу пользователя — кнопка «Подбор водителя» прямо на карточке заявки
// груза/заявки: один POST = один расчёт. Для выдачи грузов биржи сервер ничего
// не считает заранее.
//
// Математика от трёх входов (как заказано постановкой):
//   1) территория — где машина находится сейчас: пункт выгрузки текущего плеча
//      (для машин в рейсе) или база АЭМЗ в Абинске (для свободных);
//   2) ориентировочная дата освобождения — плановая выгрузка последнего плеча
//      рейса (+ запас на выгрузку) или «сейчас» для машин на базе;
//   3) груз с ATI.SU — пункт погрузки, окно дат, вес/объём, ставка и плечо.
//
// Режим движения парка: 500–600 км в день, ночных переездов нет — после
// дневного пробега машина встаёт на отстой. Поэтому все оценки времени
// считаются в целых днях: осторожная граница 500 км/день (обязательство),
// верхняя 600 км/день (лучший случай). «На грани» — успевает только при 600.
//
// Выгода обратки — не только подача: считается крюк к дому. Машина, которая
// выгружается в Казани, всё равно возвращается в Абинск; груз Казань → юг
// «по пути домой» даёт крюк ≈ 0 км, и каждый загруженный км заменяет порожний.
// Ставка делится на весь круг (подача + плечо) — так видно, как порожняк
// съедает ₽/км относительно ставки самого груза.

import { db } from '@/lib/kontur/db'
import { cityGeo, cityLabel, haversineKm } from '@/lib/kontur/geo'
import { parseRuDate, tripFrees } from '@/lib/kontur/matching'
import { marketCityGeo, roadKm } from '@/lib/kontur/atisu/market-stubs'

// ——— параметры режима (парк АЭМЗ) ———

const HINT = {
  KM_PER_DAY_SLOW: 500, // осторожный темп — им проверяем обязательство «успевает»
  KM_PER_DAY_FAST: 600, // верхняя граница режима за день
  BASE_POINT: 'Абинск (АЭМЗ)', // база парка: здесь стоят свободные машины
  TOP_N: 6, // сколько кандидатов показывать
  MAX_EXCLUDED: 10, // сколько «не подошедших» перечислить
  DEADHEAD_KM_PER_POINT: 25, // минус балл географии за каждые N км подачи
} as const

const DAY_MS = 86400000

// ——— контракт (клиент зеркалит типы в AtiVehicleHint.tsx) ———

export type VehicleHintInput = {
  from: string
  to: string
  /** окно погрузки: 'YYYY-MM-DD' (груз биржи) или 'DD.MM'/'DD.MM.YYYY' (заявка) */
  dateFrom?: string | null
  dateTo?: string | null
  weightT?: number | null
  volumeM3?: number | null
  /** ставка за поездку, ₽ (с НДС, как в карточке биржи) */
  rate?: number | null
  /** ₽/км по плечу груза — база для сравнения выгодности круга */
  perKm?: number | null
  km?: number | null
  cargo?: string | null
}

export type VehicleHintReason = { kind: 'plus' | 'warn'; text: string }
export type VehicleHintGrade = 'optimal' | 'good' | 'risky'
export type VehicleHintTiming = 'early' | 'in_window' | 'edge'

export type VehicleHintCandidate = {
  score: number // 0..100
  grade: VehicleHintGrade
  driver: { fullName: string; phone: string }
  vehicle: { brand: string; plate: string; capacityT: number | null; volumeM3: number | null }
  trailer: { plate: string; type: string } | null
  pinned: boolean // состав закреплён за водителем
  /** base — свободна на базе; trip — освобождается из рейса */
  freeKind: 'base' | 'trip'
  freesAt: string | null // ISO: когда освобождается (null = свободна сейчас)
  freesAtPoint: string
  nowRoute: string | null // текущее плечо (для машин в рейсе)
  nowStatus: string | null // статус онлайн-мониторинга водителя
  deadheadKm: number | null // подача до пункта погрузки
  deadheadDaysFast: number
  deadheadDaysSlow: number
  arriveFast: string // ISO: приезд на погрузку при 600 км/день
  arriveSlow: string // ISO: при 500 км/день
  timing: VehicleHintTiming
  idleDays: number // простой на погрузке до начала окна (0 = без простоя)
  tripKm: number
  tripDaysFast: number
  tripDaysSlow: number
  unloadEta: string // ISO: ориентировочная выгрузка (осторожный темп)
  homeAfterKm: number | null // от выгрузки до базы
  homeDetourKm: number | null // крюк к дому против порожнего возврата
  totalKm: number // подача + плечо
  rate: number | null
  revPerKm: number | null // ₽/км по кругу (с подачей)
  revRatio: number | null // доля от ₽/км плеча груза
  reasons: VehicleHintReason[]
}

export type VehicleHintExcluded = { driver: string; vehicle: string; reason: string }

export type VehicleHintResult = {
  load: {
    from: string
    to: string
    km: number
    weightT: number | null
    volumeM3: number | null
    rate: number | null
    perKm: number | null
    dateFrom: string // ISO
    dateTo: string // ISO
  }
  candidates: VehicleHintCandidate[]
  excluded: VehicleHintExcluded[]
  meta: {
    generatedAt: string
    considered: number
    activeTrips: number
    freeOnBase: number
    notes: string[]
  }
}

// ——— мелкие помощники ———

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59)

/** Дней хода по темпу (0 = ехать не надо) */
const daysAt = (km: number, perDay: number) => (km <= 0 ? 0 : Math.ceil(km / perDay))

/** «1 дн» / «2–3 дн» — вилка по режиму 500–600 км/день */
function daysLabel(fast: number, slow: number): string {
  if (fast === 0 && slow === 0) return 'без хода'
  if (fast === slow) return `${fast} дн`
  return `${fast}–${slow} дн`
}

function fmtD(d: Date): string {
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

/** '2026-11-20' | '20.11' | '20.11.2026' → Date (начало дня); null — не разобрать */
export function parseLoadDate(s?: string | null): Date | null {
  if (!s) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  const ru = /^(\d{2})\.(\d{2})(?:\.(\d{4}))?$/.exec(s)
  if (ru) {
    const y = ru[3] ? Number(ru[3]) : new Date().getFullYear()
    return new Date(y, Number(ru[2]) - 1, Number(ru[1]))
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Город из строки точки: «Абинск (АЭМЗ)» → «Абинск», «Сочи, ул. X» → «Сочи» */
function cityOf(point: string): string {
  return point.split(',')[0].replace(/\s*\(.*\)\s*$/, '').trim()
}

/**
 * км по дорогам между двумя точками. Пары городов витрины биржи — по таблице
 * реальной дорожной сети (roadKm); прочие города (адреса рейсов) — прямое
 * расстояние × 1.2; null — город не опознан совсем.
 */
function kmRoad(aPoint: string, bPoint: string): number | null {
  const a = cityOf(aPoint)
  const b = cityOf(bPoint)
  if (!a || !b) return null
  if (a.toLowerCase() === b.toLowerCase()) return 0
  if (marketCityGeo(a) && marketCityGeo(b)) return roadKm(a, b)
  const ga = cityGeo(a) ?? marketCityGeo(a)
  const gb = cityGeo(b) ?? marketCityGeo(b)
  if (!ga || !gb) return null
  return Math.max(5, Math.round((haversineKm(ga, gb) * 1.2) / 5) * 5)
}

function gradeOf(score: number): VehicleHintGrade {
  if (score >= 85) return 'optimal'
  if (score >= 65) return 'good'
  return 'risky'
}

/** Документ действует до конца рейса? заодно дни запаса */
function docsOk(validUntil: Date | null, needUntil: Date): { ok: boolean; days: number | null } {
  if (!validUntil) return { ok: true, days: null }
  const days = (validUntil.getTime() - needUntil.getTime()) / DAY_MS
  return { ok: days >= 0, days }
}

// ——— скоринг по факторам (сумма ≤ 100 + бонус за закрепление) ———

function scoreGeo(deadheadKm: number | null): number {
  if (deadheadKm == null) return 20 // не посчитать — нейтрально
  if (deadheadKm === 0) return 40
  return Math.max(4, Math.round(40 - deadheadKm / HINT.DEADHEAD_KM_PER_POINT))
}

/** Бонус «обратка по пути домой»: только для машин вне дома */
function scoreHome(detourKm: number | null, awayFromHomeKm: number | null): number {
  if (detourKm == null || awayFromHomeKm == null || awayFromHomeKm <= 100) return 0
  if (detourKm <= 150) return 10
  if (detourKm <= 400) return 6
  if (detourKm <= 800) return 3
  return 0
}

function scoreTiming(timing: VehicleHintTiming): number {
  return timing === 'early' ? 25 : timing === 'in_window' ? 20 : 10
}

function scoreMoney(ratio: number | null): number {
  if (ratio == null) return 10 // ставки нет — нейтрально
  if (ratio >= 0.95) return 20
  if (ratio >= 0.85) return 16
  if (ratio >= 0.75) return 12
  if (ratio >= 0.65) return 9
  return 5
}

function scoreDocs(minDays: number | null): number {
  if (minDays == null) return 10
  if (minDays > 90) return 10
  if (minDays > 30) return 7
  return 4
}

// ——— главный расчёт ———

export async function buildVehicleHint(input: VehicleHintInput): Promise<VehicleHintResult> {
  const now = new Date()
  const notes: string[] = []

  const from = (input.from ?? '').trim()
  const to = (input.to ?? '').trim()
  if (!from || !to) throw new Error('Не указаны пункты погрузки/выгрузки груза')

  // Окно погрузки: нет даты — считаем от завтра (и говорим об этом)
  let winFrom = parseLoadDate(input.dateFrom)
  if (!winFrom) {
    winFrom = addDays(startOfDay(now), 1)
    notes.push('Дата погрузки у груза не указана — окно считаем от завтра')
  }
  let winTo = parseLoadDate(input.dateTo)
  if (!winTo || winTo < winFrom) winTo = winFrom
  const winFromDay = startOfDay(winFrom)
  const winToEve = endOfDay(winTo)

  const weightT = input.weightT && input.weightT > 0 ? input.weightT : null
  const volumeM3 = input.volumeM3 && input.volumeM3 > 0 ? input.volumeM3 : null
  const rate = input.rate && input.rate > 0 ? Math.round(input.rate) : null
  const benchPerKm = input.perKm && input.perKm > 0 ? input.perKm : null

  let tripKm = input.km && input.km > 0 ? Math.round(input.km) : 0
  if (tripKm === 0) {
    const k = kmRoad(from, to)
    if (k != null) tripKm = k
  }
  if (tripKm === 0) notes.push('Плечо груза не удалось посчитать — проверьте направление')

  // Плечо до базы после выгрузки (для «крюка к дому»)
  const homeAfterKm = kmRoad(to, HINT.BASE_POINT)

  const [drivers, vehicles, trailers, trips, legs, online, bindings] = await Promise.all([
    db.driver.findMany(),
    db.vehicle.findMany(),
    db.trailer.findMany(),
    db.trip.findMany(),
    db.leg.findMany(),
    db.driverOnline.findMany(),
    db.vehicleBinding.findMany(),
  ])

  const driverById = new Map(drivers.map((d) => [d.id, d]))
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]))
  const legsByTrip = new Map<string, typeof legs>()
  for (const l of legs) {
    const arr = legsByTrip.get(l.tripId) ?? []
    arr.push(l)
    legsByTrip.set(l.tripId, arr)
  }
  const onlineByDriver = new Map(online.map((o) => [o.driverId, o]))
  const bindingByDriver = new Map(bindings.map((b) => [b.driverId, b]))

  const activeTrips = trips.filter((t) => t.status === 'active')
  const busyVehicleIds = new Set(activeTrips.map((t) => t.vehicleId))
  const busyTrailerIds = new Set(activeTrips.filter((t) => t.trailerId).map((t) => t.trailerId as string))
  const tripByDriver = new Map<string, typeof trips[number]>()
  for (const t of activeTrips) tripByDriver.set(t.driverId, t)

  const excluded: VehicleHintExcluded[] = []
  const pushExcluded = (driverName: string, vehicleLabel: string, reason: string) => {
    // отпускники/больничные в списке не показываем — это не про груз
    if (reason.startsWith('водитель не активен')) return
    if (excluded.length < HINT.MAX_EXCLUDED) excluded.push({ driver: driverName, vehicle: vehicleLabel, reason })
  }

  // ——— расчёт одного кандидата (общая математика для «в рейсе» и «на базе») ———
  type RawCand = {
    driver: (typeof drivers)[number]
    vehicle: (typeof vehicles)[number]
    trailer: (typeof trailers)[number] | null
    pinned: boolean
    freeKind: 'base' | 'trip'
    freesAt: Date | null
    freesAtPoint: string
    nowRoute: string | null
  }

  const evaluate = (c: RawCand): VehicleHintCandidate | { exclude: string } => {
    // — жёсткие запреты (водитель/техника/документы) —
    if (c.driver.status !== 'active') return { exclude: 'водитель не активен (отпуск/больничный)' }
    const lic = parseRuDate(c.driver.licenseUntil)
    const vehTill = parseRuDate(c.vehicle.techTill)
    const trlTill = c.trailer ? parseRuDate(c.trailer.techTill) : null

    // — география подачи —
    const deadheadKm = kmRoad(c.freesAtPoint, from)
    const deadhead = deadheadKm ?? 0
    const deadheadDaysFast = daysAt(deadhead, HINT.KM_PER_DAY_FAST)
    const deadheadDaysSlow = daysAt(deadhead, HINT.KM_PER_DAY_SLOW)

    // — время: освобождение → приезд на погрузку —
    const baseMoment = c.freesAt ?? now
    const arriveFast = deadhead === 0 ? new Date(baseMoment.getTime()) : addDays(baseMoment, deadheadDaysFast)
    const arriveSlow = deadhead === 0 ? new Date(baseMoment.getTime()) : addDays(baseMoment, deadheadDaysSlow)

    // — ход по плечу и выгрузка —
    const tripDaysFast = daysAt(tripKm, HINT.KM_PER_DAY_FAST)
    const tripDaysSlow = daysAt(tripKm, HINT.KM_PER_DAY_SLOW)
    const departAt = arriveSlow > winFromDay ? arriveSlow : winFromDay // позже из: приезд (осторожно) и начала окна
    const unloadEta = addDays(departAt, tripDaysSlow)
    const needUntil = addDays(unloadEta, 1) // документы должны жить до выгрузки (+1 дн запас)

    if (lic && !docsOk(lic, needUntil).ok) return { exclude: `ВУ водителя истекает до выгрузки (${fmtD(lic)})` }
    if (vehTill && !docsOk(vehTill, needUntil).ok) return { exclude: `ТО тягача истекает до выгрузки (${fmtD(vehTill)})` }
    if (trlTill && !docsOk(trlTill, needUntil).ok) return { exclude: 'ТО прицепа истекает до выгрузки' }
    if (c.vehicle.isRepair) return { exclude: 'тягач в ремонте' }
    if (c.vehicle.capacityT != null && weightT != null && c.vehicle.capacityT < weightT) {
      return { exclude: `не тянет вес (${Math.round(c.vehicle.capacityT)} т < ${weightT} т)` }
    }
    if (c.vehicle.volumeM3 != null && volumeM3 != null && c.vehicle.volumeM3 < volumeM3) {
      return { exclude: `не хватает объёма (${Math.round(c.vehicle.volumeM3)} м³ < ${Math.round(volumeM3)} м³)` }
    }

    // — успевает ли к окну погрузки (проверка по осторожным 500 км/день) —
    let timing: VehicleHintTiming
    if (arriveSlow <= winFromDay) timing = 'early'
    else if (arriveSlow <= winToEve) timing = 'in_window'
    else if (arriveFast <= winToEve) timing = 'edge'
    else {
      return { exclude: `не успевает к погрузке (подача ${daysLabel(deadheadDaysFast, deadheadDaysSlow)})` }
    }

    const idleDays = timing === 'early' ? Math.round((winFromDay.getTime() - arriveSlow.getTime()) / DAY_MS) : 0

    // — экономика круга и крюк к дому —
    const totalKm = deadhead + tripKm
    const revPerKm = rate != null && totalKm > 0 ? Math.round((rate / totalKm) * 10) / 10 : null
    const revRatio = revPerKm != null && benchPerKm ? Math.round((revPerKm / benchPerKm) * 100) / 100 : null
    const awayFromHomeKm = kmRoad(c.freesAtPoint, HINT.BASE_POINT)
    const homeDetourKm =
      deadheadKm != null && homeAfterKm != null && awayFromHomeKm != null
        ? deadheadKm + tripKm + homeAfterKm - awayFromHomeKm
        : null

    // — скоринг —
    const reasons: VehicleHintReason[] = []
    const warns: VehicleHintReason[] = []
    let score = 0

    // География: подача
    score += scoreGeo(deadheadKm)
    if (deadheadKm == null) {
      warns.push({ kind: 'warn', text: `Подачу до ${cityLabel(from)} не посчитать — город не опознан` })
    } else if (deadheadKm === 0) {
      reasons.push({ kind: 'plus', text: `Освобождается прямо в пункте погрузки (${cityLabel(from)}) — без порожняка` })
    } else {
      reasons.push({
        kind: 'plus',
        text: `Подача ${deadheadKm} км до погрузки · ${daysLabel(deadheadDaysFast, deadheadDaysSlow)} хода`,
      })
    }

    // Обратка по пути домой
    const homeBonus = scoreHome(homeDetourKm, awayFromHomeKm)
    score += homeBonus
    if (homeDetourKm != null && awayFromHomeKm != null && awayFromHomeKm > 100) {
      if (homeDetourKm <= 150) {
        reasons.push({
          kind: 'plus',
          text: `Обратка по пути домой: крюк ${homeDetourKm} км вместо ${awayFromHomeKm} км порожняком в Абинск`,
        })
      } else if (homeDetourKm <= 400) {
        reasons.push({ kind: 'plus', text: `Небольшой крюк к дому: +${homeDetourKm} км к порожнему возврату` })
      } else if (homeDetourKm > 800) {
        warns.push({ kind: 'warn', text: `Груз уводит от дома: крюк +${homeDetourKm} км к возврату в Абинск` })
      }
    }

    // Время
    score += scoreTiming(timing)
    if (timing === 'early') {
      reasons.push({
        kind: 'plus',
        text: `Прибудет на погрузку ${fmtD(arriveSlow)} — к началу окна ${fmtD(winFromDay)}${fmtD(winFromDay) !== fmtD(winToEve) ? `–${fmtD(winToEve)}` : ''}`,
      })
    } else if (timing === 'in_window') {
      reasons.push({ kind: 'plus', text: `Прибудет ${fmtD(arriveSlow)} — внутри окна погрузки` })
    } else {
      warns.push({ kind: 'warn', text: `Впритык: успевает только при 600 км/день (${fmtD(arriveFast)})` })
    }
    if (idleDays >= 2) {
      warns.push({ kind: 'warn', text: `Простой ${idleDays} дн. на погрузке до начала окна` })
    }

    // Деньги
    score += scoreMoney(revRatio)
    if (revPerKm != null && benchPerKm) {
      const pct = Math.round(revRatio! * 100)
      if (pct >= 95) {
        reasons.push({ kind: 'plus', text: `${rate!.toLocaleString('ru-RU')} ₽ · ${revPerKm} ₽/км по кругу — ставка груза не теряется` })
      } else if (pct >= 75) {
        reasons.push({ kind: 'plus', text: `${rate!.toLocaleString('ru-RU')} ₽ · по кругу ${revPerKm} ₽/км (${pct}% от ставки за км)` })
      } else {
        warns.push({ kind: 'warn', text: `Порожняя подача съедает ставку: по кругу ${revPerKm} ₽/км (${pct}% от ${benchPerKm})` })
      }
    }

    // Документы
    const licDays = lic ? (lic.getTime() - needUntil.getTime()) / DAY_MS : null
    const tillDays = vehTill ? (vehTill.getTime() - needUntil.getTime()) / DAY_MS : null
    const trlDays = trlTill ? (trlTill.getTime() - needUntil.getTime()) / DAY_MS : null
    const docDays = [licDays, tillDays, trlDays].filter((d): d is number => d != null)
    score += scoreDocs(docDays.length ? Math.min(...docDays) : null)
    for (const [label, days] of [['ВУ водителя', licDays], ['ТО тягача', tillDays], ['ТО прицепа', trlDays]] as const) {
      if (days != null && days <= 30) {
        warns.push({ kind: 'warn', text: `${label} истекает через ${Math.max(0, Math.round(days))} дн. после рейса` })
      }
    }

    // Ёмкость
    if (c.vehicle.capacityT != null && weightT != null) {
      reasons.push({ kind: 'plus', text: `Ёмкость ${Math.round(c.vehicle.capacityT)} т ≥ ${weightT} т груза` })
    }

    // Связь с водителем
    const mon = onlineByDriver.get(c.driver.id)
    if (mon && mon.appInstalled && mon.status && mon.status !== 'offline') {
      score += 5
      reasons.push({ kind: 'plus', text: 'Водитель на связи (приложение)' })
    } else if (mon && mon.appInstalled && mon.status === 'offline') {
      score += 2
      warns.push({ kind: 'warn', text: 'Нет связи с водителем по приложению' })
    } else {
      score += 3
    }

    // Закреплённый состав
    if (c.pinned) {
      score = Math.min(100, score + 4)
      reasons.push({ kind: 'plus', text: 'Закреплённый состав — водитель на «своей» машине' })
    }

    const finalScore = Math.round(Math.min(100, Math.max(0, score)))
    return {
      score: finalScore,
      grade: gradeOf(finalScore),
      driver: { fullName: c.driver.fullName, phone: c.driver.phone },
      vehicle: {
        brand: c.vehicle.brand,
        plate: c.vehicle.plate,
        capacityT: c.vehicle.capacityT,
        volumeM3: c.vehicle.volumeM3,
      },
      trailer: c.trailer ? { plate: c.trailer.plate, type: c.trailer.type } : null,
      pinned: c.pinned,
      freeKind: c.freeKind,
      freesAt: c.freesAt ? c.freesAt.toISOString() : null,
      freesAtPoint: c.freesAtPoint,
      nowRoute: c.nowRoute,
      nowStatus: mon?.status ?? null,
      deadheadKm,
      deadheadDaysFast,
      deadheadDaysSlow,
      arriveFast: arriveFast.toISOString(),
      arriveSlow: arriveSlow.toISOString(),
      timing,
      idleDays,
      tripKm,
      tripDaysFast,
      tripDaysSlow,
      unloadEta: unloadEta.toISOString(),
      homeAfterKm,
      homeDetourKm,
      totalKm,
      rate,
      revPerKm,
      revRatio,
      reasons: [...reasons, ...warns],
    }
  }

  // ——— 1) машины в рейсе: освобождаются на выгрузке (контур обратки) ———
  const raw: RawCand[] = []
  for (const trip of activeTrips) {
    const driver = driverById.get(trip.driverId)
    const vehicle = vehicleById.get(trip.vehicleId)
    if (!driver || !vehicle) continue
    const frees = tripFrees(legsByTrip.get(trip.id) ?? [], now)
    if (!frees) continue
    const binding = bindingByDriver.get(trip.driverId)
    // прицеп текущего рейса — из таблицы прицепов
    const trl = trip.trailerId ? trailers.find((t) => t.id === trip.trailerId) ?? null : null
    raw.push({
      driver,
      vehicle,
      trailer: trl,
      pinned: !!binding && binding.driverId === driver.id && binding.vehicleId === vehicle.id && (binding.trailerId ?? null) === (trip.trailerId ?? null),
      freeKind: 'trip',
      freesAt: frees.at,
      freesAtPoint: frees.point,
      nowRoute: frees.lastLegDesc,
    })
  }

  // ——— 2) свободные машины на базе: водитель без рейса + закреплённая машина ———
  const freeVehicles = vehicles
    .filter((v) => v.ownership !== 'held' && !v.isRepair && !busyVehicleIds.has(v.id))
    .sort((a, b) => (a.capacityT ?? 99) - (b.capacityT ?? 99))
  const availVehicles = [...freeVehicles]
  let freeOnBase = 0
  for (const driver of drivers) {
    if (driver.status !== 'active' || tripByDriver.has(driver.id)) continue
    const binding = bindingByDriver.get(driver.id)
    let vehicle: (typeof vehicles)[number] | undefined
    let pinned = false
    if (binding) {
      const idx = availVehicles.findIndex((v) => v.id === binding.vehicleId)
      if (idx >= 0) {
        vehicle = availVehicles.splice(idx, 1)[0]
        pinned = true
      }
    }
    if (!vehicle) vehicle = availVehicles.shift()
    if (!vehicle) continue // свободной техники не осталось — не кандидат
    const trl = binding?.trailerId && !busyTrailerIds.has(binding.trailerId)
      ? trailers.find((t) => t.id === binding.trailerId) ?? null
      : null
    raw.push({
      driver,
      vehicle,
      trailer: trl,
      pinned,
      freeKind: 'base',
      freesAt: null,
      freesAtPoint: HINT.BASE_POINT,
      nowRoute: null,
    })
    freeOnBase++
  }

  // ——— прогон математикой, отсев, сортировка ———
  const candidates: VehicleHintCandidate[] = []
  for (const c of raw) {
    const res = evaluate(c)
    if ('exclude' in res) {
      pushExcluded(c.driver.fullName, `${c.vehicle.brand} · ${c.vehicle.plate}`, res.exclude)
    } else {
      candidates.push(res)
    }
  }
  candidates.sort(
    (a, b) => b.score - a.score || (a.deadheadKm ?? 99999) - (b.deadheadKm ?? 99999) || a.driver.fullName.localeCompare(b.driver.fullName),
  )

  if (candidates.length === 0) {
    notes.push('Под груз не подошла ни одна машина парка — причины в списке ниже')
  }
  notes.push('Режим парка: 500–600 км/день, ночные отстои — время считается в днях')

  return {
    load: {
      from,
      to,
      km: tripKm,
      weightT,
      volumeM3,
      rate,
      perKm: benchPerKm,
      dateFrom: winFromDay.toISOString(),
      dateTo: winToEve.toISOString(),
    },
    candidates: candidates.slice(0, HINT.TOP_N),
    excluded,
    meta: {
      generatedAt: new Date().toISOString(),
      considered: raw.length,
      activeTrips: activeTrips.length,
      freeOnBase,
      notes,
    },
  }
}
