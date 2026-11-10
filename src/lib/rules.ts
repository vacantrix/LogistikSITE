/**
 * Зеркало TripEventRules.kt (:core:common). ОБЯЗАНО совпадать с сервером —
 * тот же файл используется и клиентом (UI), и аплаерами демо-сервера.
 * Вынос в общий KMP-модуль — этап MVP (открытый вопрос №8 каркаса).
 */

export type EventTypeCode =
  | 'DEPARTURE'
  | 'ARRIVAL_LOADING'
  | 'LOADING_DONE'
  | 'REST_START'
  | 'REST_END'
  | 'ARRIVAL_UNLOADING'
  | 'UNLOADING_DONE'
  | 'TRIP_DONE'

export interface EventTypeMeta {
  code: EventTypeCode
  title: string
  opensInterval: boolean
  /** Точка маршрута, к которой событие привязывается по умолчанию. */
  wantsKind?: 'loading' | 'unloading'
}

/** 8 типов событий рейса — точечные и интервальные пары. */
export const EVENT_TYPES: EventTypeMeta[] = [
  { code: 'DEPARTURE', title: 'Выезд', opensInterval: false },
  { code: 'ARRIVAL_LOADING', title: 'Прибытие на погрузку', opensInterval: true, wantsKind: 'loading' },
  { code: 'LOADING_DONE', title: 'Погрузка завершена', opensInterval: false, wantsKind: 'loading' },
  { code: 'REST_START', title: 'Начать стоянку по тахографу', opensInterval: true },
  { code: 'REST_END', title: 'Завершить стоянку', opensInterval: false },
  { code: 'ARRIVAL_UNLOADING', title: 'Прибытие на выгрузку', opensInterval: true, wantsKind: 'unloading' },
  { code: 'UNLOADING_DONE', title: 'Выгрузка завершена', opensInterval: false, wantsKind: 'unloading' },
  { code: 'TRIP_DONE', title: 'Рейс завершён', opensInterval: false },
]

/** Явная закрывашка для каждой открывашки. */
export const EXPLICIT_CLOSER: Partial<Record<string, string>> = {
  ARRIVAL_LOADING: 'LOADING_DONE',
  REST_START: 'REST_END',
  ARRIVAL_UNLOADING: 'UNLOADING_DONE',
}

export const OPENERS = ['ARRIVAL_LOADING', 'REST_START', 'ARRIVAL_UNLOADING']

/**
 * Авто-закрытие (решение сессии): «Рейс завершён» закрывает всё,
 * любое другое событие закрывает открывашки старше себя.
 */
export function shouldClose(openedAtMs: number, newEventType: string, newEventAtMs: number): boolean {
  return newEventType === 'TRIP_DONE' || openedAtMs <= newEventAtMs
}

/** Этап для героя «Сейчас» на экране «Рейс». */
export function stageLabel(lastType?: string | null): string {
  switch (lastType) {
    case null:
    case undefined:
      return 'Рейс назначен'
    case 'DEPARTURE':
      return 'В пути'
    case 'ARRIVAL_LOADING':
      return 'На погрузке'
    case 'LOADING_DONE':
      return 'Погрузка завершена — в пути'
    case 'REST_START':
      return 'Стоянка по тахографу'
    case 'REST_END':
      return 'Стоянка завершена — в пути'
    case 'ARRIVAL_UNLOADING':
      return 'На выгрузке'
    case 'UNLOADING_DONE':
      return 'Выгрузка завершена'
    case 'TRIP_DONE':
      return 'Рейс завершён'
    default:
      return 'В пути'
  }
}

/** Пометки «водители для водителей» — цвета и названия категорий (Theme.kt). */
export const MARK_CATEGORIES: Record<string, { title: string; hex: string }> = {
  POTHOLE: { title: 'Яма', hex: '#F59E0B' },
  ROADWORKS: { title: 'Ремонт', hex: '#F97316' },
  POLICE: { title: 'ДПС', hex: '#3B82F6' },
  ACCIDENT: { title: 'Авария', hex: '#EF4444' },
  CLOSED: { title: 'Перекрыто', hex: '#6B7280' },
}

export const TTL_OPTIONS: { hours: 6 | 12 | 720; title: string }[] = [
  { hours: 6, title: '6 часов' },
  { hours: 12, title: '12 часов' },
  { hours: 720, title: '30 дней' },
]

/** Уровни пробок (канал 3). 0 — свободно … 3 — затор. */
export const TRAFFIC_LEVELS: { title: string; hex: string; speedHint: string }[] = [
  { title: 'Свободно', hex: '#22C55E', speedHint: '60+ км/ч' },
  { title: 'Замедление', hex: '#FACC15', speedHint: '35–55 км/ч' },
  { title: 'Пробка', hex: '#F97316', speedHint: '15–30 км/ч' },
  { title: 'Затор', hex: '#EF4444', speedHint: 'до 12 км/ч' },
]

/** Цвет балла пробок 1–10 (чип на карте). */
export function trafficScoreColor(score: number): string {
  if (score <= 3) return '#22C55E'
  if (score <= 5) return '#FACC15'
  if (score <= 7) return '#F97316'
  return '#EF4444'
}

/** Текстовая оценка балла. */
export function trafficScoreTitle(score: number): string {
  if (score <= 2) return 'дороги свободны'
  if (score <= 4) return 'местами замедления'
  if (score <= 6) return 'замедления на подъездах'
  if (score <= 8) return 'пробки на основных участках'
  return 'город стоит'
}
