// Хранилище последних GPS-позиций водителей для мониторинга диспетчером.
//
// Канал телеметрии: приложение водителя POST-ит позицию раз в 5 с во время
// активного рейса; «Контур 1С» читает снимок через GET /api/driver/v1/position
// (сервер-сервер, localhost) и показывает машину диспетчеру на мини-карте.
//
// Хранение — файл db/positions.json (как bridge-state.json): без миграций
// схемы, переживает рестарт дев-сервера, объём — один запись на водителя.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FILE = process.env.POSITIONS_FILE ?? join(process.cwd(), 'db', 'positions.json')

export interface PositionRecord {
  driverId: string
  lat: number
  lon: number
  speedKmh: number
  heading: number
  /** Номер рейса (ЗК-…) — для карточки диспетчера. */
  tripCode?: string
  /** Стадия на устройстве: in_progress / prep / … */
  stage?: string
  /** Время фиксации по часам устройства, epoch ms. */
  ts: number
  /** Время приёма сервером, epoch ms. */
  receivedAt: number
}

type Store = { positions: PositionRecord[] }

const g = globalThis as unknown as { __azmzPositions?: { cache: Map<string, PositionRecord>; loaded: boolean } }

function state() {
  if (!g.__azmzPositions) g.__azmzPositions = { cache: new Map(), loaded: false }
  return g.__azmzPositions
}

function load(): void {
  const st = state()
  if (st.loaded) return
  st.loaded = true
  try {
    if (!existsSync(FILE)) return
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as Store
    for (const p of parsed.positions ?? []) {
      if (p && typeof p.driverId === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
        st.cache.set(p.driverId, p)
      }
    }
  } catch {
    // битый файл — начинаем с чистого снимка
  }
}

function flush(): void {
  const st = state()
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify({ positions: [...st.cache.values()], savedAt: new Date().toISOString() }))
  } catch (e) {
    console.error('[positions] не смог сохранить снимок:', (e as Error).message)
  }
}

/** Сохранить последнюю позицию водителя (перезапись, не история). */
export function savePosition(rec: PositionRecord): PositionRecord {
  const st = state()
  load()
  st.cache.set(rec.driverId, rec)
  flush()
  return rec
}

/** Снимок позиций всех водителей. maxAgeMs=0 — без фильтра по свежести. */
export function getPositions(maxAgeMs = 0): PositionRecord[] {
  const st = state()
  load()
  const now = Date.now()
  return [...st.cache.values()].filter((p) => maxAgeMs <= 0 || now - p.receivedAt <= maxAgeMs)
}

/** Позиция одного водителя (по appId-заголовку) или null. */
export function getPosition(driverId: string): PositionRecord | null {
  const st = state()
  load()
  return st.cache.get(driverId) ?? null
}
