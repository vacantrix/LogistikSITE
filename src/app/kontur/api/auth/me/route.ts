import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/kontur/auth'

export const dynamic = 'force-dynamic'

// Кто вошёл (null — сессии нет)
export async function GET() {
  const user = await getSessionUser()
  return NextResponse.json(user)
}
