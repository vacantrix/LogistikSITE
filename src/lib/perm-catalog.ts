/**
 * Каталог прав платформы — чистый модуль без серверных зависимостей:
 * импортируется и на клиенте (раздел «Профили и доступы», подсказки), и на сервере,
 * и в сид-скриптах. Проверка прав — в src/lib/permissions.ts.
 *
 * Модель доступа «контур → должность → исключение»:
 *  1. Контур — роль учётной записи (администрация / логист / перевозчик). Определяет,
 *     какие права для пользователя вообще существуют: право вне контура не выдаётся
 *     и всегда ложно (админу нельзя дать «Создание черновиков», перевозчику — «Отчёты»).
 *  2. Должность — именованный набор прав внутри контура (AccessTemplate).
 *     У каждого пользователя ровно одна; без неё действует должность контура по умолчанию.
 *  3. Исключение — личное разрешение или запрет одного права сверх должности
 *     (PermException): с причиной и, по возможности, сроком.
 */

/** Ключи прав */
export type PermKey =
  // — Заявки и торги (логист) —
  | 'draft:create'
  | 'draft:edit'
  | 'draft:delete'
  | 'request:publish'
  | 'request:extend'
  | 'request:raise'
  | 'request:offer'
  | 'request:delete'
  | 'request:quarantine'
  // — Торги (перевозчик) —
  | 'bid:submit'
  // — Документы, экипажи, рейсы —
  | 'verify:decide'
  | 'docs:upload'
  | 'docs:request'
  | 'crew:assign'
  | 'trip:close'
  // — ЭДО —
  | 'edo:sync'
  | 'edo:send'
  | 'edo:sign'
  // — Справочники —
  | 'directory:addManual'
  | 'directory:edit'
  | 'notify:agent'
  // — Собственный транспорт (диспетчерский контур) —
  | 'own:process'
  | 'own:assign'
  | 'own:plan'
  | 'own:atisu'
  | 'own:directory'
  // — Разделы и профиль —
  | 'reports:view'
  | 'profile:edit'
  // — Видимость разделов (двухуровневая навигация) —
  | 'section:board'
  | 'section:drafts'
  | 'section:my'
  | 'section:apply'
  | 'section:crew'
  | 'section:verify'
  | 'section:requests'
  | 'section:registry'
  | 'section:edo'
  | 'section:directory'
  | 'section:reports'
  | 'section:journal'
  | 'section:logs'
  | 'section:support'
  | 'section:contacts'
  | 'section:ai'
  | 'section:settings'
  | 'section:adminUsers'
  | 'section:adminDb'
  | 'section:arch'
  | 'section:neural'
  | 'section:llm'
  | 'section:ownRequests'
  | 'section:ownAtisu'
  | 'section:ownOccupancy'
  | 'section:ownPlanning'
  | 'section:ownMonitor'
  | 'section:ownDirectory'
  | 'section:ownAudit'
  | 'section:driverApp'
  // — Управление платформой (администрация) —
  | 'admin:users'
  | 'admin:db'

/** Контур — роль учётной записи */
export type Contour = 'admin' | 'logist' | 'carrier'
/** @deprecated — то же, что Contour (старое имя) */
export type PermRole = Contour

/** Насколько опасно право: «важное» и «критичное» помечаются в редакторах */
export type PermRisk = 'normal' | 'important' | 'critical'

export interface PermItem {
  key: PermKey
  /** название права */
  label: string
  /** где право появляется в интерфейсе */
  hint: string
  group: string
  risk: PermRisk
  /** в каких контурах право существует */
  contours: Contour[]
  /** название для конкретного контура, если отличается («Подпись КЭП от АЭМЗ» / «от компании») */
  labelBy?: Partial<Record<Contour, string>>
}

export const CONTOURS: Contour[] = ['logist', 'carrier', 'admin']

