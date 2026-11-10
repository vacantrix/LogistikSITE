/**
 * Аплаеры outbox-операций — зеркало TripEventApplier / MarkApplier /
 * ChatApplier каркаса (Spring Boot → Next.js API). Идемпотентность по opId
 * и по клиентскому UUID сущности; правило авто-закрытия интервалов — общее
 * с клиентом через src/lib/rules.ts (зеркало TripEventRules.kt).
 */

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { EXPLICIT_CLOSER, OPENERS, shouldClose } from '@/lib/rules'
import { DRIVER_ID } from '@/lib/demo/route-data'
import type {
  ChatSendOpPayload,
  MarkPublishOpPayload,
  MarkVoteOpPayload,
  NoteReadOpPayload,
  PushOp,
  PushOpResult,
  TripEventOpPayload,
} from '@/lib/protocol'
import {
  buildChatSnapshot,
  buildNoteSnapshot,
  buildTripEventSnapshot,
  buildTripPointSnapshot,
  buildTripSnapshot,
} from './snapshots'

const HOUR = 3_600_000

/** Публикаций в час на аккаунт (анти-спам, решение №7 каркаса). */
const MARK_RATE_LIMIT_PER_HOUR = 10

/** Демо-ответы диспетчера — «веб-часть офиса» отвечает на сообщения водителя. */
const DISPATCHER_REPLIES = [
  'Принято, Смирнов. Внес в реестр.',
  'Ок, зафиксировал. Если что — набирай.',
  'Понял. Проверю документы и вернусь.',
]

async function journalWrite(driverId: string, entity: string, payload: unknown): Promise<void> {
  await db.syncJournal.create({
    data: { driverId, entity, op: 'UPSERT', payload: JSON.stringify(payload) },
  })
}

export async function applyOperations(driverId: string, ops: PushOp[]): Promise<PushOpResult[]> {
  const results: PushOpResult[] = []
  for (const op of ops) {
    results.push(await applyOne(driverId, op))
  }
  return results
}

async function applyOne(driverId: string, op: PushOp): Promise<PushOpResult> {
  try {
    switch (op.type) {
      case 'TRIP_EVENT_CREATE':
        return await applyTripEvent(driverId, op)
      case 'MARK_PUBLISH':
        return await applyMarkPublish(driverId, op)
      case 'MARK_VOTE':
        return await applyMarkVote(driverId, op)
      case 'CHAT_SEND':
        return await applyChatSend(driverId, op)
      case 'NOTE_READ':
        return await applyNoteRead(driverId, op)
      default:
        return { opId: op.opId, status: 'REJECTED', rejectReason: 'UNKNOWN_OP' }
    }
  } catch (e) {
    const reason = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' ? 'DUPLICATE' : 'BAD_PAYLOAD'
    return { opId: op.opId, status: reason === 'DUPLICATE' ? 'DUPLICATE' : 'REJECTED', rejectReason: reason === 'DUPLICATE' ? undefined : reason }
  }
}

// --- TRIP_EVENT_CREATE ------------------------------------------------------

async function applyTripEvent(driverId: string, op: PushOp): Promise<PushOpResult> {
  const p = op.payload as TripEventOpPayload
  if (!p?.id || !p.tripId || !p.type || typeof p.occurredAt !== 'number') {
    return { opId: op.opId, status: 'REJECTED', rejectReason: 'BAD_PAYLOAD' }
  }

  // 1) идемпотентность по UUID события — страховка поверх sync_operation
  const exists = await db.tripEvent.findUnique({ where: { id: p.id } })
  if (exists) return { opId: op.opId, status: 'DUPLICATE' }

  const trip = await db.trip.findUnique({ where: { id: p.tripId } })
  if (!trip) return { opId: op.opId, status: 'REJECTED', rejectReason: 'TRIP_NOT_FOUND' }

  const occurredAt = new Date(p.occurredAt)

  // 2) вставка события
  const event = await db.tripEvent.create({
    data: {
      id: p.id,
      tripId: p.tripId,
      tripPointId: p.tripPointId,
      driverId,
      vehicleId: p.vehicleId,
      deviceId: p.deviceId ?? null,
      type: p.type,
      occurredAt,
      source: p.source,
      lat: p.lat,
      lon: p.lon,
      note: p.note,
      createdAt: new Date(),
    },
  })

  // 3) авто-закрытие открытых интервалов: TRIP_DONE закрывает всё безусловно,
  //    иначе — открывашки старше нового события
  const openers = await db.tripEvent.findMany({
    where: { tripId: p.tripId, intervalClosedAt: null, type: { in: OPENERS } },
    orderBy: { occurredAt: 'asc' },
  })
  for (const opener of openers) {
    // новое событие-открывашка не должно закрывать само себя
    // (edge-case найден при сборке; в каркасе стоит то же исправить)
    if (opener.id === event.id) continue
    if (!shouldClose(opener.occurredAt.getTime(), p.type, p.occurredAt)) continue
    const explicit = EXPLICIT_CLOSER[opener.type] === p.type && opener.tripPointId === (p.tripPointId ?? null)
    const closed = await db.tripEvent.update({
      where: { id: opener.id },
      data: {
        intervalClosedAt: opener.occurredAt.getTime() > p.occurredAt ? opener.occurredAt : occurredAt,
        intervalClosedBy: event.id,
        intervalAutoClosed: !explicit,
      },
    })
    await journalWrite(driverId, 'TRIP_EVENT', buildTripEventSnapshot(closed))
  }

  // 4) «последнее событие» и статус рейса — автостатусы реестра офиса
  const status =
    p.type === 'TRIP_DONE' ? 'completed' : trip.status === 'assigned' && p.type === 'DEPARTURE' ? 'in_progress' : trip.status
  const updatedTrip = await db.trip.update({
    where: { id: p.tripId },
    data: { lastEventType: p.type, lastEventAt: occurredAt, status },
  })

  // 5) журнал водителю рейса: новое событие + обновлённый рейс
  const audience = updatedTrip.driverId ?? driverId
  await journalWrite(audience, 'TRIP_EVENT', buildTripEventSnapshot(event))
  await journalWrite(audience, 'TRIP', buildTripSnapshot(updatedTrip))

  return { opId: op.opId, status: 'APPLIED' }
}

