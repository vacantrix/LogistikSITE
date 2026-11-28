// Движок правил B5 (ТЗ v5.0): лестница, артефакты, seq/часы, барьер корректировки,
// отмена корректировки, замена состава, пакетный разбор, outbox, аудит —
// аудит в единый журнал платформы (PlatformLog, контур dispatcher).
import { db } from '@/lib/kontur/db'
import { audit } from '@/lib/kontur/audit'
import { CONSTANTS, TRANSITIONS, FILE_REQUIRED_STATUS } from '@/lib/kontur/constants'
import { applyLadderStatus } from '@/lib/kontur/monitor'

export type RequiredFileRef = { clientId: string; kind: string }

export type DriverEventInput = {
  clientId: string
  legId: string
  status: string
  deviceId: string
  driverId?: string
  seqNo?: number | null
  clientTs?: string | null
  requiredFiles?: RequiredFileRef[] | null
  comment?: string
  receivedOffline?: boolean
}

export type EventOutcome = {
  clientId: string
  ok: boolean
  result: 'applied' | 'superseded' | 'needs_review' | 'rejected' | 'duplicate'
  reason?: string
  status?: string
  clockSkew?: boolean
}

function isTransitionValid(from: string, to: string): boolean {
  return (TRANSITIONS[from] ?? []).includes(to)
}

function minutesBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 60000
}

// Атомарная запись в outbox (B7.1): событие + пересчёт статуса + outbox + аудит — вместе
async function outboxInsert(eventType: string, payload: Record<string, unknown>) {
  await db.outbox1c.create({
    data: { eventType, payload: JSON.stringify(payload) },
  })
}

// Аудит движка — единый журнал платформы: импорт audit из '@/lib/kontur/audit';
// все места движка пишут через него (PlatformLog, контур dispatcher + JSONL)

// B5.4: docs_pending / docs_lost выводятся из required_files принятых не-superseded
// событий и состояния файлов
export async function recomputeDocs(legId: string) {
  const events = await db.statusEvent.findMany({
    where: {
      legId,
      superseded: false,
      result: { notIn: ['rejected'] },
      requiredFiles: { not: null },
      // reviewState nullable: NULL <> 'rejected' в SQL даёт NULL, поэтому явный OR
      OR: [{ reviewState: null }, { reviewState: { not: 'rejected' } }],
    },
    orderBy: { serverTs: 'asc' },
  })
  const needed = new Map<string, RequiredFileRef>()
  for (const ev of events) {
    const files = JSON.parse(ev.requiredFiles || '[]') as RequiredFileRef[]
    for (const f of files) needed.set(f.clientId, f)
  }
  const leg = await db.leg.findUnique({ where: { id: legId } })
  if (!leg) return
  let docsPending = false
  let docsLost = false
  for (const [clientId] of needed) {
    const file = await db.fileRec.findUnique({ where: { clientId } })
    if (!file || file.state === 'uploaded' || file.state === 'rejected') docsPending = true
    if (file?.state === 'lost') {
      docsLost = true
      docsPending = true
    }
  }
  await db.leg.update({ where: { id: legId }, data: { docsPending, docsLost } })
}

// B5.10: агрегация рейса — все плечи completed/cancelled => trip completed
async function recomputeTrip(tripId: string) {
  const trip = await db.trip.findUnique({ where: { id: tripId } })
  if (!trip || trip.status !== 'active') return
  const legs = await db.leg.findMany({ where: { tripId } })
  const allDone = legs.length > 0 && legs.every((l) => l.status === 'completed' || l.status === 'cancelled')
  if (allDone) {
    await db.trip.update({
      where: { id: tripId },
      data: { status: 'completed', endedAt: new Date(), version: { increment: 1 } },
    })
    await outboxInsert('trip.completed', { tripId, at: new Date().toISOString() })
    await audit({
      actorRole: 'system',
      object: 'trip',
      objectId: tripId,
      field: 'status',
      was: 'active',
      became: 'completed',
      comment: 'Все плечи завершены (docs_pending допустим, B5.10)',
    })
  }
}

