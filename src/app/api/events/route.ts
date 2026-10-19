import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** GET /api/events — журнал событий по заявкам (лента) */
export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 30), 100)
  const events = await db.event.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { request: { select: { number: true } } },
  })
  return NextResponse.json({
    events: events.map((e) => ({ id: e.id, type: e.type, message: e.message, requestNumber: e.request?.number ?? null, createdAt: e.createdAt.toISOString() })),
  })
}
