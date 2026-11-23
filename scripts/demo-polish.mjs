/**
 * Доводка демо-данных к презентации: экипажи для всех рейсов и будущие сроки
 * приёма ставок у опубликованных заявок, чтобы автоторги не меняли статусы
 * во время показа. Запускается один раз после seed-demo-volume.mjs.
 */
import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()

const carriers = await p.carrier.findMany({
  include: {
    drivers: { orderBy: { fullName: 'asc' } },
    trucks: { orderBy: { plate: 'asc' } },
    trailers: { orderBy: { plate: 'asc' } },
  },
})
const byId = new Map(carriers.map((c) => [c.id, c]))

const tripStatuses = ['AWARDED', 'DOCS_REVIEW', 'AT_LOGIST', 'CONFIRMED', 'CLOSED']
const trips = await p.request.findMany({
  where: { status: { in: tripStatuses } },
  select: { id: true, number: true, winnerId: true, driverId: true, truckId: true, trailerId: true },
  orderBy: { number: 'asc' },
})

let assigned = 0
for (const r of trips) {
  if (!r.winnerId) continue
  if (r.driverId && r.truckId && r.trailerId) continue
  const c = byId.get(r.winnerId)
  if (!c) continue
  const n = Number(r.number.replace(/\D/g, '')) || 0
  const driver = r.driverId ?? c.drivers[n % c.drivers.length]?.id ?? null
  const truck = r.truckId ?? c.trucks[(n * 3) % c.trucks.length]?.id ?? null
  const trailer = r.trailerId ?? c.trailers[(n * 5) % c.trailers.length]?.id ?? null
  if (!driver || !truck || !trailer) continue
  await p.request.update({ where: { id: r.id }, data: { driverId: driver, truckId: truck, trailerId: trailer } })
  assigned++
}
console.log('Экипажи назначены:', assigned)

const published = await p.request.findMany({
  where: { status: 'PUBLISHED', onecRef: { startsWith: 'demo-vol-' } },
  select: { id: true, number: true },
})
for (const r of published) {
  const n = Number(r.number.replace(/\D/g, '')) || 0
  const deadline = new Date(Date.UTC(2026, 11, 1 + (n % 14), 9, 0, 0))
  await p.request.update({ where: { id: r.id }, data: { deadline } })
}
console.log('Сроки PUBLISHED продлены:', published.length)

const left = await p.request.count({
  where: {
    status: { in: tripStatuses },
    OR: [{ driverId: null }, { truckId: null }, { trailerId: null }],
  },
})
console.log('Осталось рейсов без экипажа:', left)
await p.$disconnect()
