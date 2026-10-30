/** Демо: вернуть Z-1048 в AWARDED, чтобы кнопка «Отправить на проверку» была доступна */
import { db } from '../src/lib/db'
async function main() {
  const r = await db.request.findFirst({ where: { number: 'Z-1048' } })
  if (!r) throw new Error('Z-1048 not found')
  await db.request.update({ where: { id: r.id }, data: { status: 'AWARDED' } })
  const docs = await db.document.findMany({ where: { requestId: r.id }, select: { type: true, status: true } })
  console.log('STATUS', r.number, '→ AWARDED', docs.map((d) => `${d.type}:${d.status}`).join(', '))
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
