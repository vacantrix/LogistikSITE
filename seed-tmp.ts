import { db } from './src/lib/db'
const ca = await db.user.findFirst({ where: { login: 'carrier-a' } })
const ids: string[] = []
for (let i = 1; i <= 10; i++) {
  const n = await db.notification.create({ data: {
    userId: ca!.id, type: 'BID_PLACED',
    title: `[тест-9+] Проверка бейджа №${i}`,
    body: 'Временное уведомление — будет удалено.',
  } })
  ids.push(n.id)
}
console.log('ok')
await db.$disconnect()
