/**
 * Рассылка real-time события в шину ws-service (mini-services/ws-service).
 * Вызывается из API-роутов после успешных изменений; fire-and-forget:
 * если сервис не запущен, платформа работает в обычном режиме
 * (данные всё равно догружаются автообновлением каждые 15 секунд).
 *
 * В шину уходит только «что-то изменилось»: тип и id заявки. Тексты событий
 * (ставки, имена перевозчиков, ФИО водителей) не рассылаются всем подряд —
 * клиент перечитывает данные через API, где сервер сам решает, что показать.
 */
const NOTIFY_URL = process.env.WS_NOTIFY_URL ?? 'http://127.0.0.1:3004/notify'

export function notifyLive(event: { type: string; requestId?: string }): void {
  const body = JSON.stringify({ type: event.type, requestId: event.requestId, ts: new Date().toISOString() })
  const token = process.env.WS_NOTIFY_TOKEN
  void fetch(NOTIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Notify-Token': token } : {}) },
    body,
    signal: AbortSignal.timeout(1500),
  }).catch(() => { /* ws-service недоступен — live-обновление необязательно */ })
}
