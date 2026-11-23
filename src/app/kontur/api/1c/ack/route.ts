import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'

export const dynamic = 'force-dynamic'

// B7.1.2: POST /1c/events/ack {cursor_ids:[]} -> {acked:n}
export async function POST(req: Request) {
  const body = await req.json()
  const cursorIds: number[] = body.cursor_ids ?? []
  if (!Array.isArray(cursorIds)) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'cursor_ids должен быть массивом' } }, { status: 400 })
  }
  let acked = 0
  for (const id of cursorIds) {
    const r = await db.outbox1c.updateMany({
      where: { id, state: { in: ['pending', 'stale'] } },
      data: { state: 'acked', ackedAt: new Date() },
    })
    acked += r.count
  }
  return NextResponse.json({ acked })
}
