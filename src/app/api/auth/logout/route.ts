import { NextResponse } from 'next/server'
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** POST /api/auth/logout — выход: сбрасываем куку сессии (с теми же параметрами, что при входе) */
export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 })
  return res
}
