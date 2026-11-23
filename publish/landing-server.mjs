/**
 * Локальный шлюз демо-стенда LogistikSITE.
 *
 *   /                -> лендинг (publish/landing/index.html)
 *   /demo, /demo/*   -> платформа Next.js на 127.0.0.1:3000 (префикс срезается)
 *   остальное        -> платформа как есть (/_next/*, /api/*, /logo.svg ...)
 *
 * Слушает только 127.0.0.1 — наружу выходит исключительно через Tuna-туннель.
 * Без внешних зависимостей: только встроенный модуль http.
 */
import http from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOST = process.env.GATEWAY_HOST || '127.0.0.1'
const PORT = Number(process.env.GATEWAY_PORT || 8080)
const PLATFORM_HOST = '127.0.0.1'
const PLATFORM_PORT = Number(process.env.PLATFORM_PORT || 3000)
const LANDING_FILE = path.join(__dirname, 'landing', 'index.html')
const DEMO_PREFIX = '/demo'
/** Модуль водителя: PWA /driver/* и API /api/driver/* живут на :3102. */
const DRIVER_PORT = Number(process.env.DRIVER_API_PORT || 3102)
const DRIVER_WEB_PREFIX = '/driver'
const DRIVER_API_PREFIXES = [
  '/api/driver', '/api/1c',
  // карта и служебные каналы PWA: платформа таких маршрутов не имеет,
  // поэтому отдаём их модулю водителя, а не в Next платформы
  '/api/2gis', '/api/mapstyle', '/api/maptiles', '/api/demo', '/api/stand',
]
/** APK и установщики отдаём с того же домена, что и платформа. */
const DL_DIR = path.join(__dirname, 'portal', 'dl')
// Порты, доступные браузеру через query XTransformPort (real-time шина).
// Всё остальное проксируется только на платформу :3000.
const TRANSFORM_PORTS = new Set([3003])

function splitUrl (url) {
  const i = url.indexOf('?')
  if (i === -1) return { pathname: url, search: '' }
  return { pathname: url.slice(0, i), search: url.slice(i) }
}

/** Порт из ?XTransformPort=…, если он в белом списке; иначе null. */
function transformPort (search) {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('XTransformPort')
  if (!raw) return null
  const port = Number(raw)
  return Number.isInteger(port) && TRANSFORM_PORTS.has(port) ? port : null
}

/** Куда проксировать запрос: шина (?XTransformPort), модуль водителя или платформа. */
function proxyTarget (pathname, search) {
  const wsPort = transformPort(search)
  if (wsPort) return { host: '127.0.0.1', port: wsPort, path: pathname + search, isWs: true }
  if (isDriverPath(pathname)) {
    // Next с basePath /driver обслуживает и страницы, и route handlers под
    // префиксом. Наружу API остаётся корневым (/api/driver/...): APK и PWA
    // не меняют адреса, а шлюз добавляет /driver при проксировании.
    return { host: '127.0.0.1', port: DRIVER_PORT, path: driverUpstreamPath(pathname) + search, isWs: false }
  }
  return { host: PLATFORM_HOST, port: PLATFORM_PORT, path: upstreamPath(pathname) + search, isWs: false }
}

/** Внутренний путь Next-модуля водителя с учётом basePath. */
function driverUpstreamPath (pathname) {
  const isApi = DRIVER_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
  return isApi ? DRIVER_WEB_PREFIX + pathname : pathname
}

/** Модуль водителя: веб-версия и его API. */
function isDriverPath (pathname) {
  return pathname === DRIVER_WEB_PREFIX || pathname.startsWith(DRIVER_WEB_PREFIX + '/') ||
    DRIVER_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/** APK: только чтение файлов из portal/dl, без выхода за каталог. */
async function serveDownload (req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' })
    return res.end('Method Not Allowed')
  }
  const rel = pathname.slice('/dl/'.length)
  const file = path.resolve(DL_DIR, rel)
  if (!file.startsWith(path.resolve(DL_DIR) + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('Forbidden')
  }
  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error('not a file')
    const ext = path.extname(file).toLowerCase()
    const type = ext === '.apk'
      ? 'application/vnd.android.package-archive'
      : ext === '.zip'
        ? 'application/zip'
        : 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': info.size,
      'Content-Disposition': `attachment; filename="${path.basename(file)}"`,
      'Cache-Control': 'no-cache, must-revalidate',
    })
    if (req.method === 'HEAD') return res.end()
    createReadStream(file).pipe(res)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
  }
}

function isLandingPath (pathname) {
  return pathname === '/' || pathname === '/index.html' ||
    pathname === '/landing' || pathname === '/landing/'
}

function upstreamPath (pathname) {
  if (pathname === DEMO_PREFIX) return '/'
  if (pathname.startsWith(DEMO_PREFIX + '/')) return pathname.slice(DEMO_PREFIX.length)
  return pathname
}

