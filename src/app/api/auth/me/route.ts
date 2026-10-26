import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** GET /api/auth/me — текущий пользователь сессии (или 401) */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  return NextResponse.json({ user })
}
