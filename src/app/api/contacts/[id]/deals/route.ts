import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { plog } from '@/lib/platform-log'

export const dynamic = 'force-dynamic'

/**
 * /api/contacts/[id]/deals (Task 5) — новая сделка контакта рабочей тетради:
 * переговоры по грузу (нашли груз) или машине (нашли перевозчика).
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

/** POST /api/contacts/[id]/deals — добавить сделку к контакту */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  const contact = await db.memoryContact.findUnique({ where: { id }, select: { id: true, name: true, company: true } })
  if (!contact) return NextResponse.json({ error: 'Контакт не найден' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })

  const direction = str(body.direction)
  if (direction && !DIRECTIONS.includes(direction)) {
    return NextResponse.json({ error: 'Недопустимое направление сделки' }, { status: 400 })
  }
  const status = str(body.status)
  if (status && !STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Недопустимый статус сделки' }, { status: 400 })
  }
  const amount = amountOf(body.amount)
  if (amount === 'bad') return NextResponse.json({ error: 'Сумма должна быть числом' }, { status: 400 })

  try {
    const deal = await db.memoryDeal.create({
      data: {
        contactId: id,
        direction: direction || 'load',
        route: str(body.route, 200),
        cargo: str(body.cargo, 200),
        amount,
        status: status || 'talks',
        dealDate: str(body.dealDate, 20) || null,
        notes: str(body.notes, 2000),
      },
    })
    await plog({
      type: 'DEAL_CREATED', source: 'api/contacts',
      actor: { login: auth.login, name: auth.name, role: auth.role },
      message: `Сделка по контакту «${contact.name}»${contact.company ? ` (${contact.company})` : ''} добавлена${deal.route ? `: ${deal.route}` : ''}${deal.cargo ? ` (${deal.cargo})` : ''}`,
      objectType: 'deal', objectId: deal.id,
      meta: { contactId: id, direction: deal.direction, status: deal.status, amount: deal.amount },
    })
    return NextResponse.json({ deal: toDealDTO(deal) }, { status: 201 })
  } catch (e) {
    console.error('[api/contacts/id/deals] POST:', e)
    return NextResponse.json({ error: 'Не удалось сохранить сделку' }, { status: 500 })
  }
}
