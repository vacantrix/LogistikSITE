// Константы из B6.6 ТЗ v5.0 (используются только эти значения, магические числа запрещены B14.1)
export const CONSTANTS = {
  CLOCK_SKEW_FLAG_MIN: 60, // порог флага clock_skew, минут
  CLOCK_SKEW_ALERT_COUNT: 3, // событий с clock_skew для systematic_skew
  CLOCK_SKEW_WINDOW_HOURS: 24,
  OUTBOX_STALE_HOURS: 24, // без ack -> stale
  OUTBOX_FAILED_HOURS: 72, // stale -> failed_delivery (не удаляется)
  OUTBOX_ACKED_RETENTION_DAYS: 30,
  LEGACY_ALERT_COUNT: 5, // legacy-событий от устройства за окно -> алерт + upgrade_required
  LEGACY_WINDOW_HOURS: 24,
  ACK_SLA_MIN: 30, // эскалация неподтверждённого назначения
  DOC_PENDING_ALERT_HOURS: 24, // алерт по недоставленным документам
  LOCAL_FILE_PURGE_DAYS: 7, // локальная очистка подтверждённых файлов
  CHAT_POLL_SEC: 5,
  ATI_POLL_SEC: 240,
  ATI_STALE_WARN_MIN: 10,
  ATI_STALE_RED_MIN: 60,
  MONITOR_POLL_SEC: 10, // период авто-обновления раздела «Мониторинг»
  ONLINE_STALE_MIN: 2, // нет телеметрии N минут -> «нет связи»
  NEAR_UNLOAD_KM: 500, // до места выгрузки меньше N км -> «скоро завершит рейс»
  GEO_TRACK_POINTS: 120, // точек трека на водителя для карты
  GEO_POINT_TTL_HOURS: 24, // сколько хранить историю точек
  SIM_TICK_MS: 4000, // интервал авто-движения в симуляторе, мс
  SIM_SPEED_MULT: 40, // ускорение времени в симуляторе (демо-режим)
  TZ_DISPLAY: 'Europe/Moscow',

  // —— Расчётный ETA до выгрузки (раздел «Мониторинг», оценочный прогноз) ——
  // Расстояние по GPS — по прямой; реальный пробег по дороге длиннее.
  ETA_ROAD_K: 1.2, // коэффициент извилистости дорог (пробег / расстояние по прямой)
  ETA_AVG_KMH: 55, // средняя скорость режима движения (гружёный пробег, км/ч)
  ETA_BREAK_DRIVE_H: 4.5, // периодичность обязательных отдыхов водителя, ч (505-МД-2005)
  ETA_BREAK_MIN: 45, // длительность обязательного отдыха, мин
} as const

// Лестница статусов B5.1
export const LADDER = [
  'assigned',
  'en_route_to_loading',
  'at_loading',
  'loaded',
  'en_route',
  'at_unloading',
  'unloaded',
  'completed',
] as const

export type LegStatus = (typeof LADDER)[number] | 'cancelled'

// Допустимые переходы B5.2 (cancelled — отдельная ветка, только логист для плеча)
export const TRANSITIONS: Record<string, string[]> = {
  assigned: ['en_route_to_loading'],
  en_route_to_loading: ['at_loading'],
  at_loading: ['loaded'],
  loaded: ['en_route'],
  en_route: ['at_unloading'],
  at_unloading: ['unloaded'],
  unloaded: ['completed'],
  completed: [],
  cancelled: [],
}

// Переходы, требующие локально прикреплённый артефакт (фото ТТН) — B5.2/B5.3
export const FILE_REQUIRED_STATUS: Record<string, string> = {
  loaded: 'tttn',
  unloaded: 'tttn',
}

export const STATUS_LABELS: Record<string, string> = {
  assigned: 'Назначен',
  en_route_to_loading: 'В пути на погрузку',
  at_loading: 'На погрузке',
  loaded: 'Погружен',
  en_route: 'В пути',
  at_unloading: 'На выгрузке',
  unloaded: 'Выгружен',
  completed: 'Завершён',
  cancelled: 'Отменён',
}

export const TRIP_STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  active: 'Активен',
  completed: 'Завершён',
  cancelled: 'Отменён',
}

export const ACK_LABELS: Record<string, string> = {
  pending: 'Ожидает подтверждения',
  acknowledged: 'Подтверждён водителем',
  problem: 'Водитель не может',
}

// —— Онлайн-мониторинг машины и водителя (раздел «Мониторинг», телеметрия из приложения водителя) ——

// Статус онлайн-мониторинга: то, что логист видит по своей технике в реальном времени.
// Часть приходит из приложения (телеметрия/лестница B5.1), часть выводит система
// (нет связи, приложение не установлено, в ремонте, скоро завершит).
export const MONITOR_STATUSES: Record<string, string> = {
  not_installed: 'Приложение не установлено', // приложения нет — на карте не виден
  offline: 'Нет связи', // приложение есть, но давно не выходило на связь
  idle: 'Простой без рейса', // на линии, но не назначен на рейс
  assigned: 'Назначен на рейс', // ждёт подтверждения/выезда
  en_route_loading: 'Едет на погрузку',
  at_loading: 'На погрузке',
  loaded: 'Погрузилась', // машина погрузилась
  en_route: 'Едет', // гружёный пробег по маршруту
  near_unload: 'Скоро завершит рейс', // до выгрузки < NEAR_UNLOAD_KM
  at_unload: 'На выгрузке',
  unloaded: 'Выгружен',
  trip_completed: 'Завершила рейс',
  empty_return: 'Возврат порожняком', // к базе без груза
  waiting_backhaul: 'Ожидает обратную загрузку', // машина ждёт обратку (связка с ATI.SU)
  breakdown: 'Сломалась по пути', // поломка в рейсе
  repair: 'В ремонте', // машина в ремонте (не в рейсе)
  rest: 'Отдых', // плановый отдых водителя
}

