import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, type SessionUser } from '@/lib/auth'
import { notifyLive } from '@/lib/notify'
import { plog } from '@/lib/platform-log'
import {
  allAccess, allowedFor, effective, exceptionActive, inContour, invalidateAccessCache, isContour, isPermKey,
  permDenied, permLabel, permsFor, CONTOUR_LABELS,
  type Access, type Contour, type PermEffect, type PermKey,
} from '@/lib/permissions'
import type { AccessDataDTO, AccessExceptionDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * «Профили и доступы» (право admin:users): должности, исключения, журнал изменений.
 *
 * GET  — должности контуров, доступ каждого пользователя (должность, исключения, итог с источником),
 *        журнал изменений доступа.
 * POST — { op: 'template-save' | 'template-delete' | 'template-default' | 'user-access', … }.
 *        Каждое сохранение: проверки → запись → журнал ACCESS_CHANGED → live PERMS_CHANGED,
 *        ответ — свежие данные раздела.
 */

const JOURNAL_TYPES = ['ACCESS_CHANGED', 'ACCESS_MIGRATED', 'PERMS_UPDATED']
const MAX_REASON = 300

class AccessError extends Error {}
const fail = (message: string): never => { throw new AccessError(message) }

async function guard(): Promise<SessionUser | NextResponse> {
  const auth = await requireUser('admin')
  if (auth instanceof NextResponse) return auth
  if (!(await allowedFor(auth, 'admin:users'))) {
    return NextResponse.json({ error: permDenied('admin:users') }, { status: 403 })
  }
  return auth
}

const pad = (n: number) => String(n).padStart(2, '0')
/** Дата исключения для интерфейса: ГГГГ-ММ-ДД (срок включительно) */
const dayOf = (d: Date | null): string | null => d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null
/** ГГГГ-ММ-ДД → конец этого дня: «до 15.11» действует весь день 15.11 */
function endOfDay(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999)
  return d.getDate() === Number(m[3]) ? d : null
}
const ruDay = (day: string | null) => day ? `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}` : ''

/** Итог права «Профили и доступы» у всех администраторов — с учётом предлагаемого изменения */
function adminHolders(
  list: { row: { id: string }; access: Access | null }[],
  change: { templateId?: string; templatePerms?: Set<PermKey>; userId?: string; userAccess?: Access },
): string[] {
  const holders: string[] = []
  for (const { row, access } of list) {
    if (!access || access.contour !== 'admin') continue
    let a = access
    if (change.userId === row.id && change.userAccess) a = change.userAccess
    else if (change.templateId && a.templateId === change.templateId && change.templatePerms) a = { ...a, perms: change.templatePerms }
    if (effective(a, 'admin:users').on) holders.push(row.id)
  }
  return holders
}

