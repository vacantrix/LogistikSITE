// Appliers push-операций (протокол синхронизации, раздел 6.3 ТЗ):
// TRIP_EVENT_CREATE | MARK_PUBLISH | MARK_VOTE | CHAT_SEND | NOTE_READ.
// Идемпотентность: opId хранится в SyncOperation; повторная доставка даёт тот же результат.
// REJECTED финален — rejectReason показывается водителю.
import { randomUUID } from 'crypto'
import { db, withWriteLock } from '../db'
import { applyTripEvent } from '../1c/tripEvents'
import { journalWrite } from './syncWriter'
import { chatMessageSnapshot, systemNoteSnapshot } from './snapshots'

export type PushOperation = { opId: string; type: string; payload: Record<string, unknown> }
export type PushResult = { opId: string; status: 'APPLIED' | 'DUPLICATE' | 'REJECTED'; rejectReason?: string }

const MARK_CATEGORIES = ['POTHOLE', 'ROADWORKS', 'POLICE', 'ACCIDENT', 'CLOSED']
const MARK_TTL = [6, 12, 720]
const MAX_MARKS_PER_HOUR = 5

type TripEventPayload = {
  id?: string
  tripId: string
  tripPointId?: string | null
  vehicleId?: string | null
  deviceId?: string | null
  type: string
  occurredAt?: number | null
  source?: string | null
  lat?: number | null
  lon?: number | null
  note?: string | null
}

export async function applyOperations(
  driverId: string,
  deviceId: string | null,
  operations: PushOperation[],
): Promise<PushResult[]> {
  const results: PushResult[] = []
  for (const op of operations) {
    const result = await applyOperation(driverId, deviceId, op)
    results.push(result)
  }
  return results
}

