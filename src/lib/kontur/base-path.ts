// Боевой контур: диспетчерская смонтирована под /kontur на vacantrix.ru.
// Next.js basePath (next.config.ts) добавляет префикс к страницам и статике,
// но не к программным fetch('/api/...'), поэтому клиентские запросы идут
// через apiFetch/withBasePath.
export const BASE_PATH = '/kontur'

export function withBasePath(path: string): string {
  if (!path.startsWith('/')) return path
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path
  return `${BASE_PATH}${path}`
}

/** Токен активной вкладки единой платформы (lib/accounts.ts) */
const PLATFORM_KEY = 'aemz_session_token'

/** fetch с токеном вкладки: панели Контура ходят и через apiFetch, не только authFetch */
function fetchWithSession(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  try {
    const token = window.sessionStorage.getItem(PLATFORM_KEY)
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  } catch {
    /* приватный режим или серверный рендер — остаёмся на cookie-сессии */
  }
  return fetch(input, { ...init, headers })
}

/** fetch для путей приложения: '/api/state' → '/kontur/api/state'. */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof input === 'string') {
    return fetchWithSession(withBasePath(input), init)
  }
  if (typeof window !== 'undefined' && input instanceof URL && input.origin === window.location.origin) {
    const url = new URL(input.toString())
    url.pathname = withBasePath(url.pathname)
    return fetchWithSession(url, init)
  }
  return fetchWithSession(input, init)
}
