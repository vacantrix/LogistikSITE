import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'
import { getSessionUser, shortName } from '@/lib/kontur/auth'
import { konturAllowedAny, OWN_SECTION_KEYS } from '@/lib/kontur/access'

export const dynamic = 'force-dynamic'

// Контур «мост на телефон» логиста. Кнопка «Позвонить» в кабинете на ПК:
//   POST /api/call { action: 'push', orderId?, driverId } — создаёт задачу
//   звонка: лёгкое приложение на телефоне логиста забирает её и показывает
//   заявку с кнопкой вызова (номер вводить вручную не нужно).
//
// Приложение-мост (сейчас — веб-демо /phone-bridge/index.html, дальше нативное):
//   GET /api/call?poll=1  — забрать следующую задачу (pending → delivered)
//   POST /api/call { action: 'ack', taskId, result } — called | dismissed
//   GET /api/call         — последние задачи (история/отладка)

const RECENT_TAKE = 20

function telOf(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

/** Сводка заявки для карточки на телефоне: номер · заказчик · маршрут · погрузка */
async function buildOrderInfo(orderId: string): Promise<{ number: string | null; route: string | null; info: string | null }> {
  const o = await db.order.findUnique({ where: { id: orderId } })
  if (!o) return { number: null, route: null, info: null }
  const load = o.loadDatePlan ? o.loadDatePlan.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : 'дата не указана'
  return {
    number: o.number,
    route: `${o.loadPoint || '—'} → ${o.unloadPoint || '—'}`,
    info: `${o.number} · ${o.customer} · ${o.product} · погрузка ${load}`,
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: { code: 'AUTH', message: 'Нужен вход в кабинет' } }, { status: 401 })
  }

  if (url.searchParams.get('poll') === '1') {
    // Телефон-мост забирает старейшую свою pending-задачу и помечает delivered.
    const task = await db.callTask.findFirst({
      where: { userId: user.id, status: 'pending' },
      orderBy: { createdAt: 'asc' },
    })
    if (!task) return NextResponse.json({ task: null })
    await db.callTask.update({
      where: { id: task.id },
      data: { status: 'delivered', deliveredAt: new Date(), deviceId: url.searchParams.get('deviceId') ?? undefined },
    })
    return NextResponse.json({ task: { ...task, tel: telOf(task.driverPhone) } })
  }

  const tasks = await db.callTask.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: RECENT_TAKE,
  })
  return NextResponse.json({ tasks })
}

export async function POST(req: Request) {
  const body = await req.json()
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: { code: 'AUTH', message: 'Нужен вход в кабинет' } }, { status: 401 })
  }
  // звонки инициируются только из доступных разделов собственного транспорта
  if (!(await konturAllowedAny(user, OWN_SECTION_KEYS))) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Нет доступа к разделам собственного транспорта' } }, { status: 403 })
  }

  if (body.action === 'push') {
    // Клик «Позвонить» на ПК: зафиксировать задачу для телефона + отдать tel:-ссылку
    let driverName: string | null = body.driverName ?? body.name ?? null
    let phone: string | null = body.phone ?? null
    if (body.driverId) {
      const driver = await db.driver.findUnique({ where: { id: body.driverId } })
      if (driver) {
        driverName = driver.fullName
        phone = phone ?? driver.phone
      }
    }
    if (!phone) {
      return NextResponse.json({ error: { code: 'VALIDATION', message: 'Телефон не указан' } }, { status: 400 })
    }
    const ctx = body.orderId ? await buildOrderInfo(body.orderId) : { number: null, route: null, info: null }
    const task = await db.callTask.create({
      data: {
        userId: user.id,
        orderId: body.orderId ?? null,
        driverId: body.driverId ?? null,
        driverName,
        driverPhone: phone,
        orderNumber: ctx.number,
        orderRoute: ctx.route,
        orderInfo: ctx.info,
      },
    })
    return NextResponse.json({ ok: true, taskId: task.id, tel: telOf(phone), driverName, phone })
  }

  if (body.action === 'ack') {
    // Телефон-мост сообщает результат: позвонил / скрыл карточку
    const task = await db.callTask.findUnique({ where: { id: body.taskId } })
    if (!task || task.userId !== user.id) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Задача звонка не найдена' } }, { status: 404 })
    }
    const status = body.result === 'called' ? 'called' : 'dismissed'
    await db.callTask.update({ where: { id: task.id }, data: { status, finishedAt: new Date() } })
    await db.auditLog.create({
      data: {
        actorRole: 'logist',
        actorName: shortName(user.fullName),
        object: 'call_task',
        objectId: task.id,
        field: 'status',
        became: status,
        comment: `Мост на телефон: звонок ${task.driverName ?? task.driverPhone}`,
      },
    })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: { code: 'VALIDATION', message: 'Неизвестное действие' } }, { status: 400 })
}
