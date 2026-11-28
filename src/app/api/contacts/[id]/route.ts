import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { plog } from '@/lib/platform-log'

export const dynamic = 'force-dynamic'

/**
 * /api/contacts/[id] (Task 5) — правка и удаление контакта рабочей тетради.
 * Удаление каскадно убирает и все его сделки (onDelete: Cascade в схеме).
 */

const KINDS = ['carrier', 'shipper', 'driver', 'other']
const SOURCES = ['manual', 'ati']

const str = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Рейтинг «как отработали вместе» — целое 0..5 (клампится) */
const clampRating = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(5, Math.round(n)))
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

interface ContactRow {
  id: string
  name: string
  company: string
  kind: string
  phone: string
  email: string
  source: string
  atiRef: string | null
  rating: number
  notes: string
  createdAt: Date
  updatedAt: Date
  deals: DealRow[]
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

function toContactDTO(c: ContactRow) {
  const deals = [...c.deals]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(toDealDTO)
  return {
    id: c.id,
    name: c.name,
    company: c.company,
    kind: c.kind,
    phone: c.phone,
    email: c.email,
    source: c.source,
    atiRef: c.atiRef,
    rating: c.rating,
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    deals,
    dealsTotal: deals.length,
    dealsDone: deals.filter((d) => d.status === 'done').length,
    lastDealAt: deals.length > 0 ? deals[0].createdAt : null,
  }
}

type Params = { params: Promise<{ id: string }> }

/** PATCH /api/contacts/[id] — частичное обновление: меняются только присланные поля */
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })

  const existing = await db.memoryContact.findUnique({ where: { id }, select: { id: true, name: true, company: true } })
  if (!existing) return NextResponse.json({ error: 'Контакт не найден' }, { status: 404 })

  const data: {
    name?: string
    company?: string
    kind?: string
    phone?: string
    email?: string
    source?: string
    atiRef?: string | null
    rating?: number
    notes?: string
  } = {}

  if ('name' in body) {
    const name = str(body.name, 200)
    if (!name) return NextResponse.json({ error: 'Укажите имя контакта' }, { status: 400 })
    data.name = name
  }
  if ('company' in body) data.company = str(body.company, 200)
  if ('phone' in body) data.phone = str(body.phone, 40)
  if ('email' in body) data.email = str(body.email, 120)
  if ('notes' in body) data.notes = str(body.notes, 2000)
  if ('kind' in body) {
    const kind = str(body.kind)
    if (!KINDS.includes(kind)) return NextResponse.json({ error: 'Недопустимый тип контакта' }, { status: 400 })
    data.kind = kind
  }
  if ('source' in body) {
    const source = str(body.source)
    if (!SOURCES.includes(source)) return NextResponse.json({ error: 'Недопустимый источник контакта' }, { status: 400 })
    data.source = source
  }
  if ('rating' in body) data.rating = clampRating(body.rating)
  if ('atiRef' in body) data.atiRef = body.atiRef === null ? null : str(body.atiRef, 100) || null

  try {
    const contact = await db.memoryContact.update({ where: { id }, data, include: { deals: true } })
    await plog({
      type: 'CONTACT_UPDATED', source: 'api/contacts',
      actor: { login: auth.login, name: auth.name, role: auth.role },
      message: `Контакт «${contact.name}»${contact.company ? ` (${contact.company})` : ''} изменён`,
      objectType: 'contact', objectId: contact.id,
      meta: { fields: Object.keys(data) },
    })
    return NextResponse.json({ contact: toContactDTO(contact) })
  } catch (e) {
    console.error('[api/contacts/id] PATCH:', e)
    return NextResponse.json({ error: 'Не удалось сохранить контакт' }, { status: 500 })
  }
}

/** DELETE /api/contacts/[id] — контакт и (каскадом) все его сделки */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  const existing = await db.memoryContact.findUnique({ where: { id }, select: { id: true, name: true, company: true } })
  if (!existing) return NextResponse.json({ error: 'Контакт не найден' }, { status: 404 })

  try {
    await db.memoryContact.delete({ where: { id } })
    await plog({
      type: 'CONTACT_DELETED', source: 'api/contacts',
      actor: { login: auth.login, name: auth.name, role: auth.role },
      message: `Контакт «${existing.name}»${existing.company ? ` (${existing.company})` : ''} удалён вместе со сделками`,
      objectType: 'contact', objectId: id,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[api/contacts/id] DELETE:', e)
    return NextResponse.json({ error: 'Не удалось удалить контакт' }, { status: 500 })
  }
}
