import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { analyzeIntakeDoc, buildIntakeDraft, type OcrMode, type VerifyVerdict } from '@/lib/verify'
import { validatePortField, type PortFieldKind } from '@/lib/port-fields'
import { imageDataUriError, loadVerifySettings } from '@/lib/settings'
import type { VehicleIntakeResult } from '@/lib/types'

export const dynamic = 'force-dynamic'
// один документ 5–40 с, сторон две — пачка карточек «Проверить все» может занять минуты
export const maxDuration = 600

type Upload = { fileName?: string; dataUri?: string }

/** Сторона СТС по тому, что на ней прочитано: на обороте — лизингодатель и срок временного учёта */
function sideOf(v: VerifyVerdict | null): 'front' | 'back' | null {
  if (!v || v.detectedType === 'UNKNOWN' || Object.keys(v.fields).length === 0) return null
  return 'Лизингодатель' in v.fields || 'Временный учёт до' in v.fields ? 'back' : 'front'
}

/** Тяжесть статуса: итог по двум сторонам — худший из них */
const SEVERITY: Record<VerifyVerdict['status'], number> = { PASSED: 0, MANUAL: 1, PENDING: 2, REUPLOAD: 3, REJECTED: 4 }

const digits = (s: string | undefined) => (s ?? '').replace(/\D/g, '')
const fmtSts = (d: string) => `${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4)}`

/**
 * POST /api/vehicles/intake — распознавание СТС для одиночных карточек
 * «Добавить ТС» / «Добавить прицеп» (Task 83).
 *
 * Принимает { kind, sts?, stsBack?, mode }: лицевую сторону (марка, госномер, VIN, номер СТС, цвет)
 * и оборот (собственник, номер СТС) — хотя бы одну. Стороны, загруженные не в свои слоты,
 * меняются местами (swapped). Номер СТС сверяется между сторонами: не совпал — стороны
 * от разных СТС, итог REJECTED, собственник с такого оборота не подставляется.
 *
 * Нейросети (mode):
 *   "fast"     — лёгкая модель PP-OCRv5_mobile_det — кнопка «Автозаполнение»;
 *   "accurate" — точная PP-OCRv5_server_det — кнопка «Проверить»;
 *   без mode   — автоподбор движка.
 *
 * Результат нормализуется и проверяется правилами «Авто в порт» (src/lib/port-fields.ts):
 * мусор вида «22о2/гвкгк» возвращается списком проблем, а не молча попадает в карточку.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const kind = body?.kind === 'trailer' ? 'trailer' : 'truck'
  const mode: OcrMode | undefined = body?.mode === 'fast' || body?.mode === 'accurate' ? body.mode : undefined
  const front = (body?.sts?.dataUri ? body.sts : null) as Upload | null
  const back = (body?.stsBack?.dataUri ? body.stsBack : null) as Upload | null

  if (!front && !back) {
    return NextResponse.json({ error: 'Для распознавания нужно фото СТС' }, { status: 400 })
  }
  for (const u of [front, back]) {
    const err = u ? imageDataUriError(u.dataUri) : null
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }

  const settings = await loadVerifySettings()
  const read = (u: Upload | null) => (u
    ? analyzeIntakeDoc(String(u.fileName ?? '').slice(0, 200), 'STS', u.dataUri!, settings, mode)
    : Promise.resolve(null))
  const [vFront, vBack] = await Promise.all([read(front), read(back)])

  // стороны перепутаны слотами — меняем местами (клиент переложит фото)
  const swapped = (sideOf(vFront) === 'back' && sideOf(vBack) !== 'back')
    || (sideOf(vBack) === 'front' && sideOf(vFront) !== 'front')
  const [f, b] = swapped ? [vBack, vFront] : [vFront, vBack]

  // сверка номера СТС: лицевая и оборот должны быть от одного свидетельства
  const nf = digits(f?.fields['Номер СТС'])
  const nb = digits(b?.fields['Номер СТС'])
  const crossCheck = nf.length === 10 && nb.length === 10
    ? { ok: nf === nb, detail: nf === nb ? `совпадает: ${fmtSts(nf)}` : `лицевая — ${fmtSts(nf)}, оборот — ${fmtSts(nb)}: стороны от разных СТС` }
    : null
  const sameSts = crossCheck?.ok !== false

  // черновик техники с лицевой стороны (buildIntakeDraft собирает тягач из STS), собственник — с оборота
  const draft = f ? buildIntakeDraft({ STS: f }).truck : null
  const issues: string[] = [
    ...(f?.issues ?? []),
    ...(b?.issues ?? []).map((i) => `Оборот: ${i}`),
  ]
  const fields = {
    brand: draft?.brand ?? '',
    plate: draft?.plate ?? '',
    vin: draft?.vin ?? '',
    sts: draft?.sts || (b?.fields['Номер СТС'] ?? ''),
    color: draft?.color ?? '',
    owner: sameSts ? (b?.fields['Владелец'] ?? '') : '',
  }
  const kinds: Record<string, PortFieldKind> = {
    brand: 'text',
    plate: kind === 'trailer' ? 'plateTrailer' : 'plate',
    vin: 'vin',
    sts: 'sts',
    color: 'color',
    owner: 'text',
  }
  for (const [key, k] of Object.entries(kinds)) {
    const res = validatePortField(k, fields[key as keyof typeof fields])
    fields[key as keyof typeof fields] = res.value
    // непустой, но кривой формат — проблема; пустое поле не проблема (заполнит человек)
    if (!res.ok && res.value !== '' && res.message) issues.push(res.message)
  }
  // «ООО"ТРАНСАВТО"» → «ООО "ТРАНСАВТО"»: пробел после формы собственности
  fields.owner = fields.owner.replace(/^(ООО|ОАО|ЗАО|ПАО|АО|ИП)\s*(["«])/, '$1 $2')

  const verdicts = [f, b].filter((v): v is VerifyVerdict => v !== null)
  let status = verdicts.reduce<VerifyVerdict['status']>((worst, v) => (SEVERITY[v.status] > SEVERITY[worst] ? v.status : worst), 'PASSED')
  let message = verdicts.find((v) => v.status === status)?.message ?? ''
  if (!sameSts) {
    status = 'REJECTED'
    message = `Номер СТС на лицевой стороне и обороте не совпадает (${crossCheck!.detail}) — загрузите обе стороны одного СТС`
    issues.unshift(message)
  }

  const result: VehicleIntakeResult = {
    status,
    quality: Math.min(...verdicts.map((v) => v.quality)),
    engine: (f ?? b)!.engine,
    engineMode: (f ?? b)!.engineMode,
    message,
    fields,
    confidence: {
      brand: f?.confidences['Марка'] ?? 0,
      plate: f?.confidences['Госномер'] ?? 0,
      vin: f?.confidences['VIN'] ?? 0,
      sts: f?.confidences['Номер СТС'] ?? b?.confidences['Номер СТС'] ?? 0,
      color: f?.confidences['Цвет'] ?? 0,
      owner: sameSts ? (b?.confidences['Владелец'] ?? 0) : 0,
    },
    issues,
    swapped,
    crossCheck,
  }
  return NextResponse.json(result)
}