export const CONTOUR_LABELS: Record<Contour, string> = {
  logist: 'Логист АЭМЗ',
  carrier: 'Перевозчик',
  admin: 'Администрация',
}
/** @deprecated — то же, что CONTOUR_LABELS */
export const ROLE_LABELS = CONTOUR_LABELS

export const RISK_LABELS: Record<Exclude<PermRisk, 'normal'>, string> = {
  important: 'важное',
  critical: 'критичное',
}

// операционные права внутреннего контура есть и у администрации (максимум прав платформы, Task 113)
const L: Contour[] = ['logist', 'admin']
const C: Contour[] = ['carrier']
const A: Contour[] = ['admin']

export const PERMS: PermItem[] = [
  { key: 'draft:create', group: 'Заявки и торги', contours: L, risk: 'normal', label: 'Создание черновиков', hint: 'Кнопка «Новая заявка» в «Черновиках заявок»' },
  { key: 'draft:edit', group: 'Заявки и торги', contours: L, risk: 'normal', label: 'Правка черновиков', hint: 'Редактирование черновиков и заявок до начала работы' },
  { key: 'draft:delete', group: 'Заявки и торги', contours: L, risk: 'normal', label: 'Удаление черновиков', hint: 'Корзина в «Черновиках заявок»' },
  { key: 'request:publish', group: 'Заявки и торги', contours: L, risk: 'important', label: 'Публикация на площадку', hint: '«Опубликовать» — выставить черновик на торги' },
  { key: 'request:extend', group: 'Заявки и торги', contours: L, risk: 'normal', label: 'Продление приёма ставок', hint: '«Продлить» на площадке' },
  { key: 'request:raise', group: 'Заявки и торги', contours: L, risk: 'important', label: 'Повышение стартовой ставки', hint: '«Повысить ставку» на площадке' },
  { key: 'request:offer', group: 'Заявки и торги', contours: L, risk: 'critical', label: 'Прямое предложение без торгов', hint: '«Предложить напрямую» — заявка уходит перевозчику без торгов' },
  { key: 'request:delete', group: 'Заявки и торги', contours: L, risk: 'critical', label: 'Удаление заявок', hint: 'Снятие заявок с площадки и из реестра' },
  { key: 'request:quarantine', group: 'Заявки и торги', contours: L, risk: 'important', label: 'Карантин заявки', hint: 'Поместить заявку в карантин с причиной и вернуть в работу после исправления' },
  { key: 'bid:submit', group: 'Торги и экипажи', contours: C, risk: 'important', label: 'Ставки', hint: '«Сделать ставку», отзыв ставки' },
  { key: 'crew:assign', group: 'Торги и экипажи', contours: C, risk: 'normal', label: 'Назначение экипажа', hint: 'Водитель, тягач и прицеп по выигранной заявке' },
  { key: 'verify:decide', group: 'Документы и рейсы', contours: L, risk: 'important', label: 'Решения сверки', hint: '«Передать дальше», «Вернуть», «Отказ» по документам' },
  { key: 'docs:upload', group: 'Документы и рейсы', contours: L, risk: 'normal', label: 'Документы перевозчику', hint: 'Загрузка документов для перевозчика в карточке заявки' },
  { key: 'docs:request', group: 'Документы и подписи', contours: C, risk: 'normal', label: 'Доверенность и заявка логисту', hint: 'Загрузка документов по заявке в «Моих заявках»' },
  { key: 'trip:close', group: 'Документы и рейсы', contours: L, risk: 'critical', label: 'Закрытие рейсов', hint: '«Закрыть рейс» в реестре рейсов' },
  { key: 'edo:sync', group: 'Документы рейса', contours: ['logist', 'carrier', 'admin'], risk: 'normal', label: 'Обновление статусов документов', hint: '«Обновить статусы» в разделе документов' },
  { key: 'edo:send', group: 'Документы рейса', contours: L, risk: 'important', label: 'Отправка накладной', hint: '«Отправить накладную» в разделе документов' },
  { key: 'edo:sign', group: 'Документы рейса', contours: ['logist', 'carrier', 'admin'], risk: 'critical', label: 'Подпись документов КЭП', hint: '«Подписать» в разделе документов', labelBy: { logist: 'Подпись КЭП от АЭМЗ', admin: 'Подпись КЭП от АЭМЗ', carrier: 'Подпись КЭП от компании' } },
  { key: 'directory:addManual', group: 'Справочники', contours: ['logist', 'carrier', 'admin'], risk: 'normal', label: 'Добавление вручную', hint: '«Добавить вручную» в справочниках', labelBy: { carrier: 'Добавление водителей и техники вручную' } },
  { key: 'directory:edit', group: 'Справочники', contours: ['logist', 'carrier', 'admin'], risk: 'normal', label: 'Правка справочников', hint: 'Редактирование карточек в справочниках', labelBy: { carrier: 'Правка карточек своей компании' } },
  { key: 'notify:agent', group: 'Справочники', contours: L, risk: 'normal', label: 'Уведомить агента', hint: 'Рассылка перевозчикам об истекающих документах' },

  // ——— собственный транспорт (диспетчерский контур) ———
  { key: 'own:process', group: 'Собственный транспорт', contours: L, risk: 'important', label: 'Обработка заявок 1С', hint: 'Перевод заявки в план, карантин и коррекции в «Заявках» собственного транспорта' },
  { key: 'own:assign', group: 'Собственный транспорт', contours: L, risk: 'critical', label: 'Назначение собственного состава', hint: 'Подбор и назначение тягача, прицепа и водителя на заявку, привязка состава' },
  { key: 'own:plan', group: 'Собственный транспорт', contours: L, risk: 'normal', label: 'Планирование собственного парка', hint: 'Ручной план, закрытие и снятие событий в «Планировании»' },
  { key: 'own:atisu', group: 'Собственный транспорт', contours: L, risk: 'important', label: 'Сделки ATI.SU', hint: 'Согласование и назначение грузов ATI.SU на собственный состав' },
  { key: 'own:directory', group: 'Собственный транспорт', contours: L, risk: 'important', label: 'Справочники парка', hint: 'Добавление и правка водителей, тягачей и прицепов собственного парка' },

  // ——— видимость разделов: двухуровневая навигация ———
  { key: 'section:board', group: 'Разделы: привлечённый транспорт', contours: ['logist', 'carrier', 'admin'], risk: 'normal', label: 'Площадка заявок', hint: 'Вкладка «Площадка заявок»: торги и предложения перевозчиков' },
  { key: 'section:drafts', group: 'Разделы: привлечённый транспорт', contours: L, risk: 'normal', label: 'Черновики заявок', hint: 'Вкладка «Черновики заявок»' },
  { key: 'section:verify', group: 'Разделы: привлечённый транспорт', contours: L, risk: 'normal', label: 'Проверка документов', hint: 'Вкладка «Проверка документов»' },
  { key: 'section:requests', group: 'Разделы: привлечённый транспорт', contours: L, risk: 'normal', label: 'Реестр заявок', hint: 'Вкладка «Реестр заявок»' },
  { key: 'section:registry', group: 'Разделы: привлечённый транспорт', contours: L, risk: 'normal', label: 'Реестр рейсов', hint: 'Вкладка «Реестр рейсов»' },
  { key: 'section:reports', group: 'Разделы: привлечённый транспорт', contours: L, risk: 'normal', label: 'Отчёты', hint: 'Вкладка «Отчёты»' },
  { key: 'section:journal', group: 'Разделы: функции', contours: L, risk: 'normal', label: 'Журнал событий', hint: 'Вкладка «Журнал событий»: кто что делал на платформе — действия пользователей, заявки, рейсы, документы' },
  { key: 'section:logs', group: 'Разделы: функции', contours: L, risk: 'important', label: 'Логи платформы', hint: 'Вкладка «Логи платформы»: живой лог всех действий без исключения — включая попытки входа и действия диспетчерской' },
  { key: 'section:my', group: 'Разделы: кабинет перевозчика', contours: C, risk: 'normal', label: 'Мои заявки', hint: 'Вкладка «Мои заявки» в кабинете перевозчика' },
  { key: 'section:apply', group: 'Разделы: кабинет перевозчика', contours: C, risk: 'normal', label: 'Подать документы', hint: 'Вкладка «Подать документы»' },
  { key: 'section:crew', group: 'Разделы: кабинет перевозчика', contours: C, risk: 'normal', label: 'Назначение экипажей', hint: 'Вкладка «Назначение экипажей»' },
  { key: 'section:edo', group: 'Разделы: общие', contours: ['logist', 'carrier', 'admin'], risk: 'normal', label: 'ЭДО', hint: 'Вкладка «Подписать ЭДО»' },
  { key: 'section:directory', group: 'Разделы: общие', contours: ['logist', 'carrier', 'admin'], risk: 'normal', label: 'Справочники', hint: 'Вкладка «Справочники» платформы' },
  { key: 'section:support', group: 'Разделы: общие', contours: ['logist', 'carrier', 'admin'], risk: 'normal', label: 'Обращения', hint: 'Вкладка «Обращения»' },
  { key: 'section:contacts', group: 'Разделы: привлечённый транспорт', contours: L, risk: 'normal', label: 'Память контактов', hint: 'Вкладка «Память контактов»: с кем работали и какие сделки заключались' },
  { key: 'section:ownRequests', group: 'Разделы: собственный транспорт', contours: L, risk: 'normal', label: 'Заявки 1С', hint: 'Вкладка «Заявки» собственного транспорта: реестр 1С и карточка рейса' },
  { key: 'section:ownAtisu', group: 'Разделы: собственный транспорт', contours: L, risk: 'normal', label: 'ATI.SU', hint: 'Вкладка «ATI.SU»: биржа и согласованные грузы' },
  { key: 'section:ai', group: 'Разделы: собственный транспорт', contours: L, risk: 'normal', label: 'ИИ-помощник', hint: 'Вкладка «ИИ-помощник»: нейросеть-консультант по грузам и машинам ATI.SU; права жёстко ограничены (запись — только свой список и журнал)' },
  { key: 'section:ownOccupancy', group: 'Разделы: собственный транспорт', contours: L, risk: 'normal', label: 'Занятость', hint: 'Вкладка «Занятость»: кто чем занят' },
  { key: 'section:ownPlanning', group: 'Разделы: собственный транспорт', contours: L, risk: 'normal', label: 'Планирование', hint: 'Вкладка «Планирование»: календарь погрузок, выгрузок и возвратов' },
  { key: 'section:ownMonitor', group: 'Разделы: собственный транспорт', contours: L, risk: 'normal', label: 'Мониторинг', hint: 'Вкладка «Мониторинг»: статусы, геолокация и устройства' },
  { key: 'section:ownDirectory', group: 'Разделы: собственный транспорт', contours: L, risk: 'normal', label: 'Справочники парка', hint: 'Вкладка «Справочники парка»: водители, тягачи, прицепы' },
  { key: 'section:ownAudit', group: 'Разделы: собственный транспорт', contours: A, risk: 'important', label: 'Аудит контура', hint: 'Сквозной журнал действий платформы и диспетчерской' },
  { key: 'section:driverApp', group: 'Разделы: управление', contours: A, risk: 'normal', label: 'Приложение водителя', hint: 'Вкладка «Приложение водителя»: веб-версия, APK, состояние сервиса и GPS' },
  { key: 'section:settings', group: 'Разделы: управление', contours: A, risk: 'normal', label: 'Настройки платформы', hint: 'Вкладка «Настройки»' },
  { key: 'section:adminUsers', group: 'Разделы: управление', contours: A, risk: 'critical', label: 'Профили и доступы', hint: 'Вкладка «Профили и доступы»: учётные записи, должности и исключения' },
  { key: 'section:adminDb', group: 'Разделы: управление', contours: A, risk: 'critical', label: 'База данных', hint: 'Вкладка «База данных»' },
  { key: 'section:arch', group: 'Разделы: управление', contours: A, risk: 'normal', label: 'Архитектура', hint: 'Вкладка «Архитектура»' },
  { key: 'section:neural', group: 'Разделы: управление', contours: A, risk: 'normal', label: 'PaddleOCR', hint: 'Вкладка «PaddleOCR»: настройки пропуска документов — движок распознавания на серверах АЭМЗ' },
  { key: 'section:llm', group: 'Разделы: управление', contours: A, risk: 'important', label: 'Облачная LLM', hint: 'Вкладка «Облачная LLM»: права нейросети ИИ-помощника и состояние облачного движка GigaChat' },

  { key: 'admin:users', group: 'Управление', contours: A, risk: 'critical', label: 'Профили и доступы', hint: 'Учётные записи, должности и исключения' },
  { key: 'admin:db', group: 'Управление', contours: A, risk: 'critical', label: 'Редактор базы данных', hint: 'Раздел «База данных»: прямая правка записей' },
  { key: 'reports:view', group: 'Разделы и профиль', contours: ['logist', 'admin'], risk: 'normal', label: 'Отчёты', hint: 'Раздел «Отчёты» и выгрузка' },
  { key: 'profile:edit', group: 'Разделы и профиль', contours: ['logist', 'carrier', 'admin'], risk: 'normal', label: 'Правка своего профиля', hint: '«Изменить» в меню аккаунта: ФИО, должность, телефон, почта' },
]

