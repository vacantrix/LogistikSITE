import { NextResponse } from 'next/server'
import { SESSION_COOKIE as PLATFORM_SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'
import { SESSION_COOKIE, SESSION_COOKIE_PATH } from '@/lib/kontur/auth'

export const dynamic = 'force-dynamic'

// Выход: гасим cookie диспетчерской и cookie единой сессии платформы,
// иначе SSO сразу вернёт пользователя обратно в /kontur.
export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: SESSION_COOKIE_PATH, maxAge: 0 })
  res.cookies.set(PLATFORM_SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 })
  return res
}
