// Онлайн-мониторинг машины и водителя (раздел «Мониторинг»).
// Источник данных — телеметрия приложения водителя: POST /api/driver/telemetry.
// Контур тестовый: реального приложения на руках нет, до подключения работает
// симулятор из интерфейса (statusSource=test_sim) и демо-инициализация.
//
// Системные (выводимые) статусы — не отправляются приложением:
//   not_installed — приложение не установлено (на карте не виден);
//   offline       — приложение есть, но нет телеметрии дольше ONLINE_STALE_MIN;
//   near_unload   — «скоро завершит рейс»: до выгрузки < NEAR_UNLOAD_KM (500 км);
//   repair        — машина в ремонте (Vehicle.isRepair);
//   idle          — на линии без назначенного рейса.
import { db } from '@/lib/kontur/db'
import { Prisma } from '@/generated/kontur-client'
import {
  CONSTANTS, LADDER_TO_MONITOR, MONITOR_DRIVER_STATUSES,
} from '@/lib/kontur/constants'
import { bearingDeg, cityGeo, haversineKm, interpolate, progressOnSegment, type LatLng } from '@/lib/kontur/geo'

// Версия «потерявшегося» демо-водителя: keepalive его не оживляет —
// в демо всегда должен быть один без связи (старая версия приложения).
const DEMO_LOST_APP_VERSION = '2.9.0-test'

// ---------------------------------------------------------------------------
// Приём телеметрии — контракт для приложения водителя
// ---------------------------------------------------------------------------

export type TelemetryInput = {
  driverId: string
  deviceId?: string
  tripId?: string | null
  status?: string | null
  geo?: { lat: number; lng: number; speedKmh?: number; headingDeg?: number; accuracyM?: number; at?: string } | null
  appVersion?: string | null
  appInstalled?: boolean | null // false — водитель удалил приложение (тест)
  comment?: string | null
  source?: 'app' | 'test_sim'
}

/** Точка на маршруте текущего плеча по прогрессу (для демо-инициализации) */
function positionOnLeg(load: LatLng, unload: LatLng, t: number): { lat: number; lng: number; headingDeg: number } {
  const p = interpolate(load, unload, t)
  return { lat: p[0], lng: p[1], headingDeg: Math.round(bearingDeg(load, unload)) }
}

/**
 * Обрабатывает пакет телеметрии от приложения водителя.
 * Возвращает производный статус после применения.
 */
export async function ingestTelemetry(input: TelemetryInput): Promise<{
  ok: boolean
  status?: string
  error?: string
}> {
  const driver = await db.driver.findUnique({ where: { id: input.driverId } })
  if (!driver) return { ok: false, error: 'Водитель не найден' }

  const source = input.source === 'test_sim' ? 'test_sim' : 'app'
  const now = new Date()
  const existing = await db.driverOnline.findUnique({ where: { driverId: driver.id } })

  // Статус: принимаем только статусы, которые выбирает водитель в приложении;
  // системные (offline/not_installed/repair/idle/near_unload) не записываются напрямую
  let status = existing?.status ?? 'idle'
  if (input.status != null) {
    if ((MONITOR_DRIVER_STATUSES as readonly string[]).includes(input.status)) {
      status = input.status
    } else if (input.status === 'idle') {
      status = 'idle'
    } else {
      return { ok: false, error: `Статус «${input.status}» системный и не задаётся вручную` }
    }
  }

  const appInstalled = input.appInstalled === false ? false : true

  // Текущее плечо: если tripId не передан — берём активный рейс водителя
  let tripId = input.tripId ?? existing?.tripId ?? null
  let vehicleId = existing?.vehicleId ?? null
  if (!tripId) {
    const trip = await db.trip.findFirst({ where: { driverId: driver.id, status: 'active' } })
    if (trip) {
      tripId = trip.id
      vehicleId = trip.vehicleId
    }
  } else if (tripId !== existing?.tripId || !vehicleId) {
    const trip = await db.trip.findUnique({ where: { id: tripId } })
    vehicleId = trip?.vehicleId ?? vehicleId
  }

  const geo = input.geo ?? null
  const pointAt = geo?.at ? new Date(geo.at) : now

  const data = {
    driverId: driver.id,
    tripId,
    vehicleId,
    status,
    statusSource: source,
    ...(input.comment !== undefined ? { comment: input.comment } : {}),
    ...(geo ? { lat: geo.lat, lng: geo.lng, speedKmh: geo.speedKmh ?? 0, headingDeg: geo.headingDeg ?? null, pointAt } : {}),
    lastSeenAt: now,
    appInstalled,
    ...(input.appVersion ? { appVersion: input.appVersion } : {}),
  }

  await db.driverOnline.upsert({ where: { driverId: driver.id }, create: data, update: data })

  if (geo && appInstalled) {
    await db.driverGeoPoint.create({
      data: { driverId: driver.id, tripId, lat: geo.lat, lng: geo.lng, speedKmh: geo.speedKmh ?? 0, status, at: pointAt },
    })
    await pruneGeoHistory(driver.id)
  }

  return { ok: true, status }
}

