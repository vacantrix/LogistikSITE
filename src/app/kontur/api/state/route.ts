import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'
import { seedDemo } from '@/lib/kontur/seed'
import { CONSTANTS } from '@/lib/kontur/constants'
import { outboxTick } from '@/lib/kontur/engine'
import type { Alert } from '@/lib/kontur/client-types'
import { getSessionUser } from '@/lib/kontur/auth'
import { konturAllowedAny, OWN_SECTION_KEYS } from '@/lib/kontur/access'

export const dynamic = 'force-dynamic'

// Собираем состояние кабинета одним запросом (доска, шапка-бейджи, алерты B8.2)
export async function GET() {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: { code: 'AUTH', message: 'Нужен вход в платформу' } }, { status: 401 })
  }
  if (!(await konturAllowedAny(user, OWN_SECTION_KEYS))) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Нет доступа ни к одному разделу собственного транспорта' } },
      { status: 403 },
    )
  }

  await outboxTick() // аналог фоновой задачи outbox_watch (B6.3, 60 сек)
  let tripCount = await db.trip.count()
  if (tripCount === 0) {
    await seedDemo()
    tripCount = await db.trip.count()
  }

  const [drivers, vehicles, trailers] = await Promise.all([
    db.driver.findMany(),
    db.vehicle.findMany(),
    db.trailer.findMany(),
  ])
  const driverMap = new Map(drivers.map((d) => [d.id, d]))
  const vehicleMap = new Map(vehicles.map((v) => [v.id, v]))
  const trailerMap = new Map(trailers.map((t) => [t.id, t]))

  const trips = await db.trip.findMany({ orderBy: { createdAt: 'asc' } })
  const legs = await db.leg.findMany({ orderBy: [{ tripId: 'asc' }, { seq: 'asc' }] })
  const legsByTrip = new Map<string, typeof legs>()
  for (const leg of legs) {
    const arr = legsByTrip.get(leg.tripId) || []
    arr.push(leg)
    legsByTrip.set(leg.tripId, arr)
  }

  const needsReviewEvents = await db.statusEvent.findMany({
    where: { needsReview: true, reviewState: 'pending', skippedConflict: false },
    orderBy: { serverTs: 'asc' },
  })
  const legIds = new Set(needsReviewEvents.map((e) => e.legId))
  const reviewLegs = await db.leg.findMany({ where: { id: { in: [...legIds] } } })
  const reviewLegMap = new Map(reviewLegs.map((l) => [l.id, l]))

  const outbox = await db.outbox1c.findMany({ orderBy: { id: 'asc' } })
  const devices = await db.device.findMany({ orderBy: { id: 'asc' } })
  const orders = await db.order.findMany({ orderBy: { createdAt: 'asc' } })

  // Согласованные грузы ATI.SU — единая картина для «Планирования» и «Занятости»:
  // по dealId плеча видно, какая сделка уже назначена составом
  const deals = await db.atiDeal.findMany({ orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }] })

  // Ручной план логиста — записи календаря «Планирования» на любую дату
  const planEntries = await db.planEntry.findMany({ orderBy: [{ date: 'asc' }, { time: 'asc' }] })

  // Закрепления состава (водитель ↔ тягач ↔ прицеп) — для подбора и справочника
  const bindingRows = await db.vehicleBinding.findMany({ orderBy: { updatedAt: 'desc' } })
  const bindings = bindingRows.map((b) => ({
    ...b,
    driver: driverMap.get(b.driverId) || null,
    vehicle: vehicleMap.get(b.vehicleId) || null,
    trailer: b.trailerId ? trailerMap.get(b.trailerId) || null : null,
  }))

  const now = Date.now()
  // B8.2: алерты — структура (kind + цель), лицевая панель рисует их кнопками-ссылками:
  // клик ведёт к проблеме — карточка рейса в «Заявках», устройства/сводка — «Мониторинг».
  const alerts: Alert[] = []
  const shortId = (id: string) => id.slice(0, 8)

  // B8.2/B6.6: не подтверждено N (эскалация при pending > ACK_SLA_MIN)
  for (const trip of trips) {
    if (trip.ackStatus === 'pending' && trip.status === 'active') {
      const ageMin = (now - trip.createdAt.getTime()) / 60000
      if (ageMin > CONSTANTS.ACK_SLA_MIN) {
        alerts.push({
          level: 'red',
          kind: 'trip_ack',
          tripId: trip.id,
          text: `Рейс ${shortId(trip.id)} · нет подтверждения ${CONSTANTS.ACK_SLA_MIN}+ мин`,
        })
      }
    }
  }
  // B5.4: docs_pending > DOC_PENDING_ALERT_HOURS
  for (const leg of legs) {
    if (leg.docsPending && leg.statusSetAt) {
      const ageH = (now - leg.statusSetAt.getTime()) / 3600000
      if (ageH > CONSTANTS.DOC_PENDING_ALERT_HOURS) {
        alerts.push({
          level: 'red',
          kind: 'leg_docs',
          tripId: leg.tripId,
          legId: leg.id,
          text: `Плечо ${shortId(leg.id)} · документы не доставлены ${CONSTANTS.DOC_PENDING_ALERT_HOURS}+ ч`,
        })
      }
    }
    if (leg.docsLost) {
      alerts.push({
        level: 'red',
        kind: 'leg_docs_lost',
        tripId: leg.tripId,
        legId: leg.id,
        text: `Плечо ${shortId(leg.id)} · документ утрачен`,
      })
    }
  }
  // B7.1.3: stale / failed_delivery
  const staleCount = outbox.filter((o) => o.state === 'stale').length
  const failedCount = outbox.filter((o) => o.state === 'failed_delivery').length
  if (staleCount)
    alerts.push({
      level: 'amber',
      kind: 'outbox_stale',
      text: `1С не забирает события: ${staleCount} в очереди ${CONSTANTS.OUTBOX_STALE_HOURS}+ ч`,
    })
  if (failedCount)
    alerts.push({
      level: 'red',
      kind: 'outbox_failed',
      text: `Outbox: ${failedCount} событие не дошло до 1С (${CONSTANTS.OUTBOX_FAILED_HOURS}+ ч)`,
    })
  // B7.2.13: systematic_skew
  for (const d of devices) {
    if (d.systematicSkew)
      alerts.push({
        level: 'amber',
        kind: 'device_skew',
        deviceId: d.id,
        text: `Устройство ${d.id} · сдвиг часов (${d.clockSkewCount24h} за ${CONSTANTS.CLOCK_SKEW_WINDOW_HOURS} ч)`,
      })
    if (d.isLegacy)
      alerts.push({
        level: 'amber',
        kind: 'device_legacy',
        deviceId: d.id,
        text: `Устройство ${d.id} · legacy-приложение`,
      })
  }
  // Новые заявки
  const newOrders = orders.filter((o) => o.status === 'new').length
  if (newOrders) alerts.push({ level: 'info', kind: 'new_orders', text: `Новые заявки: ${newOrders}` })

  return NextResponse.json({
    trips: trips.map((t) => ({
      ...t,
      driver: driverMap.get(t.driverId) || null,
      vehicle: vehicleMap.get(t.vehicleId) || null,
      trailer: t.trailerId ? trailerMap.get(t.trailerId) || null : null,
      legs: legsByTrip.get(t.id) || [],
    })),
    orders,
    deals,
    planEntries,
    devices: devices.map((d) => ({ ...d, driver: d.driverId ? driverMap.get(d.driverId) || null : null })),
    drivers,
    vehicles,
    trailers,
    bindings,
    needsReview: needsReviewEvents.map((e) => ({
      ...e,
      leg: reviewLegMap.get(e.legId) || null,
    })),
    outbox: outbox.slice(-60),
    outboxStats: {
      pending: outbox.filter((o) => o.state === 'pending').length,
      stale: staleCount,
      failed: failedCount,
      acked: outbox.filter((o) => o.state === 'acked').length,
    },
    alerts,
  })
}