async function applyOperation(driverId: string, deviceId: string | null, op: PushOperation): Promise<PushResult> {
  if (!op.opId || typeof op.opId !== 'string' || !op.type) {
    return { opId: String(op.opId ?? randomUUID()), status: 'REJECTED', rejectReason: 'BAD_OPERATION' }
  }

  // идемпотентность: уже известная операция возвращает сохранённый результат
  const existing = await db.syncOperation.findUnique({ where: { opId: op.opId } })
  if (existing && existing.state !== 'PENDING') {
    return existing.state === 'REJECTED'
      ? { opId: op.opId, status: 'REJECTED', rejectReason: existing.rejectReason ?? undefined }
      : { opId: op.opId, status: existing.state as 'APPLIED' | 'DUPLICATE' }
  }

  const reject = async (reason: string) => {
    await db.syncOperation.upsert({
      where: { opId: op.opId },
      create: { opId: op.opId, driverId, type: op.type, payload: JSON.stringify(op.payload), state: 'REJECTED', rejectReason: reason, attempts: 1, syncedAt: new Date() },
      update: { state: 'REJECTED', rejectReason: reason, attempts: { increment: 1 }, syncedAt: new Date() },
    })
    return { opId: op.opId, status: 'REJECTED' as const, rejectReason: reason }
  }

  try {
    switch (op.type) {
      case 'TRIP_EVENT_CREATE': {
        const p = op.payload as unknown as TripEventPayload
        const trip = await db.trip.findUnique({ where: { id: p.tripId } })
        if (!trip) return await reject('TRIP_NOT_FOUND')
        if (trip.driverId !== driverId) return await reject('TRIP_NOT_OWNED')
        if (trip.status === 'completed' || trip.status === 'cancelled') return await reject('TRIP_CLOSED')
        await withWriteLock(() =>
        db.$transaction(async (tx) => {
          await applyTripEvent(tx, {
            tripId: p.tripId,
            type: p.type,
            driverId,
            vehicleId: p.vehicleId ?? trip.vehicleId ?? '',
            tripPointId: p.tripPointId ?? null,
            deviceId: p.deviceId ?? deviceId,
            source: (p.source as 'GEOFENCE' | 'MANUAL' | 'MANUAL_BACKDATED') ?? 'MANUAL',
            occurredAt: p.occurredAt ? new Date(p.occurredAt) : undefined,
            lat: p.lat ?? null,
            lon: p.lon ?? null,
            note: p.note ?? null,
          })
          await tx.syncOperation.upsert({
            where: { opId: op.opId },
            create: { opId: op.opId, driverId, type: op.type, payload: JSON.stringify(op.payload), state: 'APPLIED', attempts: 1, syncedAt: new Date() },
            update: { state: 'APPLIED', attempts: { increment: 1 }, syncedAt: new Date() },
          })
        }, { timeout: 15000 }),
        )
        return { opId: op.opId, status: 'APPLIED' }
      }

      case 'MARK_PUBLISH': {
        // rate limit: не более MAX_MARKS_PER_HOUR публикаций в час
        const since = new Date(Date.now() - 3600 * 1000)
        const recent = await db.markPublicationLog.count({ where: { driverId, publishedAt: { gte: since } } })
        if (recent >= MAX_MARKS_PER_HOUR) return await reject('RATE_LIMIT')
        const p = op.payload as {
          category?: string
          geometry?: string | { type: string; coordinates: [number, number][] }
          polylineGeoJson?: string
          comment?: string | null
          ttlHours?: number
        }
        if (!p.category || !MARK_CATEGORIES.includes(p.category)) return await reject('BAD_CATEGORY')
        const ttl = MARK_TTL.includes(p.ttlHours ?? -1) ? p.ttlHours! : 6
        const geo = typeof p.geometry === 'string' ? JSON.parse(p.geometry) : p.geometry ?? (p.polylineGeoJson ? JSON.parse(p.polylineGeoJson) : null)
        if (!geo || !Array.isArray(geo.coordinates) || geo.coordinates.length < 2) return await reject('BAD_GEOMETRY')
        const lats = geo.coordinates.map((c: [number, number]) => c[1])
        const lons = geo.coordinates.map((c: [number, number]) => c[0])
        const now = new Date()
        await withWriteLock(() =>
        db.$transaction(async (tx) => {
          await tx.roadMark.create({
            data: {
              id: (p as { id?: string }).id ?? randomUUID(),
              category: p.category!,
              polylineGeoJson: JSON.stringify(geo),
              comment: p.comment ?? null,
              ttlHours: ttl,
              createdAt: now,
              expiresAt: new Date(now.getTime() + ttl * 3600 * 1000),
              minLat: Math.min(...lats), minLon: Math.min(...lons),
              maxLat: Math.max(...lats), maxLon: Math.max(...lons),
            },
          })
          await tx.markPublicationLog.create({ data: { driverId, publishedAt: now } })
          await tx.syncOperation.upsert({
            where: { opId: op.opId },
            create: { opId: op.opId, driverId, type: op.type, payload: JSON.stringify(op.payload), state: 'APPLIED', attempts: 1, syncedAt: now },
            update: { state: 'APPLIED', attempts: { increment: 1 }, syncedAt: now },
          })
        }, { timeout: 15000 }),
        )
        return { opId: op.opId, status: 'APPLIED' }
      }

      case 'MARK_VOTE': {
        const p = op.payload as { markId?: string; vote?: number }
        if (!p.markId || (p.vote !== 1 && p.vote !== -1)) return await reject('BAD_VOTE')
        const mark = await db.roadMark.findUnique({ where: { id: p.markId } })
        if (!mark) return await reject('MARK_NOT_FOUND')
        if (mark.expiresAt.getTime() <= Date.now()) return await reject('MARK_EXPIRED')
        const vote = await db.markVote.upsert({
          where: { markId_voterDriverId: { markId: p.markId, voterDriverId: driverId } },
          create: { markId: p.markId, voterDriverId: driverId, vote: p.vote },
          update: { vote: p.vote },
        })
        const agg = await db.markVote.groupBy({ by: ['vote'], where: { markId: p.markId }, _count: { vote: true } })
        const confirm = agg.find((a) => a.vote === 1)?._count.vote ?? 0
        const outdated = agg.find((a) => a.vote === -1)?._count.vote ?? 0
        await withWriteLock(() =>
        db.$transaction(async (tx) => {
          await tx.roadMark.update({ where: { id: p.markId! }, data: { confirmCount: confirm, outdatedCount: outdated } })
          await tx.syncOperation.upsert({
            where: { opId: op.opId },
            create: { opId: op.opId, driverId, type: op.type, payload: JSON.stringify(op.payload), state: 'APPLIED', attempts: 1, syncedAt: new Date() },
            update: { state: 'APPLIED', attempts: { increment: 1 }, syncedAt: new Date() },
          })
        }, { timeout: 15000 }),
        )
        return { opId: op.opId, status: 'APPLIED' }
      }

      case 'CHAT_SEND': {
        const p = op.payload as { body?: string; tripId?: string | null; id?: string }
        if (!p.body || typeof p.body !== 'string' || p.body.trim().length === 0) return await reject('EMPTY_BODY')
        const duplicate = await db.chatMessage.findUnique({ where: { id: p.id ?? '' } })
        if (duplicate) {
          await db.syncOperation.upsert({
            where: { opId: op.opId },
            create: { opId: op.opId, driverId, type: op.type, payload: JSON.stringify(op.payload), state: 'DUPLICATE', attempts: 1, syncedAt: new Date() },
            update: { state: 'DUPLICATE', attempts: { increment: 1 }, syncedAt: new Date() },
          })
          return { opId: op.opId, status: 'DUPLICATE' }
        }
        const msg = await withWriteLock(() =>
        db.$transaction(async (tx) => {
          const m = await tx.chatMessage.create({
            data: {
              id: p.id ?? randomUUID(),
              driverId,
              tripId: p.tripId ?? null,
              sender: 'DRIVER',
              body: p.body!.trim(),
            },
          })
          await journalWrite(tx, driverId, 'CHAT_MESSAGE', 'UPSERT', chatMessageSnapshot(m))
          await tx.syncOperation.upsert({
            where: { opId: op.opId },
            create: { opId: op.opId, driverId, type: op.type, payload: JSON.stringify(op.payload), state: 'APPLIED', attempts: 1, syncedAt: new Date() },
            update: { state: 'APPLIED', attempts: { increment: 1 }, syncedAt: new Date() },
          })
          return m
        }, { timeout: 15000 }),
        )
        return { opId: op.opId, status: 'APPLIED' }
      }

      case 'NOTE_READ': {
        const p = op.payload as { id?: string }
        const note = p.id ? await db.systemNote.findUnique({ where: { id: p.id } }) : null
        if (!note || note.driverId !== driverId) return await reject('NOTE_NOT_FOUND')
        if (note.readAt) {
          await db.syncOperation.upsert({
            where: { opId: op.opId },
            create: { opId: op.opId, driverId, type: op.type, payload: JSON.stringify(op.payload), state: 'DUPLICATE', attempts: 1, syncedAt: new Date() },
            update: { state: 'DUPLICATE', attempts: { increment: 1 }, syncedAt: new Date() },
          })
          return { opId: op.opId, status: 'DUPLICATE' }
        }
        await withWriteLock(() =>
        db.$transaction(async (tx) => {
          const updated = await tx.systemNote.update({ where: { id: note.id }, data: { readAt: new Date() } })
          await journalWrite(tx, driverId, 'SYSTEM_NOTE', 'UPSERT', systemNoteSnapshot(updated))
          await tx.syncOperation.upsert({
            where: { opId: op.opId },
            create: { opId: op.opId, driverId, type: op.type, payload: JSON.stringify(op.payload), state: 'APPLIED', attempts: 1, syncedAt: new Date() },
            update: { state: 'APPLIED', attempts: { increment: 1 }, syncedAt: new Date() },
          })
        }, { timeout: 15000 }),
        )
        return { opId: op.opId, status: 'APPLIED' }
      }

      default:
        return await reject('UNKNOWN_TYPE')
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'INTERNAL'
    return await reject(message.slice(0, 120))
  }
}