/** Хвост истории точек: не больше GEO_TRACK_POINTS на водителя, старше TTL — удалить */
async function pruneGeoHistory(driverId: string) {
  const cutoff = new Date(Date.now() - CONSTANTS.GEO_POINT_TTL_HOURS * 3600_000)
  const points = await db.driverGeoPoint.findMany({
    where: { driverId, at: { gte: cutoff } },
    orderBy: { at: 'desc' },
    take: CONSTANTS.GEO_TRACK_POINTS,
    select: { id: true },
  })
  const keep = points.map((p) => p.id)
  await db.driverGeoPoint.deleteMany({
    where: { driverId, OR: [{ id: { notIn: keep } }, { at: { lt: cutoff } }] },
  })
}

/** Хук лестницы B5.1: применённый статус плеча сразу отражается в мониторинге */
export async function applyLadderStatus(driverId: string | undefined, ladderStatus: string, tripId: string) {
  if (!driverId) return
  const mapped = LADDER_TO_MONITOR[ladderStatus]
  if (!mapped) return
  const trip = await db.trip.findUnique({ where: { id: tripId } })
  if (!trip) return
  const now = new Date()
  const existing = await db.driverOnline.findUnique({ where: { driverId } })
  if (existing && existing.statusSource === 'test_sim' && existing.status === 'breakdown') return // поломка не затирается лестницей
  const data = {
    driverId,
    tripId,
    vehicleId: trip.vehicleId,
    status: mapped,
    statusSetAt: now,
    statusSource: existing?.statusSource === 'test_sim' ? 'test_sim' : 'app',
    lastSeenAt: now, // приложение прислало событие — значит на связи
    appInstalled: true,
  }
  await db.driverOnline.upsert({ where: { driverId }, create: data, update: data })
}

// ---------------------------------------------------------------------------
// Демо-инициализация (тестовый контур): расставляет водителей по маршрутам
// активных рейсов. Идемпотентна — работает один раз, дальше только телеметрия.
// ---------------------------------------------------------------------------

