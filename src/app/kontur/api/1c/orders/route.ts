import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'
import { CONTOUR_STATUS_LABELS, toOneCStatus, toPlatformStatus } from '@/lib/kontur/status-map'
import { coordsFromGeoJson, waypointsFromJson } from '@/lib/kontur/yandex-route'

export const dynamic = 'force-dynamic'

type OrderInput = {
  external_id?: string
  number?: string
  customer?: string
  product?: string
  load_point?: string
  unload_point?: string
  load_date_plan?: string
  unload_date_plan?: string
  tariff?: number
  kp?: string
  extra?: Record<string, unknown>
}

function validateOrder(o: OrderInput): string | null {
  if (!o.external_id?.trim()) return 'Не заполнен external_id'
  if (!o.number?.trim()) return 'Не заполнен номер заявки'
  if (!o.customer?.trim()) return 'Не заполнен заказчик'
  if (!o.product?.trim()) return 'Не заполнена номенклатура'
  if (!o.load_point?.trim()) return 'Не заполнен пункт погрузки'
  if (!o.unload_point?.trim()) return 'Не заполнен пункт выгрузки'
  return null
}

function formatWindow(d: Date | null): string {
  if (!d) return 'по прибытии'
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  })
}

/**
 * Лента заявок для модуля водителя (PWA/APK). Это не обмен с 1С, а тот же
 * диспетчерский контур: рейс → плечо → заявка. Водитель получает только
 * свои рейсы; чужой X-Driver-Id не раскрывает данные.
 *
 * Демо-водитель приложения пока не заведён в DispatchDriver, поэтому для него
 * возвращается пустая лента — клиент остаётся на офлайн-сиде и не ломается.
 * Когда появится карточка водителя с тем же id, лента заработает без правок APK.
 */
const DEMO_DRIVER_ID = '06c075d1-3088-45f2-a7ae-090e8c355447'

