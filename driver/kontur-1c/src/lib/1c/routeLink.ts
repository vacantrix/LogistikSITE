// Доменный сервис «вставка маршрута из Яндекс.Карт» в заявку (TransportRequest):
// разбор ссылки (rtext → точки), сохранение routeLink + routeWaypoints,
// запись в журнал регистрации (канон фазы 1: доменный сервис + logEvent в транзакции).
// Кривая ссылка не блокирует заявку — отказ возвращается ошибкой, состояние не меняется.
import { db, withWriteLock } from '../db'
import { logEvent } from './journal'
import { parseYandexRouteLink, type Waypoint } from './yandexRoute'

export type SaveRouteResult =
  | { ok: true; number: string; points: number; routeLink: string; waypoints: Waypoint[] }
  | { ok: false; error: string; code?: number }

export async function saveRequestRoute(
  requestId: string,
  link: string,
  actor = 'Диспетчер',
): Promise<SaveRouteResult> {
  const parsed = parseYandexRouteLink(link)
  if (!parsed.ok) {
    // отказ — тоже событие журнала (канон ASSIGN_REJECTED), заявка не блокируется
    await withWriteLock(() =>
      db.$transaction(async (tx) => {
        await logEvent(tx, {
          user: actor,
          action: 'ROUTE_ATTACH_REJECTED',
          entity: 'TransportRequest',
          entityId: requestId,
          level: 'warning',
        })
      }),
    )
    return { ok: false, error: parsed.error }
  }

  const request = await db.transportRequest.findUnique({
    where: { id: requestId },
    select: { number: true, status: true },
  })
  if (!request) return { ok: false, error: 'Заявка не найдена', code: 404 }
  if (request.status === 'DONE' || request.status === 'CANCELLED')
    return { ok: false, error: `Заявка ${request.number} закрыта (${request.status}) — маршрут не сохраняется` }

  const waypointsJson = JSON.stringify(parsed.waypoints)
  await withWriteLock(() =>
    db.$transaction(async (tx) => {
      await tx.transportRequest.update({
        where: { id: requestId },
        data: { routeLink: parsed.link, routeWaypoints: waypointsJson },
      })
      await logEvent(tx, {
        user: actor,
        action: 'ROUTE_ATTACH',
        entity: 'TransportRequest',
        entityId: request.number,
      })
    }),
  )
  return {
    ok: true,
    number: request.number,
    points: parsed.waypoints.length,
    routeLink: parsed.link,
    waypoints: parsed.waypoints,
  }
}
