/**
 * Демо-постановка: водитель+авто перевозчику-победителю, привязка к заявке Z-1048,
 * загрузка РЕАЛЬНЫХ сканов (upload/1 стр пас.jpg, upload/2 стр пасп.jpg) как PENDING.
 * Запуск: bun scripts/aemz-demo-setup.ts
 */
import { db } from '../src/lib/db'
import { readFileSync } from 'fs'

const dataUri = (path: string): string =>
  `data:image/jpeg;base64,${readFileSync(path).toString('base64')}`

async function main() {
  const carrier = await db.carrier.findFirst({ where: { users: { some: { login: 'carrier-b' } } } })
  if (!carrier) throw new Error('carrier-b carrier not found')
  const request = await db.request.findFirst({ where: { number: 'Z-1048' } })
  if (!request) throw new Error('Z-1048 not found')

  // водитель — данные с реальных сканов (сверка распознавания пойдёт по ним)
  let driver = await db.driver.findFirst({ where: { carrierId: carrier.id, fullName: 'Алексеев Алексей Владимирович' } })
  if (!driver) {
    driver = await db.driver.create({
      data: {
        carrierId: carrier.id,
        fullName: 'Алексеев Алексей Владимирович',
        birthDate: '31.01.1979',
        passport: '61 24 371725',
        phone: '+7 900 000-00-00',
        birthPlace: 'Рязанская обл.',
        address: 'Рязанская обл.',
        citizenship: 'РФ',
        passportIssuedBy: 'УМВД России по Рязанской области',
        passportIssuedDate: '08.04.2024',
      },
    })
    console.log('DRIVER_CREATED', driver.id)
  }

  let truck = await db.truck.findFirst({ where: { carrierId: carrier.id } })
  if (!truck) {
    truck = await db.truck.create({
      data: {
        carrierId: carrier.id,
        brand: 'КАМАЗ 5490',
        plate: 'АВ 1234 62',
        vin: 'XTC5640001K123456',
        sts: '50 12 345678',
        owner: 'ООО «Перевозчик Б»',
      },
    })
    console.log('TRUCK_CREATED', truck.id)
  }

  await db.request.update({
    where: { id: request.id },
    data: { driverId: driver.id, truckId: truck.id },
  })

  // реальные сканы как PENDING-документы заявки
  const docs: { type: string; fileName: string; path: string }[] = [
    { type: 'PASSPORT_PHOTO', fileName: 'Паспорт, стр 1.jpg', path: '/home/z/my-project/upload/1 стр пас.jpg' },
    { type: 'PASSPORT_REG', fileName: 'Паспорт, прописка.jpg', path: '/home/z/my-project/upload/2 стр пасп.jpg' },
  ]
  for (const d of docs) {
    const existing = await db.document.findFirst({ where: { requestId: request.id, type: d.type } })
    if (existing) {
      await db.document.update({
        where: { id: existing.id },
        data: { dataUri: dataUri(d.path), fileName: d.fileName, status: 'PENDING', fields: null, confidence: null, issues: null, message: null, quality: null, engine: null },
      })
      console.log('DOC_REFRESHED', d.type, existing.id)
    } else {
      const created = await db.document.create({
        data: { requestId: request.id, type: d.type, fileName: d.fileName, dataUri: dataUri(d.path), status: 'PENDING' },
      })
      console.log('DOC_CREATED', d.type, created.id)
    }
  }
  console.log('REQUEST_READY', request.number, request.id)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
