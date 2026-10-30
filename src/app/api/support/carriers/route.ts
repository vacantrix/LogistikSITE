import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isStaff, requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/support/carriers — адресаты для чатов персонала (только логист/админ):
 * id, название, ИНН и признак доступа компании. Лёгкий список без техники —
 * нужен только для выбора получателя при «Написать перевозчику».
 */
export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  if (!isStaff(auth.role)) return NextResponse.json({ error: 'Только для сотрудников платформы' }, { status: 403 })

  const carriers = await db.carrier.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, inn: true, access: true },
  })
  return NextResponse.json({ carriers })
}
