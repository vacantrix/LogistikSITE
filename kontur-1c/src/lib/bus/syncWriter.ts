// SyncJournalWriter — запись в «план обмена»: личный журнал водителя.
// Каждая прикладная запись обязана попадать в SyncJournal, иначе клиент её не увидит.
import type { Prisma } from '@prisma/client'

export type SyncEntity = 'TRIP' | 'TRIP_POINT' | 'TRIP_EVENT' | 'CHAT_MESSAGE' | 'SYSTEM_NOTE'
export type SyncOp = 'UPSERT' | 'DELETE'

export async function journalWrite(
  tx: Prisma.TransactionClient,
  driverId: string,
  entity: SyncEntity,
  op: SyncOp,
  payload: unknown,
): Promise<void> {
  await tx.syncJournal.create({
    data: {
      driverId,
      entity,
      op,
      payload: JSON.stringify(payload),
    },
  })
}
