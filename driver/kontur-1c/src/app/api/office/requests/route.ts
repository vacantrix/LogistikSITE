// API рабочего места «Заявки»: список с фильтром по статусу + создание заявки (сбыт)
import { db } from '@/lib/db'
import { jsonOffice } from '@/lib/cors'
import { createRequest, listRequests } from '@/lib/1c/requests'
import { requestRow } from '@/lib/office/serialize'
import { statusCounts } from '@/lib/1c/statusCounts'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const status = url.searchParams.get('status') ?? undefined
  const rows = await listRequests(status && status !== 'ALL' ? status : undefined)
  const inspections = await db.preTripInspection.findMany({ include: { steps: true } })
  const byRequest = new Map(inspections.map((i) => [i.requestId, i]))
  return jsonOffice({
    requests: rows.map((r) => requestRow(r, byRequest.get(r.id) ?? null)),
    counts: await statusCounts(),
  })
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonOffice({ ok: false, error: 'Некорректное тело запроса' }, 400)
  }
  const required = ['contractorId', 'cargo', 'weightT', 'fromLocationId', 'toLocationId', 'loadingAt'] as const
  const missing = required.filter((k) => !body[k])
  if (missing.length > 0)
    return jsonOffice({ ok: false, error: `Не заполнены обязательные поля: ${missing.join(', ')}` }, 400)

  const docs = Array.isArray(body.docs) ? (body.docs as string[]) : typeof body.docs === 'string' && body.docs.trim() ? (body.docs as string).split(',').map((s) => s.trim()) : []
  const req2 = await createRequest({
    contractorId: String(body.contractorId),
    cargo: String(body.cargo),
    weightT: Number(body.weightT),
    fromLocationId: String(body.fromLocationId),
    toLocationId: String(body.toLocationId),
    loadingAt: String(body.loadingAt),
    unloadingWindow: String(body.unloadingWindow ?? 'по согласованию'),
    docs,
    actor: String(body.actor ?? 'Логист'),
  })
  return jsonOffice({ ok: true, request: req2 })
}
