import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isStaff, requireUser, viewerOf } from '@/lib/auth'
import { eventVisibleTo } from '@/lib/serialize'

export const dynamic = 'force-dynamic'

/** GET /api/events — журнал событий (лента). Перевозчик видит только свои и общие события. */
export async function GET(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const viewer = viewerOf(auth)

  const raw = Number(req.nextUrl.searchParams.get('limit') ?? 30)
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 30
  const events = await db.event.findMany({
    orderBy: { createdAt: 'desc' },
    // перевозчику берём с запасом: часть событий отфильтруется по правам
    take: isStaff(viewer.role) ? limit : limit * 5,
    include: { request: { select: { number: true, winnerId: true } } },
  })
  const visible = events.filter((e) => eventVisibleTo(e, viewer, e.request?.winnerId ?? null)).slice(0, limit)
  return NextResponse.json({
    events: visible.map((e) => ({ id: e.id, type: e.type, message: e.message, requestNumber: e.request?.number ?? null, createdAt: e.createdAt.toISOString() })),
  })
}
