/**
 * Журнал событий платформы (Task 76) — человек читает журнал, машина хранит историю.
 *
 * Пишем две копии одного события:
 *  1) PlatformLog в базе платформы — для экрана «Журнал событий», фильтров и статистики;
 *  2) publish/logs/contour-audit.jsonl — единый сквозной журнал контура: платформа
 *     и диспетчерская пишут туда в одном формате (кто, что, объект, до/после, IP).
 *
 * Запись fire-and-forget: бизнес-операция не должна падать из-за журнала.
 */
import { randomUUID } from 'crypto'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { writeContourAudit } from '@/lib/contour-audit'
import { logTech } from '@/lib/tech-log'

export type PlatformLogLevel = 'INFO' | 'WARN' | 'ERROR'

export interface PlatformLogEntry {
  level?: PlatformLogLevel
  /** Тип события: LOGIN, REQUEST_CREATED, BID_PLACED, EDO_SIGNED, SERVER_ERROR… */
  type: string
  /** Источник: auth/login, api/requests/action, 1c/etrn, browser… */
  source?: string
  actor?: { login?: string; name?: string; role?: string } | null
  requestId?: string | null
  requestNumber?: string | null
  carrierName?: string | null
  message: string
  /** Произвольные подробности — сохраняются в JSON-поле meta */
  meta?: unknown
  /** Сквозной идентификатор операции (если не задан — генерируется) */
  correlationId?: string | null
  /** Объект действия: request, user, document, trip… */
  objectType?: string | null
  objectId?: string | null
  /** Состояние до и после действия */
  before?: string | null
  after?: string | null
}

interface RequestMeta {
  ip: string | null
  userAgent: string | null
}

/** IP и User-Agent текущего запроса; вне запроса (cron, старт) — пусто */
async function requestMeta(): Promise<RequestMeta> {
  try {
    const h = await headers()
    const forwarded = h.get('x-forwarded-for')
    return {
      ip: forwarded?.split(',')[0]?.trim() || h.get('x-real-ip') || null,
      userAgent: h.get('user-agent')?.slice(0, 500) ?? null,
    }
  } catch {
    return { ip: null, userAgent: null }
  }
}

export async function plog(entry: PlatformLogEntry): Promise<void> {
  const correlationId = entry.correlationId ?? randomUUID()
  const { ip, userAgent } = await requestMeta()
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
        contour: 'platform',
        correlationId,
        objectType: entry.objectType ?? (entry.requestId ? 'request' : null),
        objectId: entry.objectId ?? entry.requestId ?? null,
        before: entry.before ?? null,
        after: entry.after ?? null,
        ip,
        userAgent,
      },
    })
  } catch (e) {
    console.error('[platform-log] write failed', e)
  }

  // сквозной журнал контура — даже если запись в БД не удалась
  await writeContourAudit({
    contour: 'platform',
    action: entry.type,
    actorLogin: entry.actor?.login ?? null,
    actorName: entry.actor?.name ?? null,
    actorRole: entry.actor?.role ?? null,
    objectType: entry.objectType ?? (entry.requestId ? 'request' : null),
    objectId: entry.objectId ?? entry.requestId ?? null,
    requestNumber: entry.requestNumber ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    message: entry.message.slice(0, 2000),
    ip,
    userAgent,
    correlationId,
    meta: entry.meta,
  })

  // техническая консоль («Логи»): предупреждения и сбои — короткой строкой,
  // чтобы в консоли была вся техника платформы, а не только вызовы API.
  // Обычные действия (INFO) — территория «Журнала событий», без дублей.
  if (entry.level === 'WARN' || entry.level === 'ERROR') {
    logTech({
      kind: entry.type === 'CLIENT_ERROR' ? 'client' : 'server',
      level: entry.level,
      path: (entry.source ?? '').slice(0, 200),
      message: `[${entry.type}] ${entry.message}`,
      origin: entry.actor?.login ?? null,
    })
  }
}

/** Ошибка: уровень ERROR + текст и стек в подробностях meta. */
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
