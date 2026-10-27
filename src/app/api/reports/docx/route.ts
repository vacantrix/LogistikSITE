import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/auth'
import { buildReport } from '@/lib/reports-data'
import { buildProforma1Docx, buildProforma2Docx } from '@/lib/docx-proforma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/reports/docx?type=1|2&month=YYYY-MM — скачать бумажную проформу.
 * 1 — экономия по заявкам, 2 — обороты и привлечённый транспорт.
 * Внутри — круговые диаграммы (те же, что на странице раздела).
 */
export async function GET(request: NextRequest) {
  const user = await requireUser('logist')
  if (user instanceof NextResponse) return user

  const params = request.nextUrl.searchParams
  const type = params.get('type') === '2' ? 2 : 1
  const month = params.get('month') ?? undefined

  const data = await buildReport(month)
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