// Счётчики устройства B7.2.13: clock_skew за окно -> systematic_skew
async function refreshDeviceCounters(deviceId: string, now: Date) {
  const since = new Date(now.getTime() - CONSTANTS.CLOCK_SKEW_WINDOW_HOURS * 3600 * 1000)
  const skewCount = await db.statusEvent.count({
    where: { deviceId, clockSkew: true, serverTs: { gte: since } },
  })
  const legacySince = new Date(now.getTime() - CONSTANTS.LEGACY_WINDOW_HOURS * 3600 * 1000)
  const legacyCount = await db.statusEvent.count({
    where: { deviceId, legacy: true, serverTs: { gte: legacySince } },
  })
  const systematicSkew = skewCount >= CONSTANTS.CLOCK_SKEW_ALERT_COUNT
  await db.device.update({
    where: { id: deviceId },
    data: {
      clockSkewCount24h: skewCount,
      systematicSkew,
      isLegacy: legacyCount > CONSTANTS.LEGACY_ALERT_COUNT ? true : undefined,
    },
  })
  return { skewCount, legacyCount, systematicSkew, upgradeRequired: legacyCount > CONSTANTS.LEGACY_ALERT_COUNT }
}

// Обработка одного драйверского события — B5.3–B5.6, B5.8.3, B7.2.12
export async function processDriverEvent(input: DriverEventInput, now = new Date()): Promise<EventOutcome> {
  // Идемпотентность по client_id (B7.0): повтор безопасен
  const existing = await db.statusEvent.findUnique({ where: { clientId: input.clientId } })
  if (existing) {
    return {
      clientId: input.clientId,
      ok: true,
      result: 'duplicate',
      reason: 'Повтор безопасен (идемпотентность по client_id)',
      status: existing.status,
    }
  }

  const leg = await db.leg.findUnique({ where: { id: input.legId } })
  if (!leg) {
    return { clientId: input.clientId, ok: false, result: 'rejected', reason: 'Плечо не найдено' }
  }
  const trip = await db.trip.findUnique({ where: { id: leg.tripId } })

  // Устройство: upsert + last_seen
  const device = await db.device.upsert({
    where: { id: input.deviceId },
    update: { lastSeenAt: now, driverId: input.driverId ?? undefined },
    create: { id: input.deviceId, driverId: input.driverId, lastSeenAt: now },
  })

  // Флаги события
  const isLegacy = input.seqNo == null && input.requiredFiles == null // B7.2.12: старое приложение не шлёт seq/файлы
  const clientTs = input.clientTs ? new Date(input.clientTs) : null
  const clockSkew = clientTs ? minutesBetween(clientTs, now) > CONSTANTS.CLOCK_SKEW_FLAG_MIN : false
  const requiredFiles = input.requiredFiles ?? null

  // Артефакт B5.3: loaded/unloaded требуют локально прикреплённый файл (кроме legacy)
  const needsFile = FILE_REQUIRED_STATUS[input.status] != null
  if (needsFile && !isLegacy && (!requiredFiles || requiredFiles.length === 0)) {
    await db.statusEvent.create({
      data: {
        legId: leg.id,
        status: input.status,
        actorRole: 'driver',
        actorId: input.driverId,
        clientId: input.clientId,
        deviceId: input.deviceId,
        clientTs,
        serverTs: now,
        receivedOffline: input.receivedOffline ?? false,
        comment: input.comment,
        result: 'rejected',
        rejectReason: 'Прикрепите фото ТТН',
      },
    })
    return { clientId: input.clientId, ok: false, result: 'rejected', reason: 'Прикрепите фото ТТН', clockSkew }
  }

  const transitionValid = isTransitionValid(leg.status, input.status)

  // B5.8.3: событие от прежнего водителя после замены состава — принимается с
  // needs_review без срока давности; файлы от него принимаются всегда (late_arrival)
  const fromFormerDriver = !!input.driverId && !!trip && trip.driverId !== input.driverId
  if (fromFormerDriver) {
    await db.statusEvent.create({
      data: {
        legId: leg.id,
        status: input.status,
        actorRole: 'driver',
        actorId: input.driverId,
        clientId: input.clientId,
        deviceId: input.deviceId,
        seqNo: input.seqNo ?? null,
        clientTs,
        serverTs: now,
        receivedOffline: input.receivedOffline ?? false,
        clockSkew,
        lateArrival: true,
        needsReview: true,
        legacy: isLegacy,
        comment: input.comment,
        requiredFiles: requiredFiles ? JSON.stringify(requiredFiles) : null,
        reviewState: 'pending',
        result: 'needs_review',
      },
    })
    // Файлы принимаются независимо от разбора (B5.8.4)
    if (requiredFiles) {
      for (const f of requiredFiles) {
        await db.fileRec.create({
          data: {
            ownerType: 'leg',
            ownerId: leg.id,
            kind: f.kind,
            clientId: f.clientId,
            state: 'uploaded',
            eventClientId: input.clientId,
            lateArrival: true,
          },
        })
      }
      await recomputeDocs(leg.id)
    }
    return {
      clientId: input.clientId,
      ok: true,
      result: 'needs_review',
      reason: 'Состав изменён: событие ушло в разбор (без срока давности)',
      status: leg.status,
      clockSkew,
    }
  }

  // Барьер корректировки B5.6: последний статус установлен логистом
  if (leg.statusSource === 'logist') {
    const barrier = leg.statusSetAt
    const beforeBarrier = clientTs ? clientTs < barrier : true

    if (isLegacy) {
      // B7.2.12: прямой допустимый переход без конфликта применяется автоматически
      if (!transitionValid) {
        return rejectEvent(input, leg, now, isLegacy, clockSkew, clientTs, requiredFiles, 'Недопустимый переход')
      }
      if (beforeBarrier && !device.systematicSkew) {
        return deferEvent(input, leg, now, isLegacy, clockSkew, clientTs, requiredFiles)
      }
      return applyEvent(input, leg, trip, now, isLegacy, clockSkew, clientTs, requiredFiles)
    }

    if (clockSkew && !device.systematicSkew) {
      // часы неточны, устройство ещё не помечено систематическим сдвигом -> разбор
      return deferEvent(input, leg, now, isLegacy, clockSkew, clientTs, requiredFiles)
    }
    if (device.systematicSkew) {
      // ARC-011: client_ts недостоверен, порядок по seq/server_ts,
      // needs_review только при реальном конфликте с барьером
      if (!transitionValid) {
        return deferEvent(input, leg, now, isLegacy, clockSkew, clientTs, requiredFiles)
      }
      return applyEvent(input, leg, trip, now, isLegacy, clockSkew, clientTs, requiredFiles)
    }
    if (beforeBarrier) {
      // событие создано до корректировки -> superseded, статус не меняется (B5.6)
      return supersedeEvent(input, leg, now, isLegacy, clockSkew, clientTs, requiredFiles)
    }
    // создано после корректировки — обычная обработка
  }

  if (!transitionValid) {
    return rejectEvent(input, leg, now, isLegacy, clockSkew, clientTs, requiredFiles, `Недопустимый переход: ${leg.status} → ${input.status}`)
  }
  return applyEvent(input, leg, trip, now, isLegacy, clockSkew, clientTs, requiredFiles)
}

