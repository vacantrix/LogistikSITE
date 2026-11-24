// Доменный сервис документа «Заказ на ТС» (TransportRequest):
// создание сбытом, переходы статусов с регистром StatusHistory.
import type { Prisma } from '@prisma/client'
import { db, withWriteLock } from '../db'
import { nextRequestNumber } from './numbering'
import { logEvent } from './journal'

export type CreateRequestInput = {
  contractorId: string
  cargo: string
  weightT: number
  fromLocationId: string
  toLocationId: string
  loadingAt: string | Date
  unloadingWindow: string
  docs: string[]
  actor?: string
}

// Сбыт заводит заявку: нумератор + запись в журнал + сразу DISPATCH (попадает в пул назначения)
export async function createRequest(input: CreateRequestInput) {
  return withWriteLock(() =>
    db.$transaction(async (tx) => {
    const number = await nextRequestNumber(tx)
    const req = await tx.transportRequest.create({
      data: {
        number,
        status: 'DISPATCH',
        contractorId: input.contractorId,
        cargo: input.cargo,
        weightT: input.weightT,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        loadingAt: new Date(input.loadingAt),
        unloadingWindow: input.unloadingWindow,
        docs: JSON.stringify(input.docs),
      },
      include: { contractor: true, fromLocation: true, toLocation: true },
    })
    await tx.statusHistory.create({
      data: { requestId: req.id, fromStatus: null, toStatus: 'NEW', actor: input.actor ?? 'Логист' },
    })
    await tx.statusHistory.create({
      data: { requestId: req.id, fromStatus: 'NEW', toStatus: 'DISPATCH', actor: 'Авто' },
    })
    await logEvent(tx, {
      user: input.actor ?? 'Логист',
      action: 'REQUEST_CREATE',
      entity: 'TransportRequest',
      entityId: number,
    })
      return req
    }, { timeout: 15000 }),
  )
}

// Смена статуса через «регистр статусов»
export async function changeStatus(
  tx: Prisma.TransactionClient,
  requestId: string,
  toStatus: string,
  actor: string,
  comment?: string,
): Promise<void> {
  const current = await tx.transportRequest.findUnique({ where: { id: requestId }, select: { status: true } })
  if (!current) throw new Error('Заявка не найдена')
  await tx.transportRequest.update({ where: { id: requestId }, data: { status: toStatus } })
  await tx.statusHistory.create({
    data: { requestId, fromStatus: current.status, toStatus, actor, comment },
  })
}

const requestInclude = {
  contractor: true,
  fromLocation: true,
  toLocation: true,
  vehicle: true,
  trailer: true,
  driver: true,
  trip: { include: { points: true, events: { orderBy: { occurredAt: 'asc' as const } } } },
} satisfies Prisma.TransportRequestInclude

export async function listRequests(status?: string) {
  return db.transportRequest.findMany({
    where: status ? { status } : undefined,
    include: requestInclude,
    orderBy: { number: 'desc' },
  })
}

export async function getRequest(idOrNumber: string) {
  return db.transportRequest.findFirst({
    where: { OR: [{ id: idOrNumber }, { number: idOrNumber }] },
    include: requestInclude,
  })
}
