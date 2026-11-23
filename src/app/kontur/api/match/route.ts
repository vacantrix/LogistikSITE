import { NextResponse } from 'next/server'
import { buildMatchForOrder } from '@/lib/kontur/matching'

export const dynamic = 'force-dynamic'

// Умный подбор под заявку: GET /api/match?orderId=… — рейсы, к которым заявку
// выгодно добавить плечом, и свободный состав под новый рейс (клик по заявке).
export async function GET(req: Request) {
  const orderId = new URL(req.url).searchParams.get('orderId')
  if (!orderId) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Укажите orderId' } }, { status: 400 })
  }
  const result = await buildMatchForOrder(orderId)
  if (!result) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Заявка не найдена' } }, { status: 404 })
  }
  return NextResponse.json(result)
}