async function rejectEvent(
  input: DriverEventInput,
  leg: { id: string; status: string },
  now: Date,
  isLegacy: boolean,
  clockSkew: boolean,
  clientTs: Date | null,
  requiredFiles: RequiredFileRef[] | null,
  reason: string,
): Promise<EventOutcome> {
  // B5.5: невалидное событие rejected, остаётся в очереди и видно водителю
  await db.statusEvent.create({
    data: {
      legId: leg.id,
      status: input.status,
      actorRole: 'driver',
      actorId: input.driverId,
      clientId: input.clientId,
      deviceId: input.deviceId,
      seqNo: input.seqNo ?? null,
      clientTs,
      serverTs: now,
      receivedOffline: input.receivedOffline ?? false,
      clockSkew,
      legacy: isLegacy,
      comment: input.comment,
      result: 'rejected',
      rejectReason: reason,
    },
  })
  return { clientId: input.clientId, ok: false, result: 'rejected', reason, status: leg.status, clockSkew }
}

async function deferEvent(
  input: DriverEventInput,
  leg: { id: string; status: string },
  now: Date,
  isLegacy: boolean,
  clockSkew: boolean,
  clientTs: Date | null,
  requiredFiles: RequiredFileRef[] | null,
): Promise<EventOutcome> {
  await db.statusEvent.create({
    data: {
      legId: leg.id,
      status: input.status,
      actorRole: 'driver',
      actorId: input.driverId,
      clientId: input.clientId,
      deviceId: input.deviceId,
      seqNo: input.seqNo ?? null,
      clientTs,
      serverTs: now,
      receivedOffline: input.receivedOffline ?? false,
      clockSkew,
      legacy: isLegacy,
      comment: input.comment,
      requiredFiles: requiredFiles ? JSON.stringify(requiredFiles) : null,
      needsReview: true,
      reviewState: 'pending',
      result: 'needs_review',
    },
  })
  if (requiredFiles) {
    for (const f of requiredFiles) {
      await db.fileRec.create({
        data: {
          ownerType: 'leg',
          ownerId: leg.id,
          kind: f.kind,
          clientId: f.clientId,
          state: 'uploaded',
          eventClientId: input.clientId,
        },
      })
    }
    await recomputeDocs(leg.id)
  }
  return {
    clientId: input.clientId,
    ok: true,
    result: 'needs_review',
    reason: clockSkew ? 'Время на устройстве неточное — разбор логистом' : 'Конфликт с корректировкой — разбор логистом',
    status: leg.status,
    clockSkew,
  }
}

