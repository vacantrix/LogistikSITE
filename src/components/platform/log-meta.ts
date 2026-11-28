/**
 * Общие метаданные записей журнала платформы — используются разделами
 * «Журнал событий» и «Логи платформы» (янтарная строка «Функции»).
 *
 * Уровни — точка и слово в едином стиле статусов платформы; типы событий —
 * русскими подписями, чтобы журнал читался без знания внутренних кодов.
 * Действия диспетчерской (собственный транспорт) приходят кодами вида
 * «driver.created», «leg.status» — они переводятся по словарю объектов.
 */
import type { PlatformLogLevel, TechLogKind } from '@/lib/types'

/** Уровни точкой и словом: цветной текст — у предупреждений и ошибок */
export const LEVEL_META: Record<PlatformLogLevel, { label: string; dot: string; tone?: 'warning' | 'danger' }> = {
  INFO: { label: 'Событие', dot: 'bg-sky-500' },
  WARN: { label: 'Внимание', dot: 'bg-amber-500', tone: 'warning' },
  ERROR: { label: 'Ошибка', dot: 'bg-red-500', tone: 'danger' },
}

/** Виды строк технической консоли («Логи платформы») */
export const TECH_KIND_META: Record<TechLogKind, { label: string; hint: string }> = {
  api: { label: 'API', hint: 'Вызов API платформы' },
  server: { label: 'СРВ', hint: 'Событие серверной части' },
  client: { label: 'КЛТ', hint: 'Событие браузера' },
  system: { label: 'СИС', hint: 'Системное событие' },
}

/** Где произошло действие: платформа или диспетчерская (собственный транспорт) */
export const CONTOUR_META: Record<string, { label: string; hint: string }> = {
  platform: { label: 'Платформа', hint: 'Действие в контуре привлечённого транспорта' },
  dispatcher: { label: 'Диспетчерская', hint: 'Действие в контуре собственного транспорта' },
}

export const contourLabel = (contour: string): string =>
  CONTOUR_META[contour]?.label ?? contour

/** Формат времени журнала: с секундами — события идут плотно */
export const fmtLogTime = (iso: string): string =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Формат для консоли логов: только время с секундами (даты — в заголовке ленты) */
export const fmtLogClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Кто выполнил действие: имя, логин или система */
export const actorLabel = (e: { actorName?: string | null; actorLogin?: string | null }): string =>
  e.actorName?.trim() || e.actorLogin?.trim() || 'Система'

