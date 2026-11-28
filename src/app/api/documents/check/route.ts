import { NextRequest, NextResponse } from 'next/server'
import { isStaff, requireUser } from '@/lib/auth'
import { analyzeIntakeDoc } from '@/lib/verify'
import type { DocType } from '@/lib/verify'
import { imageDataUriError, loadVerifySettings } from '@/lib/settings'
import { startOcrJob } from '@/lib/ocr-jobs'
import { plog } from '@/lib/platform-log'
import type { IntakeDocVerdict } from '@/lib/types'

export const dynamic = 'force-dynamic'

const DOC_TYPES: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'STS', 'REQUEST_DOC', 'POA']

/** Человекочитаемые названия для журнала событий */
const DOC_TYPE_LABEL: Record<string, string> = {
  PASSPORT_PHOTO: 'паспорт (страница с фото)',
  PASSPORT_REG: 'паспорт (регистрация)',
  STS: 'СТС',
  REQUEST_DOC: 'документ по заявке',
  POA: 'доверенность',
}
const DOC_STATUS_LABEL: Record<string, string> = {
  PENDING: 'на проверке', PASSED: 'принят', REUPLOAD: 'перезагрузить', REJECTED: 'отказ', MANUAL: 'ручная проверка',
}

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
    // журнал: документ проверен вручную при загрузке — фиксируем вид и результат вердикта
    const wrongType = v.detectedType && v.detectedType !== 'UNKNOWN' && v.detectedType !== type
      ? `, распознан другой вид: ${DOC_TYPE_LABEL[v.detectedType] ?? v.detectedType}`
      : ''
    await plog({
      type: 'DOC_CHECKED', source: 'api/documents/check',
      actor: { login: auth.login, name: auth.name, role: auth.role },
      message: `Проверен документ «${DOC_TYPE_LABEL[type] ?? type}» (файл ${fileName || 'без имени'}): ${DOC_STATUS_LABEL[v.status] ?? v.status}, качество ${v.quality}${wrongType}`,
      meta: {
        docType: type,
        fileName: fileName || null,
        status: v.status,
        quality: v.quality,
        engine: v.engine,
        detectedType: v.detectedType ?? null,
        issues: v.issues,
      },
    })
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
  }, { login: auth.login, staff: isStaff(auth.role) })

  if (!started) return NextResponse.json({ error: 'Очередь распознавания переполнена — подождите немного и повторите' }, { status: 429 })
  return NextResponse.json({ jobId: started.id }, { status: 202 })
}
