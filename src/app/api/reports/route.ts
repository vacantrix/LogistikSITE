import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/auth'
import { buildReport } from '@/lib/reports-data'

export const dynamic = 'force-dynamic'

/** GET /api/reports?month=YYYY-MM — сводка: KPI (дашборд) + две проформы за месяц.
 *  Без параметра месяц — текущий. */
export async function GET(request: NextRequest) {
  const auth = await requireUser('logist')
  if (auth instanceof NextResponse) return auth

  const month = request.nextUrl.searchParams.get('month') ?? undefined
  const summary = await buildReport(month ?? undefined)
  return NextResponse.json(summary)
}
