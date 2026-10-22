/**
 * Real-time шина платформы «АЭМЗ Логистика» (Task 49).
 *
 * Два сервера:
 *  — socket.io на порту 3003: браузеры подключаются через шлюз Caddy как
 *    io('/?XTransformPort=3003') — путь '/' обязателен, его проверяет Caddy;
 *  — внутренний HTTP на порту 127.0.0.1:3004: эндпоинт POST /notify, куда
 *    API-роуты Next.js сообщают об изменениях (сервер-сервер, наружу не открыт).
 *
 * Безопасность:
 *  — подключиться может только вошедший пользователь: проверяется та же подписанная
 *    кука сессии, что у платформы (нужен тот же AUTH_SECRET);
 *  — в рассылке только «что изменилось» (тип и id заявки) — без текстов, сумм и ФИО:
 *    клиент перечитывает данные через API, где сервер сам решает, что показать;
 *  — /notify слушает только 127.0.0.1 и при заданном WS_NOTIFY_TOKEN требует его в заголовке.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { createServer } from 'http'
import { Server } from 'socket.io'

const WS_PORT = 3003
const NOTIFY_PORT = 3004
const SESSION_COOKIE = 'aemz_session'
const AUTH_SECRET = process.env.AUTH_SECRET ?? ''
const NOTIFY_TOKEN = process.env.WS_NOTIFY_TOKEN ?? ''
/** Разрешённые источники через запятую; по умолчанию — только тот же адрес (через шлюз) */
const ALLOWED_ORIGINS = (process.env.WS_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)

if (!AUTH_SECRET) {
  console.warn('[ws] AUTH_SECRET не задан — подключения без проверки входа (только для локальной разработки)')
}

interface LiveEvent {
  type: string
  requestId?: string
  ts: string
}

/** Проверка подписанного токена сессии платформы (формат src/lib/auth.ts: base64url(json).hmac) */
function tokenValid(raw: string | null | undefined): boolean {
  if (!AUTH_SECRET) return true
  if (!raw) return false
  const [body, sig] = raw.split('.')
  if (!body || !sig) return false
  const expected = createHmac('sha256', AUTH_SECRET).update(body).digest('base64url')
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { exp?: number }
    return typeof data.exp === 'number' && data.exp > Date.now()
  } catch {
    return false
  }
}

/** Проверка куки сессии платформы */
function sessionValid(cookieHeader: string | undefined): boolean {
  if (!AUTH_SECRET) return true
  const raw = (cookieHeader ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`))
  if (!raw) return false
  return tokenValid(decodeURIComponent(raw.slice(SESSION_COOKIE.length + 1)))
}

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path: it is used by Caddy to forward the request to the correct port
  path: '/',
  // браузер подключается через тот же адрес, что и сайт, — открытый CORS не нужен
  cors: ALLOWED_ORIGINS.length ? { origin: ALLOWED_ORIGINS, credentials: true } : undefined,
  allowRequest: (req, callback) => {
    // Основной способ — кука сессии; во встроенном окне предпросмотра браузер может
    // не отдавать сторонние куки — тогда клиент передаёт тот же токен query-параметром token.
    let qpToken: string | null = null
    try {
      qpToken = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token')
    } catch { /* некорректный url — проверяем только куку */ }
    const ok = sessionValid(req.headers.cookie) || tokenValid(qpToken)
    callback(ok ? null : 'unauthorized', ok)
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.on('connection', (socket) => {
  console.log(`[ws] client connected: ${socket.id} (online: ${io.engine.clientsCount})`)
  socket.on('disconnect', () => {
    console.log(`[ws] client disconnected: ${socket.id} (online: ${io.engine.clientsCount})`)
  })
})

/** Внутренний HTTP: POST /notify от API-роутов Next.js — разослать всем «есть изменения» */
const notifyServer = createServer((req, res) => {
  if (req.method === 'POST' && (req.url ?? '').startsWith('/notify')) {
    if (NOTIFY_TOKEN && req.headers['x-notify-token'] !== NOTIFY_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end('{"ok":false}')
      return
    }
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 10_000) req.destroy()
    })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}') as { type?: unknown; requestId?: unknown }
        const event: LiveEvent = {
          type: typeof parsed.type === 'string' ? parsed.type.slice(0, 64) : 'UPDATE',
          ...(typeof parsed.requestId === 'string' ? { requestId: parsed.requestId.slice(0, 64) } : {}),
          ts: new Date().toISOString(),
        }
        io.emit('platform:update', event)
        console.log(`[ws] broadcast ${event.type} → ${io.engine.clientsCount} client(s)`)
      } catch (e) {
        console.error('[ws] bad notify payload:', e)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end('{"ok":false}')
})

httpServer.listen(WS_PORT, () => {
  console.log(`[ws] socket.io listening on :${WS_PORT} (path '/')`)
})
notifyServer.listen(NOTIFY_PORT, '127.0.0.1', () => {
  console.log(`[ws] notify api listening on 127.0.0.1:${NOTIFY_PORT}`)
})
