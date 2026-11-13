/**
 * Офлайн-карта «Вся Россия» — менеджер скачанного пака тайлов.
 *
 * Что качаем (всё через свой origin /api/maptiles/osm — только так Service
 * Worker может отдавать тайлы без сети):
 *   1. СТРАНА  z4–z8  — bbox всей РФ (с переходом через 180-й меридиан):
 *      обзор страны и крупные города; ~12,7 тыс. плиток.
 *   2. КОРИДОР z9–z16 — полоса вдоль активного маршрута (заявки из 1С,
 *      маршрут по ссылке Яндекс.Карт, демо А-146): детализация до улиц.
 *   3. ПУЗЫРЬ  z10–z15 — вокруг ВОДИТЕЛЯ, когда он вне коридора: едет по
 *      своему маршруту — подробные тайлы переезжают за ним, при возврате
 *      на коридор пак возвращается к стране+коридору.
 *
 * Хранение: Cache Storage «azmz-map-pack-v1» (имя НЕ зависит от версии SW —
 * пак переживает обновления приложения). Манифест пака лежит там же под
 * служебным ключом /api/maptiles/__pack-manifest.
 *
 * Постепенное обновление: докачиваем недостающее, раз в 7 дней освежаем
 * устаревшее, плитки вне актуального набора удаляем. Очередь по 3 соединения
 * с паузами, ретраи с бэкоффом, 429/Retry-After уважаем, при серии ошибок
 * останавливаемся и попробуем снова позже (online-событие / раз в 3 ч / вручную).
 */

import { useSyncExternalStore } from 'react'
import { distToPolylineM } from '@/lib/demo/real-route'
import { LOADING_POINT, UNLOADING_POINT } from '@/lib/demo/route-data'
import { useAzmz } from '@/lib/store'

const MAP_PACK_CACHE = 'azmz-map-pack-v1'
const MANIFEST_PATH = '/api/maptiles/__pack-manifest'
/** Свежесть тайла: старше 7 дней — перекачать при очередном возрастном скане. */
const TILE_TTL_MS = 7 * 24 * 3_600_000
/** Минимальная пауза между автопроверками (не чаще раза в 30 мин). */
const CHECK_THROTTLE_MS = 30 * 60_000
/** Параллельных соединений при докачке. */
const CONCURRENCY = 3
/** Пауза между запусками запросов, мс — не долбим тайл-сервер очередью. */
const PAUSE_MS = 25
/** Потолок пака: при превышении срезаем верхние зумы (страховка от роста). */
const MAX_TILES = 20_000
/** Сколько тайлов подряд могут упасть (после ретраев), прежде чем встанем. */
const BREAKER_AFTER = 12
/** Пауза после срабатывания предохранителя, мс. */
const BREAKER_COOLDOWN_MS = 10 * 60_000

/** Страна: bbox РФ. Долгота восточной границы > 180° — Чукотка «заворачивается». */
const RF = { latMin: 41.0, latMax: 82.0, lngMin: 19.0, lngEast: 190.0 }

/** Коридор маршрута: зум → буфер в метрах от оси. */
const CORRIDOR_ZOOMS: Array<{ z: number; bufferM: number }> = [
  { z: 9, bufferM: 32_000 },
  { z: 10, bufferM: 16_000 },
  { z: 11, bufferM: 8_000 },
  { z: 12, bufferM: 4_000 },
  { z: 13, bufferM: 2_000 },
  { z: 14, bufferM: 1_000 },
  { z: 15, bufferM: 500 },
  { z: 16, bufferM: 250 },
]

/** Пузырь вокруг водителя вне коридора: зум → радиус в метрах. */
const BUBBLE_RADII: Array<{ z: number; r: number }> = [
  { z: 10, r: 30_000 },
  { z: 11, r: 20_000 },
  { z: 12, r: 12_000 },
  { z: 13, r: 7_000 },
  { z: 14, r: 4_000 },
  { z: 15, r: 2_000 },
]

/** Пузырь переезжает за водителем, когда он ушёл от центра больше чем на … */
const BUBBLE_MOVE_M = 2_000
/** …но не чаще раза в … */
const BUBBLE_REBUILD_MS = 60_000

// ─── состояние ──────────────────────────────────────────────────────────────

