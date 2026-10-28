import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, requireUser } from '@/lib/auth'
import { plog } from '@/lib/platform-log'
import { notifyLive } from '@/lib/notify'
import {
  allAccess, allowedFor, defaultTemplateId, effective, invalidateAccessCache, permDenied, type Contour,
} from '@/lib/permissions'
import type { AdminUserDTO, SessionRole } from '@/lib/types'

export const dynamic = 'force-dynamic'

const ROLES: SessionRole[] = ['admin', 'logist', 'carrier']
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Раздел «Профили и доступы» — администрация с правом admin:users */
async function guard() {
  const auth = await requireUser('admin')
  if (auth instanceof NextResponse) return auth
  if (!(await allowedFor(auth, 'admin:users'))) {
    return NextResponse.json({ error: permDenied('admin:users') }, { status: 403 })
  }
  return auth
}

/** Кто сейчас может управлять доступом, если убрать пользователя userId (удаление, смена роли) */
async function holdersWithout(userId: string): Promise<number> {
  const list = await allAccess()
  return list.filter((x) => x.row.id !== userId && x.access?.contour === 'admin' && effective(x.access, 'admin:users').on).length
}

/** DTO учётной записи с проформой, компанией и должностью */
function toAdminUserDTO(u: {
  id: string; login: string; name: string; role: string; carrierId: string | null; templateId: string | null; createdAt: Date
  carrier?: { name: string } | null
  profile?: { userId: string; fullName: string; position: string; phone: string; email: string; companyName: string; inn: string; kpp: string; address: string; director: string; contactName: string; note: string; updatedAt: Date } | null
}): AdminUserDTO {
  const p = u.profile
  return {
    id: u.id, login: u.login, name: u.name, role: (ROLES.includes(u.role as SessionRole) ? u.role : 'carrier') as SessionRole,
    carrierId: u.carrierId, carrierName: u.carrier?.name ?? null,
    templateId: u.templateId,
    createdAt: u.createdAt.toISOString(),
    profile: p ? {
      userId: p.userId, fullName: p.fullName, position: p.position, phone: p.phone, email: p.email,
      companyName: p.companyName, inn: p.inn, kpp: p.kpp, address: p.address,
      director: p.director, contactName: p.contactName, note: p.note, updatedAt: p.updatedAt.toISOString(),
    } : null,
  }
}

/**
 * GET /api/admin/users — все учётные записи с проформами (только администрация).
 */
export async function GET() {
  const auth = await guard()
  if (auth instanceof NextResponse) return auth

  const users = await db.user.findMany({
    orderBy: [{ role: 'asc' }, { login: 'asc' }],
    include: { carrier: { select: { name: true } }, profile: true },
  })
  return NextResponse.json({ users: users.map(toAdminUserDTO) })
}

/**
 * POST /api/admin/users — создать профиль (учётную запись) (только администрация).
 * { login, name, password, role, carrierId?, profile? }
 */
