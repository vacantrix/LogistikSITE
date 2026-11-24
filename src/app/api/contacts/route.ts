import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * «Память контактов» (Task 5) — рабочая тетрадь логиста/экспедитора: с кем работали
 * и какие сделки заключались. Раздел внутреннего контура АЭМЗ — доступ логистам
 * и администрации.
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

/** GET /api/contacts — все контакты со сделками и сводкой по статусам */
export async function GET() {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  try {
    const rows = await db.memoryContact.findMany({
      include: { deals: true },
      orderBy: { updatedAt: 'desc' },
    })
    const contacts = rows.map(toContactDTO)
    const deals = contacts.flatMap((c) => c.deals)
    return NextResponse.json({
      contacts,
      stats: {
        total: contacts.length,
        done: deals.filter((d) => d.status === 'done').length,
        talks: deals.filter((d) => d.status === 'talks').length,
        refused: deals.filter((d) => d.status === 'refuse').length,
      },
    })
  } catch (e) {
    console.error('[api/contacts] GET:', e)
    return NextResponse.json({ error: 'Не удалось загрузить контакты' }, { status: 500 })
  }
}

/** POST /api/contacts — новый контакт рабочей тетради */
export async function POST(req: NextRequest) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })

  const name = str(body.name, 200)
  if (!name) return NextResponse.json({ error: 'Укажите имя контакта' }, { status: 400 })

  const kindRaw = str(body.kind)
  const kind = KINDS.includes(kindRaw) ? kindRaw : 'carrier'
  const sourceRaw = str(body.source)
  const source = SOURCES.includes(sourceRaw) ? sourceRaw : 'manual'

  try {
    const contact = await db.memoryContact.create({
      data: {
        name,
        company: str(body.company, 200),
        kind,
        phone: str(body.phone, 40),
        email: str(body.email, 120),
        source,
        atiRef: str(body.atiRef, 100) || null,
        rating: clampRating(body.rating),
        notes: str(body.notes, 2000),
      },
      include: { deals: true },
    })
    return NextResponse.json({ contact: toContactDTO(contact) }, { status: 201 })
  } catch (e) {
    console.error('[api/contacts] POST:', e)
    return NextResponse.json({ error: 'Не удалось сохранить контакт' }, { status: 500 })
  }
}
