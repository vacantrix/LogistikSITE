import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'
import { getSessionUser, shortName } from '@/lib/kontur/auth'
import { denyUnless } from '@/lib/kontur/access'

export const dynamic = 'force-dynamic'

// Ручной план логиста — записи календаря «Планирования» на любую дату.
// Отличаются от расчётных событий (плечи рейсов, грузы ATI.SU): логист сам
// планирует работу состава — погрузку, выгрузку, возврат на базу АЭМЗ или
// заметку — на любой день, и запись сразу видна в календаре парка.
//
//   POST   /api/plan-entries { driverId, date, time?, kind, point?, note?, vehicleId? }
//   PUT    /api/plan-entries { id, action: 'close' | 'reopen' }  → закрыть/вернуть запись
//   DELETE /api/plan-entries?id=…              → снять запись с плана

const KINDS = ['load', 'unload', 'return', 'note'] as const
type Kind = (typeof KINDS)[number]

const KIND_LABEL: Record<Kind, string> = {
  load: 'Погрузка',
  unload: 'Выгрузка',
  return: 'Возврат на АЭМЗ',
  note: 'Заметка',
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: { code: 'AUTH', message: 'Нужен вход в кабинет' } }, { status: 401 })
  }
  const denied = await denyUnless(user, 'own:plan')
  if (denied) return denied

  const { driverId, date, time, kind, point, note, vehicleId } = (body ?? {}) as {
    driverId?: string; date?: string; time?: string | null; kind?: string
    point?: string | null; note?: string | null; vehicleId?: string | null
  }

  if (!driverId || !date || !kind || !KINDS.includes(kind as Kind)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: 'Укажите состав, дату и тип события' } },
      { status: 400 },
    )
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Дата в формате ГГГГ-ММ-ДД' } }, { status: 400 })
  }
  if (time != null && time !== '' && !/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Время в формате ЧЧ:ММ' } }, { status: 400 })
  }
  const driver = await db.driver.findUnique({ where: { id: driverId } })
  if (!driver) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Водитель не найден' } }, { status: 404 })
  }

  const finalKind = kind as Kind
  // возврат на базу — пункт фиксирован; заметка — пункт не нужен
  const finalPoint = finalKind === 'return' ? 'Абинск (АЭМЗ)' : finalKind === 'note' ? null : (point ?? null)
  if ((finalKind === 'load' || finalKind === 'unload') && !finalPoint?.trim()) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: 'Укажите пункт погрузки или выгрузки' } },
      { status: 400 },
    )
  }

  const entry = await db.planEntry.create({
    data: {
      driverId,
      vehicleId: vehicleId ?? null,
      date,
      time: time ? time : null,
      kind: finalKind,
      point: finalPoint?.trim() || null,
      note: note?.trim() || null,
      createdById: user.id,
      createdByName: shortName(user.fullName),
    },
  })
  await db.auditLog.create({
    data: {
      actorRole: 'logist',
      actorName: shortName(user.fullName),
      object: 'plan_entry',
      objectId: entry.id,
      field: 'created',
      became: `${driver.fullName}: ${KIND_LABEL[finalKind]}${finalPoint ? ` · ${finalPoint}` : ''} на ${date}${time ? ` ${time}` : ''}`,
      comment: 'Ручной план в календаре «Планирования»',
    },
  })

  const when = time ? `${date} в ${time}` : `${date} (в течение дня)`
  return NextResponse.json({
    ok: true,
    entry,
    message: `${driver.fullName}: ${KIND_LABEL[finalKind].toLowerCase()} запланирована на ${when}`,
  })
}

// Закрытие / возврат записи плана — сердце системы просрочки: пока событие
// не закрыто и его срок прошёл, оно пульсирует красным в календаре. Закрытие
// фиксирует выполнение (факт) — событие становится серым «выполнено».
export async function PUT(req: Request) {
  const body = await req.json().catch(() => null)
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: { code: 'AUTH', message: 'Нужен вход в кабинет' } }, { status: 401 })
  }
  const denied = await denyUnless(user, 'own:plan')
  if (denied) return denied

  const { id, action } = (body ?? {}) as { id?: string; action?: string }
  if (!id || (action !== 'close' && action !== 'reopen')) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: 'Укажите id записи и действие: close или reopen' } },
      { status: 400 },
    )
  }
  const entry = await db.planEntry.findUnique({ where: { id } })
  if (!entry) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Запись не найдена' } }, { status: 404 })
  }

  const closing = action === 'close'
  const updated = await db.planEntry.update({
    where: { id },
    data: closing
      ? { closedAt: new Date(), closedByName: shortName(user.fullName) }
      : { closedAt: null, closedByName: null },
  })
  await db.auditLog.create({
    data: {
      actorRole: 'logist',
      actorName: shortName(user.fullName),
      object: 'plan_entry',
      objectId: id,
      field: 'closedAt',
      became: closing ? `закрыто: ${KIND_LABEL[entry.kind as Kind] ?? entry.kind} на ${entry.date}` : '',
      was: closing ? '' : `закрыто`,
      comment: closing ? 'Событие выполнено — снято с контроля просрочки' : 'Событие возвращено в план',
    },
  })

  return NextResponse.json({
    ok: true,
    entry: updated,
    message: closing
      ? `${KIND_LABEL[entry.kind as Kind] ?? 'Событие'} на ${entry.date} закрыто — выполнено`
      : `${KIND_LABEL[entry.kind as Kind] ?? 'Событие'} на ${entry.date} возвращено в план`,
  })
}

export async function DELETE(req: Request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: { code: 'AUTH', message: 'Нужен вход в кабинет' } }, { status: 401 })
  }
  const denied = await denyUnless(user, 'own:plan')
  if (denied) return denied
  const id = new URL(req.url).searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Не указан id записи' } }, { status: 400 })
  }
  const entry = await db.planEntry.findUnique({ where: { id } })
  if (!entry) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Запись не найдена' } }, { status: 404 })
  }
  await db.planEntry.delete({ where: { id } })
  await db.auditLog.create({
    data: {
      actorRole: 'logist',
      actorName: shortName(user.fullName),
      object: 'plan_entry',
      objectId: id,
      field: 'deleted',
      was: `${KIND_LABEL[entry.kind as Kind] ?? entry.kind} на ${entry.date}`,
      comment: 'Запись снята с плана',
    },
  })
  return NextResponse.json({ ok: true, message: 'Запись снята с плана' })
}
