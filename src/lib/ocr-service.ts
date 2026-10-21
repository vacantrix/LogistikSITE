/**
 * Клиент локального OCR-сервиса (mini-services/paddle-ocr, порт 3020).
 *
 * Основной путь распознавания: PaddleOCR работает на нашем сервере, фото документов
 * никуда не уходят. Если сервис не отвечает — документ уходит на ручную проверку
 * (облачный резерв включается только явно, OCR_CLOUD_FALLBACK=1, см. verify.ts).
 *
 * Ожидаемые данные заявки сервису не передаются: он только читает фото.
 * Отключить интеграцию: OCR_SERVICE_URL='' (пустая строка).
 */
import type { DocType, OcrOutput } from '@/lib/verify'

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

/** Распознавание через локальный сервис; null — сервис недоступен или вид документа не поддерживается */
export async function ocrServiceOcr(dataUri: string, type: DocType, intake: boolean): Promise<OcrOutput | null> {
  if (!ocrServiceEnabled()) return null
  try {
    const res = await fetch(`${BASE}/ocr`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ type, dataUri, intake }),
      // первый вызов загружает модели PaddleOCR — даём запас
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) return null
    const j = (await res.json()) as {
      ok?: boolean
      ocr?: {
        engine?: string
        quality?: number
        fields?: Record<string, string>
        confidences?: Record<string, number>
        detectedType?: DocType | 'UNKNOWN'
        confirmations?: Record<string, string[]>
      }
    }
    const ocr = j.ocr
    if (!j.ok || !ocr || typeof ocr.quality !== 'number' || !ocr.engine) return null
    return {
      engine: ocr.engine,
      quality: Math.round(ocr.quality),
      fields: ocr.fields ?? {},
      confidences: ocr.confidences ?? {},
      ...(ocr.detectedType ? { detectedType: ocr.detectedType } : {}),
      ...(ocr.confirmations ? { confirmations: ocr.confirmations } : {}),
    }
  } catch {
    return null
  }
}