export type OfflineMapPhase = 'idle' | 'downloading' | 'ready' | 'error'

export interface OfflineMapState {
  enabled: boolean
  autoUpdate: boolean
  phase: OfflineMapPhase
  done: number
  total: number
  bytes: number
  tileCount: number
  builtAt: number | null
  lastCheckAt: number | null
  error: string | null
}

const DEFAULT_STATE: OfflineMapState = {
  enabled: false,
  autoUpdate: true,
  phase: 'idle',
  done: 0,
  total: 0,
  bytes: 0,
  tileCount: 0,
  builtAt: null,
  lastCheckAt: null,
  error: null,
}

let state: OfflineMapState = { ...DEFAULT_STATE }
const listeners = new Set<() => void>()

function emit(patch: Partial<OfflineMapState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getSnapshot = () => state
const getServerSnapshot = () => DEFAULT_STATE

export function useOfflineMap(): OfflineMapState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// ─── геометрия тайлов (Web Mercator) ────────────────────────────────────────

function lngToXf(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z
}
function latToYf(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z
}
/** Ширина тайла в метрах на широте lat. */
function tileMeters(z: number, lat: number): number {
  return (40_075_016.7 * Math.cos((lat * Math.PI) / 180)) / 2 ** z
}

/** Страна: перечисление «z/x/y» по bbox РФ (с заворотом через 180°). */
function* countryTiles(): Generator<string> {
  for (let z = 4; z <= 8; z++) {
    const n = 2 ** z
    const yTop = Math.floor(latToYf(RF.latMax, z))
    const yBot = Math.ceil(latToYf(RF.latMin, z)) - 1
    const xWest = Math.floor(lngToXf(RF.lngMin, z))
    const xEast = Math.floor(lngToXf(RF.lngEast, z)) // > n — переход через 180°
    for (let y = yTop; y <= yBot; y++) {
      if (xEast >= n) {
        for (let x = xWest; x < n; x++) yield `${z}/${x}/${y}`
        for (let x = 0; x <= xEast - n; x++) yield `${z}/${x}/${y}`
      } else {
        for (let x = xWest; x <= xEast; x++) yield `${z}/${x}/${y}`
      }
    }
  }
}

/** Отметка тайла и его «дилатации» — соседей в радиусе rings. */
function markWithRings(set: Set<string>, z: number, x: number, y: number, rings: number) {
  const r2 = (rings + 0.5) ** 2
  for (let dx = -rings; dx <= rings; dx++) {
    for (let dy = -rings; dy <= rings; dy++) {
      if (dx * dx + dy * dy > r2) continue
      set.add(`${z}/${x + dx}/${y + dy}`)
    }
  }
}

/** Коридор: тайлы в буфере вокруг ломаной [lng,lat][]. */
function corridorTiles(line: Array<[number, number]>): Set<string> {
  const set = new Set<string>()
  if (line.length === 0) return set
  const pts: Array<[number, number]> = line.length === 1 ? [line[0], line[0]] : line
  for (const { z, bufferM } of CORRIDOR_ZOOMS) {
    for (let i = 1; i < pts.length; i++) {
      const [lngA, latA] = pts[i - 1]
      const [lngB, latB] = pts[i]
      const ax = lngToXf(lngA, z)
      const ay = latToYf(latA, z)
      const bx = lngToXf(lngB, z)
      const by = latToYf(latB, z)
      const lenTiles = Math.hypot(bx - ax, by - ay)
      const steps = Math.max(1, Math.ceil(lenTiles / 0.5))
      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        const lat = latA + (latB - latA) * t
        const rings = Math.ceil(bufferM / tileMeters(z, lat)) + 1
        markWithRings(set, z, Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t), rings)
      }
    }
  }
  return set
}

/** Пузырь: тайлы в радиусе вокруг точки [lng,lat]. */
function bubbleTiles(center: [number, number]): Set<string> {
  const set = new Set<string>()
  const [lng, lat] = center
  for (const { z, r } of BUBBLE_RADII) {
    const cx = lngToXf(lng, z)
    const cy = latToYf(lat, z)
    const rings = Math.ceil(r / tileMeters(z, lat)) + 1
    markWithRings(set, z, Math.floor(cx), Math.floor(cy), rings)
  }
  return set
}

