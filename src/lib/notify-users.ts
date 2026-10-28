/**
 * Персональные уведомления (Task 69) — серверная сторона.
 *
 * Кто какие события получает:
 *  — Внутренний контур (все пользователи с ролями logist и admin):
 *      BID_PLACED      — перевозчик подал ставку на заявку площадки;
 *      CREW_ASSIGNED   — перевозчик указал/утвердил экипаж по выигранному рейсу;
 *      DOCS_READY      — комплект документов прошёл авто-проверку, заявка на сверке;
 *      AUCTION_FINISHED— итоги торгов подведены (по сроку или прямым назначением);
 *      MOVED_TO_DRAFT  — торги закончились без ставок, заявка в «Черновиках заявок»;
 *      EDO_SIGNED      — контрагент подписал документ ЭДО (Task 76).
 *  — Перевозчик (пользователи его компании):
 *      WINNER_AWARDED  — заявка закреплена за компанией (торги/прямое назначение);
 *      BID_OUTBID      — в торгах кто-то перебил текущую лучшую ставку;
 *      DOCS_RETURNED   — логист вернул документы на доработку (с причиной);
 *      DOCS_CONFIRMED  — логист подтвердил сверку, рейс выполняется;
 *      TRIP_CLOSED     — рейс закрыт, заявка завершена;
 *      REQUEST_DELETED — логист удалил заявку (с площадки снята);
 *      EDO_READY       — сформирован комплект ЭДО, доступен к подписанию (Task 76);
 *      EDO_SIGNED      — АЭМЗ подписало документ, ждёт подписи перевозчика (Task 76);
 *      DOC_EXPIRY      — у техники истёк или истекает техосмотр (рассылка «Уведомить агента»);
 *      DOCS_EXCHANGED  — обмен документами по заявке (Task 109): перевозчик передал
 *                      доверенность/заявку логисту или логист выложил документ для перевозчика.
 *  — Администрация и логисты:
 *      TICKET_NEW      — перевозчик создал обращение в поддержку (Task 109);
 *      TICKET_REPLY    — новый ответ в обращении.
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
  | 'TRIP_CLOSED' | 'REQUEST_DELETED' | 'MOVED_TO_DRAFT'
  | 'EDO_READY' | 'EDO_SIGNED' | 'DOC_EXPIRY'
  | 'DOCS_EXCHANGED'
  | 'TICKET_NEW' | 'TICKET_REPLY' | 'TICKET_CLOSED'

export interface NotifyPayload {
  type: NotifyType
  title: string
  body: string
  requestId?: string
}

/** Создать уведомление всем пользователям внутреннего контура — логистам и администрации */
export async function notifyLogists(n: NotifyPayload): Promise<void> {
  const users = await db.user.findMany({ where: { role: { in: ['logist', 'admin'] } }, select: { id: true } })
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

/** Уведомление администрации: все пользователи с ролью admin */
export async function notifyAdmins(n: NotifyPayload): Promise<void> {
  const users = await db.user.findMany({ where: { role: 'admin' }, select: { id: true } })
  if (users.length === 0) return
  await db.notification.createMany({
    data: users.map((u) => ({ userId: u.id, type: n.type, title: n.title, body: n.body, requestId: n.requestId ?? null })),
  })
  notifyLive({ type: `NOTIFY:${n.type}`, requestId: n.requestId })
}

/** Персональное уведомление одному пользователю (автору обращения и т. п.) */
export async function notifyUser(userId: string, n: NotifyPayload): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!user) return
  await db.notification.create({
    data: { userId: user.id, type: n.type, title: n.title, body: n.body, requestId: n.requestId ?? null },
  })
  notifyLive({ type: `NOTIFY:${n.type}`, requestId: n.requestId })
}
