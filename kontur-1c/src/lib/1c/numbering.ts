// Нумератор документов «1С»: формат ЗК-ГГГГ/NNNN, годовой период, атомарный счётчик.
// Аналог SELECT … FOR UPDATE: инкремент внутри транзакции БД.
import type { Prisma, PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient | PrismaClient

export async function nextRequestNumber(tx: Tx, when: Date = new Date()): Promise<string> {
  const year = String(when.getFullYear())
  // атомарный счётчик с повторами при занятой БД (SQLite BUSY под параллельной записью)
  let lastError: unknown = null
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const counter = await tx.numberCounter.upsert({
        where: { year },
        create: { year, last: 1001 },
        update: { last: { increment: 1 } },
      })
      return `ЗК-${year}/${counter.last}`
    } catch (e) {
      lastError = e
      const msg = e instanceof Error ? e.message : ''
      if (!/busy|locked|timeout/i.test(msg)) throw e
      await new Promise((r) => setTimeout(r, 60 * (attempt + 1)))
    }
  }
  throw lastError
}
