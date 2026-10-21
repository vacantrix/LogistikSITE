import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/directory/photos?kind=driver|truck|trailer&id=... — фото/документы
 * записи справочника (Task 54). Используется модальным окном предосмотра
 * в «Справочниках»: загруженные и проверенные фото записи + скачивание.
 * Отдельный лёгкий роут — чтобы общий GET /api/directory не таскал dataUri.
 */
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get('kind') ?? ''
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!['driver', 'truck', 'trailer'].includes(kind) || !id) {
    return NextResponse.json({ error: 'Нужны kind (driver/truck/trailer) и id' }, { status: 400 })
  }
  const photos = await db.directoryPhoto.findMany({
    where: { kind, refId: id },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({
    photos: photos.map((p) => ({ id: p.id, label: p.label, fileName: p.fileName, dataUri: p.dataUri })),
  })
}
