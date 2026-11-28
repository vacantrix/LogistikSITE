/**
 * Сессия контура «Собственный транспорт АЭМЗ» — единая с платформой.
 *
 * Отдельных учётных записей диспетчерской (DispatchUser) больше нет: контур
 * подхватывает сессию платформы (подписанный JWT из Authorization: Bearer —
 * так работает встроенный iframe и «мост на телефон», — либо cookie aemz_session).
 * В контур пускаются только сотрудники (логист и администрация): у перевозчика
 * нет разделов собственного транспорта. Роль и имя читаются из платформенной
 * сессии, поэтому смена роли/имени на платформе действует сразу.
 */
import { getSessionUser as getPlatformSessionUser } from '@/lib/auth'

export type SessionUser = {
  id: string // id учётной записи платформы
  login: string
  fullName: string
  role: 'logist' | 'admin'
}

/** Сессия текущего запроса (null — не вошёл или перевозчик). */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const platformUser = await getPlatformSessionUser()
    if (!platformUser || platformUser.role === 'carrier') return null
    return {
      id: platformUser.id,
      login: platformUser.login,
      fullName: platformUser.name,
      role: platformUser.role === 'admin' ? 'admin' : 'logist',
    }
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
