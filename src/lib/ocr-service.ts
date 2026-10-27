/**
 * Клиент локального OCR-сервиса (шлюз mini-services/ocr-service на порту 3020
 * или напрямую mini-services/paddle-ocr на 3031 — контракт POST /ocr у них общий).
 *
 * Основной путь распознавания: PaddleOCR работает на нашем сервере, фото документов
 * никуда не уходят. Если сервис не отвечает — документ остаётся «на проверке» и проверку
 * повторяют (облачного резерва нет, см. verify.ts).
 *
 * PaddleOCR распознаёт документы по одному (5–40 с на документ). Поэтому запросы этого процесса
 * выстраиваются в очередь здесь же: таймаут считается с момента отправки, а не с постановки
 * в очередь, и пачка из 10 документов не «отваливается» по таймауту на середине.
 *
 * Ожидаемые данные заявки сервису не передаются: он только читает фото.
 * Отключить интеграцию: OCR_SERVICE_URL='' (пустая строка).
 */
import type { DocType, OcrOutput } from '@/lib/verify'

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

// один документ — до ~40 с, с повторным точным проходом — до ~90 с; первый вызов ещё и грузит модели
const OCR_TIMEOUT_MS = 180_000

let queue: Promise<unknown> = Promise.resolve()

/** Очередь запросов к сервису: следующий документ уходит, только когда предыдущий распознан */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => undefined)
  return run
}

/**
 * Распознавание через локальный сервис (изображение или PDF — сервис читает первую страницу).
 * mode (Task 83) — какая нейросеть читает: "fast" (лёгкая, кнопка «Автозаполнение»),
 * "accurate" (точная, кнопка «Проверить»); без mode — сервис сам подбирает режим.
 */
export function ocrServiceOcr(dataUri: string, type: DocType, intake: boolean, mode?: 'fast' | 'accurate'): Promise<OcrServiceResult> {
  if (!ocrServiceEnabled()) return Promise.resolve({ kind: 'unavailable' })
  return enqueue(async (): Promise<OcrServiceResult> => {
    try {
      const res = await fetch(`${BASE}/ocr`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ type, dataUri, intake, ...(mode ? { mode } : {}) }),
        signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
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
          engineMode?: string
          confirmations?: Record<string, string[]>
        }
      }
      const ocr = j.ocr
      if (!j.ok || !ocr || typeof ocr.quality !== 'number' || !ocr.engine) return { kind: 'unavailable' }
      const engineMode = ocr.engineMode === 'accurate' ? 'accurate' as const : ocr.engineMode === 'fast' ? 'fast' as const : undefined
      return {
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
          ...(engineMode ? { engineMode } : {}),
          ...(ocr.confirmations ? { confirmations: ocr.confirmations } : {}),
        },
      }
    } catch {
      return { kind: 'unavailable' }
    }
  })
}
