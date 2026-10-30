/** Показ вердиктов автопроверки заявки Z-1048 */
import { db } from '../src/lib/db'

async function main() {
  const request = await db.request.findFirst({ where: { number: 'Z-1048' } })
  if (!request) throw new Error('Z-1048 not found')
  const docs = await db.document.findMany({
    where: { requestId: request.id },
    select: { type: true, fileName: true, status: true, quality: true, engine: true, fields: true, confidence: true, issues: true, message: true },
  })
  for (const d of docs) {
    console.log(`=== ${d.type} «${d.fileName}»: ${d.status}, quality=${d.quality}, engine=${d.engine}`)
    if (d.fields) console.log('FIELDS:', d.fields)
    if (d.confidence) console.log('CONF:', d.confidence)
    if (d.issues) console.log('ISSUES:', d.issues)
    if (d.message) console.log('MSG:', d.message)
  }
  const fresh = await db.request.findUnique({ where: { id: request.id }, select: { status: true } })
  console.log('REQUEST_STATUS:', fresh?.status)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
