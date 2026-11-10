import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/server/seed'
import { DRIVER_ID } from '@/lib/demo/route-data'
import type { JournalEntry, PullResponse } from '@/lib/protocol'

/**
 * GET /api/driver/v1/sync/pull?cursor=N — дельта личного журнала (канал 1).
 * Курсор — последний полученный seq (зеркало SyncController.pull).
 */
export async function GET(req: NextRequest) {
  await ensureSeeded()
  const driverId = req.headers.get('x-driver-id') ?? DRIVER_ID
  const cursor = Number(req.nextUrl.searchParams.get('cursor') ?? '0') || 0
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '500') || 500, 500)

  const rows = await db.syncJournal.findMany({
    where: { driverId, seq: { gt: cursor } },
    orderBy: { seq: 'asc' },
    take: limit,
  })

  const entries: JournalEntry[] = rows.map((r) => ({
    seq: r.seq,
    entity: r.entity as JournalEntry['entity'],
    op: r.op as JournalEntry['op'],
    payload: JSON.parse(r.payload),
  }))

  const nextCursor = entries.length > 0 ? entries[entries.length - 1].seq : cursor
  const hasMore = rows.length === limit

  return NextResponse.json({ entries, cursor: nextCursor, hasMore } satisfies PullResponse)
}
