import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * POST /api/driver/v1/ingest — приём записей плана обмена от платформы
 * «Контур 1С» (мост офис → водительский сервер).
 *
 * Авторизация: заголовок x-ingest-token (env DRIVER_INGEST_TOKEN, на стенде
 * по умолчанию демо-токен). Тело:
 *   { driverId: "<appId водителя из 1С>", entries: [{ entity, op, payload }] }
 *
 * Записи дописываются в SyncJournal (канал 1) — APK заберёт их ближайшим
 * sync/pull. Идемпотентность: точный дубль (driverId+entity+op+payload)
 * пропускается, поэтому повторная пересылка мостом безопасна.
 */

const TOKEN = process.env.DRIVER_INGEST_TOKEN ?? 'azmz-stand-bridge-2026'
const ENTITIES = new Set(['TRIP', 'TRIP_POINT', 'TRIP_EVENT', 'CHAT_MESSAGE', 'SYSTEM_NOTE'])
const OPS = new Set(['UPSERT', 'DELETE'])
const MAX_ENTRIES = 50

type IngestEntry = { entity: string; op: string; payload: unknown }

export async function POST(req: NextRequest) {
  if (req.headers.get('x-ingest-token') !== TOKEN) {
    return NextResponse.json({ ok: false, error: 'Неверный ingest-токен' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }

  let body: { driverId?: unknown; entries?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Некорректное тело запроса (ожидается JSON)' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const driverId = typeof body.driverId === 'string' ? body.driverId.trim() : ''
  if (!driverId) {
    return NextResponse.json({ ok: false, error: 'Обязательно поле driverId' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const rawEntries = Array.isArray(body.entries) ? (body.entries as IngestEntry[]) : []
  if (rawEntries.length === 0) {
    return NextResponse.json({ ok: false, error: 'Пустой массив entries' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  if (rawEntries.length > MAX_ENTRIES) {
    return NextResponse.json({ ok: false, error: `Не больше ${MAX_ENTRIES} записей за вызов` }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const valid: { entity: string; op: string; payload: string }[] = []
  for (const e of rawEntries) {
    if (!e || typeof e.entity !== 'string' || typeof e.op !== 'string' || !ENTITIES.has(e.entity) || !OPS.has(e.op)) {
      return NextResponse.json({ ok: false, error: 'Недопустимая entity или op' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
    }
    if (typeof e.payload !== 'object' || e.payload === null || Array.isArray(e.payload)) {
      return NextResponse.json({ ok: false, error: 'payload должен быть JSON-объектом (снимком строки)' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
    }
    valid.push({ entity: e.entity, op: e.op, payload: JSON.stringify(e.payload) })
  }

  // Идемпотентность: пропускаем точные дубли (повторная пересылка мостом)
  let written = 0
  let skipped = 0
  for (const e of valid) {
    const dup = await db.syncJournal.findFirst({
      where: { driverId, entity: e.entity, op: e.op, payload: e.payload },
      select: { seq: true },
    })
    if (dup) {
      skipped++
      continue
    }
    await db.syncJournal.create({
      data: { driverId, entity: e.entity, op: e.op, payload: e.payload },
    })
    written++
  }

  const last = await db.syncJournal.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true } })
  return NextResponse.json(
    { ok: true, written, skipped, maxSeq: last?.seq ?? 0 },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
