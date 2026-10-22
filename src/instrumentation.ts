/**
 * Инструментация сервера Next.js (Task 76).
 *
 * onRequestError ловит ВСЕ необработанные ошибки серверной части — маршруты API,
 * рендер и серверные действия — и пишет их в «Журнал событий платформы»
 * (таблица PlatformLog). Так логист видит в интерфейсе реальные сбои платформы,
 * а не только бизнес-события. Запись идёт через lib/platform-log (fire-and-forget):
 * сбой журналирования не влияет на ответ сервера.
 */
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
