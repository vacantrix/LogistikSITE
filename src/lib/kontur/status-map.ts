/**
 * Единый словарь статусов контура логистики (сторона диспетчерской).
 * Должен совпадать с LogistikSITE/src/lib/status-map.ts.
 */

export type PlatformStatus =
  | 'DRAFT' | 'PUBLISHED' | 'AWARDED' | 'DOCS_REVIEW' | 'AT_LOGIST'
  | 'QUARANTINE' | 'CONFIRMED' | 'CLOSED' | 'DELETED'

export type DispatcherOrderStatus = 'new' | 'ready_to_plan' | 'planned' | 'quarantine'

export type OneCStatus =
  | 'draft' | 'published' | 'in_work' | 'docs_review' | 'at_logist'
  | 'quarantine' | 'confirmed' | 'closed' | 'deleted'

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

export const DISPATCHER_TO_PLATFORM: Record<DispatcherOrderStatus, PlatformStatus> = {
  new: 'PUBLISHED',
  ready_to_plan: 'AWARDED',
  planned: 'CONFIRMED',
  quarantine: 'QUARANTINE',
}

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

export function toDispatcherStatus(status: string): DispatcherOrderStatus | null {
  return PLATFORM_TO_DISPATCHER[status as PlatformStatus] ?? null
}

export function toPlatformStatus(status: string): PlatformStatus {
  return DISPATCHER_TO_PLATFORM[status as DispatcherOrderStatus] ?? 'PUBLISHED'
}

export function toOneCStatus(status: string): OneCStatus {
  return PLATFORM_TO_ONEC[status as PlatformStatus] ?? 'in_work'
}

export function fromOneCStatus(code: string): PlatformStatus | null {
  return ONEC_TO_PLATFORM[code as OneCStatus] ?? null
}

export function statusLabel(status: string): string {
  return CONTOUR_STATUS_LABELS[status as PlatformStatus] ?? status
}
