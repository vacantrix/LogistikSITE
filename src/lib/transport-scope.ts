/**
 * Специализация логиста по типу транспорта.
 *
 * Зачем: у парка две рабочие группы — тенты и бортовые машины (Камазы). Логист
 * должен видеть и брать в работу только свою группу, чтобы нагрузка делилась
 * между людьми, а чужие заявки не перехватывались.
 *
 * Правило хранится в User.transportScope:
 *   "all"        — все типы (администрация и универсальные логисты);
 *   "tent"       — только Тент;
 *   "board"      — только Борт (Камаз);
 *   "tent,board" — обе группы (эквивалент all).
 *
 * Проверка выполняется на сервере: и в списке заявок (requestWhereFor), и в
 * карточке/действиях (loadRequestFor). Интерфейс лишь повторяет серверное правило.
 */
import type { Prisma } from '@prisma/client'

export const TRANSPORT_SCOPES = ['tent', 'board'] as const
export type TransportScope = (typeof TRANSPORT_SCOPES)[number]

export const TRANSPORT_SCOPE_ALL = 'all'

/** Подписи для интерфейса и журнала */
export const TRANSPORT_SCOPE_LABELS: Record<TransportScope, string> = {
  tent: 'Тент',
  board: 'Борт (Камаз)',
}

/** Соответствие области доступа значению Request.truckType */
export const SCOPE_TO_TRUCK_TYPE: Record<TransportScope, string> = {
  tent: 'Тент',
  board: 'Борт',
}

const TRUCK_TYPE_TO_SCOPE: Record<string, TransportScope> = {
  Тент: 'tent',
  Борт: 'board',
}

const SCOPE_ORDER: TransportScope[] = ['tent', 'board']

/** Разобрать сохранённое значение. null — ограничений нет (все типы). */
export function parseTransportScope(raw: string | null | undefined): Set<TransportScope> | null {
  if (!raw || raw === TRANSPORT_SCOPE_ALL) return null
  const set = new Set<TransportScope>()
  for (const part of raw.split(',')) {
    const v = part.trim().toLowerCase()
    if ((TRANSPORT_SCOPES as readonly string[]).includes(v)) set.add(v as TransportScope)
  }
  return set.size > 0 ? set : null
}

/**
 * Проверить и нормализовать значение из API.
 * Возвращает "all" | "tent" | "board" | "tent,board" либо null, если значение недопустимо.
 */
export function normalizeTransportScope(input: unknown): string | null {
  if (input === undefined || input === null || input === '' || input === TRANSPORT_SCOPE_ALL) return TRANSPORT_SCOPE_ALL
  const parts: unknown[] = Array.isArray(input) ? input : String(input).split(',')
  const set = new Set<TransportScope>()
  for (const part of parts) {
    const v = String(part).trim().toLowerCase()
    if (!v) continue
    if (!(TRANSPORT_SCOPES as readonly string[]).includes(v)) return null
    set.add(v as TransportScope)
  }
  if (set.size === 0) return TRANSPORT_SCOPE_ALL
  if (set.size === SCOPE_ORDER.length) return TRANSPORT_SCOPE_ALL
  return SCOPE_ORDER.filter((s) => set.has(s)).join(',')
}

/** Входит ли тип транспорта заявки в область доступа логиста */
export function scopeAllows(raw: string | null | undefined, truckType: string | null | undefined): boolean {
  const scope = parseTransportScope(raw)
  if (!scope) return true
  const kind = truckType ? TRUCK_TYPE_TO_SCOPE[truckType] : undefined
  // незнакомый тип при ограниченной области не показываем: лучше спросить администратора,
  // чем случайно отдать логисту чужую группу
  return kind ? scope.has(kind) : false
}

/** Фильтр Prisma для списка заявок: пустой объект — ограничений нет */
export function requestScopeWhere(raw: string | null | undefined): Prisma.RequestWhereInput {
  const scope = parseTransportScope(raw)
  if (!scope) return {}
  const types = SCOPE_ORDER.filter((s) => scope.has(s)).map((s) => SCOPE_TO_TRUCK_TYPE[s])
  return { truckType: { in: types } }
}

/** Человеческая подпись области доступа */
export function transportScopeLabel(raw: string | null | undefined): string {
  const scope = parseTransportScope(raw)
  if (!scope) return 'Все типы транспорта'
  return SCOPE_ORDER.filter((s) => scope.has(s)).map((s) => TRANSPORT_SCOPE_LABELS[s]).join(' + ')
}
