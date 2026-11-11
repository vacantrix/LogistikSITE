import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * Мьютекс записи: платформа работает в одном процессе Node, поэтому
 * последовательное выполнение пишущих транзакций гарантирует атомарность
 * (аналог SELECT … FOR UPDATE для SQLite; PostgreSQL в контуре стенда — обычные блокировки).
 */
let writeChain: Promise<unknown> = Promise.resolve()

export function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn)
  writeChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
