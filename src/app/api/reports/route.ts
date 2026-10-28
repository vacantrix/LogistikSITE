import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/auth'
import { buildReport } from '@/lib/reports-data'
import { parseIsoDay } from '@/lib/report-period'
import { allowedFor, permDenied } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

/** GET /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD — сводка: KPI (дашборд) + две проформы за период.
 *  Даты включительно; legacy month=YYYY-MM; без параметров — текущий месяц.
 *  Права (Task 111): раздел целиком закрывается правом reports:view. */
export async function GET(request: NextRequest) {
  // отчёты — внутренний контур АЭМЗ: перевозчику не открываются ни при каких правах
  // (в отчёте ставки и экономия по всем перевозчикам, в том числе конкурентам)
  const auth = await requireUser('admin', 'logist')
  if (auth instanceof NextResponse) return auth
  if (!(await allowedFor(auth, 'reports:view'))) {
    return NextResponse.json({ error: permDenied('reports:view') }, { status: 403 })
  }

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
