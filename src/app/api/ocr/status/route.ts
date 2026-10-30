import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { ocrServiceStatus } from '@/lib/ocr-service'
import { demoSamplesEnabled } from '@/lib/settings'
import { nnSettings } from '@/lib/nn'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ocr/status — статус цепочки распознавания для UI:
 * локальный OCR-шлюз → нейросеть на ПК перевозчика (PaddleOCR, одна сильная
 * модель — Task 86) → ручная проверка. Облачного резерва нет (Task 79):
 * фото документов не покидают инфраструктуру. Пропуск документов настраивается
 * админом в разделе «Нейросеть» (src/lib/nn.ts).
 */
export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const [service, nn] = await Promise.all([ocrServiceStatus(), nnSettings()])
  const demo = demoSamplesEnabled()
  return NextResponse.json({
    service,
    settings: nn,
    chain: [
      {
        key: 'paddle',
        label: 'PaddleOCR · нейросеть на ПК перевозчика',
        active: service.running,
        detail: service.running
          ? `Одна сильная модель · параллельно ${nn.parallel} · таймаут ${nn.timeoutSec} с · кэш ${nn.cacheMin} мин`
          : 'недоступна — документы уходят на ручную проверку',
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
