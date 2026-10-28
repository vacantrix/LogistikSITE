import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isStaff, requireUser } from '@/lib/auth'
import { notifyAdmins, notifyLogists, notifyUser } from '@/lib/notify-users'
import { plog } from '@/lib/platform-log'
import { attachmentError, canAccessTicket, TICKET_MAX_SIZE, toTicketDTO } from '@/lib/tickets'
import type { TicketMessageDTO, TicketThreadDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Сообщение ветки: вложения отдаются ссылками (файл читает /api/files/ticket-attachment/<id>) */
function toMessageDTO(m: {
  id: string; authorName: string; authorRole: string; staff: boolean; body: string; createdAt: Date
  attachments: { id: string; fileName: string; mime: string; isImage: boolean; sizeBytes: number }[]
}): TicketMessageDTO {
  return {
    id: m.id, authorName: m.authorName, authorRole: (m.authorRole === 'admin' ? 'admin' : m.authorRole === 'carrier' ? 'carrier' : 'logist'),
    staff: m.staff, body: m.body, createdAt: m.createdAt.toISOString(),
    attachments: m.attachments.map((a) => ({
      id: a.id, fileName: a.fileName, mime: a.mime, isImage: a.isImage, sizeBytes: a.sizeBytes,
      url: `/api/files/ticket-attachment/${a.id}`,
    })),
  }
}

/** GET /api/support/tickets/[id] — ветка обращения: обращение + сообщения */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const ticket = await db.ticket.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { attachments: { orderBy: { createdAt: 'asc' }, select: { id: true, fileName: true, mime: true, isImage: true, sizeBytes: true } } },
      },
    },
  })
  if (!ticket) return NextResponse.json({ error: 'Обращение не найдено' }, { status: 404 })
  if (!canAccessTicket(ticket, auth)) return NextResponse.json({ error: 'Обращение не найдено' }, { status: 404 })

  const thread: TicketThreadDTO = {
    ticket: toTicketDTO({ ...ticket, _count: { messages: ticket.messages.length } }),
    messages: ticket.messages.map(toMessageDTO),
    sizeLeft: Math.max(0, TICKET_MAX_SIZE - ticket.sizeTotal),
    // в закрытое обращение пишут только логист и администрация (открыть заново — действие reopen)
    canReply: isStaff(auth.role) || ticket.status !== 'CLOSED',
  }
  return NextResponse.json(thread)
}

/**
 * POST /api/support/tickets/[id] — сообщение в ветке:
 * { body, attachments?: [{ fileName, dataUri }] }
 * Ответ платформы (логист/администрация) переводит обращение в «Есть ответ»,
 * сообщение перевозчика возвращает в «Открыто».
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const ticket = await db.ticket.findUnique({ where: { id } })
  if (!ticket) return NextResponse.json({ error: 'Обращение не найдено' }, { status: 404 })
  if (!canAccessTicket(ticket, auth)) return NextResponse.json({ error: 'Обращение не найдено' }, { status: 404 })
  if (ticket.status === 'CLOSED' && !isStaff(auth.role)) {
    return NextResponse.json({ error: 'Обращение закрыто — откройте его заново, чтобы дописать сообщение' }, { status: 400 })
  }

  const body = (await req.json().catch(() => null)) as {
    body?: unknown; attachments?: { fileName?: unknown; dataUri?: unknown }[]
  } | null
  const text = str(body?.body, 5000)
  const atts = (body?.attachments ?? []).filter((a) => a && typeof a === 'object')
  if (!text && atts.length === 0) return NextResponse.json({ error: 'Пустое сообщение — напишите текст или приложите файл' }, { status: 400 })

  let newTotal = ticket.sizeTotal
  for (const a of atts) {
    const err = attachmentError(a.dataUri, TICKET_MAX_SIZE - newTotal)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
    newTotal += Math.floor(((a.dataUri as string).length * 3) / 4)
  }

  const staff = isStaff(auth.role)
  const message = await db.$transaction(async (tx) => {
    const created = await tx.ticketMessage.create({
      data: {
        ticketId: id, authorId: auth.id, authorName: auth.name, authorRole: auth.role, staff, body: text,
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
      include: { attachments: { orderBy: { createdAt: 'asc' }, select: { id: true, fileName: true, mime: true, isImage: true, sizeBytes: true } } },
    })
    await tx.ticket.update({
      where: { id },
      data: { status: staff ? 'ANSWERED' : 'OPEN', sizeTotal: newTotal, lastMessageAt: new Date() },
    })
    return created
  })

  await plog({
    type: 'TICKET_REPLIED', source: 'api/support/tickets',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    message: `Обращение №${ticket.number}: ${staff ? 'ответ платформы' : 'сообщение перевозчика'} (${auth.name})`,
  })

  // уведомления — после транзакции (правило P1008)
  try {
    if (staff) {
      await notifyUser(ticket.authorId, {
        type: 'TICKET_REPLY',
        title: `Ответ по обращению №${ticket.number}`,
        body: `${auth.name}: ${text.slice(0, 140) || 'приложил файл к обращению'}`,
      })
    } else {
      const payload = {
        type: 'TICKET_REPLY' as const,
        title: `Обращение №${ticket.number} — новое сообщение`,
        body: `${auth.name}: ${text.slice(0, 140) || 'приложил файл к обращению'}`,
      }
      await notifyLogists(payload)
      await notifyAdmins(payload)
    }
  } catch (e) {
    console.error('ticket reply notification error', e)
  }

  return NextResponse.json({ message: toMessageDTO(message) }, { status: 201 })
}

/**
 * PATCH /api/support/tickets/[id] — статус обращения: { action: 'close' | 'reopen' }.
 * Закрыть может автор или платформа; закрытое обращение перевозчик может открыть заново.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const ticket = await db.ticket.findUnique({ where: { id } })
  if (!ticket) return NextResponse.json({ error: 'Обращение не найдено' }, { status: 404 })
  if (!canAccessTicket(ticket, auth)) return NextResponse.json({ error: 'Обращение не найдено' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { action?: unknown }
  const action = body?.action === 'reopen' ? 'reopen' : body?.action === 'close' ? 'close' : null
  if (!action) return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })

  const status = action === 'close' ? 'CLOSED' : 'OPEN'
  await db.ticket.update({ where: { id }, data: { status } })

  await plog({
    type: action === 'close' ? 'TICKET_CLOSED' : 'TICKET_REOPENED',
    source: 'api/support/tickets',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    message: `Обращение №${ticket.number} ${action === 'close' ? 'закрыто' : 'открыто заново'} (${auth.name})`,
  })

  if (action === 'close' && isStaff(auth.role) && ticket.authorId !== auth.id) {
    try {
      await notifyUser(ticket.authorId, {
        type: 'TICKET_CLOSED',
        title: `Обращение №${ticket.number} закрыто`,
        body: `${auth.name} закрыл обращение. Если вопрос остался — откройте его заново или создайте новое обращение`,
      })
    } catch (e) {
      console.error('ticket close notification error', e)
    }
  }

  return NextResponse.json({ ok: true, status })
}
