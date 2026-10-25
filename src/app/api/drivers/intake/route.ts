import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { analyzeIntakeDoc, buildIntakeDraft, type OcrMode } from '@/lib/verify'
import type { DocType, VerifyVerdict } from '@/lib/verify'
import type { IntakeDocVerdict, IntakeResult } from '@/lib/types'
import { imageDataUriError, loadVerifySettings } from '@/lib/settings'

export const dynamic = 'force-dynamic'
// документы распознаются по одному (5–40 с каждый) — несколько файлов могут занять минуты
export const maxDuration = 600

const DOC_TYPES: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'STS', 'REQUEST_DOC', 'POA']

/**
 * POST /api/drivers/intake — добавление водителя с распознаванием документов.
 * Принимает загруженные документы (паспорт, опционально регистрацию и СТС),
 * распознаёт их и возвращает черновик карточки водителя:
 * поля, уверенность по каждому полю, перекрёстные сверки и вердикты по документам.
 * Task 53: фото ВУ больше не требуется — данные ВУ агент заполняет вручную.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const docs = (body?.docs ?? {}) as Partial<Record<DocType, { fileName?: string; dataUri?: string }>>
  // Task 83 — две нейросети: "fast" (лёгкая, «Автозаполнение») / "accurate" (точная, «Проверить»)
  const mode: OcrMode | undefined = body?.mode === 'fast' || body?.mode === 'accurate' ? body.mode : undefined
  const provided = (Object.keys(docs) as DocType[]).filter((t) => DOC_TYPES.includes(t) && docs[t]?.dataUri)

  if (!provided.includes('PASSPORT_PHOTO')) {
    return NextResponse.json({ error: 'Для распознавания нужен паспорт (страница с фото)' }, { status: 400 })
  }
  for (const t of provided) {
    const err = imageDataUriError(docs[t]!.dataUri)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }

  const settings = await loadVerifySettings()
  const pairs = await Promise.all(
    provided.map(async (t) => {
      const doc = docs[t]!
      const verdict = await analyzeIntakeDoc(String(doc.fileName ?? '').slice(0, 200), t, doc.dataUri!, settings, mode)
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
