import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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
 * POST /api/requests/bulk-assign — массовая подача заявок из Excel.
 * Принимает список строк { requestId, driverId, truckId, trailerId? } и вешает
 * водителя/ТС на каждый выигранный перевозчиком рейс (без документов — фото
 * прикрепляются к каждой заявке отдельно, по одному на документ).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const carrierId = typeof body?.carrierId === 'string' ? body.carrierId : ''
  const rows = Array.isArray(body?.rows) ? (body.rows as BulkAssignRow[]) : []

  if (!carrierId) return NextResponse.json({ error: 'Нужен carrierId' }, { status: 400 })
  if (rows.length === 0) return NextResponse.json({ error: 'Список заявок пуст' }, { status: 400 })
  if (rows.length > 50) return NextResponse.json({ error: 'Не больше 50 заявок за одну загрузку' }, { status: 400 })

  const carrier = await db.carrier.findUnique({ where: { id: carrierId } })
  if (!carrier) return NextResponse.json({ error: 'Перевозчик не найден' }, { status: 404 })

  const driverIds = new Set((await db.driver.findMany({ where: { carrierId } })).map((d) => d.id))
  const truckIds = new Set((await db.truck.findMany({ where: { carrierId } })).map((t) => t.id))
  const trailerIds = new Set((await db.trailer.findMany({ where: { carrierId } })).map((t) => t.id))

  const results: BulkAssignResult[] = []
  for (const row of rows) {
    if (!row?.requestId || !row?.driverId || !row?.truckId) {
      results.push({ requestId: row?.requestId ?? '—', number: '—', ok: false, error: 'Некорректная строка' })
      continue
    }
    const request = await db.request.findUnique({ where: { id: row.requestId } })
    if (!request) {
      results.push({ requestId: row.requestId, number: '—', ok: false, error: 'Заявка не найдена' })
      continue
    }
    if (request.winnerId !== carrierId) {
      results.push({ requestId: row.requestId, number: request.number, ok: false, error: 'Рейс не закреплён за вашей компанией' })
      continue
    }
    if (request.status !== 'AWARDED' && request.status !== 'DOCS_REVIEW') {
      results.push({ requestId: row.requestId, number: request.number, ok: false, error: 'Заявка уже подана — повторная подача недоступна' })
      continue
    }
    if (!driverIds.has(row.driverId)) {
      results.push({ requestId: row.requestId, number: request.number, ok: false, error: 'Водитель не из базы аккаунта' })
      continue
    }
    if (!truckIds.has(row.truckId)) {
      results.push({ requestId: row.requestId, number: request.number, ok: false, error: 'Тягач не из базы аккаунта' })
      continue
    }
    if (row.trailerId && !trailerIds.has(row.trailerId)) {
      results.push({ requestId: row.requestId, number: request.number, ok: false, error: 'Прицеп не из базы аккаунта' })
      continue
    }

    // Правило занятости (Task 50): ресурс «в рейсе» назначить нельзя
    const active = await db.request.findMany({
      where: {
        status: { in: ['AT_LOGIST', 'CONFIRMED'] },
        id: { not: request.id },
        OR: [
          { driverId: row.driverId },
          { truckId: row.truckId },
          ...(row.trailerId ? [{ trailerId: row.trailerId }] : []),
        ],
      },
      select: { number: true, status: true, driverId: true, truckId: true, trailerId: true },
    })
    const hit = active[0]
    if (hit) {
      const place = `— уже ${hit.status === 'CONFIRMED' ? 'в рейсе' : 'готовится к рейсу'} по заявке ${hit.number}`
      const who = hit.driverId === row.driverId
        ? 'Водитель'
        : hit.truckId === row.truckId ? 'ТС' : 'Прицеп'
      results.push({ requestId: row.requestId, number: request.number, ok: false, error: `${who} занят ${place}` })
      continue
    }

    const driver = await db.driver.findUnique({ where: { id: row.driverId } })
    const truck = await db.truck.findUnique({ where: { id: row.truckId } })
    const trailer = row.trailerId ? await db.trailer.findUnique({ where: { id: row.trailerId } }) : null

    await db.request.update({
      where: { id: request.id },
      data: { driverId: row.driverId, truckId: row.truckId, trailerId: row.trailerId || null },
    })
    await db.event.create({
      data: {
        requestId: request.id,
        type: 'DRIVER_ASSIGNED',
        message: `Массовая подача из Excel: ${driver?.fullName ?? 'водитель'}, ${truck?.brand ?? ''} (${truck?.plate ?? ''})${trailer ? ` + ${trailer.plate}` : ''}`,
      },
    })
    results.push({ requestId: row.requestId, number: request.number, ok: true })
  }

  const assigned = results.filter((r) => r.ok).length
  return NextResponse.json({ assigned, total: rows.length, results })
}
