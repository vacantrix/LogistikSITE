import { PrismaClient } from '@/generated/kontur-client'
import { writeContourAudit } from '@/lib/kontur/contour-audit'

/**
 * Клиент Prisma диспетчерской.
 *
 * Каждая запись AuditLog автоматически дублируется в единый журнал контура
 * (publish/logs/contour-audit.jsonl): так в сквозную историю попадают все
 * действия — и движка, и API-маршрутов, — без правок каждого обработчика.
 */
interface AuditRow {
  actorRole: string
  actorName?: string | null
  object: string
  objectId: string
  field?: string | null
  was?: string | null
  became?: string | null
  comment?: string | null
  at?: Date
}

function createClient() {
  // В монолите у платформы и диспетчерской пока разные SQLite-базы.
  // KONTUR_DATABASE_URL задаёт базу диспетчерской; DATABASE_URL платформы
  // (combat.db) сюда не подставляется, чтобы не читать чужие таблицы.
  const url = process.env.KONTUR_DATABASE_URL
  const base = new PrismaClient(url ? { datasourceUrl: url } : undefined)
  return base.$extends({
    query: {
      auditLog: {
        async create({ args, query }) {
          const row = (await query(args)) as AuditRow
          await writeContourAudit({
            contour: 'dispatcher',
            action: row.field ? `${row.object}.${row.field}` : row.object,
            actorName: row.actorName ?? null,
            actorRole: row.actorRole,
            objectType: row.object,
            objectId: row.objectId,
            before: row.was ?? null,
            after: row.became ?? null,
            message: row.comment ?? `${row.object} ${row.objectId}: ${row.was ?? '—'} → ${row.became ?? '—'}`,
            at: row.at?.toISOString(),
          })
          return row
        },
      },
    },
  })
}

type DbClient = ReturnType<typeof createClient>

// Единственный экземпляр Prisma-клиента на процесс (hot-reload dev-режима
// не плодит соединений; в проде — обычный синглтон).
// ВАЖНО: собственный ключ globalThis (konturPrisma), НЕ общий «prisma»:
// платформенный клиент (src/lib/db.ts) кэшируется под globalThis.prisma,
// и при общем ключе диспетчерская получала ПЛАТФОРМЕННЫЙ клиент (или наоборот,
// в зависимости от того, кто загрузился первым) — таблицы User путались
// и /kontur/api/state падал с «Unknown argument fullName».
const globalForPrisma = globalThis as unknown as { konturPrisma: DbClient | undefined }

export const db = globalForPrisma.konturPrisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.konturPrisma = db
