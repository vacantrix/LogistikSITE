/**
 * Серверная часть системы прав платформы (Task 111–113).
 * Каталог прав и дефолты — src/lib/perm-catalog.ts; здесь — хранение матрицы
 * в БД (модель RolePerm), персональные права пользователя (User.permOverrides)
 * и проверка прав в API-маршрутах.
 *
 * Два уровня прав:
 *  1. Матрица «роль × право» (RolePerm) — базовые права роли;
 *  2. Персональные права пользователя (User.permOverrides — JSON { ключ: allow|deny }) —
 *     выдаются администрацией в «Профилях и доступах» и перекрывают роль:
 *     так ведущий специалист (logist1) получает почти все права, а линейный
 *     сотрудник (logist2) — урезанный набор.
 *
 * Правило видимости: если права нет — функция целиком скрывается из интерфейса
 * (useCan на клиенте) и блокируется на сервере (allowedFor() в API).
 */
import { db } from '@/lib/db'
import type { Role } from '@/lib/auth'
import { PERM_DEFAULTS, permLabel, type PermKey } from '@/lib/perm-catalog'

export * from '@/lib/perm-catalog'

type Matrix = Map<string, boolean> // `${role}:${key}` → allowed

let cache: { matrix: Matrix; loadedAt: number } | null = null
const CACHE_TTL_MS = 5_000 // 5 секунд — правки из админки подхватываются почти сразу

/** Залить дефолты в пустую таблицу (идемпотентно: вызывается только при count === 0;
 *  skipDuplicates в SQLite не поддерживается — не нужен) */
async function seedDefaults(): Promise<void> {
  const rows = Object.entries(PERM_DEFAULTS).flatMap(([role, perms]) =>
    Object.entries(perms).map(([key, value]) => ({ role, key, allowed: value })))
  await db.rolePerm.createMany({ data: rows })
}

/**
 * Гарантировать наличие матрицы прав (первое обращение после старта заливает
 * дефолты) и вернуть кэшированную матрицу. Правки админом сбрасывают кэш.
 */
export async function permMatrix(): Promise<Matrix> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.matrix
  const count = await db.rolePerm.count()
  if (count === 0) await seedDefaults()
  const rows = await db.rolePerm.findMany()
  const matrix: Matrix = new Map()
  // отсутствующая строка = дефолт права (защита от частичной матрицы)
  for (const [role, perms] of Object.entries(PERM_DEFAULTS)) {
    for (const [key, def] of Object.entries(perms)) {
      matrix.set(`${role}:${key}`, def)
    }
  }
  for (const r of rows) matrix.set(`${r.role}:${r.key}`, r.allowed)
  cache = { matrix, loadedAt: Date.now() }
  return matrix
}

/** Есть ли у роли право (матрица без персональных оверрайдов) */
export async function allowed(role: Role, key: PermKey): Promise<boolean> {
  const matrix = await permMatrix()
  return matrix.get(`${role}:${key}`) ?? false
}

// ——— персональные права пользователя (Task 113) ———

export type PermOverride = 'allow' | 'deny'

/** Минимальные данные пользователя для проверки прав */
export interface PermUser {
  id: string
  role: Role
}

const overrideCache = new Map<string, { overrides: Partial<Record<PermKey, PermOverride>>; at: number }>()

/**
 * Персональные права пользователя из User.permOverrides (JSON).
 * Для обратной совместимости поле profileEditOwn (Task 112) считается
 * персональным правом profile:edit, если в JSON переопределения нет.
 */
export async function userPermOverrides(userId: string): Promise<Partial<Record<PermKey, PermOverride>>> {
  const hit = overrideCache.get(userId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.overrides
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { permOverrides: true, profileEditOwn: true },
  })
  const overrides: Partial<Record<PermKey, PermOverride>> = {}
  if (row?.permOverrides) {
    try {
      const parsed = JSON.parse(row.permOverrides) as Record<string, unknown>
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (value === 'allow' || value === 'deny') overrides[key as PermKey] = value
        }
      }
    } catch { /* битый JSON — работаем по роли */ }
  }
  if ((row?.profileEditOwn === 'allow' || row?.profileEditOwn === 'deny') && !overrides['profile:edit']) {
    overrides['profile:edit'] = row.profileEditOwn as PermOverride
  }
  overrideCache.set(userId, { overrides, at: Date.now() })
  return overrides
}

/** Сколько персональных прав выдано пользователю (для интерфейса администрации) */
export const countOverrides = (overrides: Partial<Record<PermKey, PermOverride>>): number =>
  Object.values(overrides).filter((v) => v === 'allow' || v === 'deny').length

/** Сброс кэша персональных прав (после правки админом) */
export function invalidateUserPermCache(userId?: string): void {
  if (userId) overrideCache.delete(userId)
  else overrideCache.clear()
}

/**
 * Эффективное право пользователя: персональное (allow/deny) приоритетнее роли.
 * Единственный источник истины для API-маршрутов.
 */
export async function allowedFor(user: PermUser, key: PermKey): Promise<boolean> {
  const overrides = await userPermOverrides(user.id)
  const own = overrides[key]
  if (own === 'allow') return true
  if (own === 'deny') return false
  return allowed(user.role, key)
}

/**
 * Эффективное право «Редактирование своего профиля» (Task 112/113): персональный
 * оверрайд (permOverrides или legacy-поле profileEditOwn) приоритетнее матрицы роли.
 */
export async function allowedOwnProfile(user: PermUser, legacyProfileEditOwn?: string | null): Promise<boolean> {
  const overrides = await userPermOverrides(user.id)
  const own = overrides['profile:edit']
  if (own === 'allow') return true
  if (own === 'deny') return false
  if (legacyProfileEditOwn === 'allow') return true
  if (legacyProfileEditOwn === 'deny') return false
  return allowed(user.role, 'profile:edit')
}

/** Сброс кэша после правки матрицы администрацией */
export function invalidatePermCache(): void {
  cache = null
}

/** Сообщение об отсутствии права для API-ответа */
export const permDenied = (key: PermKey): string =>
  `Функция «${permLabel(key)}» отключена для вашей учётной записи администратором`
