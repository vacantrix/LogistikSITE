/**
 * Клиент OCR-сервиса (шлюз mini-services/ocr-service на порту 3020
 * или напрямую движок paddle-ocr на 3031 — контракт POST /ocr у них общий).
 *
 * Как устроено: фото и файлы загружаются на серверы АЭМЗ (БД платформы),
 * распознавание крутится на выделенном GPU-ПК нейросети в инфраструктуре АЭМЗ.
 * Если сервис не отвечает — документ остаётся «на проверке» и проверку
 * повторяют (облачного резерва нет, см. verify.ts).
 *
 * Пропуск документов управляется настройками нейросети (админ-раздел «Нейросеть»,
 * src/lib/nn.ts, таблица Setting):
 *   parallel   — «максимум фото в обработке»: сколько фото GPU-ПК берёт одновременно
 *                (подбирается под VRAM). Общая очередь на ВСЕХ пользователей: несколько
 *                перевозчиков могут загружать одновременно — лишние фото честно ждут;
 *   timeoutSec — таймаут считается с момента отправки, а не с постановки в очередь,
 *                поэтому пачка документов не «отваливается» по таймауту на середине;
 *   cacheMin   — повторный тот же скан (хэш содержимого + вид документа) отдаётся из кэша
 *                мгновенно, без повторного прогона нейросети;
 *   maxSide    — перед отправкой фото сжимается (sharp): меньше трафика до ПК нейросети
 *                и быстрее распознавание.
 *
 * Ожидаемые данные заявки сервису не передаются: он только читает фото.
 * Отключить интеграцию: OCR_SERVICE_URL='' (пустая строка).
 */
import type { DocType, OcrOutput } from '@/lib/verify'
import { nnSettings, scanKey, shrinkImage } from '@/lib/nn'

/** Виды документов, которые проверяет платформа */
const KNOWN_TYPES = new Set<DocType>(['PASSPORT_PHOTO', 'PASSPORT_REG', 'STS', 'REQUEST_DOC', 'POA'])

const BASE = process.env.OCR_SERVICE_URL ?? 'http://127.0.0.1:3020'
const TOKEN = process.env.OCR_SERVICE_TOKEN

export function ocrServiceEnabled(): boolean {
  return BASE !== ''
}

const headers = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(TOKEN ? { 'X-OCR-Token': TOKEN } : {}),
})

export interface OcrServiceStatus {
  running: boolean
  version?: string
  description?: string
  activeEngine?: string | null
  processed?: number
  uptimeSec?: number
  paddleConfigured?: boolean
  time?: string
}

/** Статус сервиса для UI (короткий таймаут — статус не должен тормозить интерфейс) */
export async function ocrServiceStatus(): Promise<OcrServiceStatus> {
  if (!ocrServiceEnabled()) return { running: false }
  try {
    const res = await fetch(`${BASE}/health`, {
      headers: headers(),
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    })
    if (!res.ok) return { running: false }
    const j = (await res.json()) as {
      version?: string
      description?: string
      activeEngine?: string | null
      processed?: number
      uptimeSec?: number
      engines?: { paddle?: { configured?: boolean } }
      time?: string
    }
    return {
      running: true,
      version: j.version,
      description: j.description,
      activeEngine: j.activeEngine ?? null,
      processed: j.processed ?? 0,
      uptimeSec: j.uptimeSec,
      paddleConfigured: Boolean(j.engines?.paddle?.configured),
      time: j.time,
    }
  } catch {
    return { running: false }
  }
}

/** Результат распознавания: прочитано; вид документа без шаблона (проверка вручную); сервис не ответил */
export type OcrServiceResult = { kind: 'ok'; ocr: OcrOutput } | { kind: 'unsupported' } | { kind: 'unavailable' }

// ---------------- общая очередь фото (максимум в обработке — настройка parallel) ----------------

let active = 0
const waiters: Array<() => void> = []

/**
 * Взять слот машины с учётом текущего parallel (перечитывается на каждый документ).
 * Очередь общая для всех: если перевозчики загрузили одновременно больше фото,
 * чем берёт GPU-ПК, остальные ждут освобождения слота — FIFO, без приоритетов.
 */
async function acquireSlot(): Promise<void> {
  const { parallel } = await nnSettings()
  if (active < parallel) {
    active += 1
    return
  }
  await new Promise<void>((resolve) => waiters.push(resolve))
  active += 1
}