export async function ensureMonitorSeed(): Promise<void> {
  const existing = await db.driverOnline.count()
  if (existing > 0) return

  const trips = await db.trip.findMany({
    where: { status: 'active' },
    orderBy: { createdAt: 'asc' },
    take: 12,
  })
  if (trips.length === 0) return

  const legs = await db.leg.findMany({ where: { tripId: { in: trips.map((t) => t.id) } }, orderBy: [{ tripId: 'asc' }, { seq: 'asc' }] })
  const currentLeg = (tripId: string) => {
    const own = legs.filter((l) => l.tripId === tripId)
    return own.find((l) => l.status !== 'completed' && l.status !== 'cancelled') ?? own[own.length - 1] ?? null
  }

  const now = Date.now()
  const rows: Prisma.DriverOnlineCreateManyInput[] = []
  const trackRows: Prisma.DriverGeoPointCreateManyInput[] = []

  // Показательные роли демо (назначаем по фактическому статусу плеча):
  // одна поломка в пути, один плановый отдых, один «потерялся» (нет связи).
  let breakdownDone = false
  let restDone = false
  let lostDone = false

  trips.forEach((trip, i) => {
    const leg = currentLeg(trip.id)
    if (!leg) return
    const load = cityGeo(leg.loadPoint)
    const unload = cityGeo(leg.unloadPoint)
    if (!load || !unload) return

    // Приложение установлено у первых 9 машин (все стадии лестницы в демо);
    // остальные — «не установлено», чтобы в реестре была видна разница
    const hasApp = i < 9
    const legStatus = leg.status
    const base = LADDER_TO_MONITOR[legStatus] ?? 'idle'

    // Позиция по стадии плеча
    let t = 0.5
    if (legStatus === 'assigned' || legStatus === 'en_route_to_loading') t = 0.08
    else if (legStatus === 'at_loading' || legStatus === 'loaded') t = 0.02
    else if (legStatus === 'at_unloading' || legStatus === 'unloaded') t = 0.97
    else t = 0.2 + ((i * 37) % 60) / 100 // детерминированно 0.2..0.8

    let status = base
    let comment: string | null = null
    let appVersion = '3.0.0-test'
    let seenAgoSec = 20 + ((i * 17) % 50) // 20–70 сек назад: все на связи

    if (hasApp && !breakdownDone && legStatus === 'en_route') {
      status = 'breakdown'
      comment = 'Поломка в пути: неисправность сцепного, обочина 41 км трассы А-160'
      t = 0.6
      breakdownDone = true
      seenAgoSec = 55
    } else if (hasApp && !restDone && legStatus === 'at_unloading') {
      status = 'rest'
      comment = 'Плановый отдых водителя, ~45 мин'
      restDone = true
      seenAgoSec = 40
    } else if (hasApp && !lostDone && legStatus === 'loaded') {
      // машина «потерялась»: старая версия приложения, связь оборвалась
      lostDone = true
      seenAgoSec = 8 * 60 + 30 // 8.5 мин назад > порога 2 мин
      appVersion = DEMO_LOST_APP_VERSION
    }

    const pos = positionOnLeg(load, unload, t)
    const moving = status === 'en_route' || status === 'en_route_loading'
    const seenAt = new Date(now - seenAgoSec * 1000)

    rows.push({
      driverId: trip.driverId,
      tripId: trip.id,
      vehicleId: trip.vehicleId,
      status,
      statusSetAt: new Date(now - 40 * 60000),
      statusSource: 'test_sim',
      comment,
      lat: pos.lat,
      lng: pos.lng,
      speedKmh: status === 'breakdown' || status === 'rest' ? 0 : moving ? 58 + ((i * 13) % 20) : 0,
      headingDeg: pos.headingDeg,
      pointAt: seenAt,
      lastSeenAt: seenAt,
      appInstalled: hasApp,
      appVersion,
    })

    // Короткий трек позади текущей позиции (для полилинии на карте)
    if (hasApp && t > 0.05) {
      const steps = 6
      for (let k = steps; k >= 0; k--) {
        const tk = Math.max(0, t - k * 0.03)
        const p = interpolate(load, unload, tk)
        trackRows.push({
          driverId: trip.driverId,
          tripId: trip.id,
          lat: p[0],
          lng: p[1],
          speedKmh: moving ? 58 : 0,
          status,
          at: new Date(seenAt.getTime() - k * 120000),
        })
      }
    }
  })

  if (rows.length > 0) await db.driverOnline.createMany({ data: rows })
  if (trackRows.length > 0) await db.driverGeoPoint.createMany({ data: trackRows })
}

// ---------------------------------------------------------------------------
// Сводка для логиста: производные статусы, остаток км, треки
// ---------------------------------------------------------------------------