// --- MARK_PUBLISH / MARK_VOTE -----------------------------------------------

async function applyMarkPublish(driverId: string, op: PushOp): Promise<PushOpResult> {
  const p = op.payload as MarkPublishOpPayload
  if (!p?.id || !p.category || !p.geometry || typeof p.ttlHours !== 'number') {
    return { opId: op.opId, status: 'REJECTED', rejectReason: 'BAD_PAYLOAD' }
  }

  // анти-спам: счётчик публикаций по аккаунту, автор пометки не сохраняется
  const lastHour = await db.markPublicationLog.count({
    where: { driverId, publishedAt: { gte: new Date(Date.now() - HOUR) } },
  })
  if (lastHour >= MARK_RATE_LIMIT_PER_HOUR) {
    return { opId: op.opId, status: 'REJECTED', rejectReason: 'RATE_LIMIT' }
  }

  const coords = (JSON.parse(p.geometry) as { coordinates: [number, number][] }).coordinates
  const lons = coords.map((c) => c[0])
  const lats = coords.map((c) => c[1])
  const now = new Date()

  try {
    await db.roadMark.create({
      data: {
        id: p.id,
        category: p.category,
        polylineGeoJson: p.geometry,
        comment: p.comment,
        ttlHours: p.ttlHours,
        createdAt: now,
        expiresAt: new Date(now.getTime() + p.ttlHours * HOUR),
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLon: Math.min(...lons),
        maxLon: Math.max(...lons),
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { opId: op.opId, status: 'DUPLICATE' }
    }
    throw e
  }

  await db.markPublicationLog.create({ data: { driverId } })
  // в sync_journal пометки НЕ пишутся: рассылка всем — снимком по bbox (канал 2)
  return { opId: op.opId, status: 'APPLIED' }
}

async function applyMarkVote(driverId: string, op: PushOp): Promise<PushOpResult> {
  const p = op.payload as MarkVoteOpPayload
  if (!p?.markId || (p.vote !== 1 && p.vote !== -1)) {
    return { opId: op.opId, status: 'REJECTED', rejectReason: 'BAD_PAYLOAD' }
  }

  const mark = await db.roadMark.findUnique({ where: { id: p.markId } })
  if (!mark || mark.expiresAt.getTime() <= Date.now()) {
    return { opId: op.opId, status: 'REJECTED', rejectReason: 'MARK_EXPIRED' }
  }

  const prev = await db.markVote.findUnique({
    where: { markId_voterDriverId: { markId: p.markId, voterDriverId: driverId } },
  })

  if (prev && prev.vote === p.vote) return { opId: op.opId, status: 'DUPLICATE' }

  if (prev) {
    // смена голоса: перекладываем счётчики в противоположную сторону
    await db.markVote.update({ where: { id: prev.id }, data: { vote: p.vote } })
    await db.roadMark.update({
      where: { id: p.markId },
      data: {
        confirmCount: mark.confirmCount + (p.vote === 1 ? 1 : -1),
        outdatedCount: mark.outdatedCount + (p.vote === 1 ? -1 : 1),
      },
    })
  } else {
    await db.markVote.create({ data: { markId: p.markId, voterDriverId: driverId, vote: p.vote } })
    await db.roadMark.update({
      where: { id: p.markId },
      data: {
        confirmCount: mark.confirmCount + (p.vote === 1 ? 1 : 0),
        outdatedCount: mark.outdatedCount + (p.vote === -1 ? 1 : 0),
      },
    })
  }

  return { opId: op.opId, status: 'APPLIED' }
}

// --- CHAT_SEND / NOTE_READ ---------------------------------------------------

async function applyChatSend(driverId: string, op: PushOp): Promise<PushOpResult> {
  const p = op.payload as ChatSendOpPayload
  if (!p?.id || !p.body || typeof p.createdAt !== 'number') {
    return { opId: op.opId, status: 'REJECTED', rejectReason: 'BAD_PAYLOAD' }
  }

  try {
    const msg = await db.chatMessage.create({
      data: {
        id: p.id,
        driverId,
        tripId: p.tripId,
        sender: 'DRIVER',
        body: p.body,
        createdAt: new Date(p.createdAt),
      },
    })
    await journalWrite(driverId, 'CHAT_MESSAGE', buildChatSnapshot(msg))

    // Демо: веб-часть офиса отвечает. В проде диспетчер работает на платформе,
    // и сообщение ОБЯЗАНО дублироваться в журнал водителя (интеграционная точка №3).
    const dispatcherCount = await db.chatMessage.count({ where: { driverId, sender: 'DISPATCHER' } })
    const reply = await db.chatMessage.create({
      data: {
        id: crypto.randomUUID(),
        driverId,
        tripId: p.tripId,
        sender: 'DISPATCHER',
        body: DISPATCHER_REPLIES[dispatcherCount % DISPATCHER_REPLIES.length],
        createdAt: new Date(),
      },
    })
    await journalWrite(driverId, 'CHAT_MESSAGE', buildChatSnapshot(reply))
    return { opId: op.opId, status: 'APPLIED' }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { opId: op.opId, status: 'DUPLICATE' }
    }
    throw e
  }
}

async function applyNoteRead(driverId: string, op: PushOp): Promise<PushOpResult> {
  const p = op.payload as NoteReadOpPayload
  if (!p?.noteId) return { opId: op.opId, status: 'REJECTED', rejectReason: 'BAD_PAYLOAD' }
  await db.systemNote.updateMany({
    where: { id: p.noteId, driverId, readAt: null },
    data: { readAt: new Date() },
  })
  return { opId: op.opId, status: 'APPLIED' }
}

// --- снимки для маршрутов ----------------------------------------------------

export { buildTripSnapshot, buildTripPointSnapshot, buildTripEventSnapshot, buildChatSnapshot, buildNoteSnapshot }

/** Демо-инцидент: офис меняет точку выгрузки (письмо + уведомление). */
export async function runOfficeIncident(): Promise<{ tripPointId?: string }> {
  const { TRIP_ID } = await import('@/lib/demo/route-data')
  const trip = await db.trip.findUnique({ where: { id: TRIP_ID } })
  if (!trip) return {}

  const unloading = await db.tripPoint.findFirst({
    where: { tripId: TRIP_ID, kind: 'unloading' },
    orderBy: { seqNo: 'asc' },
  })
  if (!unloading) return {}

  const updatedPoint = await db.tripPoint.update({
    where: { id: unloading.id },
    data: {
      name: 'Стройплощадка «Промышленная»',
      address: 'Новороссийск, ул. Промышленная, 7',
      lat: 44.7285,
      lon: 37.774,
    },
  })

  const freshTrip = await db.trip.findUniqueOrThrow({ where: { id: TRIP_ID } })
  const audience = freshTrip.driverId ?? DRIVER_ID
  await journalWrite(audience, 'TRIP_POINT', buildTripPointSnapshot(updatedPoint))
  await journalWrite(audience, 'TRIP', buildTripSnapshot(freshTrip))

  const chat = await db.chatMessage.create({
    data: {
      id: crypto.randomUUID(),
      driverId: audience,
      tripId: TRIP_ID,
      sender: 'DISPATCHER',
      body: 'Выгрузка перенесена: Новороссийск, ул. Промышленная, 7. Ворота 3, пропуск у охраны.',
      createdAt: new Date(),
    },
  })
  await journalWrite(audience, 'CHAT_MESSAGE', buildChatSnapshot(chat))

  const note = await db.systemNote.create({
    data: {
      id: crypto.randomUUID(),
      driverId: audience,
      kind: 'TRIP_UPDATED',
      body: 'Заявка Z-1067 изменена офисом: точка выгрузки',
      ref: TRIP_ID,
      createdAt: new Date(),
    },
  })
  await journalWrite(audience, 'SYSTEM_NOTE', buildNoteSnapshot(note))

  return { tripPointId: updatedPoint.id }
}
