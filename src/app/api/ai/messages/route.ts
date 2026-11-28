import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { aiLog } from '@/lib/ai/core'
import { plog } from '@/lib/platform-log'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ai/messages?sessionId=… — история чата с нейросетью (AiChatMessage):
 * переписка одного диалога (AiChatSession), ход работы текстом, прикреплённые
 * файлы и виджеты, чтобы после перезагрузки чат оставался на месте.
 * Без sessionId — самый свежий чат пользователя. В ответе также session (текущий
 * чат) и sessions (все чаты — для панели «Прошлые чаты»).
 * Старые записи без чата (до появления сессий) при первом чтении переносятся
 * в архивный чат «Чат до обновления» — история не теряется.
 * Плюс savedMessageIds — какие ответы уже в «Избранном» (звезда заполнена).
 *
 * DELETE /api/ai/messages?sessionId=… — удалить один чат с его сообщениями
 * (используется редко; основной путь — /api/ai/sessions). Без sessionId —
 * удаление ВСЕХ чатов пользователя (полная очистка).
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

export async function GET(req: NextRequest) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  try {
    // одноразовая миграция: сообщения до появления чатов — в архивный чат,
    // чтобы история не потерялась и была доступна в «Прошлых чатах»
    const orphans = await db.aiChatMessage.count({
      where: { userId: auth.id, sessionId: null },
    })
    if (orphans > 0) {
      const archive = await db.aiChatSession.create({
        data: { userId: auth.id, title: 'Чат до обновления' },
      })
      await db.aiChatMessage.updateMany({
        where: { userId: auth.id, sessionId: null },
        data: { sessionId: archive.id },
      })
    }

    // чат, который открыть: свой?sessionId (если он пользовательский) или самый свежий
    const wantedId = req.nextUrl.searchParams.get('sessionId')
    let session =
      wantedId
        ? await db.aiChatSession.findFirst({ where: { id: wantedId, userId: auth.id } })
        : null
    if (!session) {
      session = await db.aiChatSession.findFirst({
        where: { userId: auth.id },
        orderBy: { updatedAt: 'desc' },
      })
    }
    if (!session) {
      // самого первого чата ещё нет — начинаем: пустой «Новый чат»
      session = await db.aiChatSession.create({ data: { userId: auth.id } })
    }

    const rows = await db.aiChatMessage.findMany({
      where: { userId: auth.id, sessionId: session.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    // какие ответы уже сохранены в «Избранное» — чтобы звезда была заполнена
    const savedRows = await db.aiSavedMessage.findMany({
      where: { userId: auth.id },
      select: { messageId: true },
    })
    const savedMessageIds = savedRows.map((r) => r.messageId).filter((id): id is string => Boolean(id))
    const messages = rows.slice().reverse().map((r) => {
      let steps: { at: number; text: string }[] = []
      try {
        steps = r.stepsJson ? (JSON.parse(r.stepsJson) as { at: number; text: string }[]) : []
      } catch {
        steps = []
      }
      let files: { name: string; size: number; excerpt: string }[] = []
      try {
        files = r.filesJson ? (JSON.parse(r.filesJson) as { name: string; size: number; excerpt: string }[]) : []
      } catch {
        files = []
      }
      let widgets: {
        best?: unknown[]
        cards?: unknown[]
        report?: unknown
        links?: unknown[]
        saved?: string[]
      } = {}
      try {
        widgets = r.widgetsJson ? (JSON.parse(r.widgetsJson) as typeof widgets) : {}
      } catch {
        widgets = {}
      }
      return {
        id: r.id,
        role: r.role,
        content: r.content,
        modelKey: r.modelKey,
        engine: r.engine,
        createdAt: r.createdAt.toISOString(),
        steps,
        files,
        best: Array.isArray(widgets.best) ? widgets.best : [],
        cards: Array.isArray(widgets.cards) ? widgets.cards : [],
        report: widgets.report ?? null,
        links: Array.isArray(widgets.links) ? widgets.links : [],
        saved: Array.isArray(widgets.saved) ? widgets.saved : [],
      }
    })
    return NextResponse.json({
      session: { id: session.id, title: session.title },
      messages,
      savedMessageIds,
      sessions: await listSessions(auth.id),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Не удалось загрузить историю' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  try {
    const sessionId = req.nextUrl.searchParams.get('sessionId')
    if (sessionId) {
      // удаляем один чат (только свой) — сообщения каскадом
      const own = await db.aiChatSession.findFirst({
        where: { id: sessionId, userId: auth.id },
        select: { id: true, title: true },
      })
      if (!own) return NextResponse.json({ error: 'Чат не найден' }, { status: 404 })
      await db.aiChatSession.delete({ where: { id: sessionId } })
      await aiLog('info', 'chat_history_clear', `Чат удалён (${auth.login})`)
      await plog({
        type: 'AI_SESSION_DELETED', source: 'api/ai/messages',
        actor: { login: auth.login, name: auth.name, role: auth.role },
        message: `Чат ИИ «${own.title}» удалён (вместе с сообщениями)`,
        objectType: 'ai_session', objectId: own.id,
      })
      return NextResponse.json({ ok: true, sessions: await listSessions(auth.id) })
    }
    // без чата — полная очистка: все чаты и сообщения пользователя
    const removedSessions = await db.aiChatSession.deleteMany({ where: { userId: auth.id } })
    const removedMessages = await db.aiChatMessage.deleteMany({ where: { userId: auth.id } })
    await aiLog('info', 'chat_history_clear', `Все чаты очищены (${auth.login})`)
    await plog({
      type: 'AI_SESSION_DELETED', source: 'api/ai/messages',
      actor: { login: auth.login, name: auth.name, role: auth.role },
      message: `Все чаты ИИ удалены: ${removedSessions.count} чат(ов), ${removedMessages.count} сообщений`,
      objectType: 'ai_session', objectId: auth.id,
      meta: { sessions: removedSessions.count, messages: removedMessages.count },
    })
    return NextResponse.json({ ok: true, sessions: [] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Не удалось очистить чат' }, { status: 500 })
  }
}
