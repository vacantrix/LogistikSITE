import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toRequestDTO } from '@/lib/serialize'

export const dynamic = 'force-dynamic'

/** GET /api/requests/[id] — заявка целиком: ставки, документы, журнал */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const request = await db.request.findUnique({
    where: { id },
    include: { bids: { include: { carrier: true } }, documents: true, events: true, winner: true, cargoType: true },
  })
  if (!request) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
  return NextResponse.json({ request: toRequestDTO(request) })
}
