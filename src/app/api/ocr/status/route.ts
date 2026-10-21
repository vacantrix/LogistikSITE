import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { ocrServiceStatus } from '@/lib/ocr-service'
import { cloudOcrEnabled, demoSamplesEnabled } from '@/lib/settings'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ocr/status — статус цепочки распознавания для UI:
 * локальный OCR (PaddleOCR, порт 3020) → облачная VLM (только если включена) → ручная проверка.
 */
export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const service = await ocrServiceStatus()
  const cloud = cloudOcrEnabled()
  const demo = demoSamplesEnabled()
  return NextResponse.json({
    service,
    chain: [
      {
        key: 'ocr-service',
        label: 'Локальный OCR (PaddleOCR)',
        active: service.running,
        detail: service.running
          ? `v${service.version} · движок: ${service.activeEngine ?? 'ожидает задач'}`
          : 'недоступен — документы уходят на ручную проверку',
      },
      {
        key: 'glm-vlm',
        label: 'Облачная VLM (резерв)',
        active: cloud,
        detail: cloud ? 'включена (OCR_CLOUD_FALLBACK=1): фото уходят во внешний сервис' : 'выключена — фото не покидают сервер',
      },
      {
        key: 'paddle-demo',
        label: 'Демо-образцы (SVG)',
        active: demo,
        detail: demo ? 'имитация для демо-стенда (DEMO_SAMPLES=1)' : 'выключены',
      },
    ],
  })
}
