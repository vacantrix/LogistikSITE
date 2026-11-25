import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { aiLog } from '@/lib/ai/core'

export const dynamic = 'force-dynamic'

/**
 * «Избранное» ответов агента: любой ответ чата можно сохранить кнопкой
 * «В избранное» — он попадает в календарь раздела «Избранное» вместе с
 * вопросом, уровнем модели и движком. Повторное сохранение того же
 * сообщения (messageId уникален) обновляет его копию, дублей нет.
 */

function clean(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

/** GET /api/ai/saved-messages — сохранённые ответы агента, новые сверху. */
export async function GET() {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  const messages = await db.aiSavedMessage.findMany({
    where: { userId: auth.id },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
  return NextResponse.json({ messages })
}

/** POST /api/ai/saved-messages — сохранить ответ агента из чата. */
export async function POST(req: Request) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const answer = clean(body?.answer, 20000)
  if (!answer) {
    return NextResponse.json({ error: 'Не указан ответ для сохранения' }, { status: 400 })
  }

  const messageId = clean(body?.messageId, 64) || null
  const question = clean(body?.question, 4000)
  const modelKey = clean(body?.modelKey, 60) || null
  const engine = clean(body?.engine, 60) || null

  // повторное сохранение того же сообщения — обновляем копию, а не плодим дубли
  if (messageId) {
    const existing = await db.aiSavedMessage.findUnique({ where: { messageId } })
    if (existing) {
      if (existing.userId !== auth.id) {
        return NextResponse.json({ error: 'Этот ответ уже сохранён другим пользователем' }, { status: 409 })
      }
      const updated = await db.aiSavedMessage.update({
        where: { id: existing.id },
        data: { question, answer, modelKey, engine },
      })
      return NextResponse.json({ ok: true, message: updated, updated: true })
    }
  }

  const created = await db.aiSavedMessage.create({
    data: { userId: auth.id, messageId, question, answer, modelKey, engine },
  })
  await aiLog('info', 'chat_saved', `Ответ сохранён в избранное (${auth.login})`)
  return NextResponse.json({ ok: true, message: created })
}

/** DELETE /api/ai/saved-messages?id=… — убрать сохранённый ответ. */
export async function DELETE(req: Request) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  const id = clean(new URL(req.url).searchParams.get('id'), 64)
  if (!id) return NextResponse.json({ error: 'Не указан id записи' }, { status: 400 })

  const saved = await db.aiSavedMessage.findUnique({ where: { id } })
  if (!saved || saved.userId !== auth.id) {
    return NextResponse.json({ error: 'Сохранённый ответ не найден' }, { status: 404 })
  }

  await db.aiSavedMessage.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
