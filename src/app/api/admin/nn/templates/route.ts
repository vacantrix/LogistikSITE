import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { deleteOcrTemplate, ocrTemplates, saveOcrTemplate, type OcrTemplateDTO } from '@/lib/ocr-templates'
import { clearNnCache } from '@/lib/ocr-service'
import { plog } from '@/lib/platform-log'

export const dynamic = 'force-dynamic'

/** GET /api/admin/nn/templates — все шаблоны документов PaddleOCR (заводские создаются автоматически) */
export async function GET() {
  const auth = await requireUser('admin')
  if (auth instanceof NextResponse) return auth

  try {
    const templates = await ocrTemplates()
    return NextResponse.json({ templates })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ошибка чтения шаблонов' }, { status: 500 })
  }
}

/** PUT /api/admin/nn/templates — сохранить шаблон целиком (upsert по docType).
 *  Тело: { docType, title, enabled, order?, fields: [{ label, kind, optional, pattern?, hint? }] }.
 *  После сохранения кэш шаблонов сбрасывается: следующий документ распознаётся по новым полям. */
export async function PUT(req: NextRequest) {
  const auth = await requireUser('admin')
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as Partial<OcrTemplateDTO> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 })

  try {
    const saved = await saveOcrTemplate({
      docType: String(body.docType ?? ''),
      title: String(body.title ?? ''),
      enabled: body.enabled !== false,
      order: Number(body.order ?? 0),
      fields: Array.isArray(body.fields)
        ? body.fields.map((f, i) => ({
          label: String(f.label ?? ''),
          kind: String(f.kind ?? 'text'),
          optional: Boolean(f.optional),
          pattern: f.pattern ?? null,
          hint: f.hint ?? null,
          order: i,
        }))
        : [],
    })
    // шаблон изменился — прежние кэшированные результаты этого вида больше не актуальны
    clearNnCache()
    // журнал: шаблон распознавания сохранён (создан или перезаписан)
    await plog({
      type: 'NN_TEMPLATE_SAVED', source: 'api/admin/nn/templates',
      actor: { login: auth.login, name: auth.name, role: auth.role },
      message: `Сохранён шаблон распознавания «${saved.title}» (${saved.docType}, полей: ${saved.fields.length}${saved.enabled ? '' : ', отключён'})`,
      meta: { docType: saved.docType, title: saved.title, enabled: saved.enabled, fields: saved.fields.length },
      objectType: 'nn-template',
      objectId: saved.docType,
    })
    return NextResponse.json({ template: saved })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Не удалось сохранить шаблон' }, { status: 400 })
  }
}

/** DELETE /api/admin/nn/templates?docType=PASSPORT_PHOTO — удалить шаблон: вид перестаёт распознаваться */
export async function DELETE(req: NextRequest) {
  const auth = await requireUser('admin')
  if (auth instanceof NextResponse) return auth

  const docType = new URL(req.url).searchParams.get('docType') ?? ''
  if (!docType.trim()) return NextResponse.json({ error: 'Не указан вид документа (docType)' }, { status: 400 })
  try {
    await deleteOcrTemplate(docType.trim())
    clearNnCache()
    // журнал: шаблон распознавания удалён — вид перестаёт распознаваться
    await plog({
      type: 'NN_TEMPLATE_DELETED', source: 'api/admin/nn/templates',
      actor: { login: auth.login, name: auth.name, role: auth.role },
      message: `Удалён шаблон распознавания (${docType.trim()}) — вид больше не распознаётся`,
      meta: { docType: docType.trim() },
      objectType: 'nn-template',
      objectId: docType.trim(),
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Не удалось удалить шаблон' }, { status: 500 })
  }
}
