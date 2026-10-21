import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { analyzeIntakeDoc } from '@/lib/verify'
import type { DocType } from '@/lib/verify'
import { imageDataUriError, loadVerifySettings } from '@/lib/settings'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const DOC_TYPES: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'LICENSE', 'STS', 'REQUEST_DOC', 'POA']

/**
 * POST /api/documents/check — мгновенная проверка одного документа при загрузке.
 * Принимает { type, fileName, dataUri }, где type — выбранный слот (заявленный вид документа).
 * Если на изображении другой документ (например, в слот «страница регистрации» загружена
 * страница с фото) — возвращает REJECTED с причиной «Несоответствие вида документа».
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
  const imgError = imageDataUriError(dataUri)
  if (imgError) return NextResponse.json({ error: imgError }, { status: 400 })

  const v = await analyzeIntakeDoc(fileName, type, dataUri as string, await loadVerifySettings())
  return NextResponse.json({
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
  })
}
