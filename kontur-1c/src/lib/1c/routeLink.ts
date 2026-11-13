// Доменный сервис «Разобрать ссылку маршрута» (канон фазы 1: транзакция + журнал).
// Диспетчер вставляет ссылку Яндекс.Карт → заявка получает routeLink (исходник)
// и routeWaypoints (JSON-точки) → приложение водителя строит по ним рейс.
// Кривая ссылка заявку НЕ блокирует: отказ пишется в журнал предупреждением.
import type { Prisma } from '@prisma/client'
import { db, withWriteLock } from '../db'
import { logEvent } from './journal'
import { parseYandexRouteLink, type Waypoint } from './yandexRoute'

export type SaveRouteResult =
  | { ok: true; number: string; waypoints: Waypoint[]; url: string }
  | { ok: false; code: 400 | 404; error: string }

export async function saveRequestRoute(
  requestId: string,
  link: string,
  actor = 'Диспетчер Е. Крылова',
): Promise<SaveRouteResult> {
  const request = await db.transportRequest.findUnique({ where: { id: requestId }, select: { id: true, number: true } })
  if (!request) return { ok: false, code: 404, error: 'Заявка не найдена' }

  const parsed = parseYandexRouteLink(link)
  if (!parsed.ok) {
    await withWriteLock(() =>
      db.$transaction(async (tx) => {
        await logEvent(tx, {
          user: actor,
          action: 'ROUTE_ATTACH_REJECTED',
          entity: 'TransportRequest',
          entityId: request.number,
          level: 'warning',
        })
      }),
    )
    return { ok: false, code: 400, error: parsed.error }
  }

  const { waypoints, url } = parsed.route
  await withWriteLock(() =>
    db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.transportRequest.update({
        where: { id: requestId },
        data: {
          routeLink: url,
          routeWaypoints: JSON.stringify(waypoints),
        },
      })
      await logEvent(tx, {
        user: actor,
        action: 'ROUTE_ATTACH',
        entity: 'TransportRequest',
        entityId: request.number,
      })
    }),
  )

  return { ok: true, number: request.number, waypoints, url }
}
