// Принудительное завершение рейса диспетчером («закрыть зависший рейс»).
//
// Сценарий: рейс назначен (assigned / in_progress), но водитель не завершает его
// в приложении (тестовые данные, водитель недоступен, ошибка на телефоне). Пока
// рейс не завершён, водитель считается «занятым» и не может получить новую
// заявку (правила проведения 5.3 ТЗ). Диспетчер закрывает рейс вручную:
//
//   заявка → DONE (регистр статусов) + событие TRIP_DONE (закрывает открытые
//   интервалы, ставит рейсу completed) + SystemNote водителю — всё в одной
//   транзакции и в плане обмена (SyncJournal), чтобы телефон увидел закрытие
//   при ближайшей синхронизации.
import { db, withWriteLock } from '../db'
import { changeStatus } from './requests'
import { logEvent } from './journal'
import { applyTripEvent } from './tripEvents'
import { systemNoteSnapshot } from '../bus/snapshots'
import { journalWrite } from '../bus/syncWriter'

export type ForceCompleteResult =
  | { ok: true; number: string }
  | { ok: false; error: string }

export async function forceCompleteTrip(requestIdOrNumber: string, actor = 'Диспетчер'): Promise<ForceCompleteResult> {
  const request = await db.transportRequest.findFirst({
    where: { OR: [{ id: requestIdOrNumber }, { number: requestIdOrNumber }] },
    select: {
      id: true, number: true, status: true, tripId: true, driverId: true, vehicleId: true,
    },
  })
  if (!request) return { ok: false, error: 'Заявка не найдена' }
  if (['DONE', 'CANCELLED'].includes(request.status))
    return { ok: false, error: `Заявка в статусе ${request.status} — завершение невозможно` }
  if (!request.tripId) return { ok: false, error: 'У заявки нет рейса' }
  if (!request.driverId || !request.vehicleId)
    return { ok: false, error: 'У заявки не заполнены водитель или ТС' }

  const result = await withWriteLock(() =>
    db.$transaction(async (tx) => {
      await changeStatus(tx, request.id, 'DONE', actor, 'Рейс завершён диспетчером (принудительно)')
      await applyTripEvent(tx, {
        tripId: request.tripId!,
        type: 'TRIP_DONE',
        driverId: request.driverId!,
        vehicleId: request.vehicleId!,
        source: 'MANUAL',
        note: 'Завершён диспетчером принудительно',
      })
      const note = await tx.systemNote.create({
        data: {
          driverId: request.driverId!,
          kind: 'TRIP_UPDATED',
          body: `Рейс ${request.number} закрыт диспетчером. Если вы ещё в пути — свяжитесь с диспетчером.`,
          ref: JSON.stringify({ requestId: request.id, tripId: request.tripId }),
        },
      })
      await journalWrite(tx, request.driverId!, 'SYSTEM_NOTE', 'UPSERT', systemNoteSnapshot(note))
      await logEvent(tx, {
        user: actor,
        action: 'TRIP_FORCE_COMPLETE',
        entity: 'TransportRequest',
        entityId: request.number,
      })
      return { number: request.number }
    }, { timeout: 15000 }),
  )
  return { ok: true, ...result }
}