export async function POST(req: NextRequest) {
  const auth = await guard()
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const login = str(body?.login, 60).toLowerCase()
  const name = str(body?.name, 120)
  const password = typeof body?.password === 'string' ? body.password : ''
  const role = ROLES.includes(body?.role as SessionRole) ? (body?.role as SessionRole) : null
  const carrierId = typeof body?.carrierId === 'string' && body.carrierId ? body.carrierId : null

  if (!login || !/^[a-z0-9._-]+$/.test(login)) {
    return NextResponse.json({ error: 'Логин — латиница, цифры и знаки . _ - (без пробелов)' }, { status: 400 })
  }
  if (!name) return NextResponse.json({ error: 'Укажите имя пользователя' }, { status: 400 })
  if (password.length < 6) return NextResponse.json({ error: 'Пароль — минимум 6 символов' }, { status: 400 })
  if (!role) return NextResponse.json({ error: 'Выберите роль: администрация, логист или перевозчик' }, { status: 400 })
  if (role === 'carrier' && !carrierId) {
    return NextResponse.json({ error: 'Учётке перевозчика нужна привязка к компании — создайте её в «Справочниках» или базе данных' }, { status: 400 })
  }
  if (carrierId && !(await db.carrier.findUnique({ where: { id: carrierId } }))) {
    return NextResponse.json({ error: 'Указанная компания не найдена' }, { status: 400 })
  }
  if (await db.user.findUnique({ where: { login } })) {
    return NextResponse.json({ error: `Логин «${login}» уже занят` }, { status: 400 })
  }

  // должность: выбранная (только своего контура) или по умолчанию для контура
  let templateId: string | null = typeof body?.templateId === 'string' && body.templateId ? body.templateId : null
  if (templateId) {
    const tpl = await db.accessTemplate.findUnique({ where: { id: templateId } })
    if (!tpl || tpl.contour !== role) return NextResponse.json({ error: 'Выберите должность того же контура, что и роль' }, { status: 400 })
  } else {
    templateId = await defaultTemplateId(role as Contour)
  }

  const profile = (body?.profile ?? {}) as Record<string, unknown>
  const profileData = {
    fullName: str(profile.fullName), position: str(profile.position, 120), phone: str(profile.phone, 40),
    email: str(profile.email, 120), companyName: str(profile.companyName), inn: str(profile.inn, 20),
    kpp: str(profile.kpp, 20), address: str(profile.address, 300), director: str(profile.director),
    contactName: str(profile.contactName), note: str(profile.note, 1000),
  }

  const user = await db.user.create({
    data: {
      login, name, role, carrierId, templateId, passwordHash: hashPassword(password),
      profile: { create: profileData },
    },
    include: { carrier: { select: { name: true } }, profile: true, template: { select: { name: true } } },
  })
  invalidateAccessCache()

  await plog({
    type: 'USER_CREATED', source: 'api/admin/users',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    message: `Создан профиль «${name}» (логин ${login}, роль ${role}, должность «${user.template?.name ?? '—'}»)`,
  })

  return NextResponse.json({ user: toAdminUserDTO(user) }, { status: 201 })
}

/**
 * PUT /api/admin/users — отредактировать существующий профиль (только администрация).
 * { id, name?, role?, carrierId?, password?, profile? }
 */
