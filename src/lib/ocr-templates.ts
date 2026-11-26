/**
 * Шаблоны документов PaddleOCR — конструктор администратора.
 *
 * Какие поля нейросеть ищет в каждом виде документа — задаётся шаблоном
 * (OcrTemplate + OcrField в БД). Администратор правит шаблоны в разделе
 * «Управление → PaddleOCR»; очередь распознавания перечитывает их перед каждым
 * документом (кэш 5 секунд — как у настроек nn.ts), поэтому правки применяются
 * к следующему документу без перезапуска.
 *
 * При первом обращении (или после сброса) шаблоны создаются из DOC_FIELDS
 * платформы (src/lib/verify.ts) — это честные заводские шаблоны, с которых
 * администратор начинает кастомизацию.
 *
 * Слой сверки результата с заявкой (verify.ts) остаётся правилами платформы:
 * шаблон управляет распознаванием («на что смотрит и как смотрит нейросеть»),
 * а сверка — что считается совпадением — в настройках верификации.
 */
import { db } from '@/lib/db'
import { DOC_FIELDS, DOC_TYPE_LABEL, STS_BACK_FIELDS, type DocType, type FieldSpec } from '@/lib/verify'

/** Поле шаблона — как в БД OcrField */
export interface OcrFieldDTO {
  id?: string
  label: string
  kind: string
  optional: boolean
  pattern?: string | null
  hint?: string | null
  order: number
}

/** Шаблон документа — как в БД OcrTemplate */
export interface OcrTemplateDTO {
  id?: string
  docType: string
  title: string
  enabled: boolean
  order: number
  fields: OcrFieldDTO[]
}

const CACHE_MS = 5_000
let cache: { at: number; value: OcrTemplateDTO[] } | null = null

/** Сбросить кэш шаблонов — после сохранения из админки */
export function invalidateOcrTemplates(): void {
  cache = null
}

const FIELD_KINDS = ['fio', 'date', 'passport', 'plate', 'vin', 'code', 'text'] as const

/** Заводские шаблоны из кода платформы (DOC_FIELDS) — стартовая точка конструктора */
function builtinTemplates(): OcrTemplateDTO[] {
  const types = Object.keys(DOC_FIELDS) as DocType[]
  const list: OcrTemplateDTO[] = types.map((t, i) => ({
    docType: t,
    title: DOC_TYPE_LABEL[t],
    enabled: true,
    order: i,
    fields: DOC_FIELDS[t].map((f: FieldSpec, j) => ({
      label: f.label,
      kind: f.kind,
      optional: Boolean(f.optional),
      order: j,
    })),
  }))
  // оборот СТС — отдельный служебный шаблон (движок сам понимает сторону)
  const hasStsBack = list.find((t) => t.docType === 'STS')
  if (hasStsBack && STS_BACK_FIELDS.length > 0) {
    // поля оборота дописываем в шаблон СТС с пометкой optional — лицевая сторона их не содержит
    hasStsBack.fields = [
      ...hasStsBack.fields,
      ...STS_BACK_FIELDS
        .filter((f) => !hasStsBack.fields.some((x) => x.label === f.label))
        .map((f, j) => ({ label: f.label, kind: f.kind, optional: true, order: hasStsBack.fields.length + j })),
    ]
  }
  return list
}

/** Создать заводские шаблоны в БД (если таблица пуста) */
async function ensureSeeded(): Promise<void> {
  const n = await db.ocrTemplate.count()
  if (n > 0) return
  const builtins = builtinTemplates()
  for (const t of builtins) {
    await db.ocrTemplate.create({
      data: {
        docType: t.docType,
        title: t.title,
        enabled: t.enabled,
        order: t.order,
        fields: {
          create: t.fields.map((f) => ({
            label: f.label,
            kind: FIELD_KINDS.includes(f.kind as (typeof FIELD_KINDS)[number]) ? f.kind : 'text',
            optional: f.optional,
            order: f.order,
          })),
        },
      },
    })
  }
}

