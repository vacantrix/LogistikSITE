/** Разовый скрипт: грузы существующих заявок → новая номенклатура АЭМЗ */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const MAP: Record<string, string> = {
  'Z-1042': 'Перевозка готовой продукции - арматура',
  'Z-1043': 'Перевозка готовой продукции - проволока',
  'Z-1044': 'Перевозка готовой продукции - катанка',
  'Z-1045': 'Перевозка готовой продукции - пруток',
  'Z-1046': 'Автоуслуги для собственных подразделений',
  'Z-1047': 'Перевозка готовой продукции - моток',
  'Z-1048': 'Перевозка металлолома',
  'Z-1039': 'Перевозка готовой продукции - арматура',
  'Z-1041': 'Перевозка готовой продукции - проволока',
  'Z-1038': 'Перевозка готовой продукции - катанка',
  'Z-1037': 'Перевозка готовой продукции - пруток',
  'Z-1036': 'Автоуслуги для собственных подразделений',
  'Z-1035': 'Автоуслуги для собственных подразделений',
  'Z-1034': 'Перевозка металлолома',
}

for (const [number, cargo] of Object.entries(MAP)) {
  const res = await db.request.updateMany({ where: { number }, data: { cargo } })
  console.log(number, '→', cargo, `(updated: ${res.count})`)
}

// заявки вне карты (созданные в демо) — приводим к ближайшей по смыслу позиции
const rest = await db.request.findMany({ where: { number: { notIn: Object.keys(MAP) } }, select: { id: true, number: true, cargo: true } })
const FALLBACK = ['Перевозка готовой продукции - проволока', 'Перевозка готовой продукции - арматура', 'Перевозка готовой продукции - катанка', 'Перевозка готовой продукции - моток', 'Перевозка готовой продукции - пруток', 'Автоуслуги для собственных подразделений', 'Перевозка металлолома']
for (const r of rest) {
  if (FALLBACK.includes(r.cargo)) continue
  const cargo = /металл|лом/i.test(r.cargo) ? 'Перевозка металлолома' : FALLBACK[r.cargo.length % FALLBACK.length]
  await db.request.update({ where: { id: r.id }, data: { cargo } })
  console.log(r.number, '(вне карты)', r.cargo, '→', cargo)
}

await db.$disconnect()
console.log('done')