export type MonitorRow = {
  driverId: string
  fullName: string
  phone: string
  vehicle: { id: string; brand: string; plate: string; isRepair: boolean } | null
  trailer: { brand: string; plate: string } | null // прицеп состава (если закреплён за рейсом)
  tripId: string | null
  tripStatus: string | null
  tripStartedAt: string | null // фактический выезд рейса
  ackStatus: string | null
  waitingReturn: boolean
  leg: { id: string; seq: number; type: string; loadPoint: string; unloadPoint: string; status: string; kmPlan: number | null } | null
  route: { from: LatLng; to: LatLng } | null // координаты городов текущего плеча
  status: string // производный статус мониторинга
  rawStatus: string // последний статус от приложения/симулятора
  statusSetAt: string | null // когда объект вошёл в текущий статус
  lastKnownStatus: string | null // прежний статус, когда «нет связи»
  kmLeft: number | null // до места выгрузки (по прямой, GPS)
  legKm: number | null // длина плеча по прямой (для прогресса)
  progressPct: number | null // прохождение плеча 0..100
  etaMin: number | null // оценочный остаток времени до выгрузки, мин
  etaAt: string | null // оценочное время прибытия
  cargo: { desc: string | null; weightT: number | null; volumeM3: number | null } | null
  order: { number: string; customer: string } | null // заявка 1С текущего плеча
  docsPending: boolean // фото ТТН ожидается по текущему плечу
  docsLost: boolean // фото ТТН утрачено
  speedKmh: number | null
  headingDeg: number | null
  point: LatLng | null
  pointAt: string | null
  lastSeenAt: string | null
  appInstalled: boolean
  appVersion: string | null
  comment: string | null
  source: string | null
  events: { at: string; status: string; actorRole: string; comment: string | null; legSeq: number | null; type: string; result: string | null }[]
  track: LatLng[] // хвост маршрута (только для карты)
}

export type MonitorState = {
  rows: MonitorRow[]
  summary: {
    onMap: number
    inMotion: number
    atLoading: number
    nearUnload: number
    breakdowns: number
    offline: number
    notInstalled: number
    waitingBackhaul: number
    onTrip: number // объектов в активных рейсах
    withApp: number // объектов с установленным приложением (покрытие парка)
    totalDrivers: number // всего объектов парка в справочнике
  }
  meta: {
    staleMin: number
    nearUnloadKm: number
    pollSec: number
    etaKmK: number // коэффициент извилистости дорог для ETA
    etaAvgKmh: number // средняя скорость расчёта ETA
    generatedAt: string
  }
}

/**
 * Оценочный ETA до выгрузки: GPS-дистанция по прямой переводится в пробег
 * по дороге (ETA_ROAD_K), делится на среднюю скорость режима движения и
 * дополняется обязательными отдыхами водителя (правило 4.5 ч / 45 мин).
 * Прогноз ориентировочный — для планирования, не для сверки с 1С.
 */
function etaMinutes(kmStraight: number): number {
  const roadKm = kmStraight * CONSTANTS.ETA_ROAD_K
  const driveH = roadKm / CONSTANTS.ETA_AVG_KMH
  const breaks = Math.floor(driveH / CONSTANTS.ETA_BREAK_DRIVE_H)
  return Math.round((driveH + breaks * (CONSTANTS.ETA_BREAK_MIN / 60)) * 60)
}

/** Плечо в контуре мониторинга (подмножество модели Leg) */
type MonitorLeg = {
  id: string
  seq: number
  status: string
  loadPoint: string
  unloadPoint: string
  tripId: string
  type: string
  kmPlan: number | null
  cargoDesc: string | null
  weightT: number | null
  volumeM3: number | null
  docsPending: boolean
  docsLost: boolean
  orderId: string | null
}

/** Текущее (незакрытое) плечо рейса */
function pickCurrentLeg(legs: MonitorLeg[], tripId: string): MonitorLeg | null {
  const own = legs.filter((l) => l.tripId === tripId).sort((a, b) => a.seq - b.seq)
  return own.find((l) => l.status !== 'completed' && l.status !== 'cancelled') ?? own[own.length - 1] ?? null
}

/**
 * Демо-keepalive: пока реального приложения нет, тестовые точки (source=test_sim)
 * «оживают» при обращении к разделу — иначе через пару минут все машины выцветают
 * в «нет связи». Движущиеся машины немного продвигаются по маршруту. Потерянный
 * водитель (DEMO_LOST_APP_VERSION) и реальные данные (source=app) не трогаются.
 */
