import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'
import { hashPassword, toSessionUser, SESSION_COOKIE, SESSION_COOKIE_PATH } from '@/lib/kontur/auth'
import { ensureUsers } from '@/lib/kontur/seed'

export const dynamic = 'force-dynamic'

// Вход в кабинет прототипа: логин + пароль (демо-контур, sha256)
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const login = typeof body?.login === 'string' ? body.login.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!login || !password) {
    return NextResponse.json({ error: { message: 'Укажите логин и пароль' } }, { status: 400 })
  }
  await ensureUsers()
  const user = await db.user.findUnique({ where: { login } })
  if (!user || user.passwordHash !== hashPassword(password)) {
    return NextResponse.json({ error: { message: 'Неверный логин или пароль' } }, { status: 401 })
  }
  const res = NextResponse.json(toSessionUser(user))
  res.cookies.set(SESSION_COOKIE, user.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: SESSION_COOKIE_PATH,
    maxAge: 60 * 60 * 24 * 7,
  })
  return res
}