async function supersedeEvent(
  input: DriverEventInput,
  leg: { id: string; status: string },
  now: Date,
  isLegacy: boolean,
  clockSkew: boolean,
  clientTs: Date | null,
  requiredFiles: RequiredFileRef[] | null,
): Promise<EventOutcome> {
  await db.statusEvent.create({
    data: {
      legId: leg.id,
      status: input.status,
      actorRole: 'driver',
      actorId: input.driverId,
      clientId: input.clientId,
      deviceId: input.deviceId,
      seqNo: input.seqNo ?? null,
      clientTs,
      serverTs: now,
      receivedOffline: input.receivedOffline ?? false,
      clockSkew,
      legacy: isLegacy,
      comment: input.comment,
      superseded: true,
      result: 'superseded',
    },
  })
  return {
    clientId: input.clientId,
    ok: true,
    result: 'superseded',
    reason: 'Заменено корректировкой логиста',
    status: leg.status,
    clockSkew,
  }
}

async function applyEvent(
  input: DriverEventInput,
  leg: { id: string; tripId: string; status: string },
  trip: { id: string; status: string } | null,
  now: Date,
  isLegacy: boolean,
  clockSkew: boolean,
  clientTs: Date | null,
  requiredFiles: RequiredFileRef[] | null,
): Promise<EventOutcome> {
  const was = leg.status
  await db.leg.update({
    where: { id: leg.id },
    data: { status: input.status, statusSource: 'driver', statusSetAt: now, version: { increment: 1 } },
  })
  await db.statusEvent.create({
    data: {
      legId: leg.id,
      status: input.status,
      actorRole: 'driver',
      actorId: input.driverId,
      clientId: input.clientId,
      deviceId: input.deviceId,
      seqNo: input.seqNo ?? null,
      clientTs,
      serverTs: now,
      receivedOffline: input.receivedOffline ?? false,
      clockSkew,
      legacy: isLegacy,
      comment: input.comment,
      requiredFiles: requiredFiles ? JSON.stringify(requiredFiles) : null,
      result: 'applied',
    },
  })
  if (requiredFiles) {
    for (const f of requiredFiles) {
      await db.fileRec.create({
        data: {
          ownerType: 'leg',
          ownerId: leg.id,
          kind: f.kind,
          clientId: f.clientId,
          state: 'uploaded',
          eventClientId: input.clientId,
        },
      })
    }
    await recomputeDocs(leg.id)
  }
  // Атомарно с событием: outbox + аудит (B5.9)
  await outboxInsert('leg.status_changed', {
    legId: leg.id,
    tripId: leg.tripId,
    status: input.status,
    source: 'driver',
    at: now.toISOString(),
  })
  await audit({
    actorRole: 'driver',
    actorName: input.driverId,
    object: 'leg',
    objectId: leg.id,
    field: 'status',
    was,
    became: input.status,
  })
  if (input.status === 'completed' && trip) {
    await recomputeTrip(trip.id)
  }
  // Онлайн-мониторинг: применённый статус плеча сразу виден логисту в «Мониторинге»
  try {
    await applyLadderStatus(input.driverId, input.status, leg.tripId)
  } catch {
    // сбой телеметрии не должен ломать приём статуса по лестнице
  }
  return { clientId: input.clientId, ok: true, result: 'applied', status: input.status, clockSkew }
}

