// Журнал регистрации: кто, что, когда, уровень; фильтры
import { db } from '@/lib/db'
import { jsonOffice } from '@/lib/cors'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const user = url.searchParams.get('user') ?? undefined
  const action = url.searchParams.get('action') ?? undefined
  const level = url.searchParams.get('level') ?? undefined
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') ?? '200', 10) || 200))

  const rows = await db.registrationLog.findMany({
    where: {
      ...(user ? { user: { contains: user } } : {}),
      ...(action ? { action: { contains: action } } : {}),
      ...(level ? { level } : {}),
    },
    orderBy: { at: 'desc' },
    take: limit,
  })
  return jsonOffice({
    rows: rows.map((r) => ({
      id: r.id,
      user: r.user,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      level: r.level,
      at: r.at.toISOString(),
    })),
  })
}
