import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform-log — «Журнал событий» и «Логи платформы» (Task 76).
 * Только логист и администрация: все действия пользователей обоих контуров
 * (платформа + диспетчерская), попытки входа, предупреждения и ошибки.
 *
 * Фильтры: level (INFO|WARN|ERROR), contour (platform|dispatcher), type, source,
 * actor, q — поиск по всем полям, limit — сколько последних записей отдать.
 * Возвращает ленту (новые сверху) и статистику за 24 часа для плиток разделов.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser('admin', 'logist')
  if (auth instanceof NextResponse) return auth

  const sp = req.nextUrl.searchParams

  const levelRaw = sp.get('level') ?? 'ALL'
  const level = ['ALL', 'INFO', 'WARN', 'ERROR'].includes(levelRaw) ? levelRaw : 'ALL'

  const contourRaw = sp.get('contour') ?? 'all'
  const contour = ['all', 'platform', 'dispatcher'].includes(contourRaw) ? contourRaw : 'all'

  const q = (sp.get('q') ?? '').trim().slice(0, 200)
  const type = (sp.get('type') ?? '').trim().slice(0, 100)
  const source = (sp.get('source') ?? '').trim().slice(0, 100)
  const actor = (sp.get('actor') ?? '').trim().slice(0, 100)

  const rawLimit = Number(sp.get('limit') ?? 200)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 1000) : 200

  const where: Prisma.PlatformLogWhereInput = {
    ...(level === 'ALL' ? {} : { level }),
    ...(contour === 'all' ? {} : { contour }),
    ...(type ? { type: { contains: type } } : {}),
    ...(source ? { source: { contains: source } } : {}),
    ...(actor
      ? { OR: [{ actorName: { contains: actor } }, { actorLogin: { contains: actor } }] }
      : {}),
    ...(q
      ? {
          OR: [
            { message: { contains: q } },
            { requestNumber: { contains: q } },
            { actorName: { contains: q } },
            { actorLogin: { contains: q } },
            { carrierName: { contains: q } },
            { source: { contains: q } },
            { type: { contains: q } },
            { objectType: { contains: q } },
            { objectId: { contains: q } },
            { ip: { contains: q } },
          ],
        }
      : {}),
  }

  const since24h = new Date(Date.now() - 24 * 3600_000)

  const [items, byLevel, lastError, logins] = await Promise.all([
    db.platformLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
    db.platformLog.groupBy({
      by: ['level'],
      where: { createdAt: { gte: since24h } },
      _count: { _all: true },
    }),
    db.platformLog.findFirst({ where: { level: 'ERROR' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, message: true } }),
    db.platformLog.groupBy({
      by: ['type'],
      where: { createdAt: { gte: since24h }, type: { in: ['LOGIN', 'LOGIN_FAILED', 'LOGIN_DENIED', 'LOGIN_LOCKOUT'] } },
      _count: { _all: true },
    }),
  ])

  const counts24h: Record<'INFO' | 'WARN' | 'ERROR', number> = { INFO: 0, WARN: 0, ERROR: 0 }
  for (const row of byLevel) {
    if (row.level === 'INFO' || row.level === 'WARN' || row.level === 'ERROR') {
      counts24h[row.level] = row._count._all
    }
  }

  // попытки входа за сутки: успешные входы и отклонённые (неверный пароль, закрытый
  // доступ перевозчика, блокировка подбора) — плитка раздела «Логи платформы»
  let loginOk = 0
  let loginFail = 0
  for (const row of logins) {
    if (row.type === 'LOGIN') loginOk = row._count._all
    else loginFail += row._count._all
  }

  return NextResponse.json({
    entries: items.map((e) => ({
      id: e.id,
      level: e.level,
      type: e.type,
      source: e.source,
      contour: e.contour,
      actorName: e.actorName,
      actorLogin: e.actorLogin,
      actorRole: e.actorRole,
      requestId: e.requestId,
      requestNumber: e.requestNumber,
      carrierName: e.carrierName,
      objectType: e.objectType,
      objectId: e.objectId,
      before: e.before,
      after: e.after,
      ip: e.ip,
      userAgent: e.userAgent,
      correlationId: e.correlationId,
      message: e.message,
      meta: e.meta ? (JSON.parse(e.meta) as Record<string, unknown>) : null,
      createdAt: e.createdAt.toISOString(),
    })),
    stats: {
      counts24h,
      logins24h: { success: loginOk, failed: loginFail },
      lastErrorAt: lastError?.createdAt.toISOString() ?? null,
      lastErrorMessage: lastError?.message ?? null,
    },
  })
}
