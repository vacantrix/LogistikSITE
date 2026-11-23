import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'
import { getSessionUser, shortName } from '@/lib/kontur/auth'
import { denyUnless } from '@/lib/kontur/access'

export const dynamic = 'force-dynamic'

/**
 * «Справочники» — ручное ведение кадров и техники собственного парка АЭМЗ.
 * POST  { kind: 'driver'|'vehicle'|'trailer', ...поля } — добавить запись;
 * PATCH { kind, id, ...поля } — изменить запись.
 * Все действия пишутся в журнал аудита (кто, что, когда).
 */

const DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/

function bad(message: string, code = 'VALIDATION') {
  return NextResponse.json({ error: { code, message } }, { status: 400 })
}

/** Приводит значение к строке-дате или null (пустое поле = «нет данных») */
function dateOrNull(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || null
}

function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: { code: 'AUTH', message: 'Нужен вход в кабинет' } }, { status: 401 })
  const denied = await denyUnless(user, 'own:directory')
  if (denied) return denied

  const body = await req.json().catch(() => null)
  if (!body || typeof body.kind !== 'string') return bad('Не указан тип записи справочника')

  try {
    if (body.kind === 'driver') {
      if (!body.fullName?.trim()) return bad('Укажите ФИО водителя')
      if (!body.phone?.trim()) return bad('Укажите телефон водителя')
      const license = dateOrNull(body.licenseUntil)
      if (license && !DATE_RE.test(license)) return bad('Срок ВУ — в формате ДД.ММ.ГГГГ')
      const d = await db.driver.create({
        data: {
          fullName: body.fullName.trim(),
          phone: body.phone.trim(),
          birthDate: dateOrNull(body.birthDate),
          passport: dateOrNull(body.passport),
          licenseUntil: license,
          status: ['active', 'vacation', 'sick', 'other'].includes(body.status) ? body.status : 'active',
          statusComment: body.statusComment?.trim() || null,
        },
      })
      await db.auditLog.create({
        data: { actorRole: user.role, actorName: shortName(user.fullName), object: 'driver', objectId: d.id, field: 'created', became: d.fullName, comment: 'Запись добавлена вручную в справочник «Водители»' },
      })
      return NextResponse.json({ ok: true, driver: d })
    }

    if (body.kind === 'vehicle') {
      if (!body.brand?.trim()) return bad('Укажите марку ТС')
      if (!body.plate?.trim()) return bad('Укажите госномер')
      const exists = await db.vehicle.findUnique({ where: { plate: body.plate.trim() } })
      if (exists) return bad('Тягач с таким госномером уже есть в справочнике')
      const techTill = dateOrNull(body.techTill)
      if (techTill && !DATE_RE.test(techTill)) return bad('Техосмотр — в формате ДД.ММ.ГГГГ')
      const v = await db.vehicle.create({
        data: {
          brand: body.brand.trim(),
          plate: body.plate.trim(),
          vin: dateOrNull(body.vin),
          sts: dateOrNull(body.sts),
          techTill,
          capacityT: numOrNull(body.capacityT),
          volumeM3: numOrNull(body.volumeM3),
          ownership: 'own',
          isRepair: body.isRepair === true,
        },
      })
      await db.auditLog.create({
        data: { actorRole: user.role, actorName: shortName(user.fullName), object: 'vehicle', objectId: v.id, field: 'created', became: `${v.brand} · ${v.plate}`, comment: 'Запись добавлена вручную в справочник «Тягачи»' },
      })
      return NextResponse.json({ ok: true, vehicle: v })
    }

    if (body.kind === 'trailer') {
      if (!body.plate?.trim()) return bad('Укажите госномер прицепа')
      if (!body.type?.trim()) return bad('Укажите тип прицепа')
      const exists = await db.trailer.findUnique({ where: { plate: body.plate.trim() } })
      if (exists) return bad('Прицеп с таким госномером уже есть в справочнике')
      const techTill = dateOrNull(body.techTill)
      if (techTill && !DATE_RE.test(techTill)) return bad('Техосмотр — в формате ДД.ММ.ГГГГ')
      const t = await db.trailer.create({
        data: {
          brand: body.brand?.trim() || '—',
          plate: body.plate.trim(),
          type: body.type.trim(),
          sts: dateOrNull(body.sts),
          techTill,
          volumeM3: numOrNull(body.volumeM3),
          beltsCount: numOrNull(body.beltsCount),
          workingBoards: body.workingBoards === true,
          ownership: 'own',
          isRepair: body.isRepair === true,
        },
      })
      await db.auditLog.create({
        data: { actorRole: user.role, actorName: shortName(user.fullName), object: 'trailer', objectId: t.id, field: 'created', became: `${t.plate} · ${t.type}`, comment: 'Запись добавлена вручную в справочник «Прицепы»' },
      })
      return NextResponse.json({ ok: true, trailer: t })
    }

    return bad('Неизвестный тип записи справочника')
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не удалось добавить запись'
    return NextResponse.json({ error: { code: 'DB', message } }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: { code: 'AUTH', message: 'Нужен вход в кабинет' } }, { status: 401 })
  const denied = await denyUnless(user, 'own:directory')
  if (denied) return denied

  const body = await req.json().catch(() => null)
  if (!body?.id || !body?.kind) return bad('Не указана запись для правки')

  try {
    if (body.kind === 'driver') {
      const before = await db.driver.findUnique({ where: { id: body.id } })
      if (!before) return bad('Водитель не найден', 'NOT_FOUND')
      const license = dateOrNull(body.licenseUntil)
      if (license && !DATE_RE.test(license)) return bad('Срок ВУ — в формате ДД.ММ.ГГГГ')
      const d = await db.driver.update({
        where: { id: body.id },
        data: {
          fullName: body.fullName?.trim() || before.fullName,
          phone: body.phone?.trim() || before.phone,
          birthDate: dateOrNull(body.birthDate),
          passport: dateOrNull(body.passport),
          licenseUntil: license,
          status: ['active', 'vacation', 'sick', 'other'].includes(body.status) ? body.status : before.status,
          statusComment: body.statusComment?.trim() || null,
        },
      })
      await db.auditLog.create({
        data: { actorRole: user.role, actorName: shortName(user.fullName), object: 'driver', objectId: d.id, field: 'updated', was: before.fullName, became: d.fullName, comment: 'Правка записи справочника «Водители»' },
      })
      return NextResponse.json({ ok: true, driver: d })
    }

    if (body.kind === 'vehicle') {
      const before = await db.vehicle.findUnique({ where: { id: body.id } })
      if (!before) return bad('Тягач не найден', 'NOT_FOUND')
      const techTill = dateOrNull(body.techTill)
      if (techTill && !DATE_RE.test(techTill)) return bad('Техосмотр — в формате ДД.ММ.ГГГГ')
      const v = await db.vehicle.update({
        where: { id: body.id },
        data: {
          brand: body.brand?.trim() || before.brand,
          plate: body.plate?.trim() || before.plate,
          vin: dateOrNull(body.vin),
          sts: dateOrNull(body.sts),
          techTill,
          capacityT: numOrNull(body.capacityT),
          volumeM3: numOrNull(body.volumeM3),
          isRepair: body.isRepair === true,
        },
      })
      await db.auditLog.create({
        data: { actorRole: user.role, actorName: shortName(user.fullName), object: 'vehicle', objectId: v.id, field: 'updated', was: before.plate, became: v.plate, comment: 'Правка записи справочника «Тягачи»' },
      })
      return NextResponse.json({ ok: true, vehicle: v })
    }

    if (body.kind === 'trailer') {
      const before = await db.trailer.findUnique({ where: { id: body.id } })
      if (!before) return bad('Прицеп не найден', 'NOT_FOUND')
      const techTill = dateOrNull(body.techTill)
      if (techTill && !DATE_RE.test(techTill)) return bad('Техосмотр — в формате ДД.ММ.ГГГГ')
      const t = await db.trailer.update({
        where: { id: body.id },
        data: {
          brand: body.brand?.trim() || before.brand,
          plate: body.plate?.trim() || before.plate,
          type: body.type?.trim() || before.type,
          sts: dateOrNull(body.sts),
          techTill,
          volumeM3: numOrNull(body.volumeM3),
          beltsCount: numOrNull(body.beltsCount),
          workingBoards: body.workingBoards === true,
          isRepair: body.isRepair === true,
        },
      })
      await db.auditLog.create({
        data: { actorRole: user.role, actorName: shortName(user.fullName), object: 'trailer', objectId: t.id, field: 'updated', was: before.plate, became: t.plate, comment: 'Правка записи справочника «Прицепы»' },
      })
      return NextResponse.json({ ok: true, trailer: t })
    }

    return bad('Неизвестный тип записи справочника')
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не удалось сохранить запись'
    return NextResponse.json({ error: { code: 'DB', message } }, { status: 500 })
  }
}
