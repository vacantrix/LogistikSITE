// Назначение ТС и водителя: проведение + рождение рейса (одна транзакция, раздел 5.3 ТЗ)
import { jsonOffice } from '@/lib/cors'
import { assignRequest } from '@/lib/1c/assign'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { vehicleId?: string; trailerId?: string | null; driverId?: string; actor?: string }
  try {
    body = await req.json()
  } catch {
    return jsonOffice({ ok: false, errors: ['Некорректное тело запроса'] }, 400)
  }
  if (!body?.vehicleId || !body?.driverId)
    return jsonOffice({ ok: false, errors: ['Нужны vehicleId и driverId'] }, 400)

  const result = await assignRequest(
    id,
    { vehicleId: body.vehicleId, trailerId: body.trailerId ?? null, driverId: body.driverId },
    body.actor ?? 'Диспетчер',
  )
  if (!result.ok) return jsonOffice({ ok: false, errors: result.errors }, 400)
  return jsonOffice(result)
}
