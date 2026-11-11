// Шина приложения: снимок активных пометок «водители для водителей» по bbox
// GET /api/driver/v1/sync/marks?minLat&minLon&maxLat&maxLon&since → { snapshotAt, marks }
// Автор пометки не хранится (152-ФЗ, минимизация) — наследие каркаса.
import { db } from '@/lib/db'
import { json, optionsOk } from '@/lib/cors'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const minLat = num(url.searchParams.get('minLat'))
  const minLon = num(url.searchParams.get('minLon'))
  const maxLat = num(url.searchParams.get('maxLat'))
  const maxLon = num(url.searchParams.get('maxLon'))
  const since = num(url.searchParams.get('since'))

  const marks = await db.roadMark.findMany({
    where: {
      expiresAt: { gt: new Date() },
      ...(since ? { updatedAt: { gt: new Date(since) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
  })
  const filtered = marks.filter((m) => {
    if (minLat === undefined && maxLat === undefined && minLon === undefined && maxLon === undefined) return true
    // пересечение bbox пометки с запрошенным bbox
    if (minLat !== undefined && m.maxLat < minLat) return false
    if (maxLat !== undefined && m.minLat > maxLat) return false
    if (minLon !== undefined && m.maxLon < minLon) return false
    if (maxLon !== undefined && m.minLon > maxLon) return false
    return true
  })

  return json({
    snapshotAt: Date.now(),
    marks: filtered.map((m) => ({
      id: m.id,
      category: m.category,
      geometry: m.polylineGeoJson,
      comment: m.comment,
      ttlHours: m.ttlHours,
      confirmCount: m.confirmCount,
      outdatedCount: m.outdatedCount,
      createdAt: m.createdAt.getTime(),
      expiresAt: m.expiresAt.getTime(),
    })),
  })
}

function num(v: string | null): number | undefined {
  if (v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export async function OPTIONS() {
  return optionsOk()
}
