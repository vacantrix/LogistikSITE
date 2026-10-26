import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** Число уведомлений в списке колокольчика (самые свежие; остальное — история читается тем же API) */
const TAKE = 50

/**
 * GET /api/notifications — уведомления текущего пользователя (колокольчик в шапке).
 * Возвращает свежие 50 штук и число непрочитанных (считается по всем).
 */
export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId: auth.id },
      orderBy: { createdAt: 'desc' },
      take: TAKE,
      include: { request: { select: { number: true } } },
    }),
    db.notification.count({ where: { userId: auth.id, read: false } }),
  ])

  return NextResponse.json({
    unread,
    notifications: items.map((n) => ({
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
    await db.notification.updateMany({ where: { userId: auth.id, read: false }, data: { read: true } })
    return NextResponse.json({ ok: true, unread: 0 })
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === 'string' && v.length > 0) : []
  if (ids.length === 0) return NextResponse.json({ error: 'Нет уведомлений для отметки' }, { status: 400 })
  await db.notification.updateMany({ where: { userId: auth.id, id: { in: ids } }, data: { read: true } })
  const unread = await db.notification.count({ where: { userId: auth.id, read: false } })
  return NextResponse.json({ ok: true, unread })
}
