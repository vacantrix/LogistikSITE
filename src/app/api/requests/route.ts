import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toRequestDTO } from '@/lib/serialize'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** GET /api/requests — список заявок (фильтры: status, mode, q) */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const where: Prisma.RequestWhereInput = {}
  const status = sp.get('status')
  const mode = sp.get('mode')
  const q = sp.get('q')
  if (status) where.status = status
  if (mode) where.mode = mode
  if (q) {
    where.OR = [
      { number: { contains: q } },
      { cargo: { contains: q } },
      { fromPoint: { contains: q } },
      { toPoint: { contains: q } },
    ]
  }
  const requests = await db.request.findMany({
    where,
    include: { bids: { include: { carrier: true } }, documents: true, events: true, winner: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ requests: requests.map(toRequestDTO) })
}

/** POST /api/requests — логист публикует заявку */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 })
  const { fromPoint, toPoint, cargo, tonnage, truckType, mode, startRate, loadDate, loadWindow, deadlineHours } = body
  if (!fromPoint || !toPoint || !cargo || !startRate) {
    return NextResponse.json({ error: 'Заполните направление, груз и стартовую ставку' }, { status: 400 })
  }
  const maxNum = await db.request.findFirst({ orderBy: { number: 'desc' } })
  const nextN = Number((maxNum?.number ?? 'Z-1000').replace(/\D/g, '')) + 1
  const request = await db.request.create({
    data: {
      number: `Z-${nextN}`,
      fromPoint, toPoint, cargo,
      tonnage: Number(tonnage) || 20,
      truckType: truckType || 'Тент',
      mode: mode || 'AUCTION',
      startRate: Number(startRate),
      loadDate: loadDate || '—',
      loadWindow: loadWindow || '08:00–12:00',
      deadline: deadlineHours ? new Date(Date.now() + Number(deadlineHours) * 3600_000) : null,
      status: 'PUBLISHED',
      events: { create: { type: 'REQUEST_PUBLISHED', message: `Заявка опубликована логистом: стартовая ставка ${Number(startRate).toLocaleString('ru-RU')} ₽` } },
    },
    include: { bids: { include: { carrier: true } }, documents: true, events: true, winner: true },
  })
  return NextResponse.json({ request: toRequestDTO(request) }, { status: 201 })
}
