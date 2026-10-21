/**
 * Рассылка real-time события в шину ws-service (mini-services/ws-service).
 * Вызывается из API-роутов после успешных изменений; fire-and-forget:
 * если сервис не запущен, платформа работает в обычном режиме
 * (данные всё равно догружаются автообновлением каждые 15 секунд).
 */
export function notifyLive(event: { type: string; message?: string; requestId?: string; actor?: string }): void {
  const body = JSON.stringify({ ...event, ts: new Date().toISOString() })
  void fetch('http://127.0.0.1:3004/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(1500),
  }).catch(() => { /* ws-service недоступен — live-обновление необязательно */ })
}
