import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSessionToken, sessionCookieOptions, verifyPassword, SESSION_COOKIE } from '@/lib/auth'
import { plog } from '@/lib/platform-log'

export const dynamic = 'force-dynamic'

/**
 * Защита от подбора пароля: после MAX_FAILS неудачных попыток на логин с одного адреса
 * вход по нему закрыт на LOCK_MS. Счётчик в памяти процесса — платформа работает одним
 * сервером; при перезапуске он обнуляется, это допустимо.
 */
const MAX_FAILS = 8
const LOCK_MS = 15 * 60_000
const fails = new Map<string, { count: number; until: number }>()

function clientKey(req: NextRequest, login: string): string {
  // последнее значение X-Forwarded-For дописывает наш прокси; первое клиент может подставить сам
  const ip = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() || 'local'
  return `${ip}|${login}`
}

/**
 * POST /api/auth/login — вход по логину и паролю.
 * { login, password } → HttpOnly-кука сессии.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const login = typeof body?.login === 'string' ? body.login.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!login || !password) {
    return NextResponse.json({ error: 'Укажите логин и пароль' }, { status: 400 })
  }

  const key = clientKey(req, login)
  const lock = fails.get(key)
  if (lock && lock.count >= MAX_FAILS && lock.until > Date.now()) {
    const min = Math.ceil((lock.until - Date.now()) / 60_000)
    return NextResponse.json({ error: `Слишком много неудачных попыток входа — повторите через ${min} мин` }, { status: 429 })
  }

  const user = await db.user.findUnique({ where: { login } })
  if (!user || !verifyPassword(password, user.passwordHash)) {
    const prev = lock && lock.until > Date.now() ? lock.count : 0
    fails.set(key, { count: prev + 1, until: Date.now() + LOCK_MS })
    if (fails.size > 5000) fails.clear() // защита памяти от перебора по множеству логинов
    // журнал платформы (Task 76): неудачная попытка входа — предупреждение
    await plog({
      level: 'WARN', type: 'LOGIN_FAILED', source: 'auth/login',
      actor: { login }, message: `Неудачная попытка входа: логин «${login}»`,
    })
    return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 })
  }
  if (user.role === 'carrier' && user.carrierId) {
    const carrier = await db.carrier.findUnique({ where: { id: user.carrierId } })
    if (!carrier || !carrier.access) {
      await plog({
        level: 'WARN', type: 'LOGIN_DENIED', source: 'auth/login',
        actor: { login, name: user.name, role: user.role },
        message: `Вход отклонён: доступ перевозчика «${carrier?.name ?? login}» закрыт`,
      })
      return NextResponse.json({ error: 'Доступ перевозчика к площадке закрыт' }, { status: 403 })
    }
  }

  const session = { id: user.id, login: user.login, name: user.name, role: user.role as 'admin' | 'logist' | 'carrier', carrierId: user.carrierId }
  // Токен отдаётся и в ответе: во встроенном окне предпросмотра браузер может не
  // принимать куки — клиент хранит его и шлёт заголовком Authorization: Bearer.
  const token = createSessionToken(session, user.sessionVersion)
  fails.delete(key)
  const res = NextResponse.json({ user: session, token })
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions)
  // журнал платформы (Task 76): вход в систему
  await plog({
    type: 'LOGIN', source: 'auth/login', actor: { login: user.login, name: user.name, role: user.role },
    message: `Вход в систему: ${user.name} (${user.role === 'admin' ? 'администрация' : user.role === 'logist' ? 'логист АЭМЗ' : 'перевозчик'})`,
  })
  return res
}
