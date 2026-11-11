// Шина приложения: дельта личного журнала водителя (план обмена)
// GET /api/driver/v1/sync/pull?cursor=0&limit=500 → entries(seq, entity, op, payload) + cursor + hasMore
import { db } from '@/lib/db'
import { json, optionsOk } from '@/lib/cors'

export const dynamic = 'force-dynamic'

async function resolveDriver(req: Request) {
  const key = req.headers.get('x-driver-id')?.trim()
  if (key) {
    // X-Driver-Id — appId приложения водителя; на стенде допускается и id записи
    const byApp = await db.driver.findUnique({ where: { appId: key } })
    if (byApp) return byApp
    const byId = await db.driver.findUnique({ where: { id: key } })
    if (byId) return byId
  }
  // в демо-режиме заголовок необязателен: подставляется демо-водитель
  return db.driver.findUnique({ where: { appId: 'd1111111-1111-4111-8111-111111111111' } })
}



export async function GET(req: Request) {
  const driver = await resolveDriver(req)
  if (!driver) return json({ ok: false, error: 'Водитель не найден (заголовок X-Driver-Id)' }, 404)

  const url = new URL(req.url)
  const cursor = Math.max(0, parseInt(url.searchParams.get('cursor') ?? '0', 10) || 0)
  const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get('limit') ?? '500', 10) || 500))

  const rows = await db.syncJournal.findMany({
    where: { driverId: driver.id, seq: { gt: cursor } },
    orderBy: { seq: 'asc' },
    take: limit + 1,
  })
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)
  const entries = page.map((r) => ({
    seq: r.seq,
    entity: r.entity,
    op: r.op,
    payload: JSON.parse(r.payload) as Record<string, unknown>,
  }))
  const lastSeq = page.length > 0 ? page[page.length - 1].seq : cursor

  return json({ entries, cursor: lastSeq, hasMore })
}

export async function OPTIONS() {
  return optionsOk()
}