function releaseSlot(): void {
  active = Math.max(0, active - 1)
  const next = waiters.shift()
  if (next) next()
}

/** Статистика очереди для админ-раздела: в обработке / ждут */
export function nnQueueStats(): { active: number; waiting: number } {
  return { active, waiting: waiters.length }
}

// ---------------- кэш повторных сканов (настройка cacheMin) ----------------

const CACHE_MAX = 200
const resultCache = new Map<string, { at: number; res: OcrServiceResult }>()
let cacheHits = 0
let cacheSavedMs = 0

export function nnCacheStats(): { size: number; hits: number; savedMs: number } {
  return { size: resultCache.size, hits: cacheHits, savedMs: cacheSavedMs }
}

function cacheGet(key: string, ttlMs: number): OcrServiceResult | null {
  if (ttlMs <= 0) return null
  const hit = resultCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > ttlMs) {
    resultCache.delete(key)
    return null
  }
  // перечитываем в конец — простое LRU по порядку вставки
  resultCache.delete(key)
  resultCache.set(key, hit)
  cacheHits += 1
  return hit.res
}

function cachePut(key: string, res: OcrServiceResult, startedAt: number): void {
  if (res.kind !== 'ok') return
  if (resultCache.size >= CACHE_MAX) {
    const oldest = resultCache.keys().next().value
    if (oldest !== undefined) resultCache.delete(oldest)
  }
  resultCache.set(key, { at: Date.now(), res })
  cacheSavedMs += Math.max(0, Date.now() - startedAt)
}

/** Сбросить кэш сканов (админ-раздел «Нейросеть») */
export function clearNnCache(): void {
  resultCache.clear()
  cacheHits = 0
  cacheSavedMs = 0
}

// ---------------- распознавание одного документа ----------------

/**
 * Распознавание через локальный сервис (изображение или PDF — сервис читает первую страницу).
 * Одна сильная модель (Task 86), параметр mode прежних кнопок убран.
 * opts.freshCache — игнорировать кэш (кнопка «Проверить нейросеть» в админке).
 */
export async function ocrServiceOcr(
  dataUri: string,
  type: DocType,
  intake: boolean,
  opts: { freshCache?: boolean } = {},
): Promise<OcrServiceResult> {
  if (!ocrServiceEnabled()) return { kind: 'unavailable' }

  const settings = await nnSettings()
  const key = scanKey(dataUri, type)
  if (!opts.freshCache) {
    const cached = cacheGet(key, settings.cacheMin * 60_000)
    if (cached) return cached
  }

  await acquireSlot()
  const startedAt = Date.now()
  try {
    // сжатие перед отправкой на ПК нейросети (настройка maxSide): меньше пикселей и мегабайт — быстрее движок
    const payload = await shrinkImage(dataUri, settings.maxSide)
    const res = await fetch(`${BASE}/ocr`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ type, dataUri: payload, intake }),
      signal: AbortSignal.timeout(settings.timeoutSec * 1000),
    })
    if (res.status === 422) return { kind: 'unsupported' }
    if (!res.ok) return { kind: 'unavailable' }
    const j = (await res.json()) as {
      ok?: boolean
      ocr?: {
        engine?: string
        quality?: number
        fields?: Record<string, string>
        confidences?: Record<string, number>
        detectedType?: DocType | 'UNKNOWN'
        side?: string
        confirmations?: Record<string, string[]>
      }
    }
    const ocr = j.ocr
    if (!j.ok || !ocr || typeof ocr.quality !== 'number' || !ocr.engine) return { kind: 'unavailable' }
    const result: OcrServiceResult = {
      kind: 'ok',
      ocr: {
        engine: ocr.engine,
        quality: Math.round(ocr.quality),
        fields: ocr.fields ?? {},
        confidences: ocr.confidences ?? {},
        // распознаватель умеет больше видов (например, ВУ), чем запрашивает платформа —
        // незнакомый ей вид = «не удалось распознать документ»
        ...(ocr.detectedType
          ? { detectedType: KNOWN_TYPES.has(ocr.detectedType as DocType) ? ocr.detectedType : 'UNKNOWN' }
          : {}),
        ...(ocr.side === 'front' || ocr.side === 'back' ? { side: ocr.side } : {}),
        ...(ocr.confirmations ? { confirmations: ocr.confirmations } : {}),
      },
    }
    cachePut(key, result, startedAt)
    return result
  } catch {
    return { kind: 'unavailable' }
  } finally {
    releaseSlot()
  }
}
