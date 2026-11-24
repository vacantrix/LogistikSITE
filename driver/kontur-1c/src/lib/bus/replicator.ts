// Мост «Контур 1С» → сервер приложения водителя (:3002).
//
// Реплицирует записи плана обмена (SyncJournal) в драйверский сервер, чтобы
// телефон водителя видел назначения/чат/события, проведённые диспетчером в 1С.
//
// Принципы:
//  • стартует при старте сервера (instrumentation.ts) и лениво при первой
//    записи в журнал (journalWrite передаёт floor-подсказку — seq записей
//    текущей транзакции не должны быть проглочены инициализацией отметки);
//  • водяная отметка хранится в db/bridge-state.json и переживает рестарт
//    сервера: незавершённая на момент сбоя доставка уйдёт после подъёма;
//  • ошибка моста НИКОГДА не валит проведение документа — записи остаются
//    в журнале 1С и уходят при следующем удачном цикле;
//  • пересылаются только записи водителей, у которых заполнен appId
//    (идентификатор приложения на телефоне); driverId в записи и в снимке
//    переписывается на appId — APK тянет журнал по нему;
//  • отметка двигается только за успешно доставленные записи; точные дубли
//    на приёме отсеиваются (идемпотентность повторов).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { db } from '../db'

const BRIDGE_URL = process.env.DRIVER_BRIDGE_URL ?? 'http://127.0.0.1:3002/api/driver/v1/ingest'
const BRIDGE_TOKEN = process.env.DRIVER_BRIDGE_TOKEN ?? 'azmz-stand-bridge-2026'
const DISABLED = process.env.DRIVER_BRIDGE_DISABLED === '1'
const TICK_MS = 2000
const STATE_FILE = process.env.DRIVER_BRIDGE_STATE ?? join(process.cwd(), 'db', 'bridge-state.json')

type ForwardEntry = { seq: number; entity: string; op: string; payload: string }

type BridgeState = {
  timer: NodeJS.Timeout | null
  watermark: number | null
  busy: boolean
}

const g = globalThis as unknown as { __azmzKonturBridge?: BridgeState }

function readState(): number | null {
  try {
    if (!existsSync(STATE_FILE)) return null
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { watermark?: number }
    return typeof parsed.watermark === 'number' ? parsed.watermark : null
  } catch {
    return null
  }
}

function writeState(watermark: number): void {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify({ watermark, savedAt: new Date().toISOString() }))
  } catch (e) {
    console.error('[bridge] не смог сохранить отметку:', (e as Error).message)
  }
}

/**
 * Запуск репликатора (идемпотентно).
 * floorHint — «отметка не выше»: seq первой записи текущей транзакции минус 1,
 * чтобы ленивый старт не проглотил самые свежие записи.
 */
export function ensureBridgeReplicator(floorHint?: number): void {
  if (DISABLED) return
  if (g.__azmzKonturBridge) return
  const persisted = readState()
  const state: BridgeState = { timer: null, watermark: persisted, busy: false }
  g.__azmzKonturBridge = state
  state.timer = setInterval(() => void tick(state), TICK_MS)
  if (state.timer.unref) state.timer.unref()
  console.log(`[bridge] репликатор плана обмена запущен → ${BRIDGE_URL} (отметка: ${persisted ?? 'нет'})`)
  if (persisted === null && floorHint !== undefined) {
    // ленивый старт из journalWrite: сразу фиксируем пол, иначе первый тик
    // возьмёт максимум по закоммиченным записям и пропустит текущую транзакцию
    state.watermark = floorHint
    writeState(floorHint)
  }
}

/** Остановка (тесты/выключение). */
export function stopBridgeReplicator(): void {
  const state = g.__azmzKonturBridge
  if (!state) return
  if (state.timer) clearInterval(state.timer)
  delete g.__azmzKonturBridge
}

async function tick(state: BridgeState): Promise<void> {
  if (state.busy) return
  state.busy = true
  try {
    if (state.watermark === null) {
      // отметки нет (первый старт после сида): встаём на текущий максимум —
      // историю журнала не пересылаем, телефон уже получил зеркальный сид
      const max = await db.syncJournal.aggregate({ _max: { seq: true } })
      state.watermark = max._max.seq ?? 0
      writeState(state.watermark)
      return
    }

    const rows = await db.syncJournal.findMany({
      where: { seq: { gt: state.watermark } },
      orderBy: { seq: 'asc' },
      take: 100,
    })
    if (rows.length === 0) return

    // Водители с приложением: пересылаем только им, переписывая driverId на appId.
    const driverIds = [...new Set(rows.map((r) => r.driverId))]
    const drivers = await db.driver.findMany({
      where: { id: { in: driverIds }, appId: { not: null } },
      select: { id: true, appId: true },
    })
    const appByDriver = new Map(drivers.map((d) => [d.id, d.appId as string]))

    const byApp = new Map<string, ForwardEntry[]>()
    for (const r of rows) {
      const app = appByDriver.get(r.driverId)
      if (!app) continue // у водителя нет приложения — пересылать некому
      const list = byApp.get(app) ?? []
      list.push({ seq: r.seq, entity: r.entity, op: r.op, payload: r.payload })
      byApp.set(app, list)
    }

    // Доставляем по водителям; при сбое замираем отметку ПЕРЕД первой
    // недоставленной записью — она уйдёт следующим циклом (дубли отсеет приём).
    let firstFailedSeq: number | null = null
    for (const [app, list] of byApp) {
      if (firstFailedSeq !== null) break
      const ok = await forward(app, list)
      if (!ok) firstFailedSeq = list[0].seq
    }

    const next = firstFailedSeq !== null ? firstFailedSeq - 1 : rows[rows.length - 1].seq
    if (next > state.watermark) {
      state.watermark = next
      writeState(next)
    }
  } catch (e) {
    console.error('[bridge] ошибка цикла репликации:', e)
  } finally {
    state.busy = false
  }
}

async function forward(appDriverId: string, list: ForwardEntry[]): Promise<boolean> {
  const entries: { entity: string; op: string; payload: unknown }[] = []
  for (const e of list) {
    const rewritten = rewriteDriverId(e.payload, appDriverId)
    if (rewritten !== undefined) entries.push({ entity: e.entity, op: e.op, payload: rewritten })
  }
  if (entries.length === 0) return true

  try {
    const res = await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-token': BRIDGE_TOKEN },
      body: JSON.stringify({ driverId: appDriverId, entries }),
    })
    if (!res.ok) {
      console.error(`[bridge] драйверский сервер ответил ${res.status} — повторю позже`)
      return false
    }
    const data = (await res.json()) as { written?: number; skipped?: number }
    console.log(
      `[bridge] водителю ${appDriverId.slice(0, 8)}… доставлено записей: ${data.written ?? '?'} (дублей отсеяно: ${data.skipped ?? 0})`,
    )
    return true
  } catch (e) {
    console.error('[bridge] драйверский сервер недоступен — повторю позже:', (e as Error).message)
    return false
  }
}

/** driverId в снимке → appId (id водителя на телефоне). Битый JSON не пересылаем. */
function rewriteDriverId(payloadText: string, appDriverId: string): unknown {
  try {
    const obj = JSON.parse(payloadText) as Record<string, unknown>
    if (typeof obj.driverId === 'string') obj.driverId = appDriverId
    return obj
  } catch {
    console.error('[bridge] некорректный JSON-снимок в журнале — запись пропущена')
    return undefined
  }
}
