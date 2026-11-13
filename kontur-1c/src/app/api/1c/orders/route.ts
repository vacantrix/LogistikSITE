// HTTP-сервис «1С»: get_driver_orders — зеркалит контракт, который уже потребляет приложение водителя.
// GET  → список заявок водителя (формат 6.1 ТЗ, поле-в-поле)
// POST → обратный канал действий водителя (ACCEPT | PRETRIP_STEP | START_ROUTE | COMPLETE_TRIP)
import { db } from '@/lib/db'
import { json, optionsOk } from '@/lib/cors'
import { mapOrderStatus } from '@/lib/1c/statuses'
import { driverAction } from '@/lib/1c/driverActions'

export const dynamic = 'force-dynamic'

async function resolveDriver(req: Request) {
  const key = req.headers.get('x-driver-id')?.trim()
  if (key) {
    // X-Driver-Id — appId приложения водителя; на стенде допускается и id записи
    const byApp = await db.driver.findUnique({ where: { appId: key } })
    if (byApp) return byApp
    const byId = await db.driver.findUnique({ where: { id: key } })
    if (byId) return byId
  }
  // в демо-режиме заголовок необязателен: подставляется демо-водитель
  return db.driver.findUnique({ where: { appId: 'd1111111-1111-4111-8111-111111111111' } })
}



function vehicleLabel(v: { model: string; plate: string } | null): string {
  return v ? `${v.model} · ${v.plate}` : '—'
}

export async function GET(req: Request) {
  const driver = await resolveDriver(req)
  if (!driver) return json({ ok: false, error: 'Водитель не найден' }, 404)

  const active = await db.transportRequest.findMany({
    where: {
      OR: [
        { driverId: driver.id, status: { in: ['ASSIGNED', 'ACCEPTED', 'PRETRIP', 'IN_PROGRESS'] } },
        { driverId: null, status: 'DISPATCH' },
      ],
    },
    include: {
      contractor: true, fromLocation: true, toLocation: true, vehicle: true, trailer: true,
      trip: { select: { routeDistanceM: true, routeDurationS: true } },
    },
    orderBy: { loadingAt: 'asc' },
  })
  const done = await db.transportRequest.findMany({
    where: { driverId: driver.id, status: 'DONE' },
    include: {
      contractor: true, fromLocation: true, toLocation: true, vehicle: true, trailer: true,
      trip: { select: { routeDistanceM: true, routeDurationS: true } },
    },
    orderBy: { assignedAt: 'desc' },
    take: 3,
  })

  const orders = [...active, ...done].map((r) => ({
    number: r.number,
    externalId: r.externalId,
    client: r.contractor.name,
    cargo: r.cargo,
    weightT: r.weightT,
    fromLabel: r.fromLocation.name,
    toLabel: r.toLocation.name,
    loadingAt: r.loadingAt.toISOString(),
    unloadingWindow: r.unloadingWindow,
    vehicle: vehicleLabel(r.vehicle),
    trailer: vehicleLabel(r.trailer),
    docs: JSON.parse(r.docs) as string[],
    distanceKm: r.trip?.routeDistanceM ? Math.round(r.trip.routeDistanceM / 1000) : 0,
    durationMin: r.trip?.routeDurationS ? Math.round(r.trip.routeDurationS / 60) : 0,
    status: mapOrderStatus(r.status) ?? 'ASSIGNED',
    assignedBy: r.assignedBy ?? '—',
    // маршрут из ссылки Яндекс.Карт (диспетчер: «Поделиться» → «Ссылка»)
    routeLink: r.routeLink ?? null,
    routeWaypoints: r.routeWaypoints ? (JSON.parse(r.routeWaypoints) as Array<{ lat: number; lng: number }>) : null,
  }))

  // eventLog — журнал действий водителя: из регистра статусов и шагов фотофиксации
  type Entry = { at: string; orderId: string; action: string }
  const log: Entry[] = []
  const statuses = await db.statusHistory.findMany({
    where: { actor: `driver:${driver.id}` },
    include: { request: { select: { number: true } } },
    orderBy: { at: 'desc' },
    take: 60,
  })
  const statusToAction: Record<string, string> = {
    ACCEPTED: 'ACCEPT',
    PRETRIP: 'PRETRIP_STEP',
    IN_PROGRESS: 'START_ROUTE',
    DONE: 'COMPLETE_TRIP',
  }
  for (const s of statuses) {
    const action = statusToAction[s.toStatus]
    if (action && s.request) log.push({ at: s.at.toISOString(), orderId: s.request.number, action })
  }
  const steps = await db.preTripStep.findMany({
    where: { inspection: { driverId: driver.id } },
    include: { inspection: { include: { request: { select: { number: true } } } } },
    orderBy: { at: 'desc' },
    take: 30,
  })
  for (const s of steps) {
    if (s.inspection.request)
      log.push({ at: s.at.toISOString(), orderId: s.inspection.request.number, action: `PRETRIP_STEP:${s.stepId}` })
  }
  const eventLog = log.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 50)

  return json({
    source: '1c-stand',
    note: 'Эмулятор 1С: список заявок водителя',
    orders,
    eventLog,
  })
}

export async function POST(req: Request) {
  const driver = await resolveDriver(req)
  let body: { orderId?: string; action?: string; stepId?: string; at?: string; photoDataUrl?: string | null }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Некорректное тело запроса (ожидается JSON)' }, 400)
  }
  if (!body?.orderId || !body?.action)
    return json({ ok: false, error: 'Обязательны поля orderId и action' }, 400)

  const result = await driverAction(
    {
      orderId: body.orderId,
      action: body.action,
      stepId: body.stepId ?? null,
      at: body.at ?? null,
      photoDataUrl: body.photoDataUrl ?? null,
    },
    driver ? { id: driver.id, fullName: driver.fullName } : null,
  )
  if (!result.ok) return json({ ok: false, error: result.error }, result.code)
  return json(result)
}

export async function OPTIONS() {
  return optionsOk()
}
