/**
 * Серверная часть системы прав платформы (Task 111).
 * Каталог прав и дефолты — src/lib/perm-catalog.ts; здесь — хранение матрицы
 * в БД (модель RolePerm) и проверка прав в API-маршрутах.
 *
 * Правило видимости: если у роли нет права — функция целиком скрывается из
 * интерфейса (useCan на клиенте) и блокируется на сервере (allowed() в API).
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

/** Есть ли у роли право (серверная проверка — единственный источник истины) */
export async function allowed(role: Role, key: PermKey): Promise<boolean> {
  const matrix = await permMatrix()
  return matrix.get(`${role}:${key}`) ?? false
}

/**
 * Эффективное право «Редактирование своего профиля» (Task 112): персональное
 * разрешение администратора (User.profileEditOwn: 'allow' | 'deny' | null) имеет
 * приоритет над матрицей роли; без персонального — право роли из «Права доступа».
 */
export async function allowedOwnProfile(role: Role, override?: string | null): Promise<boolean> {
  if (override === 'allow') return true
  if (override === 'deny') return false
  return allowed(role, 'profile:edit')
}

/** Сброс кэша после правки матрицы администрацией */
export function invalidatePermCache(): void {
  cache = null
}

/** Сообщение об отсутствии права для API-ответа */
export const permDenied = (key: PermKey): string =>
  `Функция «${permLabel(key)}» отключена для вашей роли администратором`
