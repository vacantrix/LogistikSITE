/**
 * Серверная часть системы прав: «контур → должность → исключения».
 * Каталог прав и стартовые должности — src/lib/perm-catalog.ts.
 *
 * Итоговое право пользователя (allowedFor — единственный источник истины для API):
 *  1. право должно существовать в контуре его роли, иначе — нет (без обращения к БД);
 *  2. действующее личное исключение (PermException, срок не истёк) — разрешить / запретить;
 *  3. иначе — есть ли право в должности (AccessTemplate); без должности — должность
 *     контура по умолчанию.
 *
 * Первый запуск после обновления (ensureAccess): заводятся стартовые должности, и каждому
 * пользователю подбирается должность, ближайшая к его прежним правам (матрица RolePerm +
 * личные permOverrides/profileEditOwn); расхождения переносятся исключениями — итоговые
 * права никого не меняются.
 */
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { Role } from '@/lib/auth'
import { plog } from '@/lib/platform-log'
import {
  TEMPLATE_SEEDS, inContour, isContour, isPermKey, permLabel, permsFor,
  ADMIN_VIEW_SECTIONS, CARRIER_VIEW_SECTIONS, LOGIST_VIEW_SECTIONS, OWN_VIEW_SECTIONS,
  type Contour, type PermKey,
} from '@/lib/perm-catalog'

export * from '@/lib/perm-catalog'

export type PermEffect = 'allow' | 'deny'

/** Минимальные данные пользователя для проверки прав */
export interface PermUser {
  id: string
  role: Role
}

export interface Access {
  contour: Contour
  templateId: string | null
  templateName: string
  perms: Set<PermKey>
  exceptions: Map<PermKey, { effect: PermEffect; expiresAt: Date | null }>
}

export type PermSource = 'template' | 'exception'

const CACHE_TTL_MS = 5_000 // правки из «Профилей и доступов» подхватываются почти сразу и в других процессах

// ——— перенос со старой схемы прав (один раз) ———

/** Прежние права ролей по умолчанию (Task 111) — нужны только переносу, если матрица RolePerm пуста */
const LEGACY_DEFAULTS: Record<Contour, PermKey[]> = {
  logist: [
    'draft:create', 'draft:edit', 'draft:delete', 'request:publish', 'request:delete', 'request:quarantine', 'request:extend',
    'request:raise', 'request:offer', 'bid:submit', 'verify:decide', 'docs:upload', 'docs:request',
    'crew:assign', 'edo:sync', 'edo:sign', 'edo:send', 'directory:addManual', 'directory:edit',
    'notify:agent', 'trip:close', 'reports:view',
    'own:process', 'own:assign', 'own:plan', 'own:atisu', 'own:directory',
  ],
  carrier: ['bid:submit', 'crew:assign', 'docs:request', 'edo:sign', 'edo:send', 'directory:edit'],
  // Task 113 (z.ai): администрация — максимум прав платформы (все права, фильтр по контуру ниже)
  admin: [
    'draft:create', 'draft:edit', 'draft:delete', 'request:publish', 'request:delete', 'request:quarantine', 'request:extend',
    'request:raise', 'request:offer', 'verify:decide', 'docs:upload', 'edo:sync', 'edo:sign', 'edo:send',
    'directory:addManual', 'directory:edit', 'notify:agent', 'trip:close', 'reports:view', 'profile:edit',
    'own:process', 'own:assign', 'own:plan', 'own:atisu', 'own:directory',
  ],
}

const MIGRATION_REASON = 'Перенесено из прежних прав (матрица роли и личные права)'

function legacyOverrides(raw: string | null, profileEditOwn: string | null): Map<string, PermEffect> {
  const out = new Map<string, PermEffect>()
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      for (const [key, value] of Object.entries(parsed ?? {})) {
        if (value === 'allow' || value === 'deny') out.set(key, value)
      }
    } catch { /* битый JSON — как у роли */ }
  }
  if ((profileEditOwn === 'allow' || profileEditOwn === 'deny') && !out.has('profile:edit')) out.set('profile:edit', profileEditOwn)
  return out
}

