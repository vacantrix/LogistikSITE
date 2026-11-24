/**
 * Сид демо-данных «Контур 1С» (раздел 8 ТЗ).
 * Запуск: bun prisma/seed.ts  (или bun run db:seed)
 */
import { PrismaClient } from '@prisma/client'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { seedAll } from '../src/lib/seedAll'

const db = new PrismaClient()

// Журнал пересоздаётся — сбрасываем и отметку моста план обмена, иначе
// репликатор после сида мог бы переслать «старые» записи на телефон.
const bridgeState = process.env.DRIVER_BRIDGE_STATE ?? join(process.cwd(), 'db', 'bridge-state.json')
if (existsSync(bridgeState)) {
  rmSync(bridgeState)
  console.log('Отметка моста сброшена (db/bridge-state.json)')
}

seedAll(db)
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
