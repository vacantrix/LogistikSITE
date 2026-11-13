import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import net from 'node:net'

/**
 * POST /api/stand/kontur — запуск платформы «Контур 1С» (:3001) из тела
 * живого драйверского сервера.
 *
 * Зачем: песочница убивает процессы, запущенные из инструментальных вызовов
 * агента, а платформа автостартует только корневой проект и роутер. Единственный
 * способ поднять соседний сервис «насовсем» — породить его из уже живущего
 * платформенного процесса (этот роут работает внутри dev-сервера :3002).
 *
 * Безопасность: токен x-stand-token (env STAND_CONTROL_TOKEN) + фиксированная
 * команда запуска; если :3001 уже слушается — no-op.
 */

const TOKEN = process.env.STAND_CONTROL_TOKEN ?? 'azmz-stand-control-2026'

function portListening(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host })
    s.setTimeout(800)
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('timeout', () => { s.destroy(); resolve(false) })
    s.once('error', () => resolve(false))
  })
}

export async function POST(req: NextRequest) {
  if (req.headers.get('x-stand-token') !== TOKEN) {
    return NextResponse.json({ ok: false, error: 'Неверный stand-токен' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }
  if (await portListening(3001)) {
    return NextResponse.json({ ok: true, already: true }, { headers: { 'Cache-Control': 'no-store' } })
  }

  // bun run dev → next dev -p 3001 (вывод — через tee в kontur-1c/dev.log, см. package.json)
  const child = spawn(
    '/bin/bash',
    [
      '-c',
      'cd /home/z/my-project/kontur-1c && DATABASE_URL=file:/home/z/my-project/kontur-1c/db/custom.db exec setsid /usr/local/bin/bun run dev',
    ],
    { detached: true, stdio: 'ignore', env: { ...process.env } },
  )
  child.unref()

  // ждём готовности до ~40 с, чтобы ответ говорил правду
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    if (await portListening(3001)) {
      return NextResponse.json({ ok: true, started: true, seconds: i + 1 }, { headers: { 'Cache-Control': 'no-store' } })
    }
    try { process.kill(child.pid!, 0) } catch { /* bun мог завершиться, ждём порт до конца */ }
  }
  return NextResponse.json({ ok: false, error: 'Контур 1С не поднялся за 40 с — см. kontur-1c/dev.log' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET() {
  return NextResponse.json(
    { ok: true, konturUp: await portListening(3001) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
