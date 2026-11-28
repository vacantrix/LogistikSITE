import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { aiLog } from '@/lib/ai/core'
import { plog } from '@/lib/platform-log'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ai/list — собственный список нейросети: человек может посмотреть его
 * в любой момент. ?latest=1 — только последняя запись (её нейросеть выводит
 * сразу после выполнения запроса). Чтение списка в журнал не пишется —
 * журнал фиксирует действия самой нейросети, а не просмотры человека.
 */
export async function GET(req: Request) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth
  const latestOnly = new URL(req.url).searchParams.get('latest') === '1'
  if (latestOnly) {
    const item = await db.aiListItem.findFirst({ orderBy: { createdAt: 'desc' } })
    return NextResponse.json({ item })
  }
  const items = await db.aiListItem.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })
  return NextResponse.json({ items })
}

/** DELETE /api/ai/list — очистить список нейросети (фиксируется в журнале). */
export async function DELETE() {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth
  const result = await db.aiListItem.deleteMany({})
  await aiLog('warn', 'list_clear', `Список нейросети очищен (${auth.login}); удалено записей: ${result.count}`)
  await plog({
    type: 'AI_LIST_CLEARED', source: 'api/ai/list',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    message: `Список ИИ-помощника очищен: удалено записей ${result.count}`,
    objectType: 'ai_list',
    meta: { removed: result.count },
  })
  return NextResponse.json({ ok: true, removed: result.count })
}
