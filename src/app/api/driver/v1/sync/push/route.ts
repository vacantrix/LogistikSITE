import { NextRequest, NextResponse } from 'next/server'
import { applyOperations } from '@/lib/server/appliers'
import { ensureSeeded } from '@/lib/server/seed'
import { DRIVER_ID } from '@/lib/demo/route-data'
import type { PushRequest, PushResponse } from '@/lib/protocol'

/**
 * POST /api/driver/v1/sync/push — сброс outbox-очереди водителя.
 * Батч UUID-операций, применение идемпотентно (зеркало SyncController.push).
 * Водитель определяется заголовком X-Driver-Id (этап MVP: JWT по смене).
 */
export async function POST(req: NextRequest) {
  await ensureSeeded()
  const driverId = req.headers.get('x-driver-id') ?? DRIVER_ID
  const body = (await req.json()) as PushRequest
  if (!body?.operations?.length) {
    return NextResponse.json({ results: [] } satisfies PushResponse)
  }
  const results = await applyOperations(driverId, body.operations.slice(0, 50))
  return NextResponse.json({ results } satisfies PushResponse)
}
