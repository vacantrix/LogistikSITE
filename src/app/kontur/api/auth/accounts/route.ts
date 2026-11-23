import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'
import { ensureUsers } from '@/lib/kontur/seed'

export const dynamic = 'force-dynamic'

// Список учётных записей контура (демо-стенд): для подсказки на экране входа
// и быстрого «сменить аккаунт». Пароли не раскрываются.
export async function GET() {
  await ensureUsers()
  const users = await db.user.findMany({
    orderBy: [{ role: 'asc' }, { login: 'asc' }],
    select: { id: true, login: true, fullName: true, position: true, role: true, phone: true, email: true },
  })
  return NextResponse.json(users)
}
