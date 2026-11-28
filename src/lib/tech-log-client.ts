'use client'

/**
 * Перехватчик вызовов API из браузера для технической консоли («Логи»).
 *
 * Один раз пропатчивает window.fetch: каждый вызов /api/* (из api-клиента,
 * из диспетчерской, из карт) записывается — метод, путь, код ответа и
 * сколько миллисекунд шёл вызов. Строки короткие: это журнал работы кода,
 * а не действий людей (те — в «Журнале событий»).
 *
 * Буфер копится в браузере и раз в 5 секунд уходит батчем в
 * POST /api/platform-log/tech (fire-and-forget). Сам батч и тайлы карты
 * не записываются — иначе консоль заспамится и уйдёт в цикл.
 */
import { getSessionToken } from '@/lib/api'

/** Что копим до отправки: только факты вызова, без тел и заголовков */
interface CallRec {
  ts: number
  method: string
  path: string
  status: number | null
  ms: number
}

const FLUSH_MS = 5_000
const BUF_MAX = 400

const buf: CallRec[] = []
let installed = false

/** Установить перехватчик (идемпотентно — безопасно при HMR) */
export function installTechLogger(): void {
  if (typeof window === 'undefined' || installed) return
  installed = true

  const w = window as typeof window & { __aemzTechLogInstalled?: boolean }
  if (w.__aemzTechLogInstalled) return
  w.__aemzTechLogInstalled = true

  const original = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = String(
      init?.method ??
        (typeof input === 'object' && input !== null && !('href' in input) && 'method' in input ? input.method : 'GET'),
    ).toUpperCase()
    const t0 = Date.now()
    const started = performance.now()
    const settle = (status: number | null) => recordCall(url, method, status, t0, Math.round(performance.now() - started))
    return original(input, init).then(
      (res) => { settle(res.status); return res },
      (err) => { settle(null); throw err },
    )
  }

  window.setInterval(flush, FLUSH_MS)
  // уход со страницы: отправить хвост сразу (keepalive доставит и после ухода)
  window.addEventListener('pagehide', flush)
}

function recordCall(rawUrl: string, method: string, status: number | null, ts: number, ms: number): void {
  try {
    // только вызовы API платформы; без самого отчёта (цикл) и тайлов карты (шум)
    if (!rawUrl.includes('/api/')) return
    if (rawUrl.includes('/api/platform-log/tech')) return
    if (rawUrl.includes('/api/map-tile/')) return
    buf.push({ ts, method: method.slice(0, 8), path: cleanPath(rawUrl), status, ms })
    if (buf.length > BUF_MAX) buf.splice(0, buf.length - BUF_MAX)
  } catch {
    // консоль не должна ломать вызовы
  }
}

/** Путь без токенов: query-параметры t/token вырезаются (секреты в логах не место) */
function cleanPath(raw: string): string {
  try {
    const u = raw.startsWith('/') ? new URL(raw, window.location.origin) : new URL(raw)
    u.searchParams.delete('t')
    u.searchParams.delete('token')
    return (u.pathname + (u.search ? u.search : '')).slice(0, 300)
  } catch {
    return raw.slice(0, 300)
  }
}

function flush(): void {
  if (buf.length === 0) return
  const calls = buf.splice(0, 200)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getSessionToken()
  if (token) headers.Authorization = `Bearer ${token}`
  void fetch('/api/platform-log/tech', {
    method: 'POST',
    headers,
    body: JSON.stringify({ calls }),
    keepalive: true,
    credentials: 'same-origin',
  }).catch(() => { /* консоль недоступна — не критично */ })
}
