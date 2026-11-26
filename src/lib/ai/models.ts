// Каталог уровней GigaChat для выбора модели прямо в чате.
// Модуль чистый (без SDK и БД) — используется и на клиенте (список в чате),
// и на сервере (проверка выбранного уровня в /api/ai/chat).
//
// Выбор уровня — только удобство человека: движок всегда GigaChat (Сбер),
// сбои не переключают движок. Администратор может зафиксировать уровень
// в .env.local (GIGACHAT_MODEL) — каталог здесь описывает все доступные
// уровни личного тарифа GIGACHAT_API_PERS. В интерфейсе уровни показываются
// короткими именами — Ультра / Про / Макс / Лайт; в API уходят полные ключи.

export interface GigaModelInfo {
  /** имя модели в API GigaChat — то, что уходит в payload.model */
  key: string
  /** короткая подпись для списка выбора */
  label: string
  /** чем отличается уровень — подпись в списке */
  hint: string
}

export const GIGA_MODELS: GigaModelInfo[] = [
  { key: 'GigaChat-2-Max', label: 'Ультра', hint: 'флагман — сложные разборы и отчёты' },
  { key: 'GigaChat-2-Pro', label: 'Про', hint: 'баланс глубины и скорости' },
  { key: 'GigaChat-Max', label: 'Макс', hint: 'прошлое поколение Max' },
  { key: 'GigaChat-Plus', label: 'Лайт', hint: 'быстрее и легче' },
]

export const GIGA_MODEL_KEYS: string[] = GIGA_MODELS.map((m) => m.key)

export const DEFAULT_GIGA_MODEL = 'GigaChat-2-Max'

/** Уровень из запроса валиден? Если нет — чат отвечает уровнем по умолчанию. */
export function validGigaModel(model: unknown): string {
  return typeof model === 'string' && GIGA_MODEL_KEYS.includes(model) ? model : DEFAULT_GIGA_MODEL
}

/** Подпись уровня для бейджа (если ключ неизвестен — как есть). */
export function gigaModelLabel(key: string | null | undefined): string {
  return GIGA_MODELS.find((m) => m.key === key)?.label ?? key ?? DEFAULT_GIGA_MODEL
}
