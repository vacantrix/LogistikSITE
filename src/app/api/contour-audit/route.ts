import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { allowedFor, permDenied } from '@/lib/permissions'
import { readContourAudit, type ContourSource } from '@/lib/contour-audit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/contour-audit?contour=all|platform|dispatcher&action=&q=&limit=
 * Единый сквозной журнал контура: действия платформы и диспетчерской в одном списке.
 * Доступ — внутреннему контуру с правом просмотра отчётов.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser('admin', 'logist')
  if (auth instanceof NextResponse) return auth
  if (!(await allowedFor(auth, 'reports:view'))) {
    return NextResponse.json({ error: permDenied('reports:view') }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const contourRaw = sp.get('contour') ?? 'all'
  const contour: ContourSource | 'all' = ['all', 'platform', 'dispatcher'].includes(contourRaw)
    ? (contourRaw as ContourSource | 'all')
    : 'all'
  const q = (sp.get('q') ?? '').trim().slice(0, 200)
  const action = (sp.get('action') ?? '').trim().slice(0, 100)
  const rawLimit = Number(sp.get('limit') ?? 200)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 1000) : 200

  const entries = await readContourAudit({ contour, q, action, limit })
  return NextResponse.json({
    entries,
    file: process.env.CONTOUR_AUDIT_FILE ?? null,
    count: entries.length,
  })
}
