/**
 * Единый словарь статусов контура логистики.
 *
 * Одна заявка проходит три системы:
 *  — платформа LogistikSITE (заявка, торги, документы, рейс);
 *  — диспетчерская LogistikSITEnow2 (планирование, рейсы, мониторинг);
 *  — 1С (учётная система предприятия).
 *
 * Здесь зафиксировано соответствие статусов, чтобы оба сайта и 1С говорили
 * об одном и том же состоянии. Менять словарь — только вместе с миграцией данных.
 */

/** Статусы заявки платформы */
export type PlatformStatus =
  | 'DRAFT' | 'PUBLISHED' | 'AWARDED' | 'DOCS_REVIEW' | 'AT_LOGIST'
  | 'QUARANTINE' | 'CONFIRMED' | 'CLOSED' | 'DELETED'

/** Статусы заказа диспетчерской (Order.status) */
export type DispatcherOrderStatus = 'new' | 'ready_to_plan' | 'planned' | 'quarantine'

/** Статусы, которыми обмениваемся с 1С (строковые коды, не менять без согласования) */
export type OneCStatus =
  | 'draft' | 'published' | 'in_work' | 'docs_review' | 'at_logist'
  | 'quarantine' | 'confirmed' | 'closed' | 'deleted'

/** Подписи для интерфейса и журнала */
export const CONTOUR_STATUS_LABELS: Record<PlatformStatus, string> = {
  DRAFT: 'Черновик',
  PUBLISHED: 'На площадке',
  AWARDED: 'Назначена перевозчику',
  DOCS_REVIEW: 'Документы на сверке',
  AT_LOGIST: 'У логиста',
  QUARANTINE: 'Карантин',
  CONFIRMED: 'Рейс выполняется',
  CLOSED: 'Рейс закрыт',
  DELETED: 'Удалена',
}

/**
 * Платформа → диспетчерская.
 * null — заявка ещё (или уже) не является объектом планирования:
 * черновик не передаём, удалённую — снимаем с планирования вручную.
 */
export const PLATFORM_TO_DISPATCHER: Record<PlatformStatus, DispatcherOrderStatus | null> = {
  DRAFT: null,
  PUBLISHED: 'new',
  AWARDED: 'ready_to_plan',
  DOCS_REVIEW: 'ready_to_plan',
  AT_LOGIST: 'ready_to_plan',
  QUARANTINE: 'quarantine',
  CONFIRMED: 'planned',
  CLOSED: 'planned',
  DELETED: null,
}

/**
 * Диспетчерская → платформа.
 * В диспетчерской нет удаления и черновика: обратный поток всегда возвращает
 * заявку в рабочий статус платформы.
 */
export const DISPATCHER_TO_PLATFORM: Record<DispatcherOrderStatus, PlatformStatus> = {
  new: 'PUBLISHED',
  ready_to_plan: 'AWARDED',
  planned: 'CONFIRMED',
  quarantine: 'QUARANTINE',
}

/** Платформа → 1С */
export const PLATFORM_TO_ONEC: Record<PlatformStatus, OneCStatus> = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  AWARDED: 'in_work',
  DOCS_REVIEW: 'docs_review',
  AT_LOGIST: 'at_logist',
  QUARANTINE: 'quarantine',
  CONFIRMED: 'confirmed',
  CLOSED: 'closed',
  DELETED: 'deleted',
}

/** 1С → платформа */
export const ONEC_TO_PLATFORM: Record<OneCStatus, PlatformStatus> = {
  draft: 'DRAFT',
  published: 'PUBLISHED',
  in_work: 'AWARDED',
  docs_review: 'DOCS_REVIEW',
  at_logist: 'AT_LOGIST',
  quarantine: 'QUARANTINE',
  confirmed: 'CONFIRMED',
  closed: 'CLOSED',
  deleted: 'DELETED',
}

/** Статус диспетчерской для статуса платформы; null — не передаётся */
export function toDispatcherStatus(status: string): DispatcherOrderStatus | null {
  return PLATFORM_TO_DISPATCHER[status as PlatformStatus] ?? null
}

/** Статус платформы для статуса диспетчерской; неизвестный — «На площадке» */
export function toPlatformStatus(status: string): PlatformStatus {
  return DISPATCHER_TO_PLATFORM[status as DispatcherOrderStatus] ?? 'PUBLISHED'
}

/** Код 1С для статуса платформы */
export function toOneCStatus(status: string): OneCStatus {
  return PLATFORM_TO_ONEC[status as PlatformStatus] ?? 'in_work'
}

/** Статус платформы для кода 1С; неизвестный код не двигает заявку */
export function fromOneCStatus(code: string): PlatformStatus | null {
  return ONEC_TO_PLATFORM[code as OneCStatus] ?? null
}

/** Человеческая подпись статуса (для писем, уведомлений, журнала) */
export function statusLabel(status: string): string {
  return CONTOUR_STATUS_LABELS[status as PlatformStatus] ?? status
}
