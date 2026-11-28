/**
 * Журнал аудита диспетчерской (собственный транспорт АЭМЗ).
 *
 * Единый журнал: отдельной таблицы DispatchAuditLog больше нет — каждое действие
 * контура пишется напрямую в общий журнал платформы PlatformLog (contour =
 * dispatcher) и в сквозной JSONL-файл (writeContourAudit). Так «Журнал событий»
 * и «Логи платформы» показывают всё, включая собственный транспорт.
 */
import { writeContourAudit } from '@/lib/kontur/contour-audit'

export interface AuditEntry {
  actorRole: string // logist | admin | driver | system
  actorName?: string | null
  object: string // driver | vehicle | trailer | trip | plan | ati_deal | binding | call…
  objectId: string
  field?: string | null
  was?: string | null
  became?: string | null
  comment?: string | null
}

/** Записать действие контура в единый журнал (PlatformLog + JSONL).
 *  Сбой журнала не должен ломать операцию — writeContourAudit глотает ошибки. */
export async function audit(entry: AuditEntry): Promise<void> {
  await writeContourAudit({
    contour: 'dispatcher',
    action: entry.field ? `${entry.object}.${entry.field}` : entry.object,
    actorRole: entry.actorRole,
    actorName: entry.actorName ?? null,
    objectType: entry.object,
    objectId: entry.objectId,
    before: entry.was ?? null,
    after: entry.became ?? null,
    message: entry.comment ?? `${entry.object} ${entry.objectId}: ${entry.was ?? '—'} → ${entry.became ?? '—'}`,
  })
}