// B7.2.2: POST /driver/sync — применение по seq_no внутри устройства (B5.5)
export async function processSync(events: DriverEventInput[], now = new Date()) {
  const sorted = [...events].sort((a, b) => {
    if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1
    const sa = a.seqNo ?? Number.MAX_SAFE_INTEGER
    const sb = b.seqNo ?? Number.MAX_SAFE_INTEGER
    if (sa !== sb) return sa - sb
    return (a.clientTs || '').localeCompare(b.clientTs || '')
  })
  const results: EventOutcome[] = []
  let upgradeRequired = false
  for (const ev of sorted) {
    const outcome = await processDriverEvent(ev, now)
    results.push(outcome)
    const counters = await refreshDeviceCounters(ev.deviceId, now)
    if (counters.upgradeRequired) upgradeRequired = true
  }
  return { results, upgradeRequired }
}

// B5.7: корректировка статуса логистом (барьер) — только новая корректировка отменяет
export async function applyCorrection(legId: string, status: string, comment: string, actorName = 'logist') {
  const leg = await db.leg.findUnique({ where: { id: legId } })
  if (!leg) throw new Error('Плечо не найдено')
  if (!comment?.trim()) throw new Error('Комментарий обязателен (B8.4)')
  const now = new Date()
  const was = leg.status
  await db.leg.update({
    where: { id: legId },
    data: { status, statusSource: 'logist', statusSetAt: now, version: { increment: 1 } },
  })
  const event = await db.statusEvent.create({
    data: {
      legId,
      status,
      type: 'correction',
      actorRole: 'logist',
      serverTs: now,
      comment,
      result: 'applied',
    },
  })
  await outboxInsert('leg.status_changed', {
    legId,
    tripId: leg.tripId,
    status,
    source: 'logist',
    at: now.toISOString(),
  })
  await audit({
    actorRole: 'logist',
    actorName,
    object: 'leg',
    objectId: legId,
    field: 'status',
    was,
    became: status,
    comment,
  })
  return { eventId: event.id, was, became: status }
}

// B5.7: отмена последней корректировки — только новой корректировкой с
// parent_correction_id; superseded-события не воскресают (разбор — B5.8.4)
export async function cancelLastCorrection(legId: string, actorName = 'logist') {
  const lastCorrection = await db.statusEvent.findFirst({
    where: { legId, type: 'correction' },
    orderBy: { serverTs: 'desc' },
  })
  if (!lastCorrection) throw new Error('Корректировок нет')
  // Статус до отменяемой корректировки = последний применённый статус раньше неё
  const prev = await db.statusEvent.findFirst({
    where: { legId, serverTs: { lt: lastCorrection.serverTs }, result: 'applied' },
    orderBy: { serverTs: 'desc' },
  })
  const restoreStatus = prev?.status ?? 'assigned'
  const now = new Date()
  const comment = `Отмена корректировки ${lastCorrection.id.slice(0, 8)}`
  const leg = await db.leg.findUnique({ where: { id: legId } })
  await db.leg.update({
    where: { id: legId },
    data: { status: restoreStatus, statusSource: 'logist', statusSetAt: now, version: { increment: 1 } },
  })
  await db.statusEvent.create({
    data: {
      legId,
      status: restoreStatus,
      type: 'correction',
      actorRole: 'logist',
      serverTs: now,
      parentCorrectionId: lastCorrection.id,
      comment,
      result: 'applied',
    },
  })
  await outboxInsert('leg.status_changed', {
    legId,
    status: restoreStatus,
    source: 'logist',
    correctionCancelled: lastCorrection.id,
    at: now.toISOString(),
  })
  await audit({
    actorRole: 'logist',
    actorName,
    object: 'leg',
    objectId: legId,
    field: 'status',
    was: leg?.status,
    became: restoreStatus,
    comment,
  })
  return { cancelled: lastCorrection.id, restoreStatus, comment }
}

// B5.8.1: замена состава — effective_at, причина, trip_events + аудит
export async function changeComposition(
  tripId: string,
  changes: { driverId?: string; vehicleId?: string; trailerId?: string },
  reason: string,
  actorName = 'logist',
) {
  const trip = await db.trip.findUnique({ where: { id: tripId } })
  if (!trip) throw new Error('Рейс не найден')
  if (!reason?.trim()) throw new Error('Причина обязательна (B8.4)')
  const now = new Date()
  const old = { driverId: trip.driverId, vehicleId: trip.vehicleId, trailerId: trip.trailerId }
  await db.trip.update({
    where: { id: tripId },
    data: { ...changes, version: { increment: 1 } },
  })
  await db.tripEvent.create({
    data: {
      tripId,
      type: 'composition_change',
      actorId: actorName,
      payload: JSON.stringify({ old, new: changes, reason, effectiveAt: now.toISOString() }),
      at: now,
    },
  })
  await audit({
    actorRole: 'logist',
    actorName,
    object: 'trip',
    objectId: tripId,
    field: 'composition',
    was: JSON.stringify(old),
    became: JSON.stringify(changes),
    comment: reason,
  })
  return { old, effectiveAt: now.toISOString() }
}