export const PERM_KEYS: PermKey[] = PERMS.map((p) => p.key)

const BY_KEY = new Map(PERMS.map((p) => [p.key, p]))

export const isPermKey = (key: unknown): key is PermKey => typeof key === 'string' && BY_KEY.has(key as PermKey)

export const isContour = (v: unknown): v is Contour => v === 'admin' || v === 'logist' || v === 'carrier'

/** Существует ли право в контуре */
export const inContour = (contour: Contour, key: PermKey): boolean => BY_KEY.get(key)?.contours.includes(contour) ?? false

/** Права контура в порядке каталога */
export const permsFor = (contour: Contour): PermItem[] => PERMS.filter((p) => p.contours.includes(contour))

/** Группы прав контура в порядке каталога */
export function permGroupsFor(contour: Contour): { title: string; items: PermItem[] }[] {
  const groups: { title: string; items: PermItem[] }[] = []
  for (const p of permsFor(contour)) {
    const g = groups.find((x) => x.title === p.group)
    if (g) g.items.push(p)
    else groups.push({ title: p.group, items: [p] })
  }
  return groups
}

/** Название права (с учётом контура, если оно там называется иначе) */
export function permLabel(key: PermKey, contour?: Contour): string {
  const p = BY_KEY.get(key)
  if (!p) return key
  return (contour && p.labelBy?.[contour]) || p.label
}

