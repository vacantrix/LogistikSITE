// Вставка маршрута из Яндекс.Карт: разбор ссылки, сохранение routeLink + routeWaypoints.
// Кривая ссылка → ошибка 400, заявка не блокируется (сценарий «Построить маршрут»).
import { jsonOffice } from '@/lib/cors'
import { saveRequestRoute } from '@/lib/1c/routeLink'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { link?: string; actor?: string }
  try {
    body = await req.json()
  } catch {
    return jsonOffice({ ok: false, error: 'Некорректное тело запроса' }, 400)
  }
  if (!body?.link || !String(body.link).trim())
    return jsonOffice({ ok: false, error: 'Вставьте ссылку на маршрут (Яндекс.Карты)' }, 400)

  const result = await saveRequestRoute(id, String(body.link).trim(), body.actor ?? 'Диспетчер')
  if (!result.ok) return jsonOffice({ ok: false, error: result.error }, result.code ?? 400)
  return jsonOffice({
    ok: true,
    number: result.number,
    points: result.points,
    routeLink: result.routeLink,
    waypoints: result.waypoints,
  })
}
