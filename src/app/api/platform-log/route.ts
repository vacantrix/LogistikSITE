import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform-log?level=&q=&limit= — «Журнал событий платформы» (Task 76).
 * Только логист: бизнес-события всех ролей, предупреждения и ошибки сервера/клиента.
 * Возвращает ленту (новые сверху) и статистику за 24 часа для плиток.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser('admin', 'logist')
  if (auth instanceof NextResponse) return auth

  const sp = req.nextUrl.searchParams

  const levelRaw = sp.get('level') ?? 'ALL'
  const level = ['ALL', 'INFO', 'WARN', 'ERROR'].includes(levelRaw) ? levelRaw : 'ALL'

  const q = (sp.get('q') ?? '').trim().slice(0, 200)

  const rawLimit = Number(sp.get('limit') ?? 200)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 500) : 200

  const where: Prisma.PlatformLogWhereInput = {
    ...(level === 'ALL' ? {} : { level }),
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
          ],
        }
      : {}),
  }

  const since24h = new Date(Date.now() - 24 * 3600_000)

  const [items, byLevel, lastError] = await Promise.all([
    db.platformLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
    db.platformLog.groupBy({
      by: ['level'],
      where: { createdAt: { gte: since24h } },
      _count: { _all: true },
    }),
    db.platformLog.findFirst({ where: { level: 'ERROR' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, message: true } }),
  ])

  const counts24h: Record<'INFO' | 'WARN' | 'ERROR', number> = { INFO: 0, WARN: 0, ERROR: 0 }
  for (const row of byLevel) {
    if (row.level === 'INFO' || row.level === 'WARN' || row.level === 'ERROR') {
      counts24h[row.level] = row._count._all
    }
  }

  return NextResponse.json({
    entries: items.map((e) => ({
      id: e.id,
      level: e.level,
      type: e.type,
      source: e.source,
      actorName: e.actorName,
      actorLogin: e.actorLogin,
      actorRole: e.actorRole,
      requestNumber: e.requestNumber,
      carrierName: e.carrierName,
      message: e.message,
      meta: e.meta ? (JSON.parse(e.meta) as Record<string, unknown>) : null,
      createdAt: e.createdAt.toISOString(),
    })),
    stats: {
      counts24h,
      lastErrorAt: lastError?.createdAt.toISOString() ?? null,
      lastErrorMessage: lastError?.message ?? null,
    },
  })
}