async function demoKeepalive(
  onlineRows: { driverId: string; tripId: string | null; status: string; statusSource: string; appVersion: string | null; appInstalled: boolean; lat: number | null; lng: number | null; lastSeenAt: Date | null }[],
  legs: MonitorLeg[],
): Promise<boolean> {
  const sim = onlineRows.filter((r) => r.statusSource === 'test_sim' && r.appInstalled && r.appVersion !== DEMO_LOST_APP_VERSION)
  if (sim.length === 0) return false
  const now = Date.now()
  const staleCutoff = now - CONSTANTS.ONLINE_STALE_MIN * 60000
  // Оживляем каждый объект индивидуально, как только он пересёк порог «нет связи»:
  // иначе парк волнами уходит в offline и возвращается — сводка «мигает»
  const due = sim.filter((r) => r.lastSeenAt && r.lastSeenAt.getTime() < staleCutoff)
  if (due.length === 0) return false

  for (const r of due) {
    const data: Record<string, unknown> = {
      lastSeenAt: new Date(now - (15 + Math.floor(Math.random() * 50)) * 1000),
    }
    if (r.lat != null && r.lng != null && r.tripId && ['en_route', 'en_route_loading'].includes(r.status)) {
      const leg = pickCurrentLeg(legs, r.tripId)
      const load = leg ? cityGeo(leg.loadPoint) : null
      const unload = leg ? cityGeo(leg.unloadPoint) : null
      if (load && unload) {
        const t = progressOnSegment(load, unload, [r.lat, r.lng])
        if (t < 0.98) {
          const p = interpolate(load, unload, Math.min(0.98, t + 0.004 + Math.random() * 0.01))
          data.lat = p[0]
          data.lng = p[1]
          data.pointAt = data.lastSeenAt
        }
      }
    }
    await db.driverOnline.update({ where: { driverId: r.driverId }, data }).catch(() => {})
  }
  return true
}