/** Все шаблоны (создаёт заводские при первом обращении; кэш 5 с) */
export async function ocrTemplates(): Promise<OcrTemplateDTO[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value
  await ensureSeeded()
  const rows = await db.ocrTemplate.findMany({
    orderBy: [{ order: 'asc' }, { docType: 'asc' }],
    include: { fields: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
  })
  const value: OcrTemplateDTO[] = rows.map((t) => ({
    id: t.id,
    docType: t.docType,
    title: t.title,
    enabled: t.enabled,
    order: t.order,
    fields: t.fields.map((f) => ({
      id: f.id,
      label: f.label,
      kind: f.kind,
      optional: f.optional,
      pattern: f.pattern,
      hint: f.hint,
      order: f.order,
    })),
  }))
  cache = { at: Date.now(), value }
  return value
}

/** Действующий шаблон вида документа (отключённого/незнакомого — заводской из кода) */
export async function templateFor(docType: string): Promise<OcrTemplateDTO | null> {
  const list = await ocrTemplates()
  const found = list.find((t) => t.docType === docType)
  if (found && found.enabled) return found
  // шаблон отключён администратором — движку этот вид больше не отправляем
  if (found && !found.enabled) return null
  return null
}

/** Сохранить шаблон целиком (upsert по docType); после — сброс кэша */
export async function saveOcrTemplate(input: OcrTemplateDTO): Promise<OcrTemplateDTO> {
  const docType = String(input.docType ?? '').trim().toUpperCase().replace(/\s+/g, '_')
  if (!/^[A-Z][A-Z0-9_]{1,40}$/.test(docType)) throw new Error('Некорректный код вида документа')
  const title = String(input.title ?? '').trim()
  if (!title) throw new Error('Задайте название шаблона')
  const fields = (Array.isArray(input.fields) ? input.fields : []).map((f, i) => {
    const label = String(f.label ?? '').trim()
    if (!label) throw new Error(`Поле №${i + 1}: пустое имя`)
    const kind = FIELD_KINDS.includes(f.kind as (typeof FIELD_KINDS)[number]) ? f.kind : 'text'
    const pattern = f.pattern != null && String(f.pattern).trim() !== '' ? String(f.pattern).trim() : null
    const hint = f.hint != null && String(f.hint).trim() !== '' ? String(f.hint).trim() : null
    return { label, kind, optional: Boolean(f.optional), pattern, hint, order: i }
  })
  if (fields.length === 0) throw new Error('Шаблон без полей не имеет смысла — добавьте хотя бы одно поле')

  const row = await db.ocrTemplate.upsert({
    where: { docType },
    update: { title, enabled: Boolean(input.enabled), order: input.order ?? 0 },
    create: { docType, title, enabled: Boolean(input.enabled), order: input.order ?? 0 },
  })
  // поля — под честный upsert: пересоздаём набор (DELETE + create) в одной транзакции
  await db.$transaction([
    db.ocrField.deleteMany({ where: { templateId: row.id } }),
    db.ocrField.createMany({
      data: fields.map((f) => ({ ...f, templateId: row.id })),
    }),
  ])
  invalidateOcrTemplates()
  const saved = await db.ocrTemplate.findUnique({ where: { docType }, include: { fields: { orderBy: [{ order: 'asc' }] } } })
  return {
    id: saved?.id,
    docType: saved!.docType,
    title: saved!.title,
    enabled: saved!.enabled,
    order: saved!.order,
    fields: saved!.fields.map((f) => ({
      id: f.id, label: f.label, kind: f.kind, optional: f.optional, pattern: f.pattern, hint: f.hint, order: f.order,
    })),
  }
}

/** Удалить шаблон (вид перестаёт распознаваться) */
export async function deleteOcrTemplate(docType: string): Promise<void> {
  await db.ocrTemplate.deleteMany({ where: { docType } })
  invalidateOcrTemplates()
}
