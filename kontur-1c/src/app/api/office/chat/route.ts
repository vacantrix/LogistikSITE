// Чат диспетчера с водителем: сообщения уходят водителю через SyncJournal (план обмена)
import { randomUUID } from 'crypto'
import { db, withWriteLock } from '@/lib/db'
import { jsonOffice } from '@/lib/cors'
import { journalWrite } from '@/lib/bus/syncWriter'
import { chatMessageSnapshot } from '@/lib/bus/snapshots'
import { logEvent } from '@/lib/1c/journal'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const driverId = url.searchParams.get('driverId')

  const drivers = await db.driver.findMany({ where: { isActive: true }, orderBy: { fullName: 'asc' } })
  const allMessages = await db.chatMessage.findMany({ orderBy: { createdAt: 'asc' } })

  const threads = drivers.map((d) => {
    const msgs = allMessages.filter((m) => m.driverId === d.id)
    return {
      driverId: d.id,
      fullName: d.fullName,
      lastMessage: msgs.length ? { body: msgs[msgs.length - 1].body, sender: msgs[msgs.length - 1].sender, at: msgs[msgs.length - 1].createdAt.toISOString() } : null,
      unreadFromDriver: msgs.filter((m) => m.sender === 'DRIVER').length,
    }
  })

  const messages = driverId
    ? allMessages
        .filter((m) => m.driverId === driverId)
        .map((m) => ({ id: m.id, sender: m.sender, body: m.body, tripId: m.tripId, at: m.createdAt.toISOString() }))
    : []

  return jsonOffice({ threads, messages })
}

export async function POST(req: Request) {
  let body: { driverId?: string; body?: string; tripId?: string | null; actor?: string }
  try {
    body = await req.json()
  } catch {
    return jsonOffice({ ok: false, error: 'Некорректное тело запроса' }, 400)
  }
  if (!body?.driverId || !body?.body?.trim())
    return jsonOffice({ ok: false, error: 'Нужны driverId и body' }, 400)

  const msg = await withWriteLock(() =>
    db.$transaction(async (tx) => {
    const m = await tx.chatMessage.create({
      data: {
        id: randomUUID(),
        driverId: body.driverId!,
        tripId: body.tripId ?? null,
        sender: 'DISPATCHER',
        body: body.body!.trim(),
      },
    })
    await journalWrite(tx, body.driverId!, 'CHAT_MESSAGE', 'UPSERT', chatMessageSnapshot(m))
      await logEvent(tx, { user: body.actor ?? 'Диспетчер', action: 'CHAT_SEND', entity: 'ChatMessage', entityId: m.id })
      return m
    }, { timeout: 15000 }),
  )
  return jsonOffice({ ok: true, message: { id: msg.id, sender: msg.sender, body: msg.body, at: msg.createdAt.toISOString() } })
}