// Статусы, которые водитель выбирает в приложении вручную (отправляются телеметрией).
// near_unload и служебные (offline/not_installed/repair/idle) — системные.
export const MONITOR_DRIVER_STATUSES = [
  'assigned', 'en_route_loading', 'at_loading', 'loaded', 'en_route',
  'at_unload', 'unloaded', 'trip_completed', 'empty_return',
  'waiting_backhaul', 'breakdown', 'rest',
] as const

// Маппинг лестницы плеча B5.1 -> статус онлайн-мониторинга (один канал обновления)
export const LADDER_TO_MONITOR: Record<string, string> = {
  assigned: 'assigned',
  en_route_to_loading: 'en_route_loading',
  at_loading: 'at_loading',
  loaded: 'loaded',
  en_route: 'en_route',
  at_unloading: 'at_unload',
  unloaded: 'unloaded',
  completed: 'trip_completed',
}

// Цвета статусов мониторинга для точки-маркера (стиль DotWord: цвет несёт точка)
export const MONITOR_STATUS_DOT: Record<string, string> = {
  not_installed: 'bg-slate-300',
  offline: 'bg-slate-400',
  idle: 'bg-slate-500',
  assigned: 'bg-amber-500',
  en_route_loading: 'bg-sky-500',
  at_loading: 'bg-blue-500',
  loaded: 'bg-blue-600',
  en_route: 'bg-violet-500',
  near_unload: 'bg-cyan-500',
  at_unload: 'bg-cyan-600',
  unloaded: 'bg-emerald-500',
  trip_completed: 'bg-emerald-600',
  empty_return: 'bg-indigo-400',
  waiting_backhaul: 'bg-purple-500',
  breakdown: 'bg-red-500',
  repair: 'bg-red-400',
  rest: 'bg-amber-400',
}

// Статусы, требующие внимания логиста (тон в реестре)
export const MONITOR_STATUS_TONE: Record<string, 'danger' | 'warning'> = {
  breakdown: 'danger',
  repair: 'danger',
  offline: 'warning',
  rest: 'warning',
}

// —— KPI-плитки оперативной сводки «Мониторинга» (клик = фильтр реестра и карты) ——
// count(row) — какой строкой сводки считается объект; statuses — статусы группы.
export const MONITOR_KPIS: {
  id: string
  label: string
  statuses: string[]
  tone: 'slate' | 'navy' | 'violet' | 'blue' | 'cyan' | 'purple' | 'red' | 'emerald'
}[] = [
  { id: 'on_trip', label: 'в рейсе', statuses: ['assigned', 'en_route_loading', 'at_loading', 'loaded', 'en_route', 'near_unload', 'at_unload', 'empty_return'], tone: 'navy' },
  { id: 'in_motion', label: 'в движении', statuses: ['en_route', 'near_unload', 'en_route_loading', 'empty_return'], tone: 'violet' },
  { id: 'cargo_ops', label: 'грузовые операции', statuses: ['at_loading', 'loaded', 'at_unload'], tone: 'blue' },
  { id: 'near_unload', label: 'скоро завершат', statuses: ['near_unload'], tone: 'cyan' },
  { id: 'waiting_backhaul', label: 'ожидают обратку', statuses: ['waiting_backhaul'], tone: 'purple' },
  { id: 'attention', label: 'требуют внимания', statuses: ['breakdown', 'repair', 'rest'], tone: 'red' },
  { id: 'offline', label: 'нет связи', statuses: ['offline'], tone: 'slate' },
  { id: 'on_map', label: 'на карте', statuses: ['on_map'], tone: 'emerald' }, // особая группа: виден на карте
]

export const OUTCOME_LABELS: Record<string, string> = {
  applied: 'Применено',
  superseded: 'Заменено корректировкой логиста',
  needs_review: 'Требует разбора',
  rejected: 'Отклонено',
  skipped_conflict: 'Пропущено (конфликт)',
  duplicate: 'Дубликат (безопасно)',
}

// Фиксированные тексты B8.7
export const UI_TEXTS = {
  attachTttn: 'Прикрепите фото ТТН',
  noMemory: 'Недостаточно памяти, освободите место и повторите',
  cameraUnavailable: 'Камера недоступна, выберите фото',
  fileBroken: 'Файл повреждён, переснимите',
  relogin: 'Требуется повторный вход',
  notAssigned: 'Вы больше не назначены на этот рейс',
  pushUnavailable: 'Пуши недоступны',
  reshoot: 'Логист просит переснять ТТН',
  notSent: 'Не отправлено: N событий / M фото',
  rejectedWithReason: 'Отклонено',
  supersededByCorrection: 'Заменено корректировкой логиста',
  clockInaccurate: 'Время на устройстве неточное',
  otherDriverData: 'На устройстве есть неотправленные данные другого водителя (N)',
  lowSpace: 'Мало места для новых фото, отправьте накопленное или освободите память',
  upgradeRequired: 'Требуется обновление',
  altChannel: 'Загрузка через альтернативный канал',
  localPurge: 'Локальные файлы будут удалены через N дней',
  docsNotSent: 'Документы не отправлены — требуется действие',
  correctionCancel: 'Отмена корректировки',
  batchRejected: 'Отклонено пакетно после замены состава',
  downtimeRule: 'Правило простоев и их оплаты не утверждено (Q7). Решение принимает логист, основание фиксируется комментарием',
} as const
