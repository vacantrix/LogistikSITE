#!/usr/bin/env node

/**
 * Маршрутизатор стенда на порту 3000 (единственный порт, куда внешний
 * реверс-прокси отдаёт трафик превью).
 *
 *   /kontur/*  → платформа «Контур 1С» (127.0.0.1:3001, basePath '/kontur')
 *   остальное  → приложение водителя «АЭМЗ Логистика» (127.0.0.1:3002)
 *
 * Обычный HTTP проксируется с сохранением заголовков; upgrade (WebSocket
 * HMR дев-режима) — туннелированием сырого сокета.
 *
 * Поднятие всего стенда одной командой: bash scripts/start-stack.sh
 */

const http = require('http')
const net = require('net')

const HOST = '127.0.0.1'
const PLATFORM_PORT = 3001
const DRIVER_PORT = 3002

function pickPort(url) {
  return url.startsWith('/kontur') ? PLATFORM_PORT : DRIVER_PORT
}

const server = http.createServer((req, res) => {
  const port = pickPort(req.url)
  const up = http.request(
    { host: HOST, port, path: req.url, method: req.method, headers: req.headers },
    (upRes) => {
      res.writeHead(upRes.statusCode, upRes.headers)
      upRes.pipe(res)
    },
  )
  up.on('error', (e) => {
    try {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`Сервис на порту ${port} недоступен: ${e.message}`)
    } catch {
      /* ответ уже начат — ничего не сделать */
    }
  })
  req.pipe(up)
})

// WebSocket (HMR): пробрасываем апгрейд как есть
server.on('upgrade', (req, socket, head) => {
  const port = pickPort(req.url)
  const up = net.connect(port, HOST)
  up.on('connect', () => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`
    }
    raw += '\r\n'
    up.write(raw)
    if (head && head.length) up.write(head)
    socket.pipe(up)
    up.pipe(socket)
  })
  up.on('error', () => socket.destroy())
  socket.on('error', () => up.destroy())
})

server.listen(3000, '0.0.0.0', () => {
  console.log('[router] :3000 → /kontur → :3001 (Контур 1С), остальное → :3002 (приложение водителя)')
})
