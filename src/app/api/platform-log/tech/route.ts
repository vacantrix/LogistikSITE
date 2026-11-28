import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { apiCallLine, logTech, techSnapshot } from '@/lib/tech-log'
import type { TechLogLevel } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * Техническая консоль платформы — раздел «Логи» (Task: функции-журналы).
 *
 * GET  — лента коротких строк о работе кода: вызовы API (метод, путь, код,
 *        длительность), сбои сервера и интерфейса, системные события. Только
 *        логист и администрация. Фильтры: kind (api|server|client|system),
 *        q — поиск по пути/сообщению, limit.
 * POST — приём батча вызовов API из браузера (перехватчик window.fetch):
 *        любая активная сессия сообщает свои вызовы, чтобы консоль видела
 *        работу всех открытых вкладок. Ограничение батча — 200 вызовов.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser('admin', 'logist')
  if (auth instanceof NextResponse) return auth

  const sp = req.nextUrl.searchParams
  const kindRaw = sp.get('kind') ?? 'all'
  const kind = ['all', 'api', 'server', 'client', 'system'].includes(kindRaw) ? kindRaw : 'all'
  const q = (sp.get('q') ?? '').trim().toLowerCase().slice(0, 200)
  const rawLimit = Number(sp.get('limit') ?? 500)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 1000) : 500

  const snapshot = techSnapshot()
  let entries = snapshot.entries
  if (kind !== 'all') entries = entries.filter((e) => e.kind === kind)
  if (q) {
    entries = entries.filter((e) =>
      [e.message, e.path, e.method, e.origin, e.status !== null ? String(e.status) : ''].some((v) =>
        (v ?? '').toLowerCase().includes(q),
      ),
    )
  }

  return NextResponse.json({
    entries: entries.slice(0, limit),
    stats: snapshot.stats,
  })
}

interface IncomingCall {
  ts?: unknown
  method?: unknown
  path?: unknown
  status?: unknown
  ms?: unknown
}

export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as { calls?: unknown } | null
  const calls: IncomingCall[] = Array.isArray(body?.calls) ? (body!.calls as IncomingCall[]).slice(0, 200) : []
  const now = Date.now()

  for (const c of calls) {
    const method = typeof c?.method === 'string' ? c.method.toUpperCase().slice(0, 8) : 'GET'
    const path = typeof c?.path === 'string' ? c.path.slice(0, 300) : ''
    if (!path.startsWith('/api/')) continue
    const status = typeof c?.status === 'number' && Number.isFinite(c.status) ? Math.trunc(c.status) : null
    const msRaw = typeof c?.ms === 'number' && Number.isFinite(c.ms) ? Math.trunc(c.ms) : null
    const ms = msRaw !== null ? Math.min(Math.max(msRaw, 0), 600_000) : null
    // время клиента может гулять — доверяем только окну ±10 минут
    const tsRaw = typeof c?.ts === 'number' && Number.isFinite(c.ts) ? Math.trunc(c.ts) : now
    const ts = Math.min(Math.max(tsRaw, now - 10 * 60_000), now)
    const level: TechLogLevel = status === null ? 'ERROR' : status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO'
    logTech({ kind: 'api', level, method, path, status, ms, ts, origin: auth.login, message: apiCallLine(method, path, status, ms) })
  }

  return NextResponse.json({ ok: true, accepted: calls.length })
}
