import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/server/seed'
import { DRIVER_ID } from '@/lib/demo/route-data'

/**
 * GET /api/driver/v1/sync/wait?cursor=N&timeout=25 — мгновенный канал входящих.
 *
 * Держит запрос до появления в личном журнале водителя записи с seq > cursor
 * (назначение рейса, ответ офиса, пометка) и отвечает { changed: true } сразу.
 * Если изменений нет — { changed: false } по таймауту, клиент открывает
 * следующее ожидание. Это дешевле WebSocket и проходит через любые прокси,
 * а клиентский polling остаётся страховкой при обрыве.
 */
export const dynamic = 'force-dynamic'

const MAX_WAIT_MS = 25_000
const POLL_MS = 400

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function GET(req: NextRequest) {
  await ensureSeeded()
  const driverId = req.headers.get('x-driver-id') ?? DRIVER_ID
  const cursor = Math.max(0, Number(req.nextUrl.searchParams.get('cursor') ?? '0') || 0)
  const requested = Number(req.nextUrl.searchParams.get('timeout') ?? '25') || 25
  const timeoutMs = Math.min(Math.max(requested, 1), 30) * 1000
  const deadline = Date.now() + Math.min(timeoutMs, MAX_WAIT_MS)

  while (Date.now() < deadline) {
    if (req.signal.aborted) break
    const row = await db.syncJournal.findFirst({
      where: { driverId, seq: { gt: cursor } },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    })
    if (row) {
      return noStore({ changed: true, cursor: row.seq })
    }
    await sleep(POLL_MS)
  }

  return noStore({ changed: false, cursor })
}
