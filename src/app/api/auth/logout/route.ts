import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/logout — выход.
 * Кука сессии одна на весь браузер (общая для всех вкладок), поэтому сбрасываем её
 * только когда токен запроса совпадает с кукой — иначе выход из аккаунта одной
 * вкладки (мультиаккаунт, Task 74) выбросил бы другой аккаунт, чей токен сейчас
 * лежит в общей куке. Если заголовка нет (браузер работает только на куках) —
 * сбрасываем как прежде.
 */
export async function POST(req: NextRequest) {
  const authz = req.headers.get('authorization')
  const headerToken = authz?.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : null
  const cookieToken = req.cookies.get(SESSION_COOKIE)?.value

  const res = NextResponse.json({ ok: true })
  if (!headerToken || headerToken === cookieToken) {
    res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 })
  }
  return res
}
