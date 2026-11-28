import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireUser, type SessionUser } from '@/lib/auth'
import { allowedFor } from '@/lib/permissions'
import { NOTIFY_PERM } from '@/lib/notify-users'
import { requestScopeWhere } from '@/lib/transport-scope'
import { plog } from '@/lib/platform-log'

export const dynamic = 'force-dynamic'

/** Число уведомлений в списке колокольчика (самые свежие; остальное — история читается тем же API) */
const TAKE = 50

/**
 * Уведомление доступно пользователю, если он видит заявку и может выполнить
 * действие, к которому уведомление призывает. Проверка повторяется при чтении:
 * права и специализация могли измениться уже после доставки.
 */
async function notificationAllowed(auth: SessionUser, type: string, requestId: string | null): Promise<boolean> {
  if (auth.role !== 'logist') return true
  const need = NOTIFY_PERM[type as keyof typeof NOTIFY_PERM]
  if (!need) return true
  return allowedFor(auth, need)
}

/**
 * GET /api/notifications — уведомления текущего пользователя (колокольчик в шапке).
 * Возвращает свежие 50 штук и число непрочитанных (считается по всем доступным).
 * Для логиста список ограничен его специализацией по транспорту.
 */
export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const where: Prisma.NotificationWhereInput = { userId: auth.id }
  if (auth.role === 'logist') {
    const scope = requestScopeWhere(auth.transportScope)
    if (Object.keys(scope).length > 0) {
      // уведомления без заявки (обращения, служебные) не ограничиваем
      where.OR = [{ requestId: null }, { request: { is: scope } }]
    }
  }

  const [items, unreadItems] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: TAKE,
      include: { request: { select: { number: true } } },
    }),
    db.notification.findMany({
      where: { ...where, read: false },
      select: { id: true, type: true, requestId: true },
    }),
  ])

  const shown: (typeof items)[number][] = []
  for (const n of items) {
    if (await notificationAllowed(auth, n.type, n.requestId)) shown.push(n)
  }
  let unread = 0
  for (const n of unreadItems) {
    if (await notificationAllowed(auth, n.type, n.requestId)) unread += 1
  }

  return NextResponse.json({
    unread,
    notifications: shown.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      requestId: n.requestId,
      requestNumber: n.request?.number ?? null,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    })),
  })
}

/**
 * POST /api/notifications — отметить прочитанными.
 * Тело: { ids: string[] } — конкретные, или { all: true } — все сразу.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => ({}))) as { ids?: unknown; all?: unknown }
  if (body.all === true) {
    const marked = await db.notification.updateMany({ where: { userId: auth.id, read: false }, data: { read: true } })
    await plog({
      type: 'NOTIFICATIONS_READ', source: 'api/notifications',
      actor: { login: auth.login, name: auth.name, role: auth.role },
      message: `Отмечены прочитанными все уведомления (${marked.count})`,
      meta: { all: true, count: marked.count },
    })
    return NextResponse.json({ ok: true, unread: 0 })
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === 'string' && v.length > 0) : []
  if (ids.length === 0) return NextResponse.json({ error: 'Нет уведомлений для отметки' }, { status: 400 })
  const marked = await db.notification.updateMany({ where: { userId: auth.id, id: { in: ids } }, data: { read: true } })
  const unread = await db.notification.count({ where: { userId: auth.id, read: false } })
  await plog({
    type: 'NOTIFICATIONS_READ', source: 'api/notifications',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    message: `Отмечены прочитанными уведомления: ${marked.count} из ${ids.length}`,
    meta: { count: marked.count, requested: ids.length },
  })
  return NextResponse.json({ ok: true, unread })
}