// ─── источник коридора ──────────────────────────────────────────────────────

/** Ломаная активного маршрута: [lng, lat][]. override ← карта; иначе realRoute; иначе демо А-146. */
let corridorOverride: Array<[number, number]> | null = null
let bubbleCenter: [number, number] | null = null

/** Демо-фолбэк — ось Абинск → Новороссийск (крайние точки А-146). */
const DEMO_LINE: Array<[number, number]> = [
  [LOADING_POINT.lon, LOADING_POINT.lat],
  [UNLOADING_POINT.lon, UNLOADING_POINT.lat],
]

function corridorLine(): Array<[number, number]> {
  if (corridorOverride && corridorOverride.length >= 2) return corridorOverride
  try {
    const real = useAzmz.getState().realRoute?.coords
    if (real && real.length >= 2) return real
  } catch {
    /* стор ещё не готов — демо-фолбэк */
  }
  return DEMO_LINE
}

export function setCorridorOverride(coords: Array<[number, number]> | null): void {
  corridorOverride = coords && coords.length >= 2 ? coords : null
  scheduleRebuild('коридор обновлён', 5_000)
}

/** Фиксы GPS водителя: двигаем «пузырь» подробных тайлов за ним. */
export function noteDriverPos(lng: number, lat: number): void {
  const line = corridorLine()
  const onCorridor = distToPolylineM({ lat, lng }, line) <= 2_000
  if (onCorridor) {
    if (bubbleCenter) {
      bubbleCenter = null
      scheduleRebuild('возврат на коридор', 15_000)
    }
    return
  }
  if (!bubbleCenter) {
    bubbleCenter = [lng, lat]
    scheduleRebuild('пузырь вокруг водителя', BUBBLE_REBUILD_MS)
    return
  }
  const moved = distToPolylineM({ lat, lng }, [bubbleCenter])
  if (moved >= BUBBLE_MOVE_M) {
    bubbleCenter = [lng, lat]
    scheduleRebuild('пузырь переехал', BUBBLE_REBUILD_MS)
  }
}

// ─── манифест и загрузка ────────────────────────────────────────────────────

interface PackManifest {
  version: 2
  builtAt: number
  tileCount: number
  bytes: number
  staleScanAt: number
}

function manifestUrl(): string {
  return new URL(MANIFEST_PATH, window.location.href).href
}
function tileUrl(key: string): string {
  return new URL(`/api/maptiles/osm/${key}.png`, window.location.href).href
}

async function readManifest(cache: Cache): Promise<PackManifest | null> {
  try {
    const res = await cache.match(manifestUrl())
    if (!res) return null
    const m = (await res.json()) as Partial<PackManifest>
    if (typeof m.tileCount !== 'number') return null
    return {
      version: 2,
      builtAt: m.builtAt ?? 0,
      tileCount: m.tileCount,
      bytes: m.bytes ?? 0,
      staleScanAt: m.staleScanAt ?? 0,
    }
  } catch {
    return null
  }
}

async function writeManifest(cache: Cache, m: PackManifest): Promise<void> {
  try {
    await cache.put(manifestUrl(), new Response(JSON.stringify(m), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }))
  } catch {
    /* манифест не критичен */
  }
}

/** Полный желаемый набор пака: страна + коридор + пузырь (с потолком). */
function computeDesired(): Set<string> {
  const desired = new Set<string>()
  for (const key of countryTiles()) desired.add(key)
  const line = corridorLine()
  for (const key of corridorTiles(line)) desired.add(key)
  if (bubbleCenter) for (const key of bubbleTiles(bubbleCenter)) desired.add(key)
  if (desired.size > MAX_TILES) {
    // страховка: срезаем верхние зумы, страна важнее деталей
    const byZoom = new Map<number, string[]>()
    for (const key of desired) {
      const z = Number(key.split('/')[0])
      const arr = byZoom.get(z) ?? []
      arr.push(key)
      byZoom.set(z, arr)
    }
    const kept = new Set<string>()
    let count = 0
    for (const z of [...byZoom.keys()].sort((a, b) => a - b)) {
      for (const key of byZoom.get(z)!) {
        if (count >= MAX_TILES) break
        kept.add(key)
        count++
      }
      if (count >= MAX_TILES) break
    }
    return kept
  }
  return desired
}

