import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'
import { getSessionUser, shortName } from '@/lib/kontur/auth'
import { denyUnless } from '@/lib/kontur/access'

export const dynamic = 'force-dynamic'

// Заявки: ручной ввод (до подключения 1С), перевод new -> ready_to_plan (P1)
// и планирование — назначение состава ИЗ СОБСТВЕННОГО ПАРКА АЭМЗ.
export async function POST(req: Request) {
  const body = await req.json()
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: { code: 'AUTH', message: 'Нужен вход в кабинет' } }, { status: 401 })
  }
  const action = String(body.action ?? '')
  const denied = await denyUnless(user, action === 'plan' || action === 'append' ? 'own:assign' : 'own:process')
  if (denied) return denied
  if (body.action === 'ready') {
    const o = await db.order.update({
      where: { id: body.orderId },
      data: { status: 'ready_to_plan', quarantineReason: null },
    })
    return NextResponse.json({ ok: true, order: o })
  }
  if (body.action === 'create-manual') {
    const o = await db.order.create({
      data: {
        externalId: body.externalId || `MAN-${Date.now()}`,
        number: body.number,
        customer: body.customer,
        product: body.product,
        loadPoint: body.loadPoint,
        unloadPoint: body.unloadPoint,
        loadDatePlan: body.loadDatePlan ? new Date(body.loadDatePlan) : null,
        unloadDatePlan: body.unloadDatePlan ? new Date(body.unloadDatePlan) : null,
        tariff: body.tariff ?? null,
        source: 'manual',
        status: 'new',
      },
    })
    return NextResponse.json({ ok: true, order: o })
  }
  if (body.action === 'plan') {
    // Логистический контур: состав назначается только из собственного парка АЭМЗ.
    const order = await db.order.findUnique({ where: { id: body.orderId } })
    if (!order) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Заявка не найдена' } }, { status: 404 })
    }
    if (order.status !== 'ready_to_plan') {
      return NextResponse.json({ error: { code: 'STATE', message: 'Заявка не в статусе «к планированию»' } }, { status: 409 })
    }
    if (!body.vehicleId || !body.driverId) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Выберите ТС и водителя из собственного парка' } }, { status: 400 })
    }
    const vehicle = await db.vehicle.findUnique({ where: { id: body.vehicleId } })
    if (!vehicle || vehicle.ownership !== 'own') {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'ТС должен принадлежать собственному парку АЭМЗ' } }, { status: 400 })
    }
    if (vehicle.isRepair) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'ТС в ремонте — назначение недоступно' } }, { status: 400 })
    }
    const trailer = body.trailerId ? await db.trailer.findUnique({ where: { id: body.trailerId } }) : null
    if (body.trailerId && (!trailer || trailer.ownership !== 'own')) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Прицеп должен принадлежать собственному парку АЭМЗ' } }, { status: 400 })
    }
    const driver = await db.driver.findUnique({ where: { id: body.driverId } })
    if (!driver || driver.status !== 'active') {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Водитель должен быть из штатного состава и готов к работе' } }, { status: 400 })
    }
    // Занятость — активные рейсы и назначенные (черновые, в т.ч. грузы ATI.SU из «Планирования»):
    // доска «Занятость» считает занятыми и тех и других — здесь та же логика
    const busy = await db.trip.findFirst({
      where: {
        status: { in: ['active', 'draft'] },
        OR: [
          { vehicleId: vehicle.id },
          { driverId: driver.id },
          ...(trailer ? [{ trailerId: trailer.id }] : []),
        ],
      },
    })
    if (busy) {
      return NextResponse.json(
        { error: { code: 'STATE', message: 'ТС/водитель/прицеп уже в активном рейсе — выберите свободные из парка' } },
        { status: 409 },
      )
    }

    const trip = await db.trip.create({
      data: { vehicleId: vehicle.id, trailerId: trailer?.id ?? null, driverId: driver.id, status: 'active', ackStatus: 'pending' },
    })
    const leg = await db.leg.create({
      data: {
        tripId: trip.id,
        seq: 1,
        type: 'main',
        cargoSource: '1c',
        loadPoint: order.loadPoint,
        unloadPoint: order.unloadPoint,
        loadDatePlan: order.loadDatePlan,
        unloadDatePlan: order.unloadDatePlan,
        cargoDesc: order.product,
        rate: order.tariff,
        orderId: order.id,
        status: 'assigned',
        statusSource: 'driver',
      },
    })
    await db.statusEvent.create({
      data: { legId: leg.id, status: 'assigned', actorRole: 'system', result: 'applied' },
    })
    await db.tripEvent.create({ data: { tripId: trip.id, type: 'assigned' } })
    await db.outbox1c.create({
      data: {
        eventType: 'trip.assigned',
        payload: JSON.stringify({ tripId: trip.id, driverId: driver.id, vehicleId: vehicle.id, orderId: order.id }),
      },
    })
    await db.order.update({ where: { id: order.id }, data: { status: 'planned' } })
    await db.auditLog.create({
      data: {
        actorRole: user.role === 'admin' ? 'admin' : 'logist',
        actorName: shortName(user.fullName),
        object: 'trip',
        objectId: trip.id,
        field: 'assigned',
        became: `${driver.fullName} · ${vehicle.brand} (${vehicle.plate})`,
        comment: 'Назначение состава из собственного парка АЭМЗ',
      },
    })
    return NextResponse.json({ ok: true, tripId: trip.id })
  }
  if (body.action === 'append') {
    // Умный подбор → «Добавить к рейсу»: заявку встраиваем плечом в активный рейс,
    // который освобождается рядом с погрузкой (состав не меняется, порожняка меньше).
    const order = await db.order.findUnique({ where: { id: body.orderId } })
    if (!order) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Заявка не найдена' } }, { status: 404 })
    }
    if (order.status !== 'ready_to_plan') {
      return NextResponse.json({ error: { code: 'STATE', message: 'Заявка не в статусе «к планированию»' } }, { status: 409 })
    }
    const trip = await db.trip.findUnique({ where: { id: body.tripId } })
    if (!trip || trip.status !== 'active') {
      return NextResponse.json({ error: { code: 'STATE', message: 'Рейс не найден или уже завершён' } }, { status: 409 })
    }
    if (trip.driverId !== body.driverId) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Состав рейса изменился — обновите подбор' } }, { status: 409 })
    }
    // Плечо встаёт следующим по порядку; тип — основное (груз 1С в адрес заказчика)
    const maxSeq = await db.leg.findFirst({ where: { tripId: trip.id }, orderBy: { seq: 'desc' } })
    const leg = await db.leg.create({
      data: {
        tripId: trip.id,
        seq: (maxSeq?.seq ?? 0) + 1,
        type: 'main',
        cargoSource: '1c',
        loadPoint: order.loadPoint,
        unloadPoint: order.unloadPoint,
        loadDatePlan: order.loadDatePlan,
        unloadDatePlan: order.unloadDatePlan,
        cargoDesc: order.product,
        rate: order.tariff,
        orderId: order.id,
        status: 'assigned',
        statusSource: 'driver',
      },
    })
    await db.statusEvent.create({
      data: { legId: leg.id, status: 'assigned', actorRole: 'system', result: 'applied' },
    })
    await db.tripEvent.create({
      data: { tripId: trip.id, type: 'leg_appended', actorId: shortName(user.fullName), payload: JSON.stringify({ orderId: order.id, legId: leg.id }) },
    })
    await db.outbox1c.create({
      data: {
        eventType: 'trip.leg_appended',
        payload: JSON.stringify({ tripId: trip.id, legId: leg.id, orderId: order.id, driverId: trip.driverId }),
      },
    })
    await db.order.update({ where: { id: order.id }, data: { status: 'planned' } })
    const driver = await db.driver.findUnique({ where: { id: trip.driverId } })
    await db.auditLog.create({
      data: {
        actorRole: user.role === 'admin' ? 'admin' : 'logist',
        actorName: shortName(user.fullName),
        object: 'trip',
        objectId: trip.id,
        field: 'leg_appended',
        became: `Плечо ${(maxSeq?.seq ?? 0) + 1} · заявка ${order.number}`,
        comment: 'Заявка добавлена плечом к рейсу по подсказке умного подбора',
      },
    })
    return NextResponse.json({ ok: true, tripId: trip.id, legId: leg.id, driverName: driver?.fullName ?? null })
  }
  return NextResponse.json({ error: { code: 'VALIDATION', message: 'Неизвестное действие' } }, { status: 400 })
}
