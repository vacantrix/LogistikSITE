import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { plog } from '@/lib/platform-log'

export const dynamic = 'force-dynamic'

/**
 * POST /api/platform-log/client — отчёт об ошибке браузерной части (Task 76).
 * Клиент шлёт неперехваченные JS-ошибки и сбои сети (fire-and-forget,
 * с троттлингом на своей стороне). Требует сессию, чтобы журнал нельзя
 * было заспамить извне. Ошибка журналирования не влияет на ответ.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as {
    message?: string
    stack?: string
    kind?: string
    url?: string
  } | null

  const message = (body?.message ?? '').trim().slice(0, 1000)
  if (!message) return NextResponse.json({ ok: true })

  await plog({
    level: 'ERROR',
    type: 'CLIENT_ERROR',
    source: 'browser',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    message: `Ошибка интерфейса: ${message}`,
    meta: {
      kind: body?.kind ?? 'error',
      url: (body?.url ?? '').slice(0, 500),
      stack: (body?.stack ?? '').slice(0, 3000),
    },
  })
  return NextResponse.json({ ok: true })
}
