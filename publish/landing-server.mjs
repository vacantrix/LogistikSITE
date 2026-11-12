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

/** Куда проксировать запрос: шина (?XTransformPort) или платформа. */
function proxyTarget (pathname, search) {
  const wsPort = transformPort(search)
  if (wsPort) return { host: '127.0.0.1', port: wsPort, path: pathname + search, isWs: true }
  return { host: PLATFORM_HOST, port: PLATFORM_PORT, path: upstreamPath(pathname) + search, isWs: false }
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
      // Редиректы платформы держим внутри /demo; ответы шины не трогаем.
      if (!target.isWs) {
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
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
