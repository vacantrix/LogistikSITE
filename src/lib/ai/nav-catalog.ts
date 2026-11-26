// Каталог разделов платформы для ссылок нейросети (блок ai-links).
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

export const AI_NAV_CATALOG: AiNavLinkMeta[] = [
  { tab: 'board', label: 'Площадка заявок', hint: 'тендеры и ставки привлечённого транспорта' },
  { tab: 'drafts', label: 'Черновики заявок', hint: 'незавершённые заявки' },
  { tab: 'verify', label: 'Проверка документов', hint: 'документы перевозчиков и автопроверка' },
  { tab: 'requests', label: 'Реестр заявок', hint: 'все заявки внутреннего контура' },
  { tab: 'registry', label: 'Реестр рейсов', hint: 'выполненные и текущие рейсы' },
  { tab: 'edo', label: 'Подписать ЭДО', hint: 'подписание документов через Диадок' },
  { tab: 'directory', label: 'Справочники', hint: 'машины, прицепы, водители, фирмы' },
  { tab: 'reports', label: 'Отчёты', hint: 'бумажные отчёты с выгрузкой Word' },
  { tab: 'journal', label: 'Журнал событий', hint: 'что происходило на платформе' },
  { tab: 'support', label: 'Обращения', hint: 'поддержка платформы' },
  { tab: 'contacts', label: 'Память контактов', hint: 'с кем работали: контакты, сделки, рейтинг' },
  { tab: 'own-requests', label: 'Заявки 1С', hint: 'заявки собственного транспорта из 1С' },
  { tab: 'own-atisu', label: 'ATI.SU', hint: 'витрина биржи и машины фирмы' },
  { tab: 'ai', label: 'ИИ-помощник', hint: 'этот раздел: чат с нейросетью-консультантом; права нейросети настраиваются в разделе Облачная LLM' },
  { tab: 'favorites', label: 'Избранное', hint: 'варианты из списков ИИ и переговоры по ним' },
  { tab: 'own-occupancy', label: 'Занятость', hint: 'загрузка машин' },
  { tab: 'own-planning', label: 'Планирование', hint: 'план рейсов' },
  { tab: 'own-monitor', label: 'Мониторинг', hint: 'где машины сейчас' },
  { tab: 'own-directory', label: 'Справочники парка', hint: 'парк собственного транспорта' },
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
