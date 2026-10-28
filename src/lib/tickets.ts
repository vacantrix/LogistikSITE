/**
 * Обращения в поддержку (Task 109) — серверные хелперы, общие для маршрутов /api/support.
 * Лимит вложений — 10 МБ суммарно на обращение; вложения хранятся на сообщениях.
 */
import { db } from '@/lib/db'
import { isStaff, type SessionUser } from '@/lib/auth'
import type { TicketCategory, TicketDTO, TicketStatus } from '@/lib/types'

/** Суммарный лимит вложений на одно обращение: 10 МБ */
export const TICKET_MAX_SIZE = 10 * 1024 * 1024

export const TICKET_CATEGORIES: TicketCategory[] = ['docs', 'auction', 'payment', 'edo', 'tech', 'other']
const STATUSES: TicketStatus[] = ['OPEN', 'ANSWERED', 'CLOSED']

/** Проверка вложения: фото, PDF, офисный документ; размер — в рамках остатка лимита обращения */
export function attachmentError(uri: unknown, sizeLeft: number): string | null {
  if (typeof uri !== 'string' || !uri.startsWith('data:')) return 'Приложите файл: документ или медиа'
  const mime = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)[;,]/i.exec(uri)?.[1]?.toLowerCase() ?? ''
  const ok = mime.startsWith('image/')
    || mime === 'application/pdf'
    || mime.startsWith('application/vnd.openxmlformats')
    || mime === 'application/msword'
    || mime === 'application/vnd.ms-excel'
    || mime === 'text/plain'
    || mime === 'application/rtf'
  if (!ok) return 'Поддерживаются фото, PDF и офисные документы'
  const bytes = Math.floor((uri.length * 3) / 4)
  if (bytes > TICKET_MAX_SIZE) return 'Файл больше 10 МБ'
  if (bytes > sizeLeft) return `Лимит вложений обращения исчерпан: осталось ${(sizeLeft / 1024 / 1024).toFixed(1)} МБ из 10 МБ`
  return null
}

/** DTO обращения со счётчиком сообщений и превью последнего */
export function toTicketDTO(t: {
  id: string; number: number; subject: string; category: string; status: string
  authorName: string; carrierName: string | null; sizeTotal: number; lastMessageAt: Date; createdAt: Date
  _count?: { messages: number }
  messages?: { authorName: string; staff: boolean; body: string; createdAt: Date }[]
}): TicketDTO {
  const last = t.messages?.[0]
  return {
    id: t.id, number: t.number, subject: t.subject,
    category: (TICKET_CATEGORIES.includes(t.category as TicketCategory) ? t.category : 'other') as TicketCategory,
    status: (STATUSES.includes(t.status as TicketStatus) ? t.status : 'OPEN') as TicketStatus,
    authorName: t.authorName, carrierName: t.carrierName, sizeTotal: t.sizeTotal,
    messagesCount: t._count?.messages ?? t.messages?.length ?? 0,
    lastMessage: last ? { authorName: last.authorName, staff: last.staff, body: last.body, createdAt: last.createdAt.toISOString() } : null,
    lastMessageAt: t.lastMessageAt.toISOString(),
    createdAt: t.createdAt.toISOString(),
  }
}

/** Доступ к обращению: своё/своей компании — для перевозчика, любое — для логиста и администрации */
export function canAccessTicket(
  t: { authorId: string; carrierId: string | null },
  u: SessionUser,
): boolean {
  if (isStaff(u.role)) return true
  if (t.authorId === u.id) return true
  return !!u.carrierId && t.carrierId === u.carrierId
}

/** Существует ли обращение с правами доступа (для ветки сообщений) */
export async function findTicketFor(id: string, u: SessionUser) {
  const ticket = await db.ticket.findUnique({ where: { id } })
  if (!ticket) return null
  return canAccessTicket(ticket, u) ? ticket : null
}
