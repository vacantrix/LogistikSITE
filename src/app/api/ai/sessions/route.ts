import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Чаты с нейросетью (AiChatSession) — отдельные диалоги одного пользователя:
 * «Новый чат» начинает новый диалог, прошлые остаются доступны; переключение
 * между ними — панель «Прошлые чаты» в разделе ИИ-помощника.
 *
 * GET /api/ai/sessions — список чатов пользователя (свежие сверху): id,
 *   название, время последнего сообщения и число сообщений.
 * POST /api/ai/sessions — начать новый чат (пустой, «Новый чат»).
 * DELETE /api/ai/sessions?id=… — удалить чат (вместе с его сообщениями;
 *   копии ответов в «Избранном» — отдельные записи, остаются).
 */

/** список чатов пользователя: свежие сверху, с числом сообщений */
async function listSessions(userId: string) {
  const rows = await db.aiChatSession.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { messages: true } } },
    take: 100,
  })
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updatedAt.toISOString(),
    count: r._count.messages,
  }))
}

export async function GET() {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth
  try {
    return NextResponse.json({ sessions: await listSessions(auth.id) })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Не удалось загрузить список чатов' },
      { status: 500 },
    )
  }
}

export async function POST() {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth
  try {
    const session = await db.aiChatSession.create({
      data: { userId: auth.id },
    })
    return NextResponse.json({
      session: { id: session.id, title: session.title, updatedAt: session.updatedAt.toISOString(), count: 0 },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Не удалось начать новый чат' },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Не указан чат' }, { status: 400 })
  try {
    // чужой чат не удаляется: ищем только среди своих
    const own = await db.aiChatSession.findFirst({ where: { id, userId: auth.id }, select: { id: true } })
    if (!own) return NextResponse.json({ error: 'Чат не найден' }, { status: 404 })
    await db.aiChatSession.delete({ where: { id } }) // сообщения чата — каскадом
    return NextResponse.json({ ok: true, sessions: await listSessions(auth.id) })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Не удалось удалить чат' },
      { status: 500 },
    )
  }
}