class BreakerError extends Error {}

/** Один тайл с ретраями; 429 → ждём Retry-After (троттлинг не сжигает попытку). */
async function fetchTile(url: string): Promise<{ ok: true; buf: ArrayBuffer } | { ok: false }> {
  const delays = [400, 2_000, 8_000]
  let attempt = 0
  let throttles = 0
  for (;;) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (res.status === 429) {
        throttles += 1
        if (throttles > 8) return { ok: false }
        const ra = Number(res.headers.get('retry-after'))
        const waitMs = Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 5_000, 60_000)
        await sleep(waitMs)
        continue
      }
      if (res.ok) {
        const buf = await res.arrayBuffer()
        if (buf.byteLength > 0) return { ok: true, buf }
      }
    } catch {
      /* сеть моргнула — следующий ретрай */
    }
    if (attempt >= delays.length) return { ok: false }
    await sleep(delays[attempt])
    attempt += 1
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── движок сборки ──────────────────────────────────────────────────────────

let building = false
let cancelled = false
let rebuildTimer: ReturnType<typeof setTimeout> | null = null
let breakerUntil = 0

function scheduleRebuild(reason: string, delayMs: number): void {
  if (typeof window === 'undefined') return
  if (!state.enabled || building) return
  if (rebuildTimer) clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null
    void runBuild({ reason })
  }, delayMs)
}

async function runBuild(opts: { reason: string }): Promise<void> {
  void opts.reason
  if (typeof window === 'undefined' || !('caches' in window)) return
  if (building) return
  if (!state.enabled) return
  if (!navigator.onLine) return
  if (Date.now() < breakerUntil) return
  building = true
  cancelled = false
  emit({ phase: 'downloading', error: null })

  try {
    const cache = await caches.open(MAP_PACK_CACHE)
    const manifest = await readManifest(cache)

    // желаемый набор ↔ фактический кэш
    const desired = computeDesired()
    const desiredUrls = new Map<string, string>()
    for (const key of desired) desiredUrls.set(tileUrl(key), key)
    const keys = await cache.keys()
    const haveUrls = new Set<string>()
    for (const req of keys) {
      if (req.url.endsWith(MANIFEST_PATH)) continue
      haveUrls.add(req.url)
    }

    // чистка: плитки вне актуального набора (старый пузырь, старый коридор)
    let removed = 0
    for (const url of haveUrls) {
      if (desiredUrls.has(url)) continue
      await cache.delete(url)
      removed++
    }

    // докачка недостающего
    const missing: string[] = []
    for (const url of desiredUrls.keys()) {
      if (!haveUrls.has(url)) missing.push(url)
    }

    // освежение устаревшего: возрастной скан не чаще раза в TTL
    const stale: string[] = []
    const now = Date.now()
    if (manifest && now - manifest.staleScanAt > TILE_TTL_MS) {
      for (const url of haveUrls) {
        if (!desiredUrls.has(url)) continue
        const res = await cache.match(url)
        const dateHeader = res?.headers.get('date')
        const at = dateHeader ? Date.parse(dateHeader) : NaN
        if (!Number.isFinite(at) || now - at > TILE_TTL_MS) stale.push(url)
      }
    }

    const total = missing.length + stale.length
    let done = 0
    let bytes = manifest?.bytes ?? 0
    let tileCount = Math.max(0, haveUrls.size - removed)
    emit({ done, total, bytes, tileCount })

    if (total > 0) {
      const queue = [...missing, ...stale]
      let consecutiveFails = 0
      let sinceManifest = 0

      const worker = async () => {
        while (!cancelled) {
          const url = queue.shift()
          if (!url) return
          const r = await fetchTile(url)
          if (r.ok) {
            consecutiveFails = 0
            await cache.put(url, new Response(r.buf, {
              headers: { 'Content-Type': 'image/png', Date: new Date().toISOString() },
            }))
            bytes += r.buf.byteLength
            tileCount++
            done++
          } else {
            consecutiveFails++
            if (consecutiveFails >= BREAKER_AFTER) {
              throw new BreakerError(`Серия ошибок (${BREAKER_AFTER} подряд) — тайл-сервер недоступен или лимит`)
            }
          }
          sinceManifest++
          if (sinceManifest >= 40) {
            sinceManifest = 0
            emit({ done, total, bytes, tileCount })
            await writeManifest(cache, {
              version: 2,
              builtAt: now,
              tileCount,
              bytes,
              staleScanAt: manifest?.staleScanAt ?? now,
            })
          }
          await sleep(PAUSE_MS)
        }
      }

      try {
        await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
      } catch (e) {
        if (e instanceof BreakerError) {
          breakerUntil = Date.now() + BREAKER_COOLDOWN_MS
          emit({ phase: 'error', error: 'Тайл-сервер ограничил загрузку — продолжим позже автоматически' })
          await writeManifest(cache, {
            version: 2,
            builtAt: now,
            tileCount,
            bytes,
            staleScanAt: manifest?.staleScanAt ?? now,
          })
          building = false
          return
        }
        throw e
      }
    }

    await writeManifest(cache, {
      version: 2,
      builtAt: Date.now(),
      tileCount,
      bytes,
      staleScanAt: manifest && Date.now() - manifest.staleScanAt <= TILE_TTL_MS ? manifest.staleScanAt : Date.now(),
    })
    emit({
      phase: 'ready',
      done,
      total,
      bytes,
      tileCount,
      builtAt: Date.now(),
      error: null,
    })
  } catch (e) {
    emit({
      phase: 'error',
      error: e instanceof Error ? e.message : 'Не удалось собрать офлайн-карту',
    })
  } finally {
    building = false
  }
}