async function migrateUsers(): Promise<void> {
  const [templates, rolePerms, users] = await Promise.all([
    db.accessTemplate.findMany({ include: { perms: true } }),
    db.rolePerm.findMany(),
    db.user.findMany({ where: { templateId: null }, select: { id: true, login: true, name: true, role: true, permOverrides: true, profileEditOwn: true } }),
  ])
  const matrix = new Map(rolePerms.map((r) => [`${r.role}:${r.key}`, r.allowed]))
  const lines: string[] = []

  for (const u of users) {
    if (!isContour(u.role)) continue
    const contour = u.role
    const own = legacyOverrides(u.permOverrides, u.profileEditOwn)
    // прежний итог: личное → матрица роли → прежний дефолт роли; управление — у любой прежней администрации
    const had = new Set(permsFor(contour).map((p) => p.key).filter((key) => {
      if (key === 'admin:users' || key === 'admin:db') return true
      const o = own.get(key)
      if (o) return o === 'allow'
      return matrix.get(`${contour}:${key}`) ?? LEGACY_DEFAULTS[contour].includes(key)
    }))
    // ближайшая должность контура: меньше всего расхождений, при равенстве — по умолчанию
    const candidates = templates.filter((t) => t.contour === contour)
    if (candidates.length === 0) continue
    const scored = candidates.map((t) => {
      const set = new Set(t.perms.map((p) => p.key))
      const allow = [...had].filter((k) => !set.has(k))
      // Видимость разделов (section:*) в исключения-запреты не пишем: секции — производная
      // операционных прав, их выдаёт backfillSectionPerms/backfillAiPerms по объёму работы.
      // На чистой базе (пустая матрица RolePerm) прежний код запрещал все вкладки первому
      // вошедшему пользователю — навигация становилась пустой.
      const deny = [...set].filter((k) => isPermKey(k) && inContour(contour, k) && !k.startsWith('section:') && !had.has(k as PermKey)) as PermKey[]
      return { t, allow, deny, score: allow.length + deny.length }
    }).sort((a, b) => a.score - b.score || Number(b.t.isDefault) - Number(a.t.isDefault))
    const best = scored[0]
    await db.user.update({ where: { id: u.id }, data: { templateId: best.t.id } })
    const exceptions = [
      ...best.allow.map((key) => ({ key, effect: 'allow' as const })),
      ...best.deny.map((key) => ({ key, effect: 'deny' as const })),
    ]
    if (exceptions.length > 0) {
      await db.permException.createMany({
        data: exceptions.map((e) => ({ userId: u.id, key: e.key, effect: e.effect, reason: MIGRATION_REASON, createdBy: 'Перенос прав' })),
      })
    }
    lines.push(`${u.name} (${u.login}) → «${best.t.name}»${exceptions.length ? `, исключений: ${exceptions.length}` : ''}`)
  }

  if (lines.length > 0) {
    await plog({
      type: 'ACCESS_MIGRATED', source: 'permissions',
      message: `Права перенесены на должности: ${lines.join('; ')}`.slice(0, 2000),
    })
  }
}

async function seedTemplates(): Promise<void> {
  for (const seed of TEMPLATE_SEEDS) {
    try {
      await db.accessTemplate.create({
        data: {
          contour: seed.contour, name: seed.name, description: seed.description, isDefault: !!seed.isDefault,
          perms: { create: seed.perms.filter((k) => inContour(seed.contour, k)).map((key) => ({ key })) },
        },
      })
    } catch (e) {
      // другой процесс успел завести эту должность — не ошибка
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
    }
  }
}

/**
 * Новое право «Карантин заявки» появляется у существующих должностей контура:
 * у кого было удаление заявок, тот управляет и карантином. Идемпотентно.
 */
async function backfillQuarantinePerm(): Promise<void> {
  const templates = await db.accessTemplate.findMany({
    where: { contour: { in: ['logist', 'admin'] }, perms: { some: { key: 'request:delete' } } },
    select: { id: true, perms: { where: { key: 'request:quarantine' }, select: { key: true } } },
  })
  const rows = templates.filter((t) => t.perms.length === 0).map((t) => ({ templateId: t.id, key: 'request:quarantine' }))
  if (rows.length > 0) await db.templatePerm.createMany({ data: rows })
}

/**
 * Новые права видимости разделов (`section:*`) появляются у уже существующих должностей.
 * Без этого после обновления логисты потеряли бы вкладки: старые должности не содержат
 * новых ключей. Набор подбирается по прежним операционным правам, поэтому итоговая
 * картина сохраняется: ведущий видит всё, линейный — рабочий минимум, наблюдатель — всё
 * без действий. Идемпотентно: должность, у которой уже есть хотя бы один section:*, не трогаем.
 */
