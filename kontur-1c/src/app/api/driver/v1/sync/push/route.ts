// Шина приложения: push-операции водителя
// POST /api/driver/v1/sync/push { deviceId, operations: [{ opId, type, payload }] }
// → { results: [{ opId, status, rejectReason? }] }
import { db } from '@/lib/db'
import { json, optionsOk } from '@/lib/cors'
import { applyOperations, type PushOperation } from '@/lib/bus/appliers'
import { resolveDriver } from '@/lib/bus/resolveDriver'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const driver = await resolveDriver(req)
  if (!driver) return json({ ok: false, error: 'Водитель не найден (заголовок X-Driver-Id)' }, 404)

  let body: { deviceId?: string | null; operations?: PushOperation[] }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Некорректное тело запроса (ожидается JSON)' }, 400)
  }
  if (!Array.isArray(body?.operations))
    return json({ ok: false, error: 'Ожидается массив operations' }, 400)

  const results = await applyOperations(driver.id, body.deviceId ?? null, body.operations!)
  return json({ results })
}

export async function OPTIONS() {
  return optionsOk()
}
