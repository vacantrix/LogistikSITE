/**
 * Инструментация сервера Next.js (Task 76).
 *
 * onRequestError ловит ВСЕ необработанные ошибки серверной части — маршруты API,
 * рендер и серверные действия — и пишет их в «Журнал событий платформы»
 * (таблица PlatformLog). Так логист видит в интерфейсе реальные сбои платформы,
 * а не только бизнес-события. Запись идёт через lib/platform-log (fire-and-forget):
 * сбой журналирования не влияет на ответ сервера.
 */
/**
 * Старт сервера:
 *  — фоновое подведение итогов торгов: срок вышел — победитель получает уведомление сразу,
 *    а не когда кто-то откроет платформу; период — AUCTION_SWEEP_SEC (по умолчанию 30 с, 0 — выкл.);
 *  — фоновая сверка ЭТрН с Диадоком (если интеграция настроена).
 *    Подписи перевозчика (Т2/Т4), УИД ГИС ЭПД и ошибки приходят без участия логиста;
 *    период — DIADOC_SYNC_INTERVAL_SEC (по умолчанию 180 с, 0 — только по кнопке).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // старые «Завод → Порт» и грузы без справочника — к справочникам (идемпотентно)
  await import('@/lib/data-fixes')
    .then(({ normalizeLegacyData }) => normalizeLegacyData())
    .catch((e) => console.error('[data-fixes] не удалось привести данные', e))
  // при горячей перезагрузке в dev register вызывается повторно — таймеры по одному
  const g = globalThis as unknown as {
    __diadocSyncTimer?: ReturnType<typeof setInterval>
    __auctionSweepTimer?: ReturnType<typeof setInterval>
  }
  const sweepSec = Number(process.env.AUCTION_SWEEP_SEC ?? 30)
  if (g.__auctionSweepTimer) clearInterval(g.__auctionSweepTimer)
  if (Number.isFinite(sweepSec) && sweepSec > 0) {
    g.__auctionSweepTimer = setInterval(() => {
      void import('@/lib/requests')
        .then(({ sweepAuctions }) => sweepAuctions())
        .catch((e) => console.error('[auction-sweep] сбой подведения итогов', e))
    }, sweepSec * 1000)
  }
  const { diadocConfig, diadocEnabled } = await import('@/lib/diadoc/config')
  const interval = diadocConfig().syncIntervalSec
  if (!diadocEnabled() || interval <= 0) return
  if (g.__diadocSyncTimer) clearInterval(g.__diadocSyncTimer)
  g.__diadocSyncTimer = setInterval(() => {
    void import('@/lib/diadoc/etrn')
      .then(({ syncDiadoc }) => syncDiadoc())
      .catch(() => { /* ошибка уже записана в DiadocState.lastError — покажем в разделе ЭДО */ })
  }, interval * 1000)
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers?: Record<string, string | undefined> },
  context: { routerKind: 'App Router' | 'Pages Router'; routePath?: string; routeType?: string },
): Promise<void> {
  try {
    const { plogError } = await import('@/lib/platform-log')
    await plogError('server', err, {
      type: 'SERVER_ERROR',
      source: request.path,
      message: `Серверная ошибка: ${err instanceof Error ? err.message : String(err)}`,
      meta: {
        path: request.path,
        method: request.method,
        routerKind: context.routerKind,
        routePath: context.routePath ?? null,
        routeType: context.routeType ?? null,
      },
    })
  } catch {
    // журналирование не должно ломать обработку ошибок
  }
}
