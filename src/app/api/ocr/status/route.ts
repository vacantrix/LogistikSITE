import { NextResponse } from 'next/server'
import { ocrServiceStatus } from '@/lib/ocr-service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ocr/status — статус цепочки распознавания для UI:
 * self-hosted OCR-сервис (порт 3020) → встроенный GLM-4.6V → PaddleOCR-демо.
 */
export async function GET() {
  const service = await ocrServiceStatus()
  return NextResponse.json({
    service,
    chain: [
      {
        key: 'ocr-service',
        label: 'OCR-сервис (self-hosted)',
        active: service.running,
        detail: service.running
          ? `v${service.version} · движок: ${service.activeEngine ?? 'ожидает задач'}`
          : 'недоступен — платформа использует резерв',
      },
      {
        key: 'glm-vlm',
        label: 'GLM-4.6V (резерв)',
        active: true,
        detail: 'встроенный VLM-движок платформы',
      },
      {
        key: 'paddle-demo',
        label: 'PaddleOCR-демо',
        active: true,
        detail: 'детерминированный фолбэк для демо-образцов',
      },
    ],
  })
}
