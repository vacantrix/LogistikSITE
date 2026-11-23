/**
 * Единый журнал контура логистики (сторона диспетчерской).
 *
 * Пишет те же JSONL-строки, что и платформа, в общий файл CONTOUR_AUDIT_FILE.
 * Вызывается из движка и маршрутов: каждое действие диспетчерской попадает
 * в сквозную историю контура.
 */
import { appendFile, mkdir, readFile } from 'fs/promises'
import { dirname, join } from 'path'

export type ContourSource = 'platform' | 'dispatcher'

export interface ContourAuditEntry {
  contour: ContourSource
  action: string
  actorLogin?: string | null
  actorName?: string | null
  actorRole?: string | null
  objectType?: string | null
  objectId?: string | null
  requestNumber?: string | null
  before?: string | null
  after?: string | null
  message?: string
  ip?: string | null
  userAgent?: string | null
  correlationId?: string | null
  meta?: unknown
  at?: string
}

const auditFile = (): string =>
  process.env.CONTOUR_AUDIT_FILE || join(process.cwd(), 'logs', 'contour-audit.jsonl')

let dirReady: string | null = null

function safeMeta(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value, (key, v) =>
      /pass(word)?|token|secret|authorization|cookie/i.test(key) ? '[redacted]' : v))
  } catch {
    return undefined
  }
}

export async function writeContourAudit(entry: ContourAuditEntry): Promise<void> {
  try {
    const target = auditFile()
    const dir = dirname(target)
    if (dirReady !== dir) {
      await mkdir(dir, { recursive: true })
      dirReady = dir
    }
    const at = entry.at ?? new Date().toISOString()
    const line = JSON.stringify({ ...entry, at, meta: safeMeta(entry.meta) })
    await appendFile(target, `${line.slice(0, 32_000)}\n`, 'utf8')
  } catch (e) {
    console.error('[contour-audit] write failed', e)
  }
}

export interface ContourAuditFilter {
  q?: string
  contour?: ContourSource | 'all'
  action?: string
  limit?: number
}

/** Последние записи сквозного журнала (новые сверху) — для экрана «Журнал контура» */
export async function readContourAudit(filter: ContourAuditFilter = {}): Promise<ContourAuditEntry[]> {
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 200), 1), 2000)
  const q = (filter.q ?? '').trim().toLowerCase()
  const action = (filter.action ?? '').trim().toLowerCase()
  try {
    const text = await readFile(auditFile(), 'utf8')
    const lines = text.split('\n').filter(Boolean)
    const out: ContourAuditEntry[] = []
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        const item = JSON.parse(lines[i]) as ContourAuditEntry
        if (filter.contour && filter.contour !== 'all' && item.contour !== filter.contour) continue
        if (action && !item.action.toLowerCase().includes(action)) continue
        if (q) {
          const hay = [item.action, item.actorLogin, item.actorName, item.actorRole,
            item.objectType, item.objectId, item.requestNumber, item.message]
            .filter(Boolean).join(' ').toLowerCase()
          if (!hay.includes(q)) continue
        }
        out.push(item)
      } catch { /* битая строка не ломает чтение журнала */ }
    }
    return out
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
}
