import { NextResponse } from 'next/server'
import { buildMonitorState, resetMonitorDemo } from '@/lib/kontur/monitor'
import { requireKonturPerm } from '@/lib/kontur/access'

export const dynamic = 'force-dynamic'

// GET /api/monitor — онлайн-сводка раздела «Мониторинг»: все водители с
// производными статусами (в движении / на погрузке / скоро завершит / поломка /
// нет связи / без приложения), остаток км до выгрузки, треки для карты.
export async function GET() {
  const auth = await requireKonturPerm('section:ownMonitor')
  if (auth instanceof NextResponse) return auth
  const state = await buildMonitorState()
  return NextResponse.json(state)
}

// POST /api/monitor { action: 'reset-demo' } — вернуть мониторинг к демо-состоянию
export async function POST(req: Request) {
  const auth = await requireKonturPerm('admin:db')
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  if (body?.action === 'reset-demo') {
    await resetMonitorDemo()
    const state = await buildMonitorState()
    return NextResponse.json(state)
  }
  return NextResponse.json({ error: { code: 'VALIDATION', message: 'Неизвестное действие' } }, { status: 400 })
}