async function backfillSectionPerms(): Promise<void> {
  const templates = await db.accessTemplate.findMany({ include: { perms: { select: { key: true } } } })
  const rows: { templateId: string; key: string }[] = []
  for (const t of templates) {
    if (!isContour(t.contour)) continue
    const keys = new Set(t.perms.map((p) => p.key))
    if ([...keys].some((k) => k.startsWith('section:'))) continue
    let sectionKeys: PermKey[]
    if (t.contour === 'admin') {
      sectionKeys = [...LOGIST_VIEW_SECTIONS, ...OWN_VIEW_SECTIONS, ...ADMIN_VIEW_SECTIONS]
    } else if (t.contour === 'carrier') {
      sectionKeys = CARRIER_VIEW_SECTIONS
    } else {
      const lead = ['request:publish', 'request:delete', 'trip:close', 'own:assign'].some((k) => keys.has(k))
      const line = ['draft:create', 'draft:edit', 'docs:upload'].some((k) => keys.has(k))
      sectionKeys = lead
        ? [...LOGIST_VIEW_SECTIONS, ...OWN_VIEW_SECTIONS]
        : line
          ? ['section:board', 'section:drafts', 'section:verify', 'section:requests', 'section:directory', 'section:support',
              'section:ownRequests', 'section:ownPlanning', 'section:ownOccupancy', 'section:ownDirectory']
          : [...LOGIST_VIEW_SECTIONS, ...OWN_VIEW_SECTIONS]
    }
    for (const key of sectionKeys) {
      if (inContour(t.contour, key)) rows.push({ templateId: t.id, key })
    }
  }
  if (rows.length > 0) await db.templatePerm.createMany({ data: rows })
}

/** Права действий собственного транспорта у существующих должностей — по прежнему объёму. */
async function backfillOwnTransportPerms(): Promise<void> {
  const templates = await db.accessTemplate.findMany({ include: { perms: { select: { key: true } } } })
  const rows: { templateId: string; key: string }[] = []
  for (const t of templates) {
    if (t.contour !== 'logist' && t.contour !== 'admin') continue
    const keys = new Set(t.perms.map((p) => p.key))
    if (['own:process', 'own:assign', 'own:plan', 'own:atisu', 'own:directory'].some((k) => keys.has(k))) continue
    const lead = ['request:publish', 'request:delete', 'trip:close', 'own:assign'].some((k) => keys.has(k))
    const line = ['draft:create', 'draft:edit', 'docs:upload'].some((k) => keys.has(k))
    const add: PermKey[] = lead
      ? ['own:process', 'own:assign', 'own:plan', 'own:atisu', 'own:directory']
      : line
        ? ['own:process', 'own:plan', 'own:directory']
        : []
    for (const key of add) rows.push({ templateId: t.id, key })
  }
  if (rows.length > 0) await db.templatePerm.createMany({ data: rows })
}

/**
 * Новый раздел «Приложение водителя» (администрация). Старые должности уже
 * содержат section:*, поэтому backfillSectionPerms их не трогает — выдаём
 * право адресно всем шаблонам контура «Администрация». Идемпотентно.
 */
async function backfillDriverAppPerm(): Promise<void> {
  const templates = await db.accessTemplate.findMany({
    where: { contour: 'admin' },
    select: { id: true, perms: { where: { key: 'section:driverApp' }, select: { key: true } } },
  })
  const rows = templates
    .filter((t) => t.perms.length === 0)
    .map((t) => ({ templateId: t.id, key: 'section:driverApp' }))
  if (rows.length > 0) await db.templatePerm.createMany({ data: rows })
}

/**
 * Новый раздел «Облачная LLM» (права нейросети ИИ-помощника) — администрация.
 * Существующие должности уже хранят свои section:*, поэтому backfillSectionPerms их
 * не трогает — выдаём право адресно всем шаблонам контура «Администрация»,
 * у которых уже есть «PaddleOCR» (section:neural): кто управлял распознаванием,
 * тот управляет и правами облачной LLM. Идемпотентно.
 */
async function backfillLlmPerm(): Promise<void> {
  const templates = await db.accessTemplate.findMany({
    where: { contour: 'admin' },
    select: { id: true, perms: { where: { key: { in: ['section:neural', 'section:llm'] } }, select: { key: true } } },
  })
  const rows = templates
    .filter((t) => t.perms.some((p) => p.key === 'section:neural') && !t.perms.some((p) => p.key === 'section:llm'))
    .map((t) => ({ templateId: t.id, key: 'section:llm' }))
  if (rows.length > 0) await db.templatePerm.createMany({ data: rows })
}

