import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isStaff, requireUser } from '@/lib/auth'
import { notifyAdmins, notifyLogists } from '@/lib/notify-users'
import { plog } from '@/lib/platform-log'
import { attachmentError, TICKET_CATEGORIES, TICKET_MAX_SIZE, toTicketDTO } from '@/lib/tickets'
import type { TicketCategory } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/support/tickets?status=&q= — обращения: перевозчик видит обращения своей
 * компании, логист и администрация — все. Сортировка: свежая активность сверху.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const sp = req.nextUrl.searchParams
  const status = sp.get('status') ?? ''
  const q = (sp.get('q') ?? '').trim().slice(0, 100)
  const numberQ = Number(q)

  const where = {
    ...(!isStaff(auth.role) ? { OR: [{ authorId: auth.id }, ...(auth.carrierId ? [{ carrierId: auth.carrierId }] : [])] } : {}),
    ...(['OPEN', 'ANSWERED', 'CLOSED'].includes(status) ? { status } : {}),
    ...(q ? { OR: [{ subject: { contains: q } }, ...(Number.isFinite(numberQ) && numberQ > 0 ? [{ number: numberQ }] : [])] } : {}),
  }

  const tickets = await db.ticket.findMany({
    where,
    orderBy: { lastMessageAt: 'desc' },
    include: {
      _count: { select: { messages: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { authorName: true, staff: true, body: true, createdAt: true } },
    },
    take: 200,
  })
  return NextResponse.json({ tickets: tickets.map(toTicketDTO) })
}

/**
 * POST /api/support/tickets — создать обращение (Task 109):
 * { subject, category, body, attachments?: [{ fileName, dataUri }] }
 * Первое сообщение — описание проблемы; вложения в рамках 10 МБ на обращение.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as {
    subject?: unknown; category?: unknown; body?: unknown
    attachments?: { fileName?: unknown; dataUri?: unknown }[]
  } | null

  const subject = typeof body?.subject === 'string' ? body.subject.trim().slice(0, 200) : ''
  const text = typeof body?.body === 'string' ? body.body.trim().slice(0, 5000) : ''
  const category = TICKET_CATEGORIES.includes(body?.category as TicketCategory) ? (body?.category as TicketCategory) : 'other'
  if (!subject) return NextResponse.json({ error: 'Укажите тему обращения' }, { status: 400 })
  if (!text) return NextResponse.json({ error: 'Опишите проблему — без описания обращение не создать' }, { status: 400 })

  const atts = (body?.attachments ?? []).filter((a) => a && typeof a === 'object')
  let sizeTotal = 0
  for (const a of atts) {
    const err = attachmentError(a.dataUri, TICKET_MAX_SIZE - sizeTotal)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
    sizeTotal += Math.floor(((a.dataUri as string).length * 3) / 4)
  }

  // компания автора — для кабинета перевозчика (обращение видно всем учёткам компании)
  const carrier = auth.carrierId
    ? await db.carrier.findUnique({ where: { id: auth.carrierId }, select: { name: true } })
    : null

  const ticket = await db.$transaction(async (tx) => {
    const max = await tx.ticket.aggregate({ _max: { number: true } })
    const number = (max._max.number ?? 0) + 1
    return tx.ticket.create({
      data: {
        number, subject, category, status: 'OPEN',
        authorId: auth.id, authorName: auth.name,
        carrierId: auth.carrierId, carrierName: carrier?.name ?? null,
        sizeTotal,
        messages: {
          create: {
            authorId: auth.id, authorName: auth.name, authorRole: auth.role, staff: false, body: text,
            attachments: {
              create: atts.map((a) => {
                const uri = a.dataUri as string
                const mime = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)[;,]/i.exec(uri)?.[1]?.toLowerCase() ?? ''
                return {
                  fileName: String(a.fileName ?? 'файл').slice(0, 200),
                  mime, isImage: mime.startsWith('image/'),
                  sizeBytes: Math.floor((uri.length * 3) / 4),
                  dataUri: uri,
                }
              }),
            },
          },
        },
      },
      include: { messages: true },
    })
  })

  await plog({
    type: 'TICKET_CREATED', source: 'api/support/tickets',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    message: `Новое обращение №${ticket.number}: ${subject} (${auth.name})`,
  })

  // уведомления — после транзакции: платформа (логисты и администрация) узнаёт о новом обращении
  const payload = {
    type: 'TICKET_NEW' as const,
    title: `Новое обращение №${ticket.number}`,
    body: `${auth.name}: ${subject}`,
  }
  try {
    await notifyLogists(payload)
    await notifyAdmins(payload)
  } catch (e) {
    console.error('ticket notification error', e)
  }

  return NextResponse.json({ ticket: toTicketDTO({ ...ticket, _count: { messages: ticket.messages.length } }) }, { status: 201 })
}
