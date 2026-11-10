import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/server/seed'
import { DRIVER_ID } from '@/lib/demo/route-data'
import type { MarksSnapshot } from '@/lib/protocol'

/**
 * GET /api/driver/v1/sync/marks — снимок активных пометок по bbox (канал 2).
 * since — epoch millis последнего snapshotAt (инкрементальная оптимизация).
 * NB: при рейсах за 180° клиент присылает два bbox (ограничение каркаса №6).
 */
export async function GET(req: NextRequest) {
  await ensureSeeded()
  const driverId = req.headers.get('x-driver-id') ?? DRIVER_ID
  void driverId // пометки общие для всех — автор не хранится
  const sp = req.nextUrl.searchParams
  const minLat = Number(sp.get('minLat')), minLon = Number(sp.get('minLon'))
  const maxLat = Number(sp.get('maxLat')), maxLon = Number(sp.get('maxLon'))
  const since = sp.get('since') ? new Date(Number(sp.get('since'))) : null

  const hasBbox = [minLat, minLon, maxLat, maxLon].every((n) => Number.isFinite(n))

  const marks = await db.roadMark.findMany({
    where: {
      expiresAt: { gt: new Date() },
      ...(since ? { updatedAt: { gt: since } } : {}),
      ...(hasBbox
        ? {
            // пересечение bbox (не за 180-й меридиан)
            minLat: { lte: maxLat },
            maxLat: { gte: minLat },
            minLon: { lte: maxLon },
            maxLon: { gte: minLon },
          }
        : {}),
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 200,
  })

  return NextResponse.json({
    snapshotAt: Date.now(),
    marks: marks.map((m) => ({
      id: m.id,
      category: m.category,
      geometry: m.polylineGeoJson,
      comment: m.comment ?? undefined,
      ttlHours: m.ttlHours,
      confirmCount: m.confirmCount,
      outdatedCount: m.outdatedCount,
      createdAt: m.createdAt.getTime(),
      expiresAt: m.expiresAt.getTime(),
    })),
  } satisfies MarksSnapshot)
}