/**
 * Новые разделы «ИИ-помощник» и «Память контактов» (логист + администрация).
 * Существующие должности уже хранят свои section:*, поэтому новые права выдаём
 * адресно шаблонам контуров «логист» и «администрация». Идемпотентно.
 */
async function backfillAiPerms(): Promise<void> {
  const templates = await db.accessTemplate.findMany({
    where: { contour: { in: ['logist', 'admin'] } },
    select: { id: true, perms: { where: { key: { in: ['section:ai', 'section:contacts'] } }, select: { key: true } } },
  })
  const rows: { templateId: string; key: PermKey }[] = []
  for (const t of templates) {
    const has = new Set(t.perms.map((p) => p.key))
    if (!has.has('section:ai')) rows.push({ templateId: t.id, key: 'section:ai' })
    if (!has.has('section:contacts')) rows.push({ templateId: t.id, key: 'section:contacts' })
  }
  if (rows.length > 0) await db.templatePerm.createMany({ data: rows })
}

/**
 * Новые разделы «Журнал событий» и «Логи платформы» переехали в янтарную строку «Функции»
 * (Task: функции-журналы). Право section:logs выдаётся адресно: кто видел журнал
 * событий, тот видит и логи платформы. Идемпотентно.
 */
async function backfillLogsPerm(): Promise<void> {
  const templates = await db.accessTemplate.findMany({
    where: { contour: { in: ['logist', 'admin'] } },
    select: { id: true, perms: { where: { key: { in: ['section:journal', 'section:logs'] } }, select: { key: true } } },
  })
  const rows = templates
    .filter((t) => t.perms.some((p) => p.key === 'section:journal') && !t.perms.some((p) => p.key === 'section:logs'))
    .map((t) => ({ templateId: t.id, key: 'section:logs' }))
  if (rows.length > 0) await db.templatePerm.createMany({ data: rows })
}

let ensured = false
let ensuring: Promise<void> | null = null

/** Гарантировать должности и перенос прежних прав (идемпотентно, один раз на процесс) */
export async function ensureAccess(): Promise<void> {
  if (ensured) return
  ensuring ??= (async () => {
    if ((await db.accessTemplate.count()) === 0) await seedTemplates()
    await backfillQuarantinePerm()
    await backfillSectionPerms()
    await backfillDriverAppPerm()
    await backfillOwnTransportPerms()
    await backfillAiPerms()
    await backfillLlmPerm()
    await backfillLogsPerm()
    // пользователи без должности с прежними правами (после обновления) получают ближайшую должность;
    // новые учётки создаются сразу с должностью, поэтому повторно это почти ничего не делает
    const pending = await db.user.count({ where: { templateId: null, OR: [{ permOverrides: { not: null } }, { profileEditOwn: { not: null } }] } })
    const firstRun = (await db.user.count({ where: { templateId: { not: null } } })) === 0
    if (pending > 0 || firstRun) await migrateUsers()
    ensured = true
  })().finally(() => { ensuring = null })
  return ensuring
}

// ——— доступ пользователя ———

type DefaultTpl = { id: string; name: string; perms: Set<PermKey> }
let defaultsCache: { map: Map<Contour, DefaultTpl>; at: number } | null = null
const accessCache = new Map<string, { access: Access | null; at: number }>()

async function defaultTemplates(): Promise<Map<Contour, DefaultTpl>> {
  if (defaultsCache && Date.now() - defaultsCache.at < CACHE_TTL_MS) return defaultsCache.map
  const rows = await db.accessTemplate.findMany({ include: { perms: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] })
  const map = new Map<Contour, DefaultTpl>()
  for (const t of rows) {
    if (!isContour(t.contour) || map.has(t.contour)) continue
    map.set(t.contour, { id: t.id, name: t.name, perms: new Set(t.perms.map((p) => p.key).filter(isPermKey)) })
  }
  defaultsCache = { map, at: Date.now() }
  return map
}

/** Строка пользователя с должностью и исключениями — для accessFromRow */
export const ACCESS_SELECT = {
  id: true,
  role: true,
  templateId: true,
  template: { select: { id: true, name: true, contour: true, perms: { select: { key: true } } } },
  exceptions: { select: { key: true, effect: true, expiresAt: true } },
} satisfies Prisma.UserSelect

type AccessRow = Prisma.UserGetPayload<{ select: typeof ACCESS_SELECT }>

