import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/auth'
import { buildReport } from '@/lib/reports-data'
import { buildProforma1Docx, buildProforma2Docx } from '@/lib/docx-proforma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY_FMT = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET /api/reports/docx?type=1|2&from=YYYY-MM-DD&to=YYYY-MM-DD — скачать бумажную
 * проформу, сформированную автоматически по выбранному периоду (даты включительно;
 * legacy month=YYYY-MM; без параметров — текущий месяц).
 * 1 — экономия по заявкам, 2 — обороты и привлечённый транспорт.
 * Внутри — круговые диаграммы (те же, что на странице раздела).
 */
export async function GET(request: NextRequest) {
  const user = await requireUser('logist')
  if (user instanceof NextResponse) return user

  const sp = request.nextUrl.searchParams
  for (const key of ['from', 'to'] as const) {
    const v = sp.get(key)
    if (v && !DAY_FMT.test(v)) {
      return NextResponse.json({ error: 'Период задаётся датами в формате ГГГГ-ММ-ДД' }, { status: 400 })
    }
  }

  const type = sp.get('type') === '2' ? 2 : 1
  const data = await buildReport({
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    month: sp.get('month') ?? undefined,
  })
  const doc = type === 1
    ? await buildProforma1Docx(data, user.name)
    : await buildProforma2Docx(data, user.name)

  return new NextResponse(new Uint8Array(doc.buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${doc.fileName}"; filename*=UTF-8''${encodeURIComponent(doc.displayName)}`,
      'Cache-Control': 'no-store',
    },
  })
}
