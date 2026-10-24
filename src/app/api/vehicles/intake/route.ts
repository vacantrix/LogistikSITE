import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { analyzeIntakeDoc, buildIntakeDraft, type OcrMode } from '@/lib/verify'
import { validatePortField, type PortFieldKind } from '@/lib/port-fields'
import { imageDataUriError, loadVerifySettings } from '@/lib/settings'
import type { VehicleIntakeResult } from '@/lib/types'

export const dynamic = 'force-dynamic'
// один документ 5–40 с — пачка карточек «Проверить все» может занять минуты
export const maxDuration = 600

/**
 * POST /api/vehicles/intake — распознавание СТС для одиночных карточек
 * «Добавить ТС» / «Добавить прицеп» (Task 83).
 *
 * Нейросети (mode):
 *   "fast"     — лёгкая модель PP-OCRv5_mobile_det — кнопка «Автозаполнение»;
 *   "accurate" — точная PP-OCRv5_server_det — кнопка «Проверить»;
 *   без mode   — автоподбор движка.
 *
 * Цвет по лицевой стороне СТС не читается — остаётся ручным полем.
 * Результат нормализуется и проверяется правилами «Авто в порт» (src/lib/port-fields.ts):
 * мусор вида «22о2/гвкгк» возвращается списком проблем, а не молча попадает в карточку.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const kind = body?.kind === 'trailer' ? 'trailer' : 'truck'
  const mode: OcrMode | undefined = body?.mode === 'fast' || body?.mode === 'accurate' ? body.mode : undefined
  const sts = (body?.sts ?? null) as { fileName?: string; dataUri?: string } | null

  if (!sts?.dataUri) {
    return NextResponse.json({ error: 'Для распознавания нужно фото СТС' }, { status: 400 })
  }
  const err = imageDataUriError(sts.dataUri)
  if (err) return NextResponse.json({ error: err }, { status: 400 })

  const settings = await loadVerifySettings()
  const verdict = await analyzeIntakeDoc(String(sts.fileName ?? '').slice(0, 200), 'STS', sts.dataUri, settings, mode)

  // черновик техники из распознанного СТС (buildIntakeDraft умеет собирать тягач из STS)
  const draft = buildIntakeDraft({ STS: verdict }).truck

  // нормализация + форматные правила «Авто в порт» (плитка по виду карточки)
  const issues: string[] = [...verdict.issues]
  const fields = {
    brand: draft?.brand ?? '',
    plate: draft?.plate ?? '',
    sts: draft?.sts ?? '',
    owner: draft?.owner ?? '',
  }
  const kinds: Record<string, PortFieldKind> = {
    brand: 'text',
    plate: kind === 'trailer' ? 'plateTrailer' : 'plate',
    sts: 'sts',
    owner: 'text',
  }
  for (const [key, k] of Object.entries(kinds)) {
    const res = validatePortField(k, fields[key as keyof typeof fields])
    fields[key as keyof typeof fields] = res.value
    // непустой, но кривой формат — проблема; пустое поле не проблема (заполнит человек)
    if (!res.ok && res.value !== '' && res.message) issues.push(res.message)
  }

  const result: VehicleIntakeResult = {
    status: verdict.status,
    quality: verdict.quality,
    engine: verdict.engine,
    engineMode: verdict.engineMode,
    message: verdict.message,
    fields,
    confidence: {
      brand: verdict.confidences['Марка'] ?? 0,
      plate: verdict.confidences['Госномер'] ?? 0,
      sts: verdict.confidences['Номер СТС'] ?? 0,
      owner: verdict.confidences['Владелец'] ?? 0,
    },
    issues,
  }
  return NextResponse.json(result)
}
