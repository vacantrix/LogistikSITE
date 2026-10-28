import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { myAccess } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

/**
 * GET /api/permissions — права текущего пользователя для интерфейса:
 * mine — разрешённые ключи (итог: должность ± действующие исключения, только своего контура),
 * sources — откуда каждое право (template | exception), templateName — должность.
 * Должности и исключения настраиваются в «Профилях и доступах» (/api/admin/access).
 */
export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(await myAccess(auth))
}
