/**
 * Сид демо-данных «Контур 1С» (раздел 8 ТЗ).
 * Запуск: bun prisma/seed.ts  (или bun run db:seed)
 */
import { PrismaClient } from '@prisma/client'
import { seedAll } from '../src/lib/seedAll'

const db = new PrismaClient()

seedAll(db)
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
