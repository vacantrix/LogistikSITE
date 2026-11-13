// SyncJournalWriter — запись в «план обмена»: личный журнал водителя.
// Каждая прикладная запись обязана попадать в SyncJournal, иначе клиент её не увидит.
// Попутно лениво стартует мост на драйверский сервер (replicator.ts): записи
// уходят на телефон водителя уже ПОСЛЕ коммита транзакции, сбой моста ничего не валит.
import type { Prisma } from '@prisma/client'
import { ensureBridgeReplicator } from './replicator'

export type SyncEntity = 'TRIP' | 'TRIP_POINT' | 'TRIP_EVENT' | 'CHAT_MESSAGE' | 'SYSTEM_NOTE'
export type SyncOp = 'UPSERT' | 'DELETE'

export async function journalWrite(
  tx: Prisma.TransactionClient,
  driverId: string,
  entity: SyncEntity,
  op: SyncOp,
  payload: unknown,
): Promise<void> {
  const row = await tx.syncJournal.create({
    data: {
      driverId,
      entity,
      op,
      payload: JSON.stringify(payload),
    },
    select: { seq: true },
  })
  // пол ленивого старта моста: текущая транзакция (её seq) не должна быть
  // проглочена инициализацией водяной отметки
  ensureBridgeReplicator(row.seq - 1)
}