export const permRisk = (key: PermKey): PermRisk => BY_KEY.get(key)?.risk ?? 'normal'
export const permHint = (key: PermKey): string => BY_KEY.get(key)?.hint ?? ''

// ——— стартовые должности ———

export interface TemplateSeed {
  contour: Contour
  name: string
  description: string
  perms: PermKey[]
  /** должность для новых учёток контура */
  isDefault?: boolean
}

const allOf = (contour: Contour, except: PermKey[] = []): PermKey[] =>
  permsFor(contour).map((p) => p.key).filter((k) => !except.includes(k))

/**
 * Стартовые должности. Наборы повторяют прежнее поведение платформы: «Ведущий логист» —
 * прежний логист по умолчанию, «Логист» — урезанный набор линейного сотрудника (logist2),
 * «Руководитель компании» — прежние права перевозчика, «Администратор» — прежняя администрация.
 * Правка своего профиля по умолчанию только у администрации (Task 112).
 *
 * Видимость вкладок — отдельные права `section:*`: администратор включает и выключает
 * целые разделы двухуровневой навигации, не меняя операционные права. Так логист видит
 * только тот объём привлечённого и собственного транспорта, который ему выдан должностью.
 */
export const LOGIST_VIEW_SECTIONS: PermKey[] = [
  'section:board', 'section:drafts', 'section:verify', 'section:requests', 'section:registry',
  'section:reports', 'section:journal', 'section:logs', 'section:edo', 'section:directory', 'section:support', 'section:contacts',
]
export const OWN_VIEW_SECTIONS: PermKey[] = [
  'section:ownRequests', 'section:ownAtisu', 'section:ownOccupancy',
  'section:ownPlanning', 'section:ownMonitor', 'section:ownDirectory', 'section:ai',
]
export const ADMIN_VIEW_SECTIONS: PermKey[] = [
  'section:settings', 'section:adminUsers', 'section:adminDb', 'section:arch', 'section:neural', 'section:llm',
  'section:ownAudit', 'section:driverApp',
]
export const CARRIER_VIEW_SECTIONS: PermKey[] = [
  'section:board', 'section:my', 'section:apply', 'section:crew',
  'section:edo', 'section:directory', 'section:support',
]

