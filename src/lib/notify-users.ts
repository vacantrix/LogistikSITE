/**
 * Персональные уведомления (Task 69) — серверная сторона.
 *
 * Кто какие события получает:
 *  — Логист (все пользователи с ролью logist):
 *      BID_PLACED      — перевозчик подал ставку на заявку площадки;
 *      CREW_ASSIGNED   — перевозчик указал/утвердил экипаж по выигранному рейсу;
 *      DOCS_READY      — комплект документов прошёл авто-проверку, заявка на сверке;
 *      AUCTION_FINISHED— итоги торгов подведены (по сроку или прямым назначением).
 *  — Перевозчик (пользователи его компании):
 *      WINNER_AWARDED  — заявка закреплена за компанией (торги/прямое назначение);
 *      BID_OUTBID      — в торгах кто-то перебил текущую лучшую ставку;
 *      DOCS_RETURNED   — логист вернул документы на доработку (с причиной);
 *      DOCS_CONFIRMED  — логист подтвердил сверку, данные переданы в 1С;
 *      TRIP_CLOSED     — рейс закрыт, заявка завершена;
 *      REQUEST_DELETED — логист удалил заявку (с площадки снята).
 *
 * Уведомления создаются после успешной транзакции действия; вместе с ними
 * уходит live-событие в шину ws-service — колокольчик в шапке обновляется
 * без перезагрузки страницы.
 */
import { db } from '@/lib/db'
import { notifyLive } from '@/lib/notify'

export type NotifyType =
  | 'BID_PLACED' | 'BID_OUTBID' | 'AUCTION_FINISHED' | 'WINNER_AWARDED'
  | 'CREW_ASSIGNED' | 'DOCS_READY' | 'DOCS_RETURNED' | 'DOCS_CONFIRMED'
  | 'TRIP_CLOSED' | 'REQUEST_DELETED'

export interface NotifyPayload {
  type: NotifyType
  title: string
  body: string
  requestId?: string
}

/** Создать уведомление всем пользователям с ролью «логист» (внутренний контур) */
export async function notifyLogists(n: NotifyPayload): Promise<void> {
  const users = await db.user.findMany({ where: { role: 'logist' }, select: { id: true } })
  if (users.length === 0) return
  await db.notification.createMany({
    data: users.map((u) => ({ userId: u.id, type: n.type, title: n.title, body: n.body, requestId: n.requestId ?? null })),
  })
  notifyLive({ type: `NOTIFY:${n.type}`, requestId: n.requestId })
}

/** Создать уведомление всем пользователям перевозчика (кабинет компании) */
export async function notifyCarrier(carrierId: string | null | undefined, n: NotifyPayload): Promise<void> {
  if (!carrierId) return
  const users = await db.user.findMany({ where: { carrierId, role: 'carrier' }, select: { id: true } })
  if (users.length === 0) return
  await db.notification.createMany({
    data: users.map((u) => ({ userId: u.id, type: n.type, title: n.title, body: n.body, requestId: n.requestId ?? null })),
  })
  notifyLive({ type: `NOTIFY:${n.type}`, requestId: n.requestId })
}
