// Отмена заявки диспетчером: причина из справочника
import { jsonOffice } from '@/lib/cors'
import { cancelRequest } from '@/lib/1c/cancel'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { reason?: string; actor?: string }
  try {
    body = await req.json()
  } catch {
    return jsonOffice({ ok: false, error: 'Некорректное тело запроса' }, 400)
  }
  if (!body?.reason) return jsonOffice({ ok: false, error: 'Укажите причину отмены' }, 400)

  const result = await cancelRequest(id, body.reason, body.actor ?? 'Диспетчер')
  if (!result.ok) return jsonOffice(result, 400)
  return jsonOffice(result)
}
