import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * /api/deals/[id] (Task 5) — правка и удаление сделки из рабочей тетради.
 */

const DIRECTIONS = ['load', 'truck']
const STATUSES = ['talks', 'done', 'refuse', 'lost']

const str = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Сумма сделки: число или null (пусто). Строка с запятой допустима; NaN — ошибка. */
function amountOf(v: unknown): number | null | 'bad' {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').trim())
  return Number.isFinite(n) ? n : 'bad'
}

interface DealRow {
  id: string
  contactId: string
  direction: string
  route: string
  cargo: string
  amount: number | null
  status: string
  dealDate: string | null
  notes: string
  createdAt: Date
  updatedAt: Date
}

function toDealDTO(d: DealRow) {
  return {
    id: d.id,
    contactId: d.contactId,
    direction: d.direction,
    route: d.route,
    cargo: d.cargo,
    amount: d.amount,
    status: d.status,
    dealDate: d.dealDate,
    notes: d.notes,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }
}

type Params = { params: Promise<{ id: string }> }

/** PATCH /api/deals/[id] — частичное обновление: меняются только присланные поля */
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })

  const existing = await db.memoryDeal.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'Сделка не найдена' }, { status: 404 })

  const data: {
    direction?: string
    route?: string
    cargo?: string
    amount?: number | null
    status?: string
    dealDate?: string | null
    notes?: string
  } = {}

  if ('direction' in body) {
    const direction = str(body.direction)
    if (!DIRECTIONS.includes(direction)) {
      return NextResponse.json({ error: 'Недопустимое направление сделки' }, { status: 400 })
    }
    data.direction = direction
  }
  if ('status' in body) {
    const status = str(body.status)
    if (!STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Недопустимый статус сделки' }, { status: 400 })
    }
    data.status = status
  }
  if ('route' in body) data.route = str(body.route, 200)
  if ('cargo' in body) data.cargo = str(body.cargo, 200)
  if ('notes' in body) data.notes = str(body.notes, 2000)
  if ('dealDate' in body) data.dealDate = str(body.dealDate, 20) || null
  if ('amount' in body) {
    const amount = amountOf(body.amount)
    if (amount === 'bad') return NextResponse.json({ error: 'Сумма должна быть числом' }, { status: 400 })
    data.amount = amount
  }

  try {
    const deal = await db.memoryDeal.update({ where: { id }, data })
    return NextResponse.json({ deal: toDealDTO(deal) })
  } catch (e) {
    console.error('[api/deals/id] PATCH:', e)
    return NextResponse.json({ error: 'Не удалось сохранить сделку' }, { status: 500 })
  }
}

/** DELETE /api/deals/[id] — убрать запись о сделке */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  const existing = await db.memoryDeal.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'Сделка не найдена' }, { status: 404 })

  try {
    await db.memoryDeal.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[api/deals/id] DELETE:', e)
    return NextResponse.json({ error: 'Не удалось удалить сделку' }, { status: 500 })
  }
}
