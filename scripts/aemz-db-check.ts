/** Диагностика: заявки на этапах проверки документов и их документы */
import { db } from '../src/lib/db'

async function main() {
  const reqs = await db.request.findMany({
    where: { status: { in: ['AWARDED', 'DOCS_REVIEW'] } },
    select: { id: true, number: true, status: true, winnerId: true, driverId: true, truckId: true },
    take: 10,
    orderBy: { createdAt: 'desc' },
  })
  console.log('REQUESTS_IN_VERIFY_STAGES:', reqs.length)
  for (const r of reqs) {
    const docs = await db.document.findMany({
      where: { requestId: r.id },
      select: { id: true, type: true, status: true, fileName: true },
    })
    console.log(JSON.stringify({ request: r, docs }, null, 1))
  }
  const users = await db.user.findMany({
    select: { login: true, name: true, role: true },
    take: 10,
  })
  console.log('USERS:', JSON.stringify(users))
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