// ─── публичный API ──────────────────────────────────────────────────────────

const SETTINGS_KEY = 'azmz-offline-map'

function readSettings(): { enabled: boolean; autoUpdate: boolean } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { enabled: false, autoUpdate: true }
    const p = JSON.parse(raw) as { enabled?: boolean; autoUpdate?: boolean }
    return { enabled: !!p.enabled, autoUpdate: p.autoUpdate !== false }
  } catch {
    return { enabled: false, autoUpdate: true }
  }
}

function writeSettings(s: { enabled: boolean; autoUpdate: boolean }): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* приватный режим — просто живём без сохранения */
  }
}

/** Автопроверка (старт, online, раз в 3 ч): с троттлингом 30 мин. */
function autoCheck(): void {
  if (!state.enabled || !state.autoUpdate) return
  if (building || typeof window === 'undefined') return
  if (!navigator.onLine) return
  const now = Date.now()
  if (state.lastCheckAt && now - state.lastCheckAt < CHECK_THROTTLE_MS) return
  emit({ lastCheckAt: now })
  void runBuild({ reason: 'auto' })
}

let initialized = false

/** Вызвать один раз из эффекта корневого компонента. */
export function initOfflineMap(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  const s = readSettings()
  emit(s)
  // подхватить уже скачанный пак (манифест мог остаться с прошлого запуска)
  void (async () => {
    try {
      if (!('caches' in window)) return
      const cache = await caches.open(MAP_PACK_CACHE)
      const m = await readManifest(cache)
      if (m) emit({ phase: 'ready', tileCount: m.tileCount, bytes: m.bytes, builtAt: m.builtAt })
    } catch {
      /* нет пак — нет пак */
    }
  })()
  window.addEventListener('online', () => autoCheck())
  window.setInterval(() => autoCheck(), 3 * 3_600_000)
  if (s.enabled) autoCheck()
}

export const offlineMap = {
  setEnabled(on: boolean): void {
    const s = readSettings()
    writeSettings({ ...s, enabled: on })
    emit({ enabled: on })
    if (on) {
      void runBuild({ reason: 'включён тумблер' })
    } else {
      cancelled = true
      if (rebuildTimer) {
        clearTimeout(rebuildTimer)
        rebuildTimer = null
      }
      emit({ phase: state.tileCount > 0 ? 'ready' : 'idle', done: 0, total: 0, error: null })
    }
  },
  setAutoUpdate(on: boolean): void {
    const s = readSettings()
    writeSettings({ ...s, autoUpdate: on })
    emit({ autoUpdate: on })
  },
  /** Ручная проверка/докачка прямо сейчас. */
  refreshNow(): void {
    breakerUntil = 0
    void runBuild({ reason: 'вручную' })
  },
  cancel(): void {
    cancelled = true
  },
}