export async function buildMonitorState(): Promise<MonitorState> {
  await ensureMonitorSeed()

  const [drivers, vehicles, trips, legs, online] = await Promise.all([
    db.driver.findMany(),
    db.vehicle.findMany(),
    db.trip.findMany(),
    db.leg.findMany(),
    db.driverOnline.findMany(),
  ])

  // Контекст для карточки объекта: заказы 1С, прицепы, хронология статусов плеч
  const [orders, trailers] = await Promise.all([
    db.order.findMany({ select: { id: true, number: true, customer: true } }),
    db.trailer.findMany({ select: { id: true, brand: true, plate: true } }),
  ])
  const orderById = new Map(orders.map((o) => [o.id, o]))
  const trailerById = new Map(trailers.map((t) => [t.id, t]))

  const activeTrips = trips.filter((t) => t.status === 'active')
  const currentLegByTrip = new Map<string, ReturnType<typeof pickCurrentLeg>>()
  for (const t of activeTrips) currentLegByTrip.set(t.id, pickCurrentLeg(legs, t.id))
  const currentLegIds = [...new Set([...currentLegByTrip.values()].filter(Boolean).map((l) => l!.id))]
  const legById = new Map(legs.map((l) => [l.id, l]))

  // Хронология статусов текущих плеч (лестница B5.1 + корректировки логиста)
  const eventsByLeg = new Map<string, { at: string; status: string; actorRole: string; comment: string | null; legSeq: number | null; type: string; result: string | null }[]>()
  if (currentLegIds.length > 0) {
    const evs = await db.statusEvent.findMany({
      where: { legId: { in: currentLegIds } },
      orderBy: { serverTs: 'desc' },
      take: 300,
    })
    for (const ev of evs) {
      const arr = eventsByLeg.get(ev.legId) ?? []
      if (arr.length >= 8) continue
      arr.push({
        at: ev.serverTs.toISOString(),
        status: ev.status,
        actorRole: ev.actorRole,
        comment: ev.comment,
        legSeq: legById.get(ev.legId)?.seq ?? null,
        type: ev.type,
        result: ev.result,
      })
      eventsByLeg.set(ev.legId, arr)
    }
  }

  // Демо-keepalive: оживить тестовые точки, если они состарились
  const revived = await demoKeepalive(online, legs)
  const onlineRows = revived ? await db.driverOnline.findMany() : online
  const onlineByDriver = new Map(onlineRows.map((o) => [o.driverId, o]))
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]))
  const activeTripByDriver = new Map<string, typeof trips[number]>()
  for (const t of trips) {
    if (t.status === 'active') activeTripByDriver.set(t.driverId, t)
  }

  const now = Date.now()
  const staleMs = CONSTANTS.ONLINE_STALE_MIN * 60000

  // Треки: последние точки по водителям с приложением (для полилиний)
  const trackDrivers = onlineRows.filter((o) => o.appInstalled && o.lat != null && o.lng != null).map((o) => o.driverId)
  const trackMap = new Map<string, LatLng[]>()
  if (trackDrivers.length > 0) {
    const points = await db.driverGeoPoint.findMany({
      where: { driverId: { in: trackDrivers } },
      orderBy: { at: 'asc' },
    })
    for (const p of points) {
      const arr = trackMap.get(p.driverId) ?? []
      arr.push([p.lat, p.lng])
      trackMap.set(p.driverId, arr)
    }
  }

  const rows: MonitorRow[] = drivers.map((driver) => {
    const rec = onlineByDriver.get(driver.id) ?? null
    const trip = activeTripByDriver.get(driver.id) ?? null
    const vehicle = (trip ? vehicleById.get(trip.vehicleId) : null) ?? (rec?.vehicleId ? vehicleById.get(rec.vehicleId) : null) ?? null
    const trailer = trip?.trailerId ? trailerById.get(trip.trailerId) ?? null : null
    const leg = trip ? currentLegByTrip.get(trip.id) ?? null : null
    const loadGeo = leg ? cityGeo(leg.loadPoint) : null
    const unloadGeo = leg ? cityGeo(leg.unloadPoint) : null
    const order = leg?.orderId ? orderById.get(leg.orderId) ?? null : null

    const point: LatLng | null = rec && rec.lat != null && rec.lng != null ? [rec.lat, rec.lng] : null
    const kmLeft = point && unloadGeo ? Math.round(haversineKm(point, unloadGeo)) : null
    const legKm = loadGeo && unloadGeo ? Math.round(haversineKm(loadGeo, unloadGeo)) : null

    // Прохождение плеча (доля пути от погрузки до выгрузки)
    let progressPct: number | null = null
    if (loadGeo && unloadGeo && point) progressPct = Math.round(progressOnSegment(loadGeo, unloadGeo, point) * 100)
    if (leg && ['at_unloading', 'unloaded', 'completed'].includes(leg.status)) progressPct = 100

    // Оценочный ETA — только когда есть остаток пути (объект не завершил плечо)
    const etaMin = kmLeft != null && kmLeft > 0 && !(leg && ['at_unloading', 'unloaded', 'completed'].includes(leg.status))
      ? etaMinutes(kmLeft)
      : null
    const etaAt = etaMin != null ? new Date(now + etaMin * 60000).toISOString() : null

    const appInstalled = rec?.appInstalled ?? false
    const lastSeen = rec?.lastSeenAt ?? null
    const stale = !appInstalled || !lastSeen || now - lastSeen.getTime() > staleMs

    const rawStatus = rec?.status ?? 'idle'

    // Производный статус (порядок важен)
    let status: string
    if (!appInstalled) status = 'not_installed'
    else if (vehicle?.isRepair) status = 'repair'
    else if (stale) status = 'offline'
    else if (trip?.waitingReturn && ['empty_return', 'idle', 'waiting_backhaul'].includes(rawStatus)) status = 'waiting_backhaul'
    // «Скоро завершит рейс»: машина в гружёном пробеге и до выгрузки < 500 км.
    // На стадиях погрузки/выгрузки статус этапа информативнее (все локальные
    // плечи АЭМЗ короче 500 км — правило сработало бы сразу после «Погрузилась»).
    else if (rawStatus === 'en_route' && kmLeft != null && kmLeft < CONSTANTS.NEAR_UNLOAD_KM) status = 'near_unload'
    else status = rawStatus

    return {
      driverId: driver.id,
      fullName: driver.fullName,
      phone: driver.phone,
      vehicle: vehicle ? { id: vehicle.id, brand: vehicle.brand, plate: vehicle.plate, isRepair: vehicle.isRepair } : null,
      trailer: trailer ? { brand: trailer.brand, plate: trailer.plate } : null,
      tripId: trip?.id ?? rec?.tripId ?? null,
      tripStatus: trip?.status ?? null,
      tripStartedAt: trip?.startedAt?.toISOString() ?? null,
      ackStatus: trip?.ackStatus ?? null,
      waitingReturn: trip?.waitingReturn ?? false,
      leg: leg ? { id: leg.id, seq: leg.seq, type: leg.type, loadPoint: leg.loadPoint, unloadPoint: leg.unloadPoint, status: leg.status, kmPlan: leg.kmPlan ?? null } : null,
      route: loadGeo && unloadGeo ? { from: loadGeo, to: unloadGeo } : null,
      status,
      rawStatus,
      statusSetAt: rec?.statusSetAt?.toISOString() ?? null,
      lastKnownStatus: status === 'offline' ? rawStatus : null,
      kmLeft,
      legKm,
      progressPct,
      etaMin,
      etaAt,
      cargo: leg && (leg.cargoDesc || leg.weightT != null || leg.volumeM3 != null)
        ? { desc: leg.cargoDesc ?? null, weightT: leg.weightT ?? null, volumeM3: leg.volumeM3 ?? null }
        : null,
      order: order ? { number: order.number, customer: order.customer } : null,
      docsPending: leg?.docsPending ?? false,
      docsLost: leg?.docsLost ?? false,
      speedKmh: rec?.speedKmh ?? null,
      headingDeg: rec?.headingDeg ?? null,
      point,
      pointAt: rec?.pointAt?.toISOString() ?? null,
      lastSeenAt: lastSeen?.toISOString() ?? null,
      appInstalled,
      appVersion: rec?.appVersion ?? null,
      comment: rec?.comment ?? null,
      source: rec?.statusSource ?? null,
      events: leg ? eventsByLeg.get(leg.id) ?? [] : [],
      track: (trackMap.get(driver.id) ?? []).slice(-40),
    }
  })

  // Сортировка: сначала те, кто требует внимания (поломка, нет связи), потом в работе
  const order: Record<string, number> = {
    breakdown: 0, repair: 1, offline: 2, rest: 3,
    near_unload: 4, en_route: 5, loaded: 6, at_loading: 7, en_route_loading: 8,
    assigned: 9, at_unload: 10, unloaded: 11, waiting_backhaul: 12, empty_return: 13,
    trip_completed: 14, idle: 15, not_installed: 16,
  }
  rows.sort((a, b) => (order[a.status] ?? 90) - (order[b.status] ?? 90) || a.fullName.localeCompare(b.fullName))

  const summary = {
    onMap: rows.filter((r) => r.point && r.appInstalled).length,
    inMotion: rows.filter((r) => ['en_route', 'near_unload', 'en_route_loading', 'empty_return'].includes(r.status)).length,
    atLoading: rows.filter((r) => ['at_loading', 'loaded', 'at_unload'].includes(r.status)).length,
    nearUnload: rows.filter((r) => r.status === 'near_unload').length,
    breakdowns: rows.filter((r) => ['breakdown', 'repair'].includes(r.status)).length,
    offline: rows.filter((r) => r.status === 'offline').length,
    notInstalled: rows.filter((r) => r.status === 'not_installed').length,
    waitingBackhaul: rows.filter((r) => r.status === 'waiting_backhaul').length,
    onTrip: rows.filter((r) => r.tripStatus === 'active').length,
    withApp: rows.filter((r) => r.appInstalled).length,
    totalDrivers: rows.length,
  }

  return {
    rows,
    summary,
    meta: {
      staleMin: CONSTANTS.ONLINE_STALE_MIN,
      nearUnloadKm: CONSTANTS.NEAR_UNLOAD_KM,
      pollSec: CONSTANTS.MONITOR_POLL_SEC,
      etaKmK: CONSTANTS.ETA_ROAD_K,
      etaAvgKmh: CONSTANTS.ETA_AVG_KMH,
      generatedAt: new Date().toISOString(),
    },
  }
}

/** Сброс мониторинга к демо-состоянию (кнопка в интерфейсе) */
export async function resetMonitorDemo(): Promise<void> {
  await db.driverOnline.deleteMany()
  await db.driverGeoPoint.deleteMany()
  await ensureMonitorSeed()
}
