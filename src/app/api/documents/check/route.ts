import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { analyzeIntakeDoc } from '@/lib/verify'
import type { DocType } from '@/lib/verify'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const DOC_TYPES: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'LICENSE', 'STS']

/**
 * POST /api/documents/check — мгновенная нейропроверка одного документа при загрузке.
 * Принимает { type, fileName, dataUri }, где type — выбранный слот (заявленный вид документа).
 * Нейросеть определяет, какой документ реально изображён: если он не совпадает
 * со слотом (например, в слот «страница регистрации» загружена страница с фото) —
 * возвращает REJECTED с причиной «Несоответствие вида документа».
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const type = body?.type as DocType
  const dataUri = typeof body?.dataUri === 'string' ? body.dataUri : ''
  const fileName = typeof body?.fileName === 'string' ? body.fileName : ''

  if (!DOC_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Неизвестный вид документа' }, { status: 400 })
  }
  if (!dataUri.startsWith('data:image/')) {
    return NextResponse.json({ error: 'Ожидается изображение (dataUri)' }, { status: 400 })
  }

  const settingsRow = await db.setting.findUnique({ where: { id: 'main' } })
  const settings = {
    confReupload: settingsRow?.confReupload ?? 0.6,
    confAuto: settingsRow?.confAuto ?? 0.95,
    minQuality: settingsRow?.minQuality ?? 60,
  }

  const v = await analyzeIntakeDoc(fileName, type, dataUri, settings)
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
