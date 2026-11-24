// Определение водителя по заголовку X-Driver-Id (pull/push).
//
// В приложении водителя X-Driver-Id — это Driver.appId; на стенде допускается
// и id записи. Если заголовок пуст или содержит идентификатор, которого нет в
// текущей демо-БД (например, после пересборки базы приложение сохранило старый
// appId в SharedPreferences), берём единственного водителя стенда. Иначе
// синхронизация молча получает 404 и рейсы «не передаются» на телефон.
import { db } from '../db'

const STAND_DRIVER_APP_ID = '06c075d1-3088-45f2-a7ae-090e8c355447'

async function findDriver(key: string) {
  const byApp = await db.driver.findUnique({ where: { appId: key } })
  if (byApp) return byApp
  return db.driver.findUnique({ where: { id: key } })
}

export async function resolveDriver(req: Request) {
  const key = req.headers.get('x-driver-id')?.trim()
  if (key) {
    const found = await findDriver(key)
    if (found) return found
  }

  const stand = await db.driver.findUnique({ where: { appId: STAND_DRIVER_APP_ID } })
  if (stand) return stand

  return db.driver.findFirst({
    where: { appId: { not: null } },
    orderBy: { createdAt: 'asc' },
  })
}
