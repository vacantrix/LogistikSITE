import { NextResponse } from 'next/server'
import { processSync, DriverEventInput } from '@/lib/kontur/engine'

export const dynamic = 'force-dynamic'

// B7.2.2: POST /driver/sync {events:[]} -> {results:[], upgrade_required}
export async function POST(req: Request) {
  const body = await req.json()
  const events: DriverEventInput[] = body.events ?? []
  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Пустой пакет событий' } }, { status: 400 })
  }
  const { results, upgradeRequired } = await processSync(events)
  // 426 — сигнал, не блокировка (ARC-006): creation событий продолжается всегда
  return NextResponse.json({ results, upgrade_required: upgradeRequired })
}
