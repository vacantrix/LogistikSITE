import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSessionToken, sessionCookieOptions, verifyPassword, SESSION_COOKIE } from '@/lib/auth'

export const dynamic = 'force-dynamic'

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

  const user = await db.user.findUnique({ where: { login } })
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 })
  }
  if (user.role === 'carrier' && user.carrierId) {
    const carrier = await db.carrier.findUnique({ where: { id: user.carrierId } })
    if (!carrier || !carrier.access) {
      return NextResponse.json({ error: 'Доступ перевозчика к площадке закрыт' }, { status: 403 })
    }
  }

  const session = { id: user.id, login: user.login, name: user.name, role: user.role as 'logist' | 'carrier', carrierId: user.carrierId }
  // Токен отдаётся и в ответе: во встроенном окне предпросмотра браузер может не
  // принимать куки — клиент хранит его и шлёт заголовком Authorization: Bearer.
  const token = createSessionToken(session)
  const res = NextResponse.json({ user: session, token })
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions)
  return res
}
