import { NextRequest, NextResponse } from 'next/server'
import { readSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'
import { SESSION_COOKIE as DISPATCH_SESSION_COOKIE, SESSION_COOKIE_PATH as DISPATCH_SESSION_COOKIE_PATH } from '@/lib/kontur/session-constants'
import { plog } from '@/lib/platform-log'

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
    // Единый выход: платформа и Контур используют разные cookie, поэтому
    // гасим обе. Иначе после выхода из платформы /kontur остался бы открыт.
    res.cookies.set(DISPATCH_SESSION_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      path: DISPATCH_SESSION_COOKIE_PATH,
      maxAge: 0,
    })
  }
  // журнал платформы (Task 76): выход — кто вышел, разбираем из подписанного токена
  const session = readSessionToken(headerToken ?? cookieToken)
  if (session) {
    await plog({
      type: 'LOGOUT', source: 'auth/logout',
      actor: { login: session.login, name: session.name, role: session.role },
      message: `Выход из системы: ${session.name}`,
    })
  }
  return res
}
