import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'
import { outboxTick } from '@/lib/kontur/engine'

export const dynamic = 'force-dynamic'

// B7.1.2: GET /1c/events?since=<cursor>&limit=500 — 1С забирает курсором и ack'ает.
// Попытки/таймеры считаются по факту выдачи (B7.1.3) — сервер ничего не пушит.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const since = Number(searchParams.get('since') || '0') || 0
  const limit = Math.min(Number(searchParams.get('limit') || '500'), 500)

  await outboxTick()

  const events = await db.outbox1c.findMany({
    where: { id: { gt: since }, state: { in: ['pending', 'stale'] } },
    orderBy: { id: 'asc' },
    take: limit,
  })

  // фиксируем выдачу
  const now = new Date()
  for (const ev of events) {
    await db.outbox1c.update({
      where: { id: ev.id },
      data: { attempts: { increment: 1 }, lastAttemptAt: now },
    })
  }

  const nextCursor = events.length > 0 ? events[events.length - 1].id : since
  return NextResponse.json({
    events: events.map((e) => ({
      cursor_id: e.id,
      event_type: e.eventType,
      payload: JSON.parse(e.payload),
      created_at: e.firstSeenAt.toISOString(),
      state: e.state,
      attempts: e.attempts + (events.find((x) => x.id === e.id) ? 1 : 0),
    })),
    next_cursor: Buffer.from(String(nextCursor)).toString('base64'),
    next_cursor_raw: nextCursor,
  })
}
