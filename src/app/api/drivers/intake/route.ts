import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { analyzeIntakeDoc, buildIntakeDraft } from '@/lib/verify'
import type { DocType, VerifyVerdict } from '@/lib/verify'
import type { IntakeDocVerdict, IntakeResult } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/drivers/intake — добавление водителя сразу с нейросетью.
 * Принимает загруженные документы (паспорт, ВУ, опционально СТС и регистрацию),
 * распознаёт их и возвращает черновик карточки водителя и тягача:
 * поля, уверенность по каждому полю, перекрёстные сверки и вердикты по документам.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const docs = (body?.docs ?? {}) as Partial<Record<DocType, { fileName?: string; dataUri?: string }>>
  const provided = (Object.keys(docs) as DocType[]).filter((t) => docs[t]?.dataUri)

  if (!provided.includes('PASSPORT_PHOTO') || !provided.includes('LICENSE')) {
    return NextResponse.json(
      { error: 'Для распознавания нужны минимум два документа: паспорт (стр. с фото) и водительское удостоверение' },
      { status: 400 },
    )
  }

  const settingsRow = await db.setting.findUnique({ where: { id: 'main' } })
  const settings = {
    confReupload: settingsRow?.confReupload ?? 0.6,
    confAuto: settingsRow?.confAuto ?? 0.95,
    minQuality: settingsRow?.minQuality ?? 60,
  }

  const pairs = await Promise.all(
    provided.map(async (t) => {
      const doc = docs[t]!
      const verdict = await analyzeIntakeDoc(doc.fileName ?? '', t, doc.dataUri!, settings)
      return [t, verdict] as const
    }),
  )
  const map = Object.fromEntries(pairs) as Partial<Record<DocType, VerifyVerdict>>

  const draft = buildIntakeDraft(map)
  const documents: IntakeDocVerdict[] = pairs.map(([type, v]) => ({
    type,
    status: v.status,
    quality: v.quality,
    engine: v.engine,
    fields: v.fields,
    confidence: v.confidences,
    issues: v.issues,
    message: v.message,
    detectedType: v.detectedType ?? null,
  }))

  const result: IntakeResult = {
    driver: draft.driver,
    truck: draft.truck,
    crossChecks: draft.crossChecks,
    documents,
  }
  return NextResponse.json(result)
}
