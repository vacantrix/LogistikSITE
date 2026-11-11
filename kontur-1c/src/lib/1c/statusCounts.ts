// Счётчики заявок по статусам (дашборд и список заявок)
import { db } from '@/lib/db'
import { REQUEST_STATUSES } from './statuses'

export async function statusCounts(): Promise<Record<string, number>> {
  const group = await db.transportRequest.groupBy({ by: ['status'], _count: { status: true } })
  const counts: Record<string, number> = {}
  for (const s of REQUEST_STATUSES) counts[s] = 0
  for (const g of group) counts[g.status] = g._count.status
  return counts
}
