// Шина приложения: снимок пробок по bbox (в демо — генератор правдоподобных сегментов)
// GET /api/driver/v1/traffic?minLat&minLon&maxLat&maxLon&since → { snapshotAt, segments }
import { db } from '@/lib/db'
import { json, optionsOk } from '@/lib/cors'
import { refreshTraffic, segmentBbox } from '@/lib/bus/traffic'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const minLat = num(url.searchParams.get('minLat'))
  const minLon = num(url.searchParams.get('minLon'))
  const maxLat = num(url.searchParams.get('maxLat'))
  const maxLon = num(url.searchParams.get('maxLon'))
  const since = num(url.searchParams.get('since'))

  // если есть свежий снимок (моложе 60 c) — отдаём его, иначе перегенерируем
  let segments = await db.trafficSegment.findMany()
  const stale = since === undefined || segments.length === 0 || segments.some((s) => s.updatedAt.getTime() < (since ?? 0)) || segments.some((s) => Date.now() - s.updatedAt.getTime() > 60_000)
  if (stale) {
    const rows = await refreshTraffic()
    segments = rows.map((r) => ({ ...r, updatedAt: new Date() })) as typeof segments
  }

  const filtered = segments
    .filter((s) => {
      if (minLat === undefined && maxLat === undefined && minLon === undefined && maxLon === undefined) return true
      const b = segmentBbox(s.geometry)
      if (minLat !== undefined && b.maxLat < minLat) return false
      if (maxLat !== undefined && b.minLat > maxLat) return false
      if (minLon !== undefined && b.maxLon < minLon) return false
      if (maxLon !== undefined && b.minLon > maxLon) return false
      return true
    })
    .map((s) => ({
      id: s.id,
      title: s.title,
      geometry: s.geometry,
      level: s.level,
      speedKmh: s.speedKmh,
      onRoute: s.onRoute,
      updatedAt: s.updatedAt.getTime(),
    }))

  return json({ snapshotAt: Date.now(), segments: filtered })
}

function num(v: string | null): number | undefined {
  if (v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export async function OPTIONS() {
  return optionsOk()
}