async function driverOrders(driverId: string) {
  let trips = await db.trip.findMany({
    where: { driverId, status: { in: ['active', 'draft'] } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  // Пилот с одним телефоном: водителя приложения ещё нет в справочнике,
  // поэтому показываем рейс, на который офис только что сохранил маршрут.
  // В парке DRIVER_APP_SINGLE_DRIVER=0 — работает строгая выборка по driverId.
  if (
    trips.length === 0 &&
    driverId === DEMO_DRIVER_ID &&
    process.env.DRIVER_APP_SINGLE_DRIVER === '1'
  ) {
    const routedLeg = await db.leg.findFirst({
      where: { routeLink: { not: null } },
      orderBy: { routeUpdatedAt: 'desc' },
    })
    if (routedLeg) {
      const routedTrip = await db.trip.findFirst({
        where: { id: routedLeg.tripId, status: { in: ['active', 'draft'] } },
      })
      if (routedTrip) trips = [routedTrip]
    }
  }

  if (trips.length === 0) return []

  const legs = await db.leg.findMany({
    where: { tripId: { in: trips.map((t) => t.id) } },
    orderBy: { seq: 'asc' },
  })
  const orderIds = [...new Set(legs.map((l) => l.orderId).filter((id): id is string => Boolean(id)))]
  const trailerIds = [...new Set(trips.map((t) => t.trailerId).filter((id): id is string => Boolean(id)))]
  const [orders, vehicles, trailers] = await Promise.all([
    db.order.findMany({ where: { id: { in: orderIds } } }),
    db.vehicle.findMany({ where: { id: { in: [...new Set(trips.map((t) => t.vehicleId))] } } }),
    db.trailer.findMany({ where: { id: { in: trailerIds } } }),
  ])
  const orderById = new Map<string, (typeof orders)[number]>(orders.map((o) => [o.id, o]))
  const vehicleById = new Map<string, (typeof vehicles)[number]>(vehicles.map((v) => [v.id, v]))
  const trailerById = new Map<string, (typeof trailers)[number]>(trailers.map((t) => [t.id, t]))
  const legsByTrip = new Map<string, typeof legs>()
  for (const leg of legs) {
    const list = legsByTrip.get(leg.tripId) ?? []
    list.push(leg)
    legsByTrip.set(leg.tripId, list)
  }

  return trips.flatMap((trip) => {
    const vehicle = vehicleById.get(trip.vehicleId)
    const trailer = trip.trailerId ? trailerById.get(trip.trailerId) : undefined
    return (legsByTrip.get(trip.id) ?? []).flatMap((leg) => {
      const order = leg.orderId ? orderById.get(leg.orderId) : undefined
      if (!order) return []
      const loadingAt = order.loadDatePlan ?? leg.loadDatePlan ?? trip.createdAt
      const unloadingAt = order.unloadDatePlan ?? leg.unloadDatePlan
      const done = trip.status === 'completed' || leg.status === 'completed' || leg.status === 'unloaded'
      const status = done ? 'DONE' as const : trip.ackStatus === 'pending' ? 'DISPATCH' as const : 'ASSIGNED' as const
      // Маршрут офиса из Яндекс.Карт: ссылка, точки по порядку и готовая
      // дорожная линия. Приложение строит маршрут именно по этим точкам.
      const routeWaypoints = waypointsFromJson(leg.routeWaypoints)
      const routeCoords = coordsFromGeoJson(leg.routeGeometry)
      return [{
        number: order.number,
        externalId: order.externalId,
        client: order.customer,
        cargo: order.product || leg.cargoDesc || '—',
        weightT: leg.weightT ?? 0,
        fromLabel: order.loadPoint || leg.loadPoint,
        toLabel: order.unloadPoint || leg.unloadPoint,
        loadingAt: loadingAt.toISOString(),
        unloadingWindow: formatWindow(unloadingAt ?? null),
        vehicle: vehicle ? `${vehicle.brand} ${vehicle.plate}` : '—',
        trailer: trailer ? `${trailer.brand} ${trailer.plate}` : '—',
        docs: [] as string[],
        distanceKm: leg.kmPlan ?? (leg.routeDistanceM ? Math.round(leg.routeDistanceM / 1000) : 0),
        durationMin: leg.routeDurationS ? Math.round(leg.routeDurationS / 60) : 0,
        status,
        assignedBy: 'Диспетчер',
        routeLink: leg.routeLink ?? null,
        routeWaypoints,
        routeCoords,
        routeDistanceM: leg.routeDistanceM ?? null,
        routeDurationS: leg.routeDurationS ?? null,
        routeSource: leg.routeLink
          ? (leg.routeSource === 'yandex' ? 'yandex' as const : 'osrm' as const)
          : null,
      }]
    })
  })
}

/**
 * GET /api/1c/orders?external_id=…[,…]|onec=<фрагмент> — статусы заявок для 1С.
 * Обратная задача обмена: 1С видит судьбу своего документа (Новая → К планированию →
 * В рейсе / Карантин) и назначенный состав (водитель, тягач, прицеп), чтобы
 * перенести его в путевой лист. Симулятор 1С использует этот же GET в «Обновить статусы».
 *
 * Без external_id, но с X-Driver-Id — лента модуля водителя (см. driverOrders).
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const idsRaw = sp.get('external_id') || sp.get('onec') || ''
  const ids = [...new Set(idsRaw.split(',').map((s) => s.trim()).filter(Boolean))]
  if (ids.length === 0) {
    const driverId = req.headers.get('x-driver-id')?.trim()
    if (driverId) {
      return NextResponse.json(
        { ok: true, orders: await driverOrders(driverId) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Укажите external_id (или список через запятую)' } }, { status: 400 })
  }

  const orders = await db.order.findMany({ where: { externalId: { in: ids } } })

  // FK в схеме — строковые, без Prisma-связей: соединяем заявка → плечо → рейс → состав вручную
  const orderIds = new Set(orders.map((o) => o.id))
  const legs = orderIds.size ? await db.leg.findMany({ where: { orderId: { in: [...orderIds] } } }) : []
  const tripIds = [...new Set(legs.map((l) => l.tripId))]
  const trips = tripIds.length ? await db.trip.findMany({ where: { id: { in: tripIds } } }) : []
  const [drivers, vehicles, trailers] = await Promise.all([
    db.driver.findMany(),
    db.vehicle.findMany(),
    db.trailer.findMany(),
  ])
  const legByOrder = new Map(legs.map((l) => [l.orderId!, l]))
  const tripById = new Map(trips.map((t) => [t.id, t]))
  const driverById = new Map(drivers.map((d) => [d.id, d]))
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]))
  const trailerById = new Map(trailers.map((t) => [t.id, t]))

  const statusRu: Record<string, string> = {
    new: 'Новая',
    ready_to_plan: 'К планированию',
    planned: 'В рейсе',
    quarantine: 'Карантин',
  }

  const data = ids.map((externalId) => {
    const o = orders.find((row) => row.externalId === externalId)
    if (!o) return { external_id: externalId, found: false }
    const trip = o.id ? legByOrder.get(o.id)?.tripId : undefined
    const t = trip ? tripById.get(trip) : undefined
    const d = t ? driverById.get(t.driverId) : undefined
    const v = t ? vehicleById.get(t.vehicleId) : undefined
    const tr = t?.trailerId ? trailerById.get(t.trailerId) : undefined
    // единый словарь контура: статус диспетчерской + статус платформы + код 1С
    const platformStatus = toPlatformStatus(o.status)
    return {
      external_id: externalId,
      found: true,
      number: o.number,
      status: o.status,
      statusRu: statusRu[o.status] ?? o.status,
      platformStatus,
      platformStatusRu: CONTOUR_STATUS_LABELS[platformStatus],
      oneCStatus: toOneCStatus(platformStatus),
      quarantineReason: o.quarantineReason ?? null,
      updatedAt: o.updatedAt,
      trip: t
        ? {
            id: t.id,
            status: t.status,
            driver: d ? { fullName: d.fullName, phone: d.phone } : null,
            vehicle: v ? { brand: v.brand, plate: v.plate } : null,
            trailer: tr ? { brand: tr.brand, plate: tr.plate } : null,
          }
        : null,
    }
  })

  return NextResponse.json({ ok: true, data })
}

// B7.1.1: POST /1c/orders — upsert по external_id, partial-batch, карантин с причиной.
// Дубль -> обновление. Повтор безопасен (идемпотентность).
export async function POST(req: Request) {
  const body = await req.json()
  const orders: OrderInput[] = body.orders ?? []
  if (!Array.isArray(orders)) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'orders должен быть массивом' } }, { status: 400 })
  }

  const accepted: string[] = []
  const quarantined: { external_id: string; reason: string }[] = []

  for (const o of orders) {
    const reason = validateOrder(o)
    if (reason) {
      quarantined.push({ external_id: o.external_id || '(без external_id)', reason })
      continue
    }
    const data = {
      externalId: o.external_id!.trim(),
      number: o.number!.trim(),
      customer: o.customer!.trim(),
      product: o.product!.trim(),
      loadPoint: o.load_point!.trim(),
      unloadPoint: o.unload_point!.trim(),
      loadDatePlan: o.load_date_plan ? new Date(o.load_date_plan) : null,
      unloadDatePlan: o.unload_date_plan ? new Date(o.unload_date_plan) : null,
      tariff: o.tariff ?? null,
      kp: o.kp ?? null,
      extra: o.extra ? JSON.stringify(o.extra) : null,
      source: '1c' as const,
    }
    // upsert: дубль -> обновление (P1). Заявка, уже поставленная в рейс (planned),
    // статус не теряет — повторная отправка документа 1С безопасна.
    const existing = await db.order.findUnique({ where: { externalId: data.externalId } })
    const keepPlanned = existing?.status === 'planned'
    await db.order.upsert({
      where: { externalId: data.externalId },
      update: { ...data, ...(keepPlanned ? {} : { status: 'new' }), quarantineReason: null },
      create: { ...data, status: 'new' },
    })
    accepted.push(data.externalId)
  }

  return NextResponse.json({ accepted, quarantined })
}
