import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { notifyLive } from '@/lib/notify'
import { applyCrew, inTx, validateCrew } from '@/lib/requests'

export const dynamic = 'force-dynamic'

export interface BulkAssignRow {
  requestId: string
  driverId: string
  truckId: string
  trailerId?: string
}

export interface BulkAssignResult {
  requestId: string
  number: string
  ok: boolean
  error?: string
}

/**
 * POST /api/requests/bulk-assign — массовое назначение экипажей из Excel.
 * Принимает { rows: [{ requestId, driverId, truckId, trailerId }] } и вешает экипаж на каждый
 * выигранный рейс. Перевозчик — только свой (из сессии); проверки те же, что при назначении
 * по одной заявке: прицеп обязателен, срок техосмотра, занятость — в том числе
 * внутри самой загрузки (один водитель не пройдёт в двух строках).
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser('carrier')
  if (auth instanceof NextResponse) return auth
  const carrierId = auth.carrierId!

  const body = await req.json().catch(() => null)
  const rows = Array.isArray(body?.rows) ? (body.rows as Partial<BulkAssignRow>[]) : []
  if (rows.length === 0) return NextResponse.json({ error: 'Список заявок пуст' }, { status: 400 })
  if (rows.length > 50) return NextResponse.json({ error: 'Не больше 50 заявок за одну загрузку' }, { status: 400 })

  const taken = { drivers: new Map<string, string>(), trucks: new Map<string, string>(), trailers: new Map<string, string>() }
  const seenRequests = new Set<string>()
  const results: BulkAssignResult[] = []

  for (const row of rows) {
    const requestId = typeof row?.requestId === 'string' ? row.requestId : ''
    if (!requestId) {
      results.push({ requestId: '—', number: '—', ok: false, error: 'Некорректная строка' })
      continue
    }
    const request = await db.request.findUnique({ where: { id: requestId } })
    if (!request || request.winnerId !== carrierId) {
      results.push({ requestId, number: request?.number ?? '—', ok: false, error: request ? 'Рейс не закреплён за вашей компанией' : 'Заявка не найдена' })
      continue
    }
    if (seenRequests.has(requestId)) {
      results.push({ requestId, number: request.number, ok: false, error: 'Заявка встречается в загрузке повторно' })
      continue
    }
    seenRequests.add(requestId)
    if (request.status !== 'AWARDED' && request.status !== 'DOCS_REVIEW') {
      results.push({ requestId, number: request.number, ok: false, error: 'Заявка уже подана — повторная подача недоступна' })
      continue
    }

    try {
      const outcome = await inTx(async (tx) => {
        const crew = await validateCrew(tx, request, row, taken)
        if (typeof crew === 'string') return crew
        await applyCrew(tx, request, crew)
        await tx.event.create({
          data: {
            requestId, carrierId, type: 'DRIVER_ASSIGNED',
            message: `Массовая подача из Excel: ${crew.driver.fullName}, ${crew.truck.brand} (${crew.truck.plate}) + ${crew.trailer.plate}`,
          },
        })
        return crew
      })
      if (typeof outcome === 'string') {
        results.push({ requestId, number: request.number, ok: false, error: outcome })
        continue
      }
      taken.drivers.set(outcome.driver.id, request.number)
      taken.trucks.set(outcome.truck.id, request.number)
      taken.trailers.set(outcome.trailer.id, request.number)
      results.push({ requestId, number: request.number, ok: true })
      notifyLive({ type: 'DRIVER_ASSIGNED', requestId })
    } catch (e) {
      console.error('bulk-assign error', requestId, e)
      results.push({ requestId, number: request.number, ok: false, error: 'Не удалось назначить — повторите' })
    }
  }

  const assigned = results.filter((r) => r.ok).length
  return NextResponse.json({ assigned, total: rows.length, results })
}
