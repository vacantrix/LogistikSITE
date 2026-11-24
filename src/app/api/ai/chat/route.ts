import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { aiLog, buildRestrictedContext, buildSystemPrompt, getZai } from '@/lib/ai/core'

export const dynamic = 'force-dynamic'

/**
 * POST /api/ai/chat — вопрос нейросети-консультанту.
 * Контекст собирается на сервере только из разрешённых ей источников (частичное
 * чтение: контакты без телефонов и почты); ответ модели НЕ пишется в контакты и
 * заявки — только в журнал нейросети. Права ограничены жёстко, на стороне сервера.
 */
export async function POST(req: Request) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth
  const body = (await req.json().catch(() => null)) as { message?: unknown; history?: unknown } | null
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: 'Пустой вопрос' }, { status: 400 })
  const history = Array.isArray(body?.history)
    ? (body.history as unknown[])
        .filter((m): m is { role: 'user' | 'assistant'; content: string } => {
          if (!m || typeof m !== 'object') return false
          const role = (m as { role?: unknown }).role
          const content = (m as { content?: unknown }).content
          return (role === 'user' || role === 'assistant') && typeof content === 'string' && content.length > 0
        })
        .slice(-6)
    : []

  await aiLog('info', 'chat_start', `Вопрос (${auth.login}): ${message.slice(0, 300)}`, { historyMessages: history.length })
  try {
    const ctx = await buildRestrictedContext()
    const system = buildSystemPrompt(ctx)
    const zai = await getZai()
    const completion = await zai.chat.completions.create({
      // системный промпт передаётся ролью 'assistant' (требование z-ai-web-dev-sdk)
      messages: [{ role: 'assistant', content: system }, ...history, { role: 'user', content: message }],
      thinking: { type: 'disabled' },
    })
    const answer = completion.choices[0]?.message?.content ?? ''
    if (!answer.trim()) throw new Error('пустой ответ модели')
    await aiLog('info', 'chat_done', `Ответ выдан (${answer.length} симв.)`)
    return NextResponse.json({ answer })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await aiLog('error', 'chat_error', `Ошибка ответа: ${msg}`)
    return NextResponse.json({ error: `Нейросеть не ответила: ${msg}` }, { status: 502 })
  }
}
