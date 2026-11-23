import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'
import { requireKonturPerm } from '@/lib/kontur/access'

export const dynamic = 'force-dynamic'

// Админ-действия над outbox (B8.1 «Failed outbox»): ручной возврат в pending;
// демо-состаривание для показа жизненного цикла stale/failed (B7.1.3)
export async function POST(req: Request) {
  const auth = await requireKonturPerm('section:ownAudit')
  if (auth instanceof NextResponse) return auth
  const body = await req.json()
  const action: 'return' | 'age' = body.action

  if (action === 'return') {
    // failed_delivery -> pending: вкладка админа с ручным возвратом (ARC-005)
    const r = await db.outbox1c.updateMany({
      where: { id: body.id, state: 'failed_delivery' },
      data: { state: 'pending', firstSeenAt: new Date(), lastError: null },
    })
    return NextResponse.json({ ok: true, returned: r.count })
  }

  if (action === 'age') {
    // Демо: сдвигаем first_seen_at назад, чтобы показать stale (24ч) и failed (72ч)
    const hours: number = body.hours
    const ids: number[] = body.ids ?? []
    const shifted = new Date(Date.now() - hours * 3600000)
    for (const id of ids) {
      await db.outbox1c.update({ where: { id }, data: { firstSeenAt: shifted } })
    }
    return NextResponse.json({ ok: true, aged: ids.length, hours })
  }

  return NextResponse.json({ error: { code: 'VALIDATION', message: 'Неизвестное действие' } }, { status: 400 })
}
