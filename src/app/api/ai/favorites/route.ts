import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * «Избранное» ИИ-помощника: варианты, которые человек отобрал из списков
 * ai-best. Ключ варианта — title|route|rate: один и тот же вариант не
 * дублируется, повторное сохранение лишь обновляет запрос и движок.
 */

function clean(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

function favoriteKey(title: string, route: string, rate: string): string {
  return [title, route, rate]
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .join('|')
}

/** GET /api/ai/favorites — сохранённые варианты, новые сверху. */
export async function GET() {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth
  const favorites = await db.aiFavorite.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return NextResponse.json({ favorites })
}

/** POST /api/ai/favorites — сохранить вариант из списка ИИ (upsert по ключу). */
export async function POST(req: Request) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const offer = body?.offer
  const title = clean(offer?.title, 300)
  if (!title) {
    return NextResponse.json({ error: 'Не указан вариант для сохранения' }, { status: 400 })
  }

  const route = clean(offer?.route, 300)
  const rate = clean(offer?.rate, 120)
  const key = favoriteKey(title, route, rate)
  const rankRaw = Number(offer?.rank)
  const rank = Number.isFinite(rankRaw) ? Math.max(1, Math.trunc(rankRaw)) : 1
  const engine = clean(body?.engine, 60) || null

  const favorite = await db.aiFavorite.upsert({
    where: { key },
    create: {
      key,
      query: clean(body?.query, 1000),
      rank,
      title,
      route,
      rate,
      date: clean(offer?.date, 120),
      company: clean(offer?.company, 300),
      contact: clean(offer?.contact, 300),
      note: clean(offer?.note, 2000),
      engine,
    },
    update: {
      query: clean(body?.query, 1000),
      rank,
      engine,
    },
  })

  return NextResponse.json({ ok: true, favorite })
}

/** DELETE /api/ai/favorites?id=… | ?key=… — убрать вариант и его переговоры. */
export async function DELETE(req: Request) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const id = clean(url.searchParams.get('id'), 100)
  const key = clean(url.searchParams.get('key'), 1000)
  if (!id && !key) {
    return NextResponse.json({ error: 'Не указан вариант' }, { status: 400 })
  }

  const favorite = id
    ? await db.aiFavorite.findUnique({ where: { id } })
    : await db.aiFavorite.findUnique({ where: { key } })
  if (!favorite) return NextResponse.json({ ok: true, removed: 0 })

  await db.$transaction([
    db.aiFavoriteMessage.deleteMany({ where: { favoriteKey: favorite.key } }),
    db.aiFavorite.delete({ where: { id: favorite.id } }),
  ])

  return NextResponse.json({ ok: true, removed: 1 })
}
