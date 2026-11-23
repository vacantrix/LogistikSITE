// Диагностика канала «телефон → сервер»: GET /api/driver/v1/health
// Открывается прямо в браузере телефона и не требует заголовков.
import { db } from '@/lib/db'
import { json, optionsOk } from '@/lib/cors'

export const dynamic = 'force-dynamic'

export async function GET() {
  const driver = await db.driver.findUnique({
    where: { appId: '06c075d1-3088-45f2-a7ae-090e8c355447' },
  })
  const max = driver
    ? await db.syncJournal.aggregate({ where: { driverId: driver.id }, _max: { seq: true } })
    : null

  return json({
    ok: true,
    service: 'driver-api',
    time: new Date().toISOString(),
    driver: driver ? { id: driver.id, appId: driver.appId, name: driver.fullName } : null,
    maxSeq: max?._max.seq ?? 0,
  })
}

export async function OPTIONS() {
  return optionsOk()
}
