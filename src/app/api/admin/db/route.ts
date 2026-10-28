import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { plog } from '@/lib/platform-log'
import type { AdminDbTableData, AdminDbTableDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * Прямой редактор базы данных для администрации (Task 109).
 * Администрация может создавать, изменять и удалять записи любой таблицы «как угодно» —
 * это служебный контур платформы: каждый доступ выписан явно, действия пишутся в журнал.
 */

/** Таблицы, доступные администрации: ключ Prisma-делегата → человекочитаемое название */
const TABLES: Record<string, { model: Prisma.ModelName; label: string }> = {
  user: { model: 'User', label: 'Пользователи и доступы' },
  profile: { model: 'Profile', label: 'Профили (проформы)' },
  carrier: { model: 'Carrier', label: 'Перевозчики (компании)' },
  driver: { model: 'Driver', label: 'Водители' },
  truck: { model: 'Truck', label: 'Тягачи' },
  trailer: { model: 'Trailer', label: 'Прицепы' },
  directoryPhoto: { model: 'DirectoryPhoto', label: 'Фото справочника' },
  cargoType: { model: 'CargoType', label: 'Грузы (справочник)' },
  request: { model: 'Request', label: 'Заявки' },
  bid: { model: 'Bid', label: 'Ставки' },
  document: { model: 'Document', label: 'Документы заявок' },
  requestFile: { model: 'RequestFile', label: 'Файлы обмена по заявкам' },
  edoDocument: { model: 'EdoDocument', label: 'Документы ЭДО' },
  diadocState: { model: 'DiadocState', label: 'Состояние Диадока' },
  ticket: { model: 'Ticket', label: 'Обращения' },
  ticketMessage: { model: 'TicketMessage', label: 'Сообщения обращений' },
  ticketAttachment: { model: 'TicketAttachment', label: 'Вложения обращений' },
  notification: { model: 'Notification', label: 'Уведомления' },
  event: { model: 'Event', label: 'События заявок' },
  platformLog: { model: 'PlatformLog', label: 'Журнал платформы' },
  setting: { model: 'Setting', label: 'Настройки платформы' },
}

type ScalarField = {
  name: string
  kind: 'string' | 'number' | 'boolean' | 'datetime'
  isRequired: boolean
  isId: boolean
  hasDefault: boolean
}

/** Скалярные поля модели из DMMF (связи и служебные списки не редактируются) */
function scalarFields(modelName: string): ScalarField[] {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName)
  if (!model) return []
  return model.fields
    .filter((f) => f.kind === 'scalar')
    .map((f) => ({
      name: f.name,
      kind: f.type === 'Boolean' ? 'boolean' as const
        : f.type === 'DateTime' ? 'datetime' as const
        : (f.type === 'Int' || f.type === 'Float' || f.type === 'BigInt' || f.type === 'Decimal') ? 'number' as const
        : 'string' as const,
      isRequired: f.isRequired,
      isId: f.isId,
      hasDefault: f.hasDefaultValue,
    }))
}

/** Минимальный контракт делегата Prisma, который использует редактор */
interface TableDelegate {
  findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>
  findUnique(args: Record<string, unknown>): Promise<Record<string, unknown> | null>
  create(args: Record<string, unknown>): Promise<Record<string, unknown>>
  update(args: Record<string, unknown>): Promise<Record<string, unknown>>
  delete(args: Record<string, unknown>): Promise<Record<string, unknown>>
  count(args?: Record<string, unknown>): Promise<number>
}

const delegate = (key: string): TableDelegate =>
  (db as unknown as Record<string, TableDelegate>)[key]

/** Приведение значения формы к типу поля (пустая строка → null для необязательных) */
function coerceField(f: ScalarField, raw: unknown): unknown {
  if (raw === null || raw === '') {
    if (!f.isRequired) return null
    if (f.kind === 'string') return ''
    throw new Error(`Поле «${f.name}» обязательно для заполнения`)
  }
  switch (f.kind) {
    case 'string':
      return String(raw).slice(0, 2_000_000)
    case 'number': {
      const n = Number(String(raw).replace(',', '.'))
      if (!Number.isFinite(n)) throw new Error(`Поле «${f.name}» — должно быть числом`)
      return Math.round(n)
    }
    case 'boolean':
      return raw === true || raw === 'true' || raw === '1' || raw === 1
    case 'datetime': {
      const s = String(raw).trim()
      // ISO или «ДД.ММ.ГГГГ [ЧЧ:мм]»
      const ru = /^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2}))?$/.exec(s)
      const d = ru
        ? new Date(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1]), Number(ru[4] ?? 0), Number(ru[5] ?? 0))
        : new Date(s)
      if (Number.isNaN(d.getTime())) throw new Error(`Поле «${f.name}» — неверная дата (ГГГГ-ММ-ДД ЧЧ:мм)`)
      return d
    }
  }
}

/** Значение ячейки для списка: даты в ISO, длинные строки обрезаются */
function cellValue(f: ScalarField, v: unknown, full: boolean): string | number | boolean | null {
  if (v === null || v === undefined) return null
  if (f.kind === 'datetime') return v instanceof Date ? v.toISOString() : String(v)
  if (f.kind === 'string') {
    const s = String(v)
    if (full || s.length <= 140) return s
    return `${s.slice(0, 140)}… [обрезано, ${s.length} симв.]`
  }
  return (v as string | number | boolean)
}

