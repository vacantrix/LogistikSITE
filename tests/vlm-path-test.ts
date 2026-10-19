/** Тест VLM-пути: генерируем PNG-документ, прогоняем полный цикл API */
import sharp from 'sharp'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const BASE = 'http://localhost:3000'

async function j(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, init)
  const data = await res.json()
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(data)}`)
  return data
}

async function main() {
  const { carriers } = await j('/api/directory')
  const carrierA = carriers.find((c: { name: string }) => c.name.includes('А»'))
  const driver = carrierA.drivers[0]
  const truck = carrierA.trucks[0]

  const { requests } = await j('/api/requests')
  const z1043 = requests.find((r: { number: string }) => r.number === 'Z-1043')

  // 1. Взять заявку (FIXED)
  await j(`/api/requests/${z1043.id}/action`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'take', carrierId: carrierA.id }),
  })
  // 2. Назначить водителя и ТС
  await j(`/api/requests/${z1043.id}/action`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'assign', driverId: driver.id, truckId: truck.id }),
  })

  // 3. Сгенерировать документ-подобный PNG (не SVG → пойдёт в VLM)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560">
    <rect width="800" height="560" fill="#f3e9dd"/>
    <text x="40" y="60" font-family="DejaVu Sans" font-size="30" font-weight="bold" fill="#8a1f1f">ПАСПОРТ РОССИЙСКОЙ ФЕДЕРАЦИИ</text>
    <rect x="50" y="100" width="200" height="260" fill="#d9c7b2" stroke="#8a7a63"/>
    <text x="60" y="220" font-family="DejaVu Sans" font-size="16" fill="#666">ФОТО</text>
    <text x="300" y="150" font-family="DejaVu Sans" font-size="24" fill="#222">Фамилия: ИВАНОВ</text>
    <text x="300" y="200" font-family="DejaVu Sans" font-size="24" fill="#222">Имя: ИВАН</text>
    <text x="300" y="250" font-family="DejaVu Sans" font-size="24" fill="#222">Отчество: ИВАНОВИЧ</text>
    <text x="300" y="300" font-family="DejaVu Sans" font-size="24" fill="#222">Дата рождения: 15.05.1990</text>
    <text x="300" y="350" font-family="DejaVu Sans" font-size="24" fill="#222">Серия и номер: 99 12 345678</text>
  </svg>`
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  const dataUri = `data:image/png;base64,${png.toString('base64')}`

  // 4. Загрузить документ
  await j(`/api/requests/${z1043.id}/documents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'PASSPORT_PHOTO', fileName: 'passport_camera_photo.png', dataUri }),
  })

  // 5. Проверка нейросетью
  const t0 = Date.now()
  const { request } = await j(`/api/requests/${z1043.id}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  const doc = request.documents.find((d: { type: string }) => d.type === 'PASSPORT_PHOTO')
  console.log(`engine: ${doc.engine}`)
  console.log(`status: ${doc.status}, quality: ${doc.quality}, время: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(`message: ${doc.message}`)
  console.log('fields:', JSON.stringify(doc.fields))
  console.log('confidence:', JSON.stringify(doc.confidence))
  console.log('issues:', JSON.stringify(doc.issues))
  console.log('request status:', request.status)
}

main().finally(() => db.$disconnect())
