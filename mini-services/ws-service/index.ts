/**
 * Real-time шина платформы «АЭМЗ Логистика» (Task 49).
 *
 * Два сервера:
 *  — socket.io на порту 3003: браузеры подключаются через шлюз Caddy как
 *    io('/?XTransformPort=3003') — путь '/' обязателен, его проверяет Caddy;
 *  — внутренний HTTP на порту 127.0.0.1:3004: эндпоинт POST /notify, куда
 *    API-роуты Next.js сообщают об изменениях (сервер-сервер, наружу не открыт).
 *
 * Каждое уведомление рассылается всем клиентам событием 'platform:update';
 * фронтенд по нему мгновенно догружает данные активного раздела.
 */
import { createServer } from 'http'
import { Server } from 'socket.io'

const WS_PORT = 3003
const NOTIFY_PORT = 3004

interface LiveEvent {
  type: string
  message?: string
  requestId?: string
  actor?: string
  ts: string
}

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path: it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
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

/** Внутренний HTTP: POST /notify от API-роутов Next.js — разослать всем */
const notifyServer = createServer((req, res) => {
  if (req.method === 'POST' && (req.url ?? '').startsWith('/notify')) {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}') as Omit<LiveEvent, 'ts'>
        const event: LiveEvent = { ...parsed, ts: new Date().toISOString() }
        io.emit('platform:update', event)
        console.log(`[ws] broadcast ${event.type}${event.message ? ` — ${event.message}` : ''} → ${io.engine.clientsCount} client(s)`)
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
