// API рабочего места «Маршрутные листы»: разбор ссылки Яндекс.Карт.
// POST { link } → заявке пишутся routeLink + routeWaypoints (JSON-точки).
import { jsonOffice } from '@/lib/cors'
import { saveRequestRoute } from '@/lib/1c/routeLink'
import { pointsLabel } from '@/lib/1c/yandexRoute'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  let body: { link?: string; actor?: string }
  try {
    body = await req.json()
  } catch {
    return jsonOffice({ ok: false, error: 'Некорректное тело запроса (ожидается JSON)' }, 400)
  }
  if (!body?.link || typeof body.link !== 'string')
    return jsonOffice({ ok: false, error: 'Обязательно поле link — ссылка на маршрут' }, 400)

  const result = await saveRequestRoute(id, body.link, body.actor ?? 'Диспетчер Е. Крылова')
  if (!result.ok) return jsonOffice({ ok: false, error: result.error }, result.code)

  return jsonOffice({
    ok: true,
    number: result.number,
    points: result.waypoints.length,
    pointsLabel: pointsLabel(result.waypoints.length),
    url: result.url,
  })
}
