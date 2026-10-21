import { NextRequest, NextResponse } from 'next/server'
import { requireUser, viewerOf } from '@/lib/auth'
import { toRequestDTO } from '@/lib/serialize'
import { finalizeExpired, loadRequestFor } from '@/lib/requests'

export const dynamic = 'force-dynamic'

/** GET /api/requests/[id] — заявка целиком: ставки, документы, журнал (в объёме прав пользователя) */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const viewer = viewerOf(auth)
  const { id } = await params

  await finalizeExpired()
  const request = await loadRequestFor(id, viewer)
  if (!request) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
  return NextResponse.json({ request: toRequestDTO(request, viewer) })
}
