/**
 * Task 33 (разовый, история): из номенклатуры грузов убрана позиция
 * «Автоуслуги для собственных подразделений», из типов ТС — «Реф» и «Изотерм».
 * Существующие заявки переводятся на оставшиеся позиции номенклатуры и «Тент».
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

/** адресный перенос грузов: по номеру заявки */
const CARGO_BY_NUMBER: Record<string, string> = {
  'Z-1046': 'Перевозка готовой продукции - моток',
  'Z-1036': 'Перевозка металлолома',
  'Z-1035': 'Перевозка готовой продукции - катанка',
}
const DEFAULT_CARGO = 'Перевозка готовой продукции - моток'

const requests = await db.request.findMany({
  where: {
    OR: [
      { cargo: 'Автоуслуги для собственных подразделений' },
      { truckType: { in: ['Реф', 'Изотерм'] } },
    ],
  },
  select: { id: true, number: true, cargo: true, truckType: true },
})

for (const r of requests) {
  const data: { cargo?: string; truckType?: string } = {}
  if (r.cargo === 'Автоуслуги для собственных подразделений') data.cargo = CARGO_BY_NUMBER[r.number] ?? DEFAULT_CARGO
  if (r.truckType === 'Реф' || r.truckType === 'Изотерм') data.truckType = 'Тент'
  await db.request.update({ where: { id: r.id }, data })
  console.log(`${r.number}: "${r.cargo}" / "${r.truckType}" → "${data.cargo ?? r.cargo}" / "${data.truckType ?? r.truckType}"`)
}

console.log(`обновлено заявок: ${requests.length}`)
await db.$disconnect()
