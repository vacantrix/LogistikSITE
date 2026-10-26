import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { ocrServiceStatus } from '@/lib/ocr-service'
import { demoSamplesEnabled } from '@/lib/settings'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ocr/status — статус цепочки распознавания для UI:
 * локальный OCR (PaddleOCR на нашем сервере, две нейросети — Task 83) → ручная проверка.
 * Облачного резерва нет (Task 79): фото документов не покидают сервер.
 */
export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const service = await ocrServiceStatus()
  const demo = demoSamplesEnabled()
  return NextResponse.json({
    service,
    chain: [
      {
        key: 'paddle-accurate',
        label: 'PaddleOCR · точная нейросеть',
        active: service.running,
        detail: service.running
          ? 'PP-OCRv5 server — проверка «Проверить» перед попаданием в базу'
          : 'недоступна — документы уходят на ручную проверку',
      },
      {
        key: 'paddle-fast',
        label: 'PaddleOCR · лёгкая нейросеть',
        active: service.running,
        detail: service.running
          ? 'PP-OCRv5 mobile — быстрое «Автозаполнение» карточек'
          : 'недоступна',
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