/** Доступ из строки пользователя: должность своего контура, иначе должность по умолчанию */
export function accessFromRow(row: AccessRow, defaults: Map<Contour, DefaultTpl>): Access | null {
  if (!isContour(row.role)) return null
  const contour = row.role
  const own = row.template && row.template.contour === contour ? row.template : null
  const fallback = own ? null : defaults.get(contour) ?? null
  const perms = own
    ? new Set(own.perms.map((p) => p.key).filter((k): k is PermKey => isPermKey(k) && inContour(contour, k)))
    : new Set([...(fallback?.perms ?? [])].filter((k) => inContour(contour, k)))
  const exceptions = new Map<PermKey, { effect: PermEffect; expiresAt: Date | null }>()
  for (const e of row.exceptions) {
    if (isPermKey(e.key) && inContour(contour, e.key) && (e.effect === 'allow' || e.effect === 'deny')) {
      exceptions.set(e.key, { effect: e.effect, expiresAt: e.expiresAt })
    }
  }
  return {
    contour,
    templateId: own?.id ?? fallback?.id ?? null,
    templateName: own?.name ?? fallback?.name ?? '—',
    perms, exceptions,
  }
}

/** Все пользователи с доступом — для «Профилей и доступов» и проверок «не остаться без администратора» */
export async function allAccess(): Promise<{ row: AccessRow; access: Access | null }[]> {
  await ensureAccess()
  const [rows, defaults] = await Promise.all([db.user.findMany({ select: ACCESS_SELECT }), defaultTemplates()])
  return rows.map((row) => ({ row, access: accessFromRow(row, defaults) }))
}

export async function accessOf(userId: string): Promise<Access | null> {
  const hit = accessCache.get(userId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.access
  await ensureAccess()
  const [row, defaults] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: ACCESS_SELECT }),
    defaultTemplates(),
  ])
  const access = row ? accessFromRow(row, defaults) : null
  accessCache.set(userId, { access, at: Date.now() })
  return access
}

/** Действует ли исключение сейчас (срок «до ДД.ММ.ГГГГ» включает весь день — хранится конец дня) */
export const exceptionActive = (e: { expiresAt: Date | null }, now = new Date()): boolean =>
  !e.expiresAt || e.expiresAt.getTime() >= now.getTime()

/** Итоговое право и его источник */
export function effective(access: Access, key: PermKey, now = new Date()): { on: boolean; source: PermSource } {
  if (!inContour(access.contour, key)) return { on: false, source: 'template' }
  const ex = access.exceptions.get(key)
  if (ex && exceptionActive(ex, now)) return { on: ex.effect === 'allow', source: 'exception' }
  return { on: access.perms.has(key), source: 'template' }
}

/**
 * Есть ли у пользователя право. Единственный источник истины для API-маршрутов.
 * Право вне контура роли — всегда нет, без обращения к базе.
 */
export async function allowedFor(user: PermUser, key: PermKey): Promise<boolean> {
  if (!isContour(user.role) || !inContour(user.role, key)) return false
  const access = await accessOf(user.id)
  return access ? effective(access, key).on : false
}

/** Права текущего пользователя для интерфейса: итог и источник каждого */
export async function myAccess(user: PermUser): Promise<{ mine: PermKey[]; sources: Partial<Record<PermKey, PermSource>>; templateName: string | null }> {
  const access = await accessOf(user.id)
  if (!access) return { mine: [], sources: {}, templateName: null }
  const now = new Date()
  const mine: PermKey[] = []
  const sources: Partial<Record<PermKey, PermSource>> = {}
  for (const p of permsFor(access.contour)) {
    const r = effective(access, p.key, now)
    if (r.on) { mine.push(p.key); sources[p.key] = r.source }
  }
  return { mine, sources, templateName: access.templateName }
}

/** Сброс кэша после любой правки должностей, исключений или ролей */
export function invalidateAccessCache(): void {
  accessCache.clear()
  defaultsCache = null
}
/** @deprecated — сбрасывает весь кэш доступа */
export const invalidateUserPermCache = (_userId?: string): void => invalidateAccessCache()
/** @deprecated — сбрасывает весь кэш доступа */
export const invalidatePermCache = invalidateAccessCache

/** Должность по умолчанию для новой учётки контура */
export async function defaultTemplateId(contour: Contour): Promise<string | null> {
  await ensureAccess()
  return (await defaultTemplates()).get(contour)?.id ?? null
}

/** Сообщение об отсутствии права для ответа API */
export const permDenied = (key: PermKey, contour?: Contour): string =>
  `Нет права «${permLabel(key, contour)}». Его выдаёт администрация в «Профилях и доступах»`
