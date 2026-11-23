import { NextResponse } from 'next/server'
import { AtiError } from '@/lib/kontur/atisu/client'
import { getTrucks, getTrucksCount } from '@/lib/kontur/atisu/free'

export const dynamic = 'force-dynamic'

// Ваши машины на бирже ATI.SU: список + счётчики (реальный вызов, только чтение).
export async function GET() {
  try {
    const [trucks, count] = await Promise.all([getTrucks(), getTrucksCount()])
    return NextResponse.json({ count, trucks, published: trucks.length })
  } catch (e) {
    const message = e instanceof AtiError ? `${e.status}: ${e.message}` : 'Сервис ATI.SU недоступен'
    return NextResponse.json({ error: { code: 'ATISU', message } }, { status: 502 })
  }
}