async function payload(meId: string): Promise<AccessDataDTO> {
  const [list, templates, users, journal] = await Promise.all([
    allAccess(),
    db.accessTemplate.findMany({ include: { perms: true }, orderBy: [{ contour: 'asc' }, { createdAt: 'asc' }] }),
    db.user.findMany({
      select: {
        id: true, login: true, name: true, role: true,
        carrier: { select: { name: true } },
        profile: { select: { fullName: true, position: true } },
        exceptions: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ role: 'asc' }, { login: 'asc' }],
    }),
    db.platformLog.findMany({ where: { type: { in: JOURNAL_TYPES } }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ])
  const accessById = new Map(list.map((x) => [x.row.id, x.access]))
  const counts = new Map<string, number>()
  for (const { access } of list) if (access?.templateId) counts.set(access.templateId, (counts.get(access.templateId) ?? 0) + 1)
  const now = new Date()

  return {
    meId,
    templates: templates.filter((t) => isContour(t.contour)).map((t) => ({
      id: t.id, contour: t.contour as Contour, name: t.name, description: t.description, isDefault: t.isDefault,
      perms: t.perms.map((p) => p.key).filter((k) => isPermKey(k) && inContour(t.contour as Contour, k)),
      userCount: counts.get(t.id) ?? 0,
      updatedAt: t.updatedAt.toISOString(),
    })),
    users: users.filter((u) => isContour(u.role)).map((u) => {
      const access = accessById.get(u.id) ?? null
      const contour = u.role as Contour
      const effectiveKeys: string[] = []
      const sources: Record<string, 'template' | 'exception'> = {}
      if (access) {
        for (const p of permsFor(contour)) {
          const r = effective(access, p.key, now)
          if (r.on) effectiveKeys.push(p.key)
          sources[p.key] = r.source
        }
      }
      return {
        id: u.id, login: u.login, name: u.name, role: contour,
        fullName: u.profile?.fullName || u.name,
        position: u.profile?.position ?? '',
        carrierName: u.carrier?.name ?? null,
        templateId: access?.templateId ?? null,
        templateName: access?.templateName ?? '—',
        exceptions: u.exceptions.filter((e) => isPermKey(e.key) && inContour(contour, e.key)).map((e): AccessExceptionDTO => ({
          key: e.key, effect: e.effect === 'deny' ? 'deny' : 'allow', reason: e.reason,
          expiresAt: dayOf(e.expiresAt), active: exceptionActive(e, now),
          createdBy: e.createdBy, createdAt: e.createdAt.toISOString(),
        })),
        effective: effectiveKeys,
        sources,
      }
    }),
    journal: journal.map((j) => {
      let reason: string | null = null
      try { reason = j.meta ? (JSON.parse(j.meta) as { reason?: string }).reason ?? null : null } catch { /* без подробностей */ }
      return { id: j.id, at: j.createdAt.toISOString(), actorName: j.actorName, message: j.message, reason }
    }),
  }
}

export async function GET() {
  const auth = await guard()
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(await payload(auth.id))
}

type ExceptionInput = { key: PermKey; effect: PermEffect; reason: string; expiresAt: Date | null; day: string | null }

export async function POST(req: NextRequest) {
  const auth = await guard()
  if (auth instanceof NextResponse) return auth
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const op = typeof body?.op === 'string' ? body.op : ''
  const actor = { login: auth.login, name: auth.name, role: auth.role }

  try {
    let message = ''
    let reason: string | null = null

    if (op === 'template-save') {
      const id = typeof body?.id === 'string' && body.id ? body.id : null
      const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : ''
      const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 300) : ''
      const rawPerms = Array.isArray(body?.perms) ? body.perms : fail('Передайте список прав должности')
      const existing = id ? await db.accessTemplate.findUnique({ where: { id }, include: { perms: true } }) : null
      if (id && !existing) fail('Должность не найдена — обновите страницу')
      const contour = existing ? existing.contour : body?.contour
      if (!isContour(contour)) fail('Укажите контур: логист, перевозчик или администрация')
      const c = contour as Contour
      if (name.length < 2) fail('Укажите название должности')
      const foreign = (rawPerms as unknown[]).filter((k) => !isPermKey(k) || !inContour(c, k))
      if (foreign.length) fail(`Эти права не существуют для контура «${CONTOUR_LABELS[c]}»: ${foreign.map((k) => isPermKey(k) ? permLabel(k) : String(k)).join(', ')}`)
      const perms = new Set(rawPerms as PermKey[])
      const clash = await db.accessTemplate.findFirst({ where: { contour: c, name, ...(id ? { id: { not: id } } : {}) } })
      if (clash) fail(`Должность «${name}» уже есть в контуре «${CONTOUR_LABELS[c]}»`)

      if (existing && c === 'admin') {
        const list = await allAccess()
        const holders = adminHolders(list, { templateId: existing.id, templatePerms: perms })
        if (holders.length === 0) fail('После сохранения ни у кого не останется права «Профили и доступы» — некому будет управлять доступом')
        if (!holders.includes(auth.id) && list.some((x) => x.row.id === auth.id && x.access?.templateId === existing.id)) {
          fail('Нельзя убрать право «Профили и доступы» из своей должности: вы потеряете доступ к этому разделу')
        }
      }

      if (existing) {
        const before = new Set(existing.perms.map((p) => p.key))
        const added = [...perms].filter((k) => !before.has(k))
        const removed = [...before].filter((k) => isPermKey(k) && !perms.has(k as PermKey)) as PermKey[]
        await db.$transaction([
          db.templatePerm.deleteMany({ where: { templateId: existing.id } }),
          db.accessTemplate.update({
            where: { id: existing.id },
            data: { name, description, perms: { create: [...perms].map((key) => ({ key })) } },
          }),
        ])
        const users = await db.user.count({ where: { templateId: existing.id } })
        const parts = [
          name !== existing.name ? `переименована из «${existing.name}»` : '',
          added.length ? `добавлено: ${added.map((k) => permLabel(k, c)).join(', ')}` : '',
          removed.length ? `убрано: ${removed.map((k) => permLabel(k, c)).join(', ')}` : '',
          description !== existing.description && !added.length && !removed.length && name === existing.name ? 'изменено описание' : '',
        ].filter(Boolean)
        message = `Должность «${name}» (${CONTOUR_LABELS[c].toLowerCase()}): ${parts.join('; ') || 'без изменений'}. Затронуто пользователей: ${users}`
      } else {
        await db.accessTemplate.create({
          data: { contour: c, name, description, perms: { create: [...perms].map((key) => ({ key })) } },
        })
        message = `Создана должность «${name}» (${CONTOUR_LABELS[c].toLowerCase()}): ${perms.size ? [...perms].map((k) => permLabel(k, c)).join(', ') : 'без прав, только просмотр'}`
      }
    } else if (op === 'template-delete') {
      const id = typeof body?.id === 'string' ? body.id : ''
      const t = await db.accessTemplate.findUnique({ where: { id } })
      if (!t) fail('Должность не найдена — обновите страницу')
      if (t!.isDefault) fail('Должность по умолчанию не удаляется — сначала назначьте основной другую')
      const users = await db.user.count({ where: { templateId: id } })
      if (users > 0) fail(`На должности ${users} ${users === 1 ? 'пользователь' : 'пользователя'} — сначала переведите их на другую`)
      await db.accessTemplate.delete({ where: { id } })
      message = `Удалена должность «${t!.name}» (${CONTOUR_LABELS[t!.contour as Contour]?.toLowerCase() ?? t!.contour})`
    } else if (op === 'template-default') {
      const id = typeof body?.id === 'string' ? body.id : ''
      const t = await db.accessTemplate.findUnique({ where: { id } })
      if (!t) fail('Должность не найдена — обновите страницу')
      await db.$transaction([
        db.accessTemplate.updateMany({ where: { contour: t!.contour }, data: { isDefault: false } }),
        db.accessTemplate.update({ where: { id }, data: { isDefault: true } }),
      ])
      message = `Должность «${t!.name}» назначена основной для новых учёток (${CONTOUR_LABELS[t!.contour as Contour]?.toLowerCase() ?? t!.contour})`
    } else if (op === 'user-access') {
      const userId = typeof body?.userId === 'string' ? body.userId : ''
      const user = await db.user.findUnique({ where: { id: userId }, include: { exceptions: true } })
      if (!user || !isContour(user.role)) fail('Пользователь не найден — обновите страницу')
      const c = user!.role as Contour
      const templateId = typeof body?.templateId === 'string' ? body.templateId : ''
      const tpl = await db.accessTemplate.findUnique({ where: { id: templateId }, include: { perms: true } })
      if (!tpl || tpl.contour !== c) fail(`Выберите должность контура «${CONTOUR_LABELS[c]}»`)
      const tplPerms = new Set(tpl!.perms.map((p) => p.key).filter((k): k is PermKey => isPermKey(k) && inContour(c, k)))

      const rawEx = Array.isArray(body?.exceptions) ? body.exceptions as Record<string, unknown>[] : []
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const seen = new Set<string>()
      const exceptions: ExceptionInput[] = rawEx.map((e) => {
        const key = e?.key
        if (!isPermKey(key) || !inContour(c, key)) fail(`Право «${String(key)}» не существует для контура «${CONTOUR_LABELS[c]}»`)
        const k = key as PermKey
        if (seen.has(k)) fail(`Исключение «${permLabel(k, c)}» указано дважды`)
        seen.add(k)
        const effect = e.effect === 'allow' || e.effect === 'deny' ? e.effect : fail('Исключение: разрешить или запретить')
        const reasonText = typeof e.reason === 'string' ? e.reason.trim().slice(0, MAX_REASON) : ''
        if (reasonText.length < 3) fail(`Укажите причину исключения «${permLabel(k, c)}»`)
        const day = typeof e.expiresAt === 'string' && e.expiresAt ? e.expiresAt : null
        const expiresAt = day ? endOfDay(day) : null
        if (day && !expiresAt) fail(`Срок исключения «${permLabel(k, c)}» — дата в формате ГГГГ-ММ-ДД`)
        const old = user!.exceptions.find((x) => x.key === k)
        const unchanged = old && old.effect === effect && old.reason === reasonText && dayOf(old.expiresAt) === day
        if (!unchanged && expiresAt && expiresAt < today) fail(`Срок исключения «${permLabel(k, c)}» уже прошёл`)
        // исключение должно что-то менять относительно должности
        if (!unchanged && effect === 'allow' && tplPerms.has(k)) fail(`«${permLabel(k, c)}» уже есть в должности «${tpl!.name}» — разрешать отдельно не нужно`)
        if (!unchanged && effect === 'deny' && !tplPerms.has(k)) fail(`В должности «${tpl!.name}» нет права «${permLabel(k, c)}» — запрещать нечего`)
        return { key: k, effect: effect as PermEffect, reason: reasonText, expiresAt, day }
      })

      // не остаться без администратора и не снять доступ к разделу у себя
      const list = await allAccess()
      const current = list.find((x) => x.row.id === user!.id)?.access
      if (c === 'admin' && current) {
        const proposed: Access = {
          ...current, templateId: tpl!.id, templateName: tpl!.name, perms: tplPerms,
          exceptions: new Map(exceptions.map((e) => [e.key, { effect: e.effect, expiresAt: e.expiresAt }])),
        }
        const holders = adminHolders(list, { userId: user!.id, userAccess: proposed })
        if (user!.id === auth.id && !holders.includes(auth.id)) fail('Нельзя снять у себя право «Профили и доступы»: вы потеряете доступ к этому разделу. Попросите другого администратора')
        if (holders.length === 0) fail('После сохранения ни у кого не останется права «Профили и доступы» — некому будет управлять доступом')
      }

      // итог «было → стало» для журнала
      const beforeAccess = current
      const afterAccess: Access = {
        contour: c, templateId: tpl!.id, templateName: tpl!.name, perms: tplPerms,
        exceptions: new Map(exceptions.map((e) => [e.key, { effect: e.effect, expiresAt: e.expiresAt }])),
      }
      const plus: string[] = [], minus: string[] = []
      for (const p of permsFor(c)) {
        const a = beforeAccess ? effective(beforeAccess, p.key).on : false
        const b = effective(afterAccess, p.key).on
        if (a !== b) (b ? plus : minus).push(permLabel(p.key, c))
      }

      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user!.id }, data: { templateId: tpl!.id } })
        const keep = new Set<string>()
        for (const e of exceptions) {
          const old = user!.exceptions.find((x) => x.key === e.key)
          if (old && old.effect === e.effect && old.reason === e.reason && dayOf(old.expiresAt) === e.day) { keep.add(old.id); continue }
          if (old) await tx.permException.delete({ where: { id: old.id } })
          const created = await tx.permException.create({
            data: { userId: user!.id, key: e.key, effect: e.effect, reason: e.reason, expiresAt: e.expiresAt, createdBy: auth.name },
          })
          keep.add(created.id)
        }
        await tx.permException.deleteMany({ where: { userId: user!.id, id: { notIn: [...keep] } } })
      })

      const exParts: string[] = []
      for (const e of exceptions) {
        const old = user!.exceptions.find((x) => x.key === e.key)
        if (old && old.effect === e.effect && old.reason === e.reason && dayOf(old.expiresAt) === e.day) continue
        exParts.push(`исключение «${permLabel(e.key, c)}» — ${e.effect === 'allow' ? 'разрешено' : 'запрещено'}${e.day ? ` до ${ruDay(e.day)}` : ' бессрочно'}`)
        reason = e.reason
      }
      for (const old of user!.exceptions) {
        if (!exceptions.some((e) => e.key === old.key) && isPermKey(old.key)) exParts.push(`снято исключение «${permLabel(old.key, c)}»`)
      }
      const parts = [
        beforeAccess && beforeAccess.templateId !== tpl!.id ? `должность «${beforeAccess.templateName}» → «${tpl!.name}»` : '',
        ...exParts,
        plus.length ? `появилось: ${plus.join(', ')}` : '',
        minus.length ? `убрано: ${minus.join(', ')}` : '',
      ].filter(Boolean)
      message = `${user!.name} (${user!.login}): ${parts.join('; ') || 'без изменений'}`
    } else {
      fail('Неизвестная операция')
    }

    invalidateAccessCache()
    await plog({ type: 'ACCESS_CHANGED', source: 'api/admin/access', actor, message, meta: reason ? { reason } : undefined })
    notifyLive({ type: 'PERMS_CHANGED' })
    return NextResponse.json(await payload(auth.id))
  } catch (e) {
    if (e instanceof AccessError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }
}
