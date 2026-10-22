import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/directory/photos?kind=driver|truck|trailer&id=... — фото/документы
 * записи справочника (Task 54) для модального окна предосмотра.
 * Видят логист и перевозчик-владелец записи. Сами файлы — по ссылке /api/files/directory/<id>.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const kind = req.nextUrl.searchParams.get('kind') ?? ''
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!['driver', 'truck', 'trailer'].includes(kind) || !id) {
    return NextResponse.json({ error: 'Нужны kind (driver/truck/trailer) и id' }, { status: 400 })
  }
  if (auth.role !== 'logist') {
    const owner = kind === 'driver'
      ? await db.driver.findUnique({ where: { id }, select: { carrierId: true } })
      : kind === 'truck'
        ? await db.truck.findUnique({ where: { id }, select: { carrierId: true } })
        : await db.trailer.findUnique({ where: { id }, select: { carrierId: true } })
    if (!owner || owner.carrierId !== auth.carrierId) return NextResponse.json({ photos: [] })
  }
  const photos = await db.directoryPhoto.findMany({
    where: { kind, refId: id },
    select: { id: true, label: true, fileName: true, status: true },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({
    photos: photos.map((p) => ({
      id: p.id, label: p.label, fileName: p.fileName,
      url: `/api/files/directory/${p.id}`,
      status: p.status === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'LOADED',
    })),
  })
}