export const TEMPLATE_SEEDS: TemplateSeed[] = [
  { contour: 'logist', name: 'Ведущий логист', description: 'Весь операционный контур: торги, сверка, рейсы, документы, отчёты и собственный парк.', perms: allOf('logist', ['profile:edit']) },
  { contour: 'logist', name: 'Логист', description: 'Черновики заявок, документы перевозчику, справочники и планирование собственного парка. Назначение состава и ATI.SU — у ведущего логиста.', isDefault: true,
    perms: [
      'draft:create', 'draft:edit', 'draft:delete', 'docs:upload',
      'directory:addManual', 'directory:edit',
      ...LOGIST_VIEW_SECTIONS.filter((k) => k !== 'section:reports' && k !== 'section:journal'),
      'section:ownRequests', 'section:ownPlanning', 'section:ownOccupancy', 'section:ownDirectory',
      'own:process', 'own:plan', 'own:directory',
    ] },
  { contour: 'logist', name: 'Наблюдатель', description: 'Видит все разделы привлечённого и собственного транспорта, ничего не меняет. Для стажёров и руководства.', perms: [...LOGIST_VIEW_SECTIONS, ...OWN_VIEW_SECTIONS] },
  { contour: 'carrier', name: 'Руководитель компании', description: 'Торги, экипажи, документы и подпись от компании.', isDefault: true,
    perms: ['bid:submit', 'crew:assign', 'docs:request', 'edo:sign', 'directory:edit', ...CARRIER_VIEW_SECTIONS] },
  { contour: 'carrier', name: 'Диспетчер', description: 'Ставки, экипажи и документы. Без права подписи.', perms: ['bid:submit', 'crew:assign', 'docs:request', 'directory:edit', ...CARRIER_VIEW_SECTIONS] },
  { contour: 'carrier', name: 'Подписант', description: 'Подпись накладных и актов КЭП, на которого она оформлена, и документы по заявкам.', perms: ['edo:sign', 'docs:request', 'section:my', 'section:apply', 'section:edo', 'section:directory', 'section:support'] },
  { contour: 'admin', name: 'Администратор', description: 'Максимум прав: весь операционный контур логиста и собственного парка, учётные записи и доступы, база данных.', isDefault: true,
    perms: allOf('admin') },
  { contour: 'admin', name: 'Администратор доступа', description: 'Учётные записи, доступы и база данных — без операций с заявками.',
    perms: ['admin:users', 'admin:db', 'reports:view', 'profile:edit', 'section:adminUsers', 'section:adminDb', 'section:reports', 'section:support'] },
  { contour: 'admin', name: 'Аудитор', description: 'Видит разделы, журналы и отчёты, ничего не меняет.', perms: ['reports:view', ...LOGIST_VIEW_SECTIONS, ...OWN_VIEW_SECTIONS] },
]
