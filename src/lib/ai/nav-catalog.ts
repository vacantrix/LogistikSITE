// Каталог разделов платформы для ссылок нейросети (блок ai-links и инлайн-ссылки #nav:).
// Модуль чистый (без React и серверных импортов) — импортируется и на клиенте
// (валидация ссылок в UI), и на сервере (проверка блока, сборка промпта).
//
// Синхронизирован с NAV_ALL в src/components/platform/shell.tsx: ключи и
// названия разделов должны совпадать. hint — чем человек там занимается,
// идёт в системный промпт: модель понимает, КУДА она отправляет человека,
// и не ссылается на разделы, которых нет.
export interface AiNavLinkMeta {
  tab: string
  label: string
  hint: string
}

/** Каким значениям верить при разборе фильтра (белые списки как в market-stubs) */
export interface AiNavFilterSpec {
  /** text — короткая строка; number — число; list — значения через запятую */
  kind: 'text' | 'number' | 'list'
  /** максимум: длина строки, величина числа или число элементов списка */
  max: number
  /** для kind=list — допустимые значения (пустое = любые короткие строки) */
  values?: readonly string[]
}

/**
 * Фильтры, которые нейросеть может применить к разделу (ai-links → filters).
 * Нейросеть «выполняет работу по платформе»: переходит в раздел и сама
 * выставляет фильтры/поиск. Ключи и значения — белые списки: всё лишнее
 * сервер отбрасывает, интерфейс клампит ещё раз.
 *
 * own-atisu — фильтры витрины грузов (AtiSuMarketPanel: from/to/weight/
 * volume/bodies/payments/minRate); board/requests/own-requests — поисковый
 * запрос q (строка поиска раздела).
 */
export const AI_NAV_FILTERS: Partial<Record<string, Record<string, AiNavFilterSpec>>> = {
  board: { q: { kind: 'text', max: 80 } },
  requests: { q: { kind: 'text', max: 80 } },
  'own-requests': { q: { kind: 'text', max: 80 } },
  'own-atisu': {
    from: { kind: 'text', max: 60 },
    to: { kind: 'text', max: 60 },
    weight: { kind: 'number', max: 100 },
    volume: { kind: 'number', max: 300 },
    bodies: { kind: 'list', max: 6, values: ['тент', 'изотерм', 'реф', 'бортовая', 'цельнометалл.', 'контейнер'] },
    payments: { kind: 'list', max: 4, values: ['cashless_vat', 'cashless', 'cash', 'card'] },
    minRate: { kind: 'text', max: 12 },
  },
}

/** Проверенные фильтры для перехода: только белые ключи/значения, всё клампится */
export function sanitizeNavFilters(tab: string, raw: unknown): Record<string, string> | undefined {
  const specs = AI_NAV_FILTERS[tab]
  if (!specs || !raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const [key, spec] of Object.entries(specs)) {
    const v = o[key]
    if (v === undefined || v === null) continue
    if (spec.kind === 'number') {
      const n = typeof v === 'number' ? v : Number(v)
      if (Number.isFinite(n)) out[key] = String(Math.max(0, Math.min(spec.max, n)))
      continue
    }
    if (spec.kind === 'list') {
      const list = (typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v : [])
        .map((s) => String(s).trim())
        .filter((s) => (spec.values ? spec.values.includes(s) : s.length > 0 && s.length <= spec.max))
        .slice(0, spec.max)
      if (list.length > 0) out[key] = list.join(',')
      continue
    }
    const s = String(v).trim().slice(0, spec.max)
    if (s) out[key] = s
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Список фильтров раздела для системного промпта: «tab: key1, key2…» */
export function aiNavFiltersPromptLines(): string {
  return Object.entries(AI_NAV_FILTERS)
    .map(([tab, specs]) => `${tab}: ${Object.keys(specs ?? {}).join(', ')}`)
    .join('\n')
}

export const AI_NAV_CATALOG: AiNavLinkMeta[] = [
  { tab: 'board', label: 'Площадка заявок', hint: 'тендеры и ставки привлечённого транспорта' },
  { tab: 'drafts', label: 'Черновики заявок', hint: 'незавершённые заявки' },
  { tab: 'verify', label: 'Проверка документов', hint: 'документы перевозчиков и автопроверка' },
  { tab: 'requests', label: 'Реестр заявок', hint: 'все заявки внутреннего контура' },
  { tab: 'registry', label: 'Реестр рейсов', hint: 'выполненные и текущие рейсы' },
  { tab: 'edo', label: 'Подписать ЭДО', hint: 'подписание документов через Диадок' },
  { tab: 'directory', label: 'Справочники', hint: 'единый справочник: водители, тягачи и прицепы — собственный парк АЭМЗ и привлечённый транспорт' },
  { tab: 'reports', label: 'Отчёты', hint: 'бумажные отчёты с выгрузкой Word' },
  { tab: 'journal', label: 'Журнал событий', hint: 'что происходило на платформе: кто, что и когда сделал' },
  { tab: 'logs', label: 'Логи платформы', hint: 'живой лог всех действий без исключения: попытки входа, действия, предупреждения и ошибки' },
  { tab: 'support', label: 'Обращения', hint: 'поддержка платформы' },
  { tab: 'contacts', label: 'Память контактов', hint: 'с кем работали: контакты, сделки, рейтинг' },
  { tab: 'own-requests', label: 'Заявки 1С', hint: 'заявки собственного транспорта из 1С' },
  { tab: 'own-atisu', label: 'ATI.SU', hint: 'витрина биржи и машины фирмы' },
  { tab: 'ai', label: 'ИИ-помощник', hint: 'этот раздел: чат с нейросетью-консультантом; права нейросети настраиваются в разделе Облачная LLM' },
  { tab: 'favorites', label: 'Избранное', hint: 'варианты из списков ИИ и переговоры по ним' },
  { tab: 'own-planning', label: 'Планирование', hint: 'работа парка в двух видах: кто чем занят сейчас и график рейсов' },
  { tab: 'own-monitor', label: 'Мониторинг', hint: 'где машины сейчас' },
  { tab: 'own-audit', label: 'Аудит контура', hint: 'журнал действий диспетчерского контура' },
  { tab: 'driver-app', label: 'Приложение водителя', hint: 'PWA и APK водителя' },
  { tab: 'nn', label: 'PaddleOCR', hint: 'движок распознавания документов на серверах АЭМЗ' },
  { tab: 'llm', label: 'Облачная LLM', hint: 'права нейросети ИИ-помощника и облачный движок GigaChat' },
  { tab: 'settings', label: 'Настройки', hint: 'настройки платформы' },
  { tab: 'admin-users', label: 'Профили и доступы', hint: 'пользователи и права' },
  { tab: 'admin-db', label: 'База данных', hint: 'администрирование базы' },
  { tab: 'arch', label: 'Архитектура', hint: 'карта системы' },
]

/** Быстрый поиск метаданных раздела по ключу */
export function aiNavLink(tab: string): AiNavLinkMeta | undefined {
  return AI_NAV_CATALOG.find((n) => n.tab === tab)
}

/** Список «key — название (подсказка)» для системного промпта модели */
export function aiNavPromptLines(): string {
  return AI_NAV_CATALOG.map((n) => `${n.tab} — ${n.label} (${n.hint})`).join('\n')
}