/** Парсинг даты ДД.ММ.ГГГГ / ISO → «ДД.ММ.ГГГГ ЧЧ:мм» для отображения */
function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** GET /api/admin/db — список таблиц; ?table=… — строки; ?table=…&id=… — одна строка целиком */
export async function GET(req: NextRequest) {
  const auth = await requireUser('admin')
  if (auth instanceof NextResponse) return auth

  const sp = req.nextUrl.searchParams
  const tableKey = sp.get('table') ?? ''

  if (!tableKey) {
    const tables: AdminDbTableDTO[] = []
    for (const [key, t] of Object.entries(TABLES)) {
      const count = await delegate(key).count()
      tables.push({ key, label: t.label, count })
    }
    return NextResponse.json({ tables })
  }

  const t = TABLES[tableKey]
  if (!t) return NextResponse.json({ error: 'Неизвестная таблица' }, { status: 400 })
  const fields = scalarFields(t.model)
  const delegate_ = delegate(tableKey)

  // одна строка целиком (для окна редактирования)
  const id = sp.get('id')
  if (id) {
    const row = await delegate_.findUnique({ where: { id } })
    if (!row) return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 })
    const values: Record<string, string | number | boolean | null> = {}
    for (const f of fields) {
      const v = (row as Record<string, unknown>)[f.name]
      values[f.name] = f.kind === 'datetime' && v instanceof Date ? fmtDate(v.toISOString()) : cellValue(f, v, true)
    }
    return NextResponse.json({ row: { id, values } })
  }

  const rawLimit = Number(sp.get('limit') ?? 200)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 10), 500) : 200
  const q = (sp.get('q') ?? '').trim().slice(0, 100)

  // поиск: по id точным совпадением и contains по первым строковым полям
  const stringFields = fields.filter((f) => f.kind === 'string').slice(0, 6)
  const where = q
    ? { OR: [{ id: q }, ...stringFields.map((f) => ({ [f.name]: { contains: q } }))] }
    : {}
  const orderBy = fields.some((f) => f.name === 'createdAt') ? { createdAt: 'desc' as const } : { id: 'asc' as const }

  const rowsRaw = await delegate_.findMany({ where, orderBy, take: limit + 1 })
  const truncated = rowsRaw.length > limit
  const rows = rowsRaw.slice(0, limit).map((row: Record<string, unknown>) => {
    const values: Record<string, string | number | boolean | null> = {}
    for (const f of fields) values[f.name] = cellValue(f, row[f.name], false)
    return { id: String(row.id), values }
  })

  const data: AdminDbTableData = {
    table: { key: tableKey, label: t.label, count: await delegate_.count() },
    columns: fields.map((f) => ({ key: f.name, kind: f.kind })),
    rows,
    truncated,
  }
  return NextResponse.json({ data })
}

/**
 * POST /api/admin/db — создать / изменить / удалить запись:
 * { table, op: 'create' | 'update' | 'delete', id?, data? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser('admin')
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as {
    table?: string; op?: string; id?: string; data?: Record<string, unknown>
  } | null
  const t = body?.table ? TABLES[body.table] : undefined
  if (!t) return NextResponse.json({ error: 'Неизвестная таблица' }, { status: 400 })
  const op = body?.op ?? ''
  if (op !== 'create' && op !== 'update' && op !== 'delete') {
    return NextResponse.json({ error: 'Неизвестная операция' }, { status: 400 })
  }
  const delegate_ = delegate(body!.table!)

  try {
    if (op === 'delete') {
      const id = String(body?.id ?? '')
      if (!id) return NextResponse.json({ error: 'Не указана запись' }, { status: 400 })
      await delegate_.delete({ where: { id } })
      await plog({
        type: 'DB_ROW_DELETED', source: 'api/admin/db',
        actor: { login: auth.login, name: auth.name, role: auth.role },
        message: `База данных: удалена запись ${body!.table} (${id})`,
      })
      return NextResponse.json({ ok: true })
    }

    const fields = scalarFields(t.model)
    const data: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(body?.data ?? {})) {
      const f = fields.find((x) => x.name === key)
      if (!f || f.isId) continue // первичный ключ не редактируется
      data[key] = coerceField(f, raw)
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Нет данных для сохранения' }, { status: 400 })
    }

    if (op === 'create') {
      const row = await delegate_.create({ data })
      await plog({
        type: 'DB_ROW_CREATED', source: 'api/admin/db',
        actor: { login: auth.login, name: auth.name, role: auth.role },
        message: `База данных: создана запись ${body!.table} (${String(row.id)})`,
      })
      return NextResponse.json({ ok: true, id: String(row.id) }, { status: 201 })
    }

    const id = String(body?.id ?? '')
    if (!id) return NextResponse.json({ error: 'Не указана запись' }, { status: 400 })
    await delegate_.update({ where: { id }, data })
    await plog({
      type: 'DB_ROW_UPDATED', source: 'api/admin/db',
      actor: { login: auth.login, name: auth.name, role: auth.role },
      message: `База данных: изменена запись ${body!.table} (${id}) — поля: ${Object.keys(data).join(', ')}`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не удалось выполнить операцию'
    // внешние ключи SQLite — понятное сообщение вместо кода P2003
    const fk = /P2003|FOREIGN KEY/i.test(message)
    return NextResponse.json(
      { error: fk ? 'Запись связана с другими данными — сначала удалите связанные записи' : message },
      { status: 400 },
    )
  }
}
