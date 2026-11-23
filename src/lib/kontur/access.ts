/**
 * Права диспетчерского контура внутри единой платформы.
 *
 * Диспетчерская сессия хранит пользователя DispatchUser, а должности и исключения
 * живут в платформенной таблице User. Связь — по логину (единый вход). Поэтому
 * проверка права идёт через платформенный allowedFor, а не по роли «logist/admin»:
 * администратор может выдать линейному логисту только часть разделов собственного
 * транспорта, и API это соблюдает.
 */
import { NextResponse } from 'next/server'
import { db as platformDb } from '@/lib/db'
import { allowedFor } from '@/lib/permissions'
import type { PermKey } from '@/lib/perm-catalog'
import { getSessionUser, type SessionUser } from '@/lib/kontur/auth'

/** Разделы собственного транспорта: достаточно любого, чтобы читать /api/state */
export const OWN_SECTION_KEYS: PermKey[] = [
  'section:ownRequests', 'section:ownAtisu', 'section:ownOccupancy',
  'section:ownPlanning', 'section:ownMonitor', 'section:ownDirectory', 'section:ownAudit',
]

export async function konturAllowed(user: SessionUser, key: PermKey): Promise<boolean> {
  const platform = await platformDb.user.findUnique({
    where: { login: user.login },
    select: { id: true, role: true },
  })
  if (!platform) return false
  return allowedFor({ id: platform.id, role: platform.role as 'admin' | 'logist' | 'carrier' }, key)
}

export async function konturAllowedAny(user: SessionUser, keys: PermKey[]): Promise<boolean> {
  for (const key of keys) {
    if (await konturAllowed(user, key)) return true
  }
  return false
}

/** Ответ 403 в едином формате диспетчерской */
export function forbidden(message = 'Нет права на это действие. Его выдаёт администрация в «Профилях и доступах»'): NextResponse {
  return NextResponse.json({ error: { code: 'FORBIDDEN', message } }, { status: 403 })
}

/** Проверка права для уже полученной сессии: null — можно, иначе готовый ответ 403 */
export async function denyUnless(user: SessionUser, key: PermKey): Promise<NextResponse | null> {
  return (await konturAllowed(user, key)) ? null : forbidden()
}

/** Текущий пользователь + право: готовый 401/403 или сессия */
export async function requireKonturPerm(key: PermKey): Promise<{ user: SessionUser } | NextResponse> {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: { code: 'AUTH', message: 'Нужен вход в платформу' } }, { status: 401 })
  }
  const denied = await denyUnless(user, key)
  if (denied) return denied
  return { user }
}
