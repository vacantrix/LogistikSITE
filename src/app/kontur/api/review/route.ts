import { NextResponse } from 'next/server'
import { reviewBatch } from '@/lib/kontur/engine'
import { requireKonturPerm } from '@/lib/kontur/access'

export const dynamic = 'force-dynamic'

// B5.8.4: пакетный разбор needs_review (чекбоксы + «Применить все» / «Отклонить все»)
export async function POST(req: Request) {
  const auth = await requireKonturPerm('own:process')
  if (auth instanceof NextResponse) return auth
  const body = await req.json()
  const mode: 'apply' | 'reject' = body.mode
  const eventIds: string[] = body.eventIds ?? []
  if (!['apply', 'reject'].includes(mode) || eventIds.length === 0) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Выберите события и действие' } }, { status: 400 })
  }
  const results = await reviewBatch(eventIds, mode)
  return NextResponse.json({ results })
}
