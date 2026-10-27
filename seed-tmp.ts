import { db } from './src/lib/db'
const ca = await db.user.findFirst({ where: { login: 'carrier-a' } })
if (!ca) throw new Error('carrier-a не найден')
const ids: string[] = []
for (let i = 1; i <= 10; i++) {
  const n = await db.notification.create({ data: {
    userId: ca.id, type: 'BID_PLACED',
    title: `[тест-9+] Новая ставка · №Z-10${String(40 + i).padStart(2, '0')}`,
    body: 'Временное уведомление для проверки бейджа — будет удалено.',
  } })
  ids.push(n.id)
}
console.log('создано:', ids.join(','))
await db.$disconnect()
