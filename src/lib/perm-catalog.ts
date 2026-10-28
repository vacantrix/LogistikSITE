/**
 * Каталог прав платформы (Task 111) — чистый модуль без серверных зависимостей:
 * импортируется и на клиенте (раздел «Права доступа», подсказки), и на сервере.
 * Серверные проверки (allowed/permMatrix) — в src/lib/permissions.ts.
 */

/** Ключи прав (строки — чтобы каталог можно было использовать и на клиенте) */
export type PermKey =
  // — Заявки и торги —
  | 'draft:create'      // создание черновиков (кнопки «Создать заявку» / «Новая заявка»)
  | 'draft:edit'        // правка черновиков
  | 'draft:delete'      // удаление черновиков
  | 'request:publish'   // публикация заявок на площадку
  | 'request:delete'    // удаление заявок с площадки
  | 'request:extend'    // продление приёма ставок
  | 'request:raise'     // повышение стартовой ставки
  | 'request:offer'     // прямое предложение заявки перевозчику (без торгов)
  | 'bid:submit'        // подача, отзыв ставок (перевозчик)
  // — Документы и сверка —
  | 'verify:decide'     // решения сверки документов (передать дальше / вернуть / отказ)
  | 'docs:upload'       // загрузка документов для перевозчика (логист)
  | 'docs:request'      // обмен документами по заявке (доверенность / заявка)
  // — Экипажи —
  | 'crew:assign'       // назначение экипажей и утверждение
  // — ЭДО —
  | 'edo:sync'          // синхронизация статусов Диадока
  | 'edo:sign'          // подписание документов КЭП
  | 'edo:send'          // отправка ЭТрН в Диадок
  // — Справочники —
  | 'directory:addManual' // ручное добавление записей в справочники
  | 'directory:edit'      // правка своих данных в справочниках
  | 'notify:agent'        // «Уведомить агента» (рассылка об истекающих документах)
  // — Рейсы —
  | 'trip:close'        // закрытие рейсов
  // — Отчёты —
  | 'reports:view'      // доступ к разделу «Отчёты»

export interface PermItem {
  key: PermKey
  label: string
  hint?: string
}

export interface PermGroup {
  title: string
  items: PermItem[]
}

/** Каталог прав для раздела «Права доступа» и подсказок */
export const PERM_GROUPS: PermGroup[] = [
  {
    title: 'Заявки и торги',
    items: [
      { key: 'draft:create', label: 'Создание черновиков', hint: 'Кнопки «Создать заявку» и «Новая заявка»' },
      { key: 'draft:edit', label: 'Правка черновиков' },
      { key: 'draft:delete', label: 'Удаление черновиков' },
      { key: 'request:publish', label: 'Публикация заявок', hint: 'Выставление черновика на площадку с приёмом ставок' },
      { key: 'request:delete', label: 'Удаление заявок', hint: 'Снятие заявок с площадки и из реестра' },
      { key: 'request:extend', label: 'Продление приёма ставок' },
      { key: 'request:raise', label: 'Повышение стартовой ставки' },
      { key: 'request:offer', label: 'Прямое предложение', hint: '«Предложить напрямую» — передача заявки перевозчику без торгов' },
      { key: 'bid:submit', label: 'Подача ставок', hint: 'Ставки, отзыв и продление своих ставок' },
    ],
  },
  {
    title: 'Документы и сверка',
    items: [
      { key: 'verify:decide', label: 'Решения сверки', hint: '«Передать дальше», «Перезагрузить», «Отказ» по документам' },
      { key: 'docs:upload', label: 'Документы перевозчику', hint: 'Загрузка документов логистом в пакет заявки' },
      { key: 'docs:request', label: 'Обмен документами по заявке', hint: 'Доверенность и заявка от перевозчика, комплект от логиста' },
    ],
  },
  {
    title: 'Экипажи',
    items: [
      { key: 'crew:assign', label: 'Назначение экипажей', hint: 'Указание и утверждение водителя, тягача и прицепа по заявке' },
    ],
  },
  {
    title: 'ЭДО',
    items: [
      { key: 'edo:sync', label: 'Синхронизация Диадока', hint: 'Кнопка «Обновить статусы» в разделе ЭДО' },
      { key: 'edo:sign', label: 'Подписание документов', hint: 'КЭП-подпись документов в разделе ЭДО' },
      { key: 'edo:send', label: 'Отправка ЭТрН в Диадок' },
    ],
  },
  {
    title: 'Справочники',
    items: [
      { key: 'directory:addManual', label: 'Ручное добавление', hint: 'Кнопка «Добавить вручную» в справочниках' },
      { key: 'directory:edit', label: 'Правка своих данных', hint: 'Редактирование карточек своей компании' },
      { key: 'notify:agent', label: 'Уведомить агента', hint: 'Рассылка перевозчикам об истекающих документах' },
    ],
  },
  {
    title: 'Рейсы и отчёты',
    items: [
      { key: 'trip:close', label: 'Закрытие рейсов' },
      { key: 'reports:view', label: 'Раздел «Отчёты»', hint: 'Финансовые отчёты и экономия' },
    ],
  },
]

export const PERM_KEYS: PermKey[] = PERM_GROUPS.flatMap((g) => g.items.map((i) => i.key))

export type PermRole = 'admin' | 'logist' | 'carrier'

const has = (keys: PermKey[]): Record<PermKey, boolean> =>
  Object.fromEntries(PERM_KEYS.map((k) => [k, keys.includes(k)])) as Record<PermKey, boolean>

/** Права по умолчанию — заливаются в БД при первом запуске (ensurePerms) */
export const PERM_DEFAULTS: Record<PermRole, Record<PermKey, boolean>> = {
  // Логист — операционный контур: все функции платформы
  logist: has(PERM_KEYS),
  // Перевозчик/экспедитор — кабинет компании: торги, экипажи, документы, ЭДО, свои карточки
  carrier: has([
    'bid:submit', 'crew:assign', 'docs:request', 'edo:sign', 'edo:send', 'directory:edit',
  ]),
  // Администрация — просмотр всех разделов и управление правами; операционные
  // функции выключены (при необходимости админ включит их себе сам)
  admin: has(['reports:view']),
}

export const ROLE_LABELS: Record<PermRole, string> = {
  logist: 'Логист',
  carrier: 'Перевозчик',
  admin: 'Администрация',
}

export function permLabel(key: PermKey): string {
  for (const g of PERM_GROUPS) {
    const item = g.items.find((i) => i.key === key)
    if (item) return item.label
  }
  return key
}
