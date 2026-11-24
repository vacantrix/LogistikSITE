// Шина приложения: дельта личного журнала водителя (план обмена)
// GET /api/driver/v1/sync/pull?cursor=0&limit=500 → entries(seq, entity, op, payload) + cursor + hasMore
import { db } from '@/lib/db'
import { json, optionsOk } from '@/lib/cors'
import { resolveDriver } from '@/lib/bus/resolveDriver'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const driver = await resolveDriver(req)
  if (!driver) return json({ ok: false, error: 'Водитель не найден (заголовок X-Driver-Id)' }, 404)

  const url = new URL(req.url)
  const requested = Math.max(0, parseInt(url.searchParams.get('cursor') ?? '0', 10) || 0)
  const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get('limit') ?? '500', 10) || 500))

  // Курсор выше серверного максимума означает, что клиент пришёл с другого
  // стенда или его журнал был пересобран. Без сброса такой водитель никогда
  // не получит назначенные рейсы: pull вечно возвращает пустую дельту.
  const max = await db.syncJournal.aggregate({
    where: { driverId: driver.id },
    _max: { seq: true },
  })
  const maxSeq = max._max.seq ?? 0
  const cursorReset = requested > maxSeq
  const cursor = cursorReset ? 0 : requested

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

  return json({
    entries,
    cursor: lastSeq,
    hasMore,
    // Диагностика канала: видно в access.log и в ответе приложения.
    driverId: driver.appId ?? driver.id,
    maxSeq,
    cursorReset,
  })
}

export async function OPTIONS() {
  return optionsOk()
}
