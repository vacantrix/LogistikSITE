import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'

export const dynamic = 'force-dynamic'

// Устройства (B4.23): поддержка сбрасывает счётчик после синхронизации времени (B7.2.13)
export async function POST(req: Request) {
  const body = await req.json()
  if (body.action === 'reset-skew') {
    const d = await db.device.update({
      where: { id: body.deviceId },
      data: { clockSkewCount24h: 0, systematicSkew: false },
    })
    return NextResponse.json({ ok: true, device: d })
  }
  if (body.action === 'set-legacy') {
    const d = await db.device.update({
      where: { id: body.deviceId },
      data: { isLegacy: !!body.value },
    })
    return NextResponse.json({ ok: true, device: d })
  }
  return NextResponse.json({ error: { code: 'VALIDATION', message: 'Неизвестное действие' } }, { status: 400 })
}
