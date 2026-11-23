import { NextResponse } from 'next/server'
import { seedDemo } from '@/lib/kontur/seed'
import { requireKonturPerm } from '@/lib/kontur/access'

export const dynamic = 'force-dynamic'

// Демо: пересоздать данные
export async function POST() {
  const auth = await requireKonturPerm('admin:db')
  if (auth instanceof NextResponse) return auth
  const stats = await seedDemo()
  return NextResponse.json({ ok: true, ...stats })
}
