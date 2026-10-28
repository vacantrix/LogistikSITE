import { NextRequest, NextResponse } from 'next/server'
import { requireUser, type Role } from '@/lib/auth'
import { plog } from '@/lib/platform-log'
import {
  PERM_GROUPS, PERM_DEFAULTS, ROLE_LABELS, allowed, invalidatePermCache, permLabel,
  permMatrix, type PermKey,
} from '@/lib/permissions'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const ROLES: Role[] = ['logist', 'carrier', 'admin']

const permsView = (matrix: Map<string, boolean>) =>
  ROLES.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    items: PERM_GROUPS.flatMap((g) => g.items).map((i) => ({
      key: i.key as string,
      allowed: matrix.get(`${role}:${i.key}`) ?? false,
    })),
  }))

/** GET /api/permissions — матрица прав для раздела «Права доступа» + права текущего пользователя */
export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const matrix = await permMatrix()
  const mine = PERM_GROUPS.flatMap((g) => g.items)
    .filter((i) => matrix.get(`${auth.role}:${i.key}`) === true)
    .map((i) => i.key as string)

  return NextResponse.json({
    perms: permsView(matrix),
    mine,
    defaults: Object.fromEntries(
      Object.entries(PERM_DEFAULTS).map(([role, keys]) => [role, keys]),
    ),
  })
}

/**
 * PUT /api/permissions — правка матрицы (только администрация).
 * Тело: { updates: [{ role, key, allowed }] } — сохраняет построчно,
 * пишет в журнал платформы и сбрасывает кэш прав.
 */
export async function PUT(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  if (auth.role !== 'admin') {
    return NextResponse.json({ error: 'Права доступа настраивает администрация' }, { status: 403 })
  }

  const body = (await req.json().catch(() => null)) as { updates?: { role?: string; key?: string; allowed?: boolean }[] } | null
  const updates = body?.updates ?? []
  const valid = updates.filter(
    (u): u is { role: Role; key: PermKey; allowed: boolean } =>
      (u.role === 'logist' || u.role === 'carrier' || u.role === 'admin') &&
      typeof u.key === 'string' && PERM_GROUPS.some((g) => g.items.some((i) => i.key === u.key)) &&
      typeof u.allowed === 'boolean',
  )
  if (valid.length === 0) {
    return NextResponse.json({ error: 'Нет корректных правок в запросе' }, { status: 400 })
  }

  for (const u of valid) {
    // upsert по составному ключу (role, key)
    await db.rolePerm.upsert({
      where: { role_key: { role: u.role, key: u.key } },
      create: { role: u.role, key: u.key, allowed: u.allowed },
      update: { allowed: u.allowed },
    })
  }
  invalidatePermCache()

  await plog({
    level: 'INFO',
    type: 'PERMS_UPDATED',
    source: 'api/permissions',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    message: `Права доступа изменены (${valid.length}): ${valid
      .map((u) => `${ROLE_LABELS[u.role]}/${permLabel(u.key)} — ${u.allowed ? 'вкл' : 'выкл'}`)
      .slice(0, 10)
      .join('; ')}${valid.length > 10 ? '…' : ''}`,
    meta: JSON.stringify({ updates: valid }),
  })

  const matrix = await permMatrix()
  return NextResponse.json({
    ok: true,
    perms: permsView(matrix),
  })
}