async function serveLanding (req, res) {
  try {
    const info = await stat(LANDING_FILE)
    if (!info.isFile()) throw new Error('landing is not a file')
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache'
    })
    if (req.method === 'HEAD') return res.end()
    createReadStream(LANDING_FILE).pipe(res)
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Landing page is missing: ' + LANDING_FILE)
  }
}

function keepRedirectInsideDemo (location) {
  if (typeof location !== 'string') return location
  if (!location.startsWith('/')) return location
  if (location === DEMO_PREFIX || location.startsWith(DEMO_PREFIX + '/')) return location
  return DEMO_PREFIX + location
}

function proxyToPlatform (req, res, pathname, search) {
  const target = proxyTarget(pathname, search)
  const headers = { ...req.headers }
  headers.host = `${target.host}:${target.port}`
  headers['x-forwarded-for'] = req.socket.remoteAddress || ''
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'https'

  let finished = false
  const fail = (err) => {
    if (finished) return
    finished = true
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Upstream is unavailable on ' + target.host + ':' + target.port)
    } else {
      res.destroy()
    }
    console.error(new Date().toISOString(), 'proxy error', target.path, err && err.message)
  }

  const upstream = http.request(
    { host: target.host, port: target.port, method: req.method, path: target.path, headers },
    (up) => {
      const outHeaders = { ...up.headers }
      // sw.js модуля водителя должен управлять и корнем /driver (без слэша),
      // иначе браузер ограничивает scope каталогом /driver/ и офлайн-оболочка
      // не перехватывает главный экран установленной PWA.
      if (!target.isWs && pathname === DRIVER_WEB_PREFIX + '/sw.js') {
        outHeaders['service-worker-allowed'] = DRIVER_WEB_PREFIX
      }
      // Редиректы платформы держим внутри /demo; ответы шины и модуля водителя не трогаем:
      // /driver — самостоятельный раздел, его Location уже верный.
      if (!target.isWs && !isDriverPath(pathname)) {
        const location = keepRedirectInsideDemo(outHeaders.location)
        if (location !== outHeaders.location) outHeaders.location = location
      }
      res.writeHead(up.statusCode || 502, outHeaders)
      up.pipe(res)
      up.on('end', () => { finished = true })
      up.on('error', fail)
    }
  )
  upstream.on('error', fail)
  req.on('aborted', () => upstream.destroy())
  req.pipe(upstream)
}

/** WebSocket-upgrade для real-time шины через ?XTransformPort=3003. */
function proxyUpgrade (req, clientSocket, head) {
  const { pathname, search } = splitUrl(req.url || '/')
  const target = proxyTarget(pathname, search)
  if (!target.isWs) {
    clientSocket.destroy()
    return
  }
  const headers = { ...req.headers }
  headers.host = `${target.host}:${target.port}`
  headers['x-forwarded-for'] = req.socket.remoteAddress || ''
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'https'

  const upstream = http.request({
    host: target.host,
    port: target.port,
    method: req.method,
    path: target.path,
    headers,
  })
  upstream.on('upgrade', (upRes, upSocket, upHead) => {
    let response = 'HTTP/1.1 101 Switching Protocols\r\n'
    for (let i = 0; i < upRes.rawHeaders.length; i += 2) {
      response += `${upRes.rawHeaders[i]}: ${upRes.rawHeaders[i + 1]}\r\n`
    }
    response += '\r\n'
    clientSocket.write(response)
    if (upHead && upHead.length) clientSocket.write(upHead)
    if (head && head.length) upSocket.write(head)
    upSocket.pipe(clientSocket)
    clientSocket.pipe(upSocket)
    upSocket.on('error', () => clientSocket.destroy())
    clientSocket.on('error', () => upSocket.destroy())
  })
  upstream.on('error', () => clientSocket.destroy())
  upstream.end()
}

const server = http.createServer((req, res) => {
  const { pathname, search } = splitUrl(req.url || '/')
  if (pathname === '/dl') {
    res.writeHead(301, { Location: '/dl/' })
    return res.end()
  }
  if (pathname.startsWith('/dl/')) {
    void serveDownload(req, res, pathname)
    return
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && isLandingPath(pathname)) {
    return serveLanding(req, res)
  }
  return proxyToPlatform(req, res, pathname, search)
})

server.on('upgrade', proxyUpgrade)

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`port ${PORT} is already in use`)
  } else {
    console.error('gateway error', err)
  }
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log(`LogistikSITE gateway on http://${HOST}:${PORT}`)
  console.log(`  /         -> ${LANDING_FILE}`)
  console.log(`  /demo/*   -> http://${PLATFORM_HOST}:${PLATFORM_PORT}/*`)
  console.log(`  /driver/* -> http://127.0.0.1:${DRIVER_PORT}${DRIVER_WEB_PREFIX}/*`)
  console.log(`  /api/driver/*, /api/1c/* -> http://127.0.0.1:${DRIVER_PORT}`)
  console.log(`  /dl/*     -> ${DL_DIR}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
