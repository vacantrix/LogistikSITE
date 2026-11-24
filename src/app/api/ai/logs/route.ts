import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** GET /api/ai/logs — журнал нейросети: что она делала и когда. Просмотры человеком
 *  в журнал не пишутся — там только действия самой нейросети. */
export async function GET(req: Request) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth
  const rawLimit = Number(new URL(req.url).searchParams.get('limit'))
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 100, 10), 300)
  const logs = await db.aiLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
  return NextResponse.json({ logs })
}
