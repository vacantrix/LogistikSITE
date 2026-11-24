// «Журнал регистрации» 1С — аудит всех действий. Пишется из каждого доменного сервиса.
import type { Prisma, PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient | PrismaClient

export async function logEvent(
  tx: Tx,
  entry: {
    user: string
    action: string
    entity: string
    entityId?: string | null
    level?: 'info' | 'warning' | 'error'
  },
): Promise<void> {
  await tx.registrationLog.create({
    data: {
      user: entry.user,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      level: entry.level ?? 'info',
    },
  })
}
