import { NextResponse } from 'next/server'
import { applyCorrection, cancelLastCorrection } from '@/lib/kontur/engine'
import { LADDER } from '@/lib/kontur/constants'

export const dynamic = 'force-dynamic'

// B5.7: корректировка статуса и отмена последней корректировки
export async function POST(req: Request) {
  const body = await req.json()
  const mode: 'apply' | 'cancel' = body.mode
  try {
    if (mode === 'apply') {
      const status: string = body.status
      const allowed = [...LADDER, 'cancelled']
      if (!allowed.includes(status)) {
        return NextResponse.json({ error: { code: 'VALIDATION', message: 'Недопустимый статус' } }, { status: 400 })
      }
      if (!body.comment?.trim()) {
        return NextResponse.json({ error: { code: 'VALIDATION', message: 'Причина обязательна (B8.4)' } }, { status: 400 })
      }
      const result = await applyCorrection(body.legId, status, body.comment)
      return NextResponse.json(result)
    }
    if (mode === 'cancel') {
      const result = await cancelLastCorrection(body.legId)
      return NextResponse.json(result)
    }
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Неизвестный режим' } }, { status: 400 })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Ошибка'
    return NextResponse.json({ error: { code: 'STATE_CONFLICT', message } }, { status: 409 })
  }
}
