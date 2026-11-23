// HTTP-клиент ATI.SU (api.ati.su): Bearer-токен из .env, обязательные заголовки,
// троттлинг 10 rps, retry на 429 с удвоением паузы и на обрывы сокета.
// Требования «Требования и ограничения» ATI.SU (с 01.07.2022): https, gzip/deflate/br,
// User-Agent ati_integrator_<код>, редиректы, retry. Токен никогда не попадает в логи и ответы.

const BASE = process.env.ATISU_API_BASE ?? 'https://api.ati.su'
const TOKEN = process.env.ATISU_TOKEN ?? ''
const USER_AGENT = process.env.ATISU_USER_AGENT ?? 'ati_integrator_api-panda-portal'
const TIMEOUT_MS = Number(process.env.ATISU_TIMEOUT_MS ?? 12000)
const MIN_INTERVAL_MS = 110 // троттлинг ≤10 rps на контакт (правила ATI.SU)
const MAX_429_RETRIES = 5 // 100→200→400→800→1600 мс (правила ATI.SU)
const MAX_NET_RETRIES = 3 // retry на ECONNRESET/ENOTCONN (правила ATI.SU)

export function atisuConfigured(): boolean {
  return TOKEN.length > 0
}

/** Метаданные токена для UI (без самого токена) */
export function atisuTokenMeta(): { expiresAt: string | null; daysLeft: number | null; clientId: string | null } {
  const expiresAt = process.env.ATISU_TOKEN_EXPIRES ?? null
  const days = expiresAt ? Math.ceil((new Date(expiresAt + 'T23:59:59+03:00').getTime() - Date.now()) / 86400000) : null
  const clientId = process.env.ATISU_CLIENT_ID ?? null
  return { expiresAt, daysLeft: days, clientId: clientId ? clientId.slice(0, 8) + '…' : null }
}

// ---- троттлинг: одна очередь, минимум MIN_INTERVAL_MS между отправками ----
let queueTail: Promise<void> = Promise.resolve()
let lastSendAt = 0

function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const wait = lastSendAt + MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastSendAt = Date.now()
  })
  queueTail = run.catch(() => {})
  return run.then(task)
}

export class AtiError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate, br',
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
  }
}

async function rawCall(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: unknown; text: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'follow',
      signal: ctrl.signal,
    })
    const text = await res.text()
    let json: unknown = undefined
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
    return { status: res.status, json, text }
  } finally {
    clearTimeout(timer)
  }
}

/** GET к api.ati.su с троттлингом, таймаутом и retry по правилам ATI.SU */
export async function atiGet<T>(path: string): Promise<T> {
  return atiCall('GET', path)
}

/** POST к api.ati.su (тело — JSON) */
export async function atiPost<T>(path: string, body: unknown): Promise<T> {
  return atiCall('POST', path, body)
}

async function atiCall<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (!atisuConfigured()) throw new AtiError(0, 'ATISU_TOKEN не задан в .env')
  let backoff = 100
  let lastError: unknown = null

  for (let attempt = 0; attempt <= MAX_NET_RETRIES; attempt++) {
    let res: { status: number; json: unknown; text: string }
    try {
      res = await schedule(() => rawCall(method, path, body))
    } catch (e) {
      // обрыв сокета / таймаут — ретрай (правила ATI.SU)
      lastError = e
      await new Promise((r) => setTimeout(r, backoff))
      backoff *= 2
      continue
    }
    if (res.status === 429) {
      // Too Many Requests: пауза с удвоением (правила ATI.SU)
      if (attempt >= MAX_429_RETRIES) break
      await new Promise((r) => setTimeout(r, backoff))
      backoff *= 2
      continue
    }
    if (res.status >= 200 && res.status < 300) {
      return (res.json ?? res.text) as T
    }
    const reason =
      (res.json && typeof res.json === 'object' && 'reason' in (res.json as Record<string, unknown>)
        ? String((res.json as Record<string, unknown>).reason)
        : res.text.slice(0, 200)) || `HTTP ${res.status}`
    throw new AtiError(res.status, reason, res.json)
  }
  throw new AtiError(0, lastError instanceof Error ? lastError.message : 'Сеть недоступна', lastError)
}
