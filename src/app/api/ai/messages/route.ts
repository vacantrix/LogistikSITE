import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { aiLog } from '@/lib/ai/core'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ai/messages — история чата с нейросетью (AiChatMessage) для
 * вошедшего пользователя: полная переписка, ход работы текстом, прикреплённые
 * файлы и виджеты, чтобы после перезагрузки чат оставался на месте.
 *
 * DELETE /api/ai/messages — «Новый чат»: очистить переписку этого пользователя.
 * Разборы в «Списке ИИ» не трогаются — это отдельный журнал работы нейросети.
 */

export async function GET() {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  try {
    const rows = await db.aiChatMessage.findMany({
      where: { userId: auth.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
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
    return NextResponse.json({ messages })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Не удалось загрузить историю' }, { status: 500 })
  }
}

export async function DELETE() {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  try {
    await db.aiChatMessage.deleteMany({ where: { userId: auth.id } })
    await aiLog('info', 'chat_history_clear', `Чат очищен (${auth.login}) — начат новый диалог`)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Не удалось очистить чат' }, { status: 500 })
  }
}
