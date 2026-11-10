// Сброс демо-данных: чистит все таблицы, ensureSeeded() пересоздаст сценарий Z-1067
// при первом обращении к API. Запуск: bun scripts/reset-db.ts
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  await db.markVote.deleteMany()
  await db.markPublicationLog.deleteMany()
  await db.roadMark.deleteMany()
  await db.syncJournal.deleteMany()
  await db.syncOperation.deleteMany()
  await db.chatMessage.deleteMany()
  await db.systemNote.deleteMany()
  await db.tripEvent.deleteMany()
  await db.tripPoint.deleteMany()
  await db.trip.deleteMany()
  console.log('demo db cleared — ensureSeeded will re-run on next API call')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
