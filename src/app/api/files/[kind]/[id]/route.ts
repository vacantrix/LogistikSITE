import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUserViaRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** data:<mime>[;base64],<payload> → байты и тип; null — не изображение и не PDF */
function decodeDataUri(uri: string): { mime: string; bytes: Buffer } | null {
  const m = uri.match(/^data:(image\/[a-z0-9.+-]+|application\/pdf)(;[^,]*)?,([\s\S]*)$/i)
  if (!m) return null
  const mime = m[1].toLowerCase()
  const isBase64 = (m[2] ?? '').toLowerCase().includes('base64')
  try {
    const bytes = isBase64 ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8')
    return { mime, bytes }
  } catch {
    return null
  }
}

/**
 * GET /api/files/document/<id> — фото документа рейса (логист или перевозчик-победитель);
 * GET /api/files/directory/<id> — фото записи справочника (логист или владелец записи).
 * ?download=1 — отдать файлом. Раньше фото отдавались целиком в каждом списке и без проверки прав.
 * Сессия: кука или заголовок, а для <img src> — ещё и query-параметр t (см. requireUserViaRequest).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const auth = await requireUserViaRequest(req)
  if (auth instanceof NextResponse) return auth
  const { kind, id } = await params
  const notFound = () => NextResponse.json({ error: 'Файл не найден' }, { status: 404 })

  let fileName = 'file'
  let dataUri: string | null = null

  if (kind === 'document') {
    const doc = await db.document.findUnique({
      where: { id },
      select: { fileName: true, dataUri: true, request: { select: { winnerId: true } } },
    })
    if (!doc) return notFound()
    if (auth.role !== 'logist' && doc.request.winnerId !== auth.carrierId) return notFound()
    fileName = doc.fileName
    dataUri = doc.dataUri
  } else if (kind === 'directory') {
    const photo = await db.directoryPhoto.findUnique({ where: { id } })
    if (!photo) return notFound()
    if (auth.role !== 'logist') {
      const owner = photo.kind === 'driver'
        ? await db.driver.findUnique({ where: { id: photo.refId }, select: { carrierId: true } })
        : photo.kind === 'truck'
          ? await db.truck.findUnique({ where: { id: photo.refId }, select: { carrierId: true } })
          : await db.trailer.findUnique({ where: { id: photo.refId }, select: { carrierId: true } })
      if (!owner || owner.carrierId !== auth.carrierId) return notFound()
    }
    fileName = photo.fileName
    dataUri = photo.dataUri
  } else {
    return notFound()
  }

  const file = dataUri ? decodeDataUri(dataUri) : null
  if (!file) return notFound()
  const download = req.nextUrl.searchParams.get('download') === '1'
  const pdf = file.mime === 'application/pdf'
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(file.bytes.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      // SVG-образцы не должны исполнять скрипты, даже если файл открыть отдельной вкладкой.
      // PDF открывается встроенным просмотрщиком браузера — в режиме sandbox браузер его блокирует,
      // поэтому для PDF только запрет внешних загрузок и встраивания на чужие сайты
      'Content-Security-Policy': pdf
        ? "default-src 'none'; frame-ancestors 'self'"
        : "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    },
  })
}
