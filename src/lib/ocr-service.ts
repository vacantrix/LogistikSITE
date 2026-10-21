/**
 * Клиент self-hosted OCR-микросервиса (mini-services/ocr-service, порт 3020).
 *
 * Платформа вызывает сервис ДО резервных движков: если сервис поднят —
 * распознавание идёт «у нас на сервере» (PaddleOCR → GLM-4.6V внутри сервиса),
 * при недоступности платформа откатывается на встроенные движки verify.ts.
 *
 * Отключить интеграцию: OCR_SERVICE_URL='' (пустая строка).
 */
import type { DocType, ExpectedData, OcrOutput } from '@/lib/verify'

const BASE = process.env.OCR_SERVICE_URL ?? 'http://127.0.0.1:3020'

export function ocrServiceEnabled(): boolean {
  return BASE !== ''
}

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

/** Распознавание через микросервис; null — сервис недоступен (платформа откатится на свой пайплайн) */
export async function ocrServiceOcr(
  dataUri: string,
  type: DocType,
  expected: ExpectedData | null,
  intake: boolean,
): Promise<OcrOutput | null> {
  if (!ocrServiceEnabled()) return null
  try {
    const res = await fetch(`${BASE}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, dataUri, expected, intake }),
      signal: AbortSignal.timeout(60_000),
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
    }
  } catch {
    return null
  }
}
