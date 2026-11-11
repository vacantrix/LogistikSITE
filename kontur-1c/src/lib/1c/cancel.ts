// Отмена заявки диспетчером: причина из справочника + SystemNote водителю через план обмена.
import { db, withWriteLock } from '../db'
import { changeStatus } from './requests'
import { logEvent } from './journal'
import { systemNoteSnapshot } from '../bus/snapshots'
import { journalWrite } from '../bus/syncWriter'

export async function cancelRequest(requestId: string, reason: string, actor = 'Диспетчер') {
  const request = await db.transportRequest.findUnique({ where: { id: requestId }, include: { driver: true } })
  if (!request) return { ok: false as const, error: 'Заявка не найдена' }
  if (['DONE', 'CANCELLED'].includes(request.status))
    return { ok: false as const, error: `Заявка в статусе ${request.status} — отмена невозможна` }

  const result = await withWriteLock(() =>
    db.$transaction(async (tx) => {
    await changeStatus(tx, requestId, 'CANCELLED', actor, reason)
    await tx.transportRequest.update({ where: { id: requestId }, data: { closeReason: reason } })
    if (request.tripId) {
      await tx.trip.update({ where: { id: request.tripId }, data: { status: 'cancelled' } })
    }
    if (request.driverId) {
      const note = await tx.systemNote.create({
        data: {
          driverId: request.driverId,
          kind: 'ORDER_CANCELLED',
          body: `Заявка ${request.number} отменена диспетчером. Причина: ${reason}.`,
          ref: JSON.stringify({ requestId }),
        },
      })
      await journalWrite(tx, request.driverId, 'SYSTEM_NOTE', 'UPSERT', systemNoteSnapshot(note))
    }
    await logEvent(tx, { user: actor, action: 'CANCEL', entity: 'TransportRequest', entityId: request.number })
      return { number: request.number }
    }, { timeout: 15000 }),
  )
  return { ok: true as const, ...result }
}
