import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/auth'
import { buildReport } from '@/lib/reports-data'
import { parseIsoDay } from '@/lib/report-period'

export const dynamic = 'force-dynamic'

/** GET /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD — сводка: KPI (дашборд) + две проформы за период.
 *  Даты включительно; legacy month=YYYY-MM; без параметров — текущий месяц. */
export async function GET(request: NextRequest) {
  const auth = await requireUser('logist')
  if (auth instanceof NextResponse) return auth

  const sp = request.nextUrl.searchParams
  for (const key of ['from', 'to'] as const) {
    const v = sp.get(key)
    if (v && !parseIsoDay(v)) {
      return NextResponse.json({ error: 'Период задаётся существующими датами в формате ГГГГ-ММ-ДД' }, { status: 400 })
    }
  }

  const summary = await buildReport({
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    month: sp.get('month') ?? undefined,
  })
  return NextResponse.json(summary)
}
