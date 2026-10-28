/**
 * Каталог прав платформы — чистый модуль без серверных зависимостей:
 * импортируется и на клиенте (раздел «Профили и доступы», подсказки), и на сервере,
 * и в сид-скриптах. Проверка прав — в src/lib/permissions.ts.
 *
 * Модель доступа «контур → должность → исключения»:
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
  // — Разделы и профиль —
  | 'reports:view'
  | 'profile:edit'
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
  { key: 'draft:create', group: 'Заявки и торги', contours: L, risk: 'normal', label: 'Создание черновиков', hint: 'Кнопки «Создать заявку» и «Новая заявка»' },
  { key: 'draft:edit', group: 'Заявки и торги', contours: L, risk: 'normal', label: 'Правка черновиков', hint: 'Редактирование черновиков и заявок до начала работы' },
  { key: 'draft:delete', group: 'Заявки и торги', contours: L, risk: 'normal', label: 'Удаление черновиков', hint: 'Корзина в «Черновиках заявок»' },
  { key: 'request:publish', group: 'Заявки и торги', contours: L, risk: 'important', label: 'Публикация на площадку', hint: '«Опубликовать» — выставить черновик на торги' },
  { key: 'request:extend', group: 'Заявки и торги', contours: L, risk: 'normal', label: 'Продление приёма ставок', hint: '«Продлить» на площадке' },
  { key: 'request:raise', group: 'Заявки и торги', contours: L, risk: 'important', label: 'Повышение стартовой ставки', hint: '«Повысить ставку» на площадке' },
  { key: 'request:offer', group: 'Заявки и торги', contours: L, risk: 'critical', label: 'Прямое предложение без торгов', hint: '«Предложить напрямую» — заявка уходит перевозчику без торгов' },
  { key: 'request:delete', group: 'Заявки и торги', contours: L, risk: 'critical', label: 'Удаление заявок', hint: 'Снятие заявок с площадки и из реестра' },
  { key: 'bid:submit', group: 'Торги и экипажи', contours: C, risk: 'important', label: 'Ставки', hint: '«Сделать ставку», отзыв ставки' },
  { key: 'crew:assign', group: 'Торги и экипажи', contours: C, risk: 'normal', label: 'Назначение экипажа', hint: 'Водитель, тягач и прицеп по выигранной заявке' },
  { key: 'verify:decide', group: 'Документы и рейсы', contours: L, risk: 'important', label: 'Решения сверки', hint: '«Передать дальше», «Вернуть», «Отказ» по документам' },
  { key: 'docs:upload', group: 'Документы и рейсы', contours: L, risk: 'normal', label: 'Документы перевозчику', hint: 'Загрузка документов для перевозчика в карточке заявки' },
  { key: 'docs:request', group: 'Документы и ЭДО', contours: C, risk: 'normal', label: 'Доверенность и заявка логисту', hint: 'Загрузка документов по заявке в «Моих заявках»' },
  { key: 'trip:close', group: 'Документы и рейсы', contours: L, risk: 'critical', label: 'Закрытие рейсов', hint: '«Закрыть рейс» в реестре рейсов' },
  { key: 'edo:sync', group: 'ЭДО', contours: ['logist', 'carrier', 'admin'], risk: 'normal', label: 'Обновление статусов Диадока', hint: '«Обновить статусы» в разделе ЭДО' },
  { key: 'edo:send', group: 'ЭДО', contours: L, risk: 'important', label: 'Отправка ЭТрН в Диадок', hint: '«Отправить ЭТрН» в разделе ЭДО' },
  { key: 'edo:sign', group: 'ЭДО', contours: ['logist', 'carrier', 'admin'], risk: 'critical', label: 'Подпись документов КЭП', hint: '«Подписать» в разделе ЭДО', labelBy: { logist: 'Подпись КЭП от АЭМЗ', admin: 'Подпись КЭП от АЭМЗ', carrier: 'Подпись КЭП от компании' } },
  { key: 'directory:addManual', group: 'Справочники', contours: ['logist', 'carrier', 'admin'], risk: 'normal', label: 'Добавление вручную', hint: '«Добавить вручную» в справочниках', labelBy: { carrier: 'Добавление водителей и техники вручную' } },
  { key: 'directory:edit', group: 'Справочники', contours: ['logist', 'carrier', 'admin'], risk: 'normal', label: 'Правка справочников', hint: 'Редактирование карточек в справочниках', labelBy: { carrier: 'Правка карточек своей компании' } },
  { key: 'notify:agent', group: 'Справочники', contours: L, risk: 'normal', label: 'Уведомить агента', hint: 'Рассылка перевозчикам об истекающих документах' },
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
 */
export const TEMPLATE_SEEDS: TemplateSeed[] = [
  { contour: 'logist', name: 'Ведущий логист', description: 'Весь операционный контур: торги, сверка, рейсы, ЭДО, отчёты.', perms: allOf('logist', ['profile:edit']) },
  { contour: 'logist', name: 'Логист', description: 'Черновики заявок, документы перевозчику, справочники. Публикует, сверяет и закрывает ведущий логист.', isDefault: true,
    perms: ['draft:create', 'draft:edit', 'draft:delete', 'docs:upload', 'directory:addManual', 'directory:edit'] },
  { contour: 'logist', name: 'Наблюдатель', description: 'Видит разделы логиста, ничего не меняет. Для стажёров и руководства.', perms: [] },
  { contour: 'carrier', name: 'Руководитель компании', description: 'Торги, экипажи, документы и подпись ЭДО от компании.', isDefault: true,
    perms: ['bid:submit', 'crew:assign', 'docs:request', 'edo:sign', 'directory:edit'] },
  { contour: 'carrier', name: 'Диспетчер', description: 'Ставки, экипажи и документы. Без подписи ЭДО.', perms: ['bid:submit', 'crew:assign', 'docs:request', 'directory:edit'] },
  { contour: 'carrier', name: 'Подписант ЭДО', description: 'Подпись ЭТрН и актов КЭП, на которого она оформлена, и документы по заявкам.', perms: ['edo:sign', 'docs:request'] },
  { contour: 'admin', name: 'Администратор', description: 'Максимум прав: весь операционный контур логиста, учётные записи и доступы, база данных.', isDefault: true,
    perms: allOf('admin') },
  { contour: 'admin', name: 'Администратор доступа', description: 'Учётные записи, доступы и база данных — без операций с заявками.',
    perms: ['admin:users', 'admin:db', 'reports:view', 'profile:edit'] },
  { contour: 'admin', name: 'Аудитор', description: 'Видит все разделы и отчёты, ничего не меняет.', perms: ['reports:view'] },
]
