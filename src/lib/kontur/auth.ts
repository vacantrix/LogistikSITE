// Сессия кабинета прототипа (демо-контур): cookie с userId, пароли — sha256.
// Ролевая система по мотивам LogistikSITE, адаптирована: логисты и администрация.
import { createHash, randomBytes } from 'crypto'
import { cookies, headers } from 'next/headers'
import { getSessionUser as getPlatformSessionUser } from '@/lib/auth'
import { db } from '@/lib/kontur/db'
import { SESSION_COOKIE, SESSION_COOKIE_PATH } from '@/lib/kontur/session-constants'

// Имя cookie отличается от платформы LogistikSITE (aemz_session): обе
// системы живут на одном домене, и сессии не должны перетирать друг друга.
export { SESSION_COOKIE, SESSION_COOKIE_PATH }
/** Единый демо-пароль контура (только прототип, не продакшен) */
export const DEMO_PASSWORD = 'demo2026'

export function hashPassword(password: string): string {
  return createHash('sha256').update(`aemz:${password}`).digest('hex')
}

export type SessionUser = {
  id: string
  login: string
  fullName: string
  position: string
  role: 'logist' | 'admin'
  phone: string | null
  email: string | null
}

export function toSessionUser(u: {
  id: string; login: string; fullName: string; position: string; role: string; phone: string | null; email: string | null
}): SessionUser {
  return {
    id: u.id,
    login: u.login,
    fullName: u.fullName,
    position: u.position,
    role: u.role === 'admin' ? 'admin' : 'logist',
    phone: u.phone,
    email: u.email,
  }
}

/**
 * Учётки платформы и Контура — одна система. Если сотрудник платформы ещё не
 * заведён в DispatchUser, создаём зеркало при первом обращении; имя и роль
 * подтягиваем из платформы, чтобы понижение/повышение действовало сразу.
 * Пароль зеркала случайный: вход в Контур отдельным паролем больше не нужен.
 */
async function linkPlatformUser(platformUser: {
  id: string; login: string; name: string; role: 'admin' | 'logist' | 'carrier'
}): Promise<SessionUser | null> {
  if (platformUser.role === 'carrier') return null
  let linked = await db.user.findUnique({ where: { login: platformUser.login } })
  if (!linked) {
    try {
      linked = await db.user.create({
        data: {
          login: platformUser.login,
          fullName: platformUser.name,
          position: platformUser.role === 'admin' ? 'Администратор платформы' : 'Логист АЭМЗ',
          role: platformUser.role,
          passwordHash: hashPassword(randomBytes(24).toString('hex')),
        },
      })
    } catch {
      // параллельный запрос уже создал зеркало — читаем его
      linked = await db.user.findUnique({ where: { login: platformUser.login } })
    }
  } else if (linked.fullName !== platformUser.name || linked.role !== platformUser.role) {
    linked = await db.user.update({
      where: { id: linked.id },
      data: { fullName: platformUser.name, role: platformUser.role },
    })
  }
  return linked ? toSessionUser(linked) : null
}

/**
 * Текущий пользователь (null — не вошёл). Каналы сессии:
 * 1) Authorization: Bearer <userId> — запасной канал для встроенного превью (iframe):
 *    браузеры блокируют сторонние cookie, cookie-сессия в iframe не сохраняется;
 * 2) cookie диспетчерской — обычное открытие /kontur в отдельной вкладке;
 * 3) cookie платформы aemz_session — единый вход: пользователь вошёл на /,
 *    а /kontur подхватывает его сессию по логину (роли admin/logist).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const h = await headers()
  const auth = h.get('authorization')
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined
  if (bearer) {
    // 1) старый токен диспетчерской — это id пользователя DispatchUser;
    const byId = await db.user.findUnique({ where: { id: bearer } })
    if (byId) return toSessionUser(byId)

    // 2) токен единой платформы — подписанный JWT этой вкладки. Он главнее
    //    куки: в браузере может остаться старая сессия диспетчерской, но
    //    активная учётка платформы не должна из-за неё «переобуваться».
    const platformByToken = await getPlatformSessionUser()
    return platformByToken ? linkPlatformUser(platformByToken) : null
  }

  const jar = await cookies()
  const cookieId = jar.get(SESSION_COOKIE)?.value
  if (cookieId) {
    const byCookie = await db.user.findUnique({ where: { id: cookieId } })
    if (byCookie) return toSessionUser(byCookie)
  }

  // Единый вход с платформой: проверяем её подписанную сессию и находим
  // диспетчерского пользователя по тому же логину. Перевозчиков в контур
  // не пускаем — у них нет ролей диспетчерской.
  try {
    const platformUser = await getPlatformSessionUser()
    return platformUser ? linkPlatformUser(platformUser) : null
  } catch {
    return null
  }
}

/** Короткое имя для подписи в аудит: «Фамилия И.О.» */
export function shortName(fullName: string): string {
  const [f, i, o] = fullName.split(' ')
  if (!i) return f
  return `${f} ${i[0]}.${o ? `${o[0]}.` : ''}`
}
