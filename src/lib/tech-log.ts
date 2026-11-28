/**
 * Техническая консоль платформы — короткие строки о работе кода: каждый
 * вызов API (метод, путь, код ответа, длительность), сбои сервера и
 * интерфейса, системные события.
 *
 * Отличие от «Журнала событий» (PlatformLog в БД): журнал — аудиту действий
 * людей, кто что сделал; консоль — как работает сам код. Живёт в памяти
 * процесса (кольцевой буфер, переживает горячую перезагрузку) — как
 * `docker logs`: перезапуск очищает ленту, история действий не теряется.
 */
import type { TechLogEntryDTO as TechLogEntry, TechLogKind, TechLogLevel } from '@/lib/types'

/** Ёмкость кольцевого буфера: ~2000 последних строк консоли */
const CAPACITY = 2000
/** Окно статистики для плиток раздела «Логи» */
export const STATS_WINDOW_MS = 5 * 60_000

/** Буфер на globalThis — единый на процесс и переживает HMR dev-сервер */
const g = globalThis as unknown as { __aemzTechLog?: { buf: TechLogEntry[]; seq: number } }
const store = (g.__aemzTechLog ??= { buf: [], seq: 0 })

export interface TechLogInput {
  kind: TechLogKind
  level?: TechLogLevel
  message?: string
  method?: string | null
  path?: string | null
  status?: number | null
  ms?: number | null
  origin?: string | null
  /** epoch ms (по умолчанию — сейчас) */
  ts?: number
}

/** Добавить строку в консоль (fire-and-forget, ошибок не бросает) */
export function logTech(input: TechLogInput): void {
  try {
    const seq = ++store.seq
    const ts = typeof input.ts === 'number' && Number.isFinite(input.ts) ? Math.trunc(input.ts) : Date.now()
    const entry: TechLogEntry = {
      id: `t${ts.toString(36)}-${seq.toString(36)}`,
      ts,
      kind: input.kind,
      level: input.level ?? 'INFO',
      method: input.method ?? null,
      path: input.path ?? null,
      status: input.status ?? null,
      ms: input.ms ?? null,
      message: (input.message ?? '').slice(0, 500),
      origin: input.origin ?? null,
    }
    store.buf.push(entry)
    if (store.buf.length > CAPACITY) store.buf.splice(0, store.buf.length - CAPACITY)
  } catch {
    // консоль не должна ломать вызывающий код
  }
}

/** Короткая строка вызова API: «GET /api/state → 200 · 84 мс» */
export function apiCallLine(method: string, path: string, status: number | null, ms: number | null): string {
  const code = status === null ? 'сбой сети' : String(status)
  return `${method} ${path} → ${code}${ms !== null ? ` · ${ms} мс` : ''}`
}

/**
 * Снимок консоли: последние записи (новые сверху) + статистика за окно
 * STATS_WINDOW_MS для плиток раздела «Логи».
 */
export function techSnapshot(): { entries: TechLogEntry[]; stats: ReturnType<typeof computeStats> } {
  const all = store.buf.slice()
  all.sort((a, b) => b.ts - a.ts)
  return { entries: all, stats: computeStats(all) }
}

function computeStats(entries: TechLogEntry[]): {
  windowMin: number
  calls: number
  avgMs: number | null
  errors: number
  slowest: { path: string; ms: number } | null
  sessions: number
} {
  const since = Date.now() - STATS_WINDOW_MS
  const fresh = entries.filter((e) => e.ts >= since)

  let calls = 0
  let msSum = 0
  let msCount = 0
  let errors = 0
  let slowest: { path: string; ms: number } | null = null
  const origins = new Set<string>()

  for (const e of fresh) {
    if (e.kind === 'api') {
      calls += 1
      if (e.origin) origins.add(e.origin)
      if (e.ms !== null) {
        msSum += e.ms
        msCount += 1
        if (!slowest || e.ms > slowest.ms) slowest = { path: `${e.method ?? ''} ${e.path ?? ''}`.trim(), ms: e.ms }
      }
      if (e.status === null || e.status >= 400) errors += 1
    } else if (e.level === 'ERROR') {
      errors += 1
    }
  }

  return {
    windowMin: Math.round(STATS_WINDOW_MS / 60_000),
    calls,
    avgMs: msCount > 0 ? Math.round(msSum / msCount) : null,
    errors,
    slowest,
    sessions: origins.size,
  }
}
