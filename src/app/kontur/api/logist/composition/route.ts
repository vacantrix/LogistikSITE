import { NextResponse } from 'next/server'
import { changeComposition } from '@/lib/kontur/engine'

export const dynamic = 'force-dynamic'

// B5.8.1: замена водителя/ТС/прицепа с effective_at и причиной
export async function POST(req: Request) {
  const body = await req.json()
  try {
    const result = await changeComposition(body.tripId, {
      driverId: body.driverId || undefined,
      vehicleId: body.vehicleId || undefined,
      trailerId: body.trailerId || undefined,
    }, body.reason)
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Ошибка'
    return NextResponse.json({ error: { code: 'STATE_CONFLICT', message } }, { status: 409 })
  }
}
