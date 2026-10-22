/**
 * Журнал событий платформы (Task 76) — серверная сторона.
 *
 * Единая точка записи в таблицу PlatformLog: бизнес-события (вход, заявки,
 * ставки, документы, ЭДО, интеграция с 1С), предупреждения и ошибки.
 * Пишем fire-and-forget: сбой журналирования никогда не ломает основной
 * сценарий — ошибка записи уходит только в консоль сервера.
 *
 * Необработанные ошибки маршрутов дополнительно ловит instrumentation.ts
 * (onRequestError), клиентские — эндпоинт /api/platform-log/client.
 * Лентой журнал показывает раздел «Журнал событий» (только логист).
 */
import { db } from '@/lib/db'

export type PlatformLogLevel = 'INFO' | 'WARN' | 'ERROR'

export interface PlatformLogEntry {
  level?: PlatformLogLevel
  /** вид события: LOGIN, REQUEST_CREATED, BID_PLACED, EDO_SIGNED, SERVER_ERROR… */
  type: string
  /** источник: auth/login, api/requests/action, 1c/etrn, browser… */
  source?: string
  actor?: { login?: string; name?: string; role?: string } | null
  requestId?: string | null
  requestNumber?: string | null
  carrierName?: string | null
  message: string
  /** произвольные подробности — сериализуются в JSON-колонку meta */
  meta?: unknown
}

export async function plog(entry: PlatformLogEntry): Promise<void> {
  try {
    await db.platformLog.create({
      data: {
        level: entry.level ?? 'INFO',
        type: entry.type,
        source: entry.source ?? 'platform',
        actorLogin: entry.actor?.login ?? null,
        actorName: entry.actor?.name ?? null,
        actorRole: entry.actor?.role ?? null,
        requestId: entry.requestId ?? null,
        requestNumber: entry.requestNumber ?? null,
        carrierName: entry.carrierName ?? null,
        message: entry.message.slice(0, 2000),
        meta: entry.meta === undefined ? null : safeJson(entry.meta),
      },
    })
  } catch (e) {
    console.error('[platform-log] write failed', e)
  }
}

/** Ошибка: уровень ERROR + стек и подробности в meta. Поля ctx при желании переопределяют значения */
export async function plogError(source: string, err: unknown, ctx: Partial<PlatformLogEntry> = {}): Promise<void> {
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? (err.stack ?? null) : null
  await plog({
    level: 'ERROR',
    type: ctx.type ?? 'SERVER_ERROR',
    source: ctx.source ?? source,
    actor: ctx.actor ?? null,
    requestId: ctx.requestId ?? null,
    requestNumber: ctx.requestNumber ?? null,
    carrierName: ctx.carrierName ?? null,
    message: ctx.message ?? `Ошибка: ${message}`,
    meta: { ...(ctx.meta as Record<string, unknown> | undefined), stack: stack?.slice(0, 4000) },
  })
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v).slice(0, 8000)
  } catch {
    return '"[не сериализуется]"'
  }
}