export async function PUT(req: NextRequest) {
  const auth = await guard()
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const id = str(body?.id, 60)
  if (!id) return NextResponse.json({ error: 'Не указана учётная запись' }, { status: 400 })

  const existing = await db.user.findUnique({ where: { id }, include: { profile: true } })
  if (!existing) return NextResponse.json({ error: 'Учётная запись не найдена' }, { status: 404 })

  const patch: Record<string, unknown> = {}
  if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 120)

  if (body?.role !== undefined) {
    const role = ROLES.includes(body.role as SessionRole) ? (body.role as SessionRole) : null
    if (!role) return NextResponse.json({ error: 'Неизвестная роль' }, { status: 400 })
    if (role !== existing.role) {
      if (existing.id === auth.id) return NextResponse.json({ error: 'Нельзя сменить роль себе: вы потеряете доступ к этому разделу' }, { status: 400 })
      // защита: не остаться без того, кто управляет доступом
      if (existing.role === 'admin' && (await holdersWithout(existing.id)) === 0) {
        return NextResponse.json({ error: 'Нельзя сменить роль: больше ни у кого нет права «Профили и доступы»' }, { status: 400 })
      }
      // новая роль — новый контур: должность по умолчанию контура, прежние исключения снимаются
      patch.role = role
      patch.templateId = await defaultTemplateId(role as Contour)
    }
  }

  if (body?.carrierId !== undefined) {
    const carrierId = typeof body.carrierId === 'string' && body.carrierId ? body.carrierId : null
    if (carrierId && !(await db.carrier.findUnique({ where: { id: carrierId } }))) {
      return NextResponse.json({ error: 'Указанная компания не найдена' }, { status: 400 })
    }
    if (patch.role !== undefined ? patch.role !== 'carrier' : existing.role !== 'carrier') {
      patch.carrierId = null
      if (carrierId) return NextResponse.json({ error: 'Привязка к компании — только для учёток перевозчика' }, { status: 400 })
    } else {
      if ((patch.role ?? existing.role) === 'carrier' && !carrierId) {
        return NextResponse.json({ error: 'Учётке перевозчика нужна привязка к компании' }, { status: 400 })
      }
      patch.carrierId = carrierId
    }
  } else if (patch.role === 'carrier' && !existing.carrierId) {
    return NextResponse.json({ error: 'Учётке перевозчика нужна привязка к компании — укажите компанию' }, { status: 400 })
  }

  if (typeof body?.password === 'string' && body.password) {
    if (body.password.length < 6) return NextResponse.json({ error: 'Пароль — минимум 6 символов' }, { status: 400 })
    patch.passwordHash = hashPassword(body.password)
  }

  const profile = (body?.profile ?? null) as Record<string, unknown> | null
  const profileData = profile ? {
    fullName: str(profile.fullName), position: str(profile.position, 120), phone: str(profile.phone, 40),
    email: str(profile.email, 120), companyName: str(profile.companyName), inn: str(profile.inn, 20),
    kpp: str(profile.kpp, 20), address: str(profile.address, 300), director: str(profile.director),
    contactName: str(profile.contactName), note: str(profile.note, 1000),
  } : null

  const roleChanged = patch.role !== undefined
  const user = await db.$transaction(async (tx) => {
    if (roleChanged) await tx.permException.deleteMany({ where: { userId: id } })
    return tx.user.update({
      where: { id },
      data: {
        ...patch,
        ...(profileData ? { profile: existing.profile
          ? { update: profileData }
          : { create: profileData } } : {}),
      },
      include: { carrier: { select: { name: true } }, profile: true, template: { select: { name: true } } },
    })
  })
  invalidateAccessCache()
  if (roleChanged) notifyLive({ type: 'PERMS_CHANGED' })

  await plog({
    type: roleChanged ? 'ACCESS_CHANGED' : 'USER_UPDATED', source: 'api/admin/users',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    message: `Профиль изменён: ${user.name} (логин ${user.login})${
      roleChanged ? ` — роль ${existing.role} → ${user.role}, должность «${user.template?.name ?? '—'}», личные исключения сняты` : ''}${
      typeof body?.password === 'string' && body.password ? ' — пароль сброшен' : ''}`,
  })

  return NextResponse.json({ user: toAdminUserDTO(user) })
}

/**
 * DELETE /api/admin/users?id=… — удалить профиль (только администрация).
 * Нельзя удалить собственную учётку и последнего администратора.
 */
export async function DELETE(req: NextRequest) {
  const auth = await guard()
  if (auth instanceof NextResponse) return auth

  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'Не указана учётная запись' }, { status: 400 })
  if (id === auth.id) return NextResponse.json({ error: 'Нельзя удалить собственную учётную запись' }, { status: 400 })

  const existing = await db.user.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Учётная запись не найдена' }, { status: 404 })
  if (existing.role === 'admin' && (await holdersWithout(existing.id)) === 0) {
    return NextResponse.json({ error: 'Нельзя удалить: больше ни у кого нет права «Профили и доступы»' }, { status: 400 })
  }

  // связанные записи чистятся перед удалением: уведомления, проформа,
  // обращения пользователя (вместе с сообщениями-вложениями) и его сообщения в чужих ветках
  const userTickets = await db.ticket.findMany({ where: { authorId: id }, select: { id: true } })
  await db.ticketMessage.deleteMany({ where: { ticketId: { in: userTickets.map((t) => t.id) } } }) // вложения удалятся каскадом
  await db.ticket.deleteMany({ where: { authorId: id } })
  await db.ticketMessage.deleteMany({ where: { authorId: id } })
  await db.notification.deleteMany({ where: { userId: id } })
  await db.profile.deleteMany({ where: { userId: id } })
  await db.user.delete({ where: { id } }) // исключения удалятся каскадом
  invalidateAccessCache()

  await plog({
    type: 'USER_DELETED', source: 'api/admin/users',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    message: `Профиль удалён: ${existing.name} (логин ${existing.login})`,
  })

  return NextResponse.json({ ok: true })
}
