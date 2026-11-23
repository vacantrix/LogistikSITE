import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/kontur/auth'
import { denyUnless } from '@/lib/kontur/access'
import { readContourAudit, type ContourSource } from '@/lib/kontur/contour-audit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/contour-audit?contour=all|platform|dispatcher&action=&q=&limit=
 * Сквозной журнал контура: действия диспетчерской и платформы в одном списке.
 * Читает тот же JSONL-файл, что и LogistikSITE (CONTOUR_AUDIT_FILE).
 */
export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: { code: 'AUTH', message: 'Нужен вход в кабинет' } }, { status: 401 })
  }
  const denied = await denyUnless(user, 'section:ownAudit')
  if (denied) return denied

  const sp = new URL(req.url).searchParams
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