// B5.8.4: пакетный разбор needs_review — порядок (device_id, seq_no), затем server_ts;
// применяется только допустимый переход, недопустимое — пропуск с меткой skipped_conflict
export async function reviewBatch(eventIds: string[], mode: 'apply' | 'reject', approver = 'logist') {
  // skipped_conflict-события считаются обработанными (пропущены) и в очередь не возвращаются
  const events = await db.statusEvent.findMany({
    where: { id: { in: eventIds }, needsReview: true, reviewState: 'pending', skippedConflict: false },
  })
  const sorted = events.sort((a, b) => {
    if ((a.deviceId || '') !== (b.deviceId || '')) return (a.deviceId || '') < (b.deviceId || '') ? -1 : 1
    const sa = a.seqNo ?? Number.MAX_SAFE_INTEGER
    const sb = b.seqNo ?? Number.MAX_SAFE_INTEGER
    if (sa !== sb) return sa - sb
    return a.serverTs.getTime() - b.serverTs.getTime()
  })
  const results: { eventId: string; outcome: 'applied' | 'skipped_conflict' | 'rejected' }[] = []
  for (const ev of sorted) {
    if (mode === 'reject') {
      await db.statusEvent.update({
        where: { id: ev.id },
        data: { reviewState: 'rejected', result: 'rejected', comment: 'Отклонено пакетно после замены состава' },
      })
      await audit({
        actorRole: 'logist',
        actorName: approver,
        object: 'status_event',
        objectId: ev.id,
        field: 'review_state',
        was: 'pending',
        became: 'rejected',
        comment: 'Отклонено пакетно после замены состава',
      })
      results.push({ eventId: ev.id, outcome: 'rejected' })
      continue
    }
    const leg = await db.leg.findUnique({ where: { id: ev.legId } })
    if (!leg) continue
    if (isTransitionValid(leg.status, ev.status)) {
      const was = leg.status
      await db.leg.update({
        where: { id: leg.id },
        data: { status: ev.status, statusSource: 'driver', statusSetAt: new Date(), version: { increment: 1 } },
      })
      await db.statusEvent.update({
        where: { id: ev.id },
        data: { appliedByReview: true, reviewState: 'applied', result: 'applied', needsReview: false },
      })
      await outboxInsert('leg.status_changed', {
        legId: leg.id,
        status: ev.status,
        source: 'driver',
        appliedByReview: true,
        at: new Date().toISOString(),
      })
      await audit({
        actorRole: 'logist',
        actorName: approver,
        object: 'leg',
        objectId: leg.id,
        field: 'status',
        was,
        became: ev.status,
        comment: 'Применено при пакетном разборе; автор события — водитель',
      })
      results.push({ eventId: ev.id, outcome: 'applied' })
    } else {
      // Недопустимое — пропуск с меткой, не отклонение (B5.8.4)
      await db.statusEvent.update({
        where: { id: ev.id },
        data: { skippedConflict: true, result: 'skipped_conflict' },
      })
      results.push({ eventId: ev.id, outcome: 'skipped_conflict' })
    }
  }
  return results
}

// B7.1.3: жизненный цикл outbox — stale/failed_delivery по времени выдачи
export async function outboxTick(now = new Date()) {
  const staleBefore = new Date(now.getTime() - CONSTANTS.OUTBOX_STALE_HOURS * 3600 * 1000)
  const failedBefore = new Date(now.getTime() - CONSTANTS.OUTBOX_FAILED_HOURS * 3600 * 1000)
  await db.outbox1c.updateMany({
    where: { state: 'pending', firstSeenAt: { lt: staleBefore } },
    data: { state: 'stale' },
  })
  await db.outbox1c.updateMany({
    where: { state: 'stale', firstSeenAt: { lt: failedBefore } },
    data: { state: 'failed_delivery' },
  })
}
