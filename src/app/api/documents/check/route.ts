import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { analyzeIntakeDoc } from '@/lib/verify'
import type { DocType } from '@/lib/verify'
import { imageDataUriError, loadVerifySettings } from '@/lib/settings'
import { startOcrJob } from '@/lib/ocr-jobs'
import type { IntakeDocVerdict } from '@/lib/types'

export const dynamic = 'force-dynamic'

const DOC_TYPES: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'STS', 'REQUEST_DOC', 'POA']

/**
 * POST /api/documents/check — мгновенная проверка одного документа при загрузке.
 * Принимает { type, fileName, dataUri }, где type — выбранный слот (заявленный вид документа).
 * Если на изображении другой документ (например, в слот «страница регистрации» загружена
 * страница с фото) — возвращает REJECTED с причиной «Несоответствие вида документа».
 *
 * Распознавание занимает 5–90 с: валидация — сразу, проверка — в фоновой задаче,
 * маршрут отвечает { jobId } (202), клиент опрашивает GET /api/ocr-jobs — длинный
 * ответ шлюз обрывает и браузер показывает «Ошибка запроса (502)».
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const type = body?.type as DocType
  const dataUri = body?.dataUri
  const fileName = typeof body?.fileName === 'string' ? body.fileName.slice(0, 200) : ''

  if (!DOC_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Неизвестный вид документа' }, { status: 400 })
  }
  const imgError = imageDataUriError(dataUri, { pdf: true })
  if (imgError) return NextResponse.json({ error: imgError }, { status: 400 })

  const started = startOcrJob<{ verdict: IntakeDocVerdict }>(async () => {
    const v = await analyzeIntakeDoc(fileName, type, dataUri as string, await loadVerifySettings())
    return {
      verdict: {
        type,
        status: v.status,
        quality: v.quality,
        engine: v.engine,
        fields: v.fields,
        confidence: v.confidences,
        issues: v.issues,
        message: v.message,
        detectedType: v.detectedType ?? null,
      },
    }
  })

  if (!started) return NextResponse.json({ error: 'Очередь распознавания переполнена — подождите немного и повторите' }, { status: 429 })
  return NextResponse.json({ jobId: started.id }, { status: 202 })
}