/** Инициалы актёра для кружка в строке журнала */
export const actorInitials = (e: { actorName?: string | null; actorLogin?: string | null }): string => {
  const label = actorLabel(e)
  if (label === 'Система') return 'СХ'
  const parts = label.replace(/[()]/g, ' ').split(/[\s.]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '—'
}

/** Русские подписи типов событий платформы — журнал читается без знания кодов */
export const TYPE_LABEL: Record<string, string> = {
  // вход и выход
  LOGIN: 'Вход', LOGIN_FAILED: 'Неудачный вход', LOGIN_DENIED: 'Вход отклонён', LOGIN_LOCKOUT: 'Блокировка входа', LOGOUT: 'Выход',
  // заявки и торги
  REQUEST_CREATED: 'Заявка опубликована', REQUEST_UPDATED: 'Заявка отредактирована', REQUEST_DELETED: 'Заявка удалена',
  REQUEST_DRAFTED: 'Черновик заявки', REQUESTS_BULK_ASSIGNED: 'Массовое назначение',
  BID_PLACED: 'Ставка', BID_WITHDRAWN: 'Отзыв ставки', DEADLINE_EXTENDED: 'Срок продлён',
  DIRECT_OFFER: 'Прямое назначение', RATE_RAISED: 'Ставка повышена',
  CREW_ASSIGNED: 'Экипаж', CREW_APPROVED: 'Экипаж утверждён',
  // документы и рейсы
  DOCS_VERIFIED: 'Проверка документов', OCR_FAILED: 'Сбой распознавания',
  TRIP_CONFIRMED: 'Сверка подтверждена', DOCS_RETURNED: 'Возврат на доработку',
  TRIP_CLOSED: 'Рейс закрыт', ETRN_1C: 'Накладная получена',
  EDO_PACK_CREATED: 'Комплект документов', EDO_SIGNED: 'Документ подписан',
  DIADOC_SENT: 'Накладная отправлена', DIADOC_STATUS: 'Статус накладной', DIADOC_ERROR: 'Ошибка накладной',
  // контакты и сделки
  CONTACT_CREATED: 'Контакт добавлен', CONTACT_UPDATED: 'Контакт изменён', CONTACT_DELETED: 'Контакт удалён',
  DEAL_CREATED: 'Сделка добавлена', DEAL_UPDATED: 'Сделка изменена', DEAL_DELETED: 'Сделка удалена',
  // справочники
  DIRECTORY_ENTRY_CREATED: 'Запись справочника', DIRECTORY_ENTRY_UPDATED: 'Правка справочника', DIRECTORY_ENTRY_DELETED: 'Запись удалена',
  DIRECTORY_BULK_IMPORT: 'Массовый импорт', DIRECTORY_PHOTO_ADDED: 'Фото добавлено', DIRECTORY_PHOTO_DELETED: 'Фото удалено',
  AGENT_NOTIFIED: 'Уведомление агенту',
  INTAKE_SAVED: 'Данные для сверки',
  // ИИ-помощник
  AI_QUERY: 'Запрос к ИИ', AI_SEARCH: 'Поиск ИИ',
  AI_SESSION_CREATED: 'Сессия ИИ создана', AI_SESSION_DELETED: 'Сессия ИИ удалена',
  AI_FAVORITE_ADDED: 'В избранное ИИ', AI_FAVORITE_REMOVED: 'Избранное ИИ убрано',
  AI_SAVED_MESSAGE_ADDED: 'Сообщение сохранено', AI_SAVED_MESSAGE_DELETED: 'Сообщение удалено',
  AI_RIGHTS_CHANGED: 'Права ИИ изменены', AI_REPORT_DOWNLOADED: 'Отчёт ИИ скачан',
  // служебное
  ACCESS_CHANGED: 'Права изменены', ACCESS_MIGRATED: 'Перенос прав',
  SETTINGS_CHANGED: 'Настройки платформы',
  NN_SETTINGS_CHANGED: 'Настройки распознавания', NN_ACTION: 'Действие PaddleOCR',
  NN_TEMPLATE_SAVED: 'Шаблон распознавания', NN_TEMPLATE_DELETED: 'Шаблон удалён',
  FILE_SAVED: 'Файл сохранён', FILE_DOWNLOADED: 'Файл скачан',
  DOC_CHECKED: 'Проверка документа', REPORT_EXPORTED: 'Выгрузка отчёта',
  NOTIFICATIONS_READ: 'Уведомления прочитаны', '1C_PING': 'Проверка связи 1С', '1C_PING_DENIED': 'Проверка 1С отклонена',
  DRIVER_APP_CHANGED: 'Приложение водителя',
  AI_LIST_CLEARED: 'Список ИИ очищен',
  REQUESTS_BULK_ASSIGNED_DENIED: 'Массовое назначение отклонено',
  DIRECTORY_ENTRY_DENIED: 'Действие со справочником отклонено',
  REPORT_EXPORTED_DENIED: 'Выгрузка отчёта отклонена',
  SERVER_ERROR: 'Сбой сервера', ACTION_FAILED: 'Сбой действия', FINALIZE_FAILED: 'Сбой итогов', CLIENT_ERROR: 'Ошибка интерфейса',
}

/** Объекты диспетчерской (собственный транспорт) — коды из аудита контура */
const KONTUR_OBJECTS: Record<string, string> = {
  order: 'Заявка 1С', leg: 'Рейс', trip: 'Рейс', status_event: 'Статус рейса',
  driver: 'Водитель', vehicle: 'Тягач', trailer: 'Прицеп',
  plan_entry: 'Событие плана', ati_deal: 'Сделка ATI.SU', call_task: 'Задание звонка',
  vehicle_binding: 'Привязка состава', file: 'Файл',
}

/** Поля аудита диспетчерской — что именно сделали с объектом */
const FIELD_LABEL: Record<string, string> = {
  created: 'добавление', updated: 'правка', deleted: 'удаление',
  status: 'статус', state: 'состояние', assigned: 'назначение',
  confirmed: 'подтверждение', linked: 'привязка', rejected: 'отклонение',
  quarantined: 'карантин', planned: 'план', corrected: 'коррекция',
  closed: 'закрытие', cancelled: 'отмена', synced: 'синхронизация',
}

/** Подпись типа события: словарь платформы → диспетчерская → исходный код */
export function typeLabelOf(type: string): string {
  if (TYPE_LABEL[type]) return TYPE_LABEL[type]
  const dot = type.indexOf('.')
  if (dot > 0) {
    const obj = KONTUR_OBJECTS[type.slice(0, dot)]
    if (obj) return `${obj}: ${FIELD_LABEL[type.slice(dot + 1)] ?? type.slice(dot + 1)}`
  }
  return KONTUR_OBJECTS[type] ?? type
}
