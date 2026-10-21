import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, viewerOf } from '@/lib/auth'
import { DOC_SELECT, toDocumentDTO, toRequestDTO } from '@/lib/serialize'
import { notifyLive } from '@/lib/notify'
import { inTx, loadRequestFor } from '@/lib/requests'
import { imageDataUriError } from '@/lib/settings'

export const dynamic = 'force-dynamic'

const DOC_TYPES = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'LICENSE', 'STS', 'REQUEST_DOC', 'POA']

/** POST /api/requests/[id]/documents — перевозчик-победитель (или логист) загружает документ рейса */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const viewer = viewerOf(auth)
  const { id } = await params
  const body = await req.json().catch(() => null)
  const { type, fileName, dataUri } = (body ?? {}) as { type?: unknown; fileName?: unknown; dataUri?: unknown }

  if (typeof type !== 'string' || !DOC_TYPES.includes(type)) return NextResponse.json({ error: 'Неизвестный тип документа' }, { status: 400 })
  const name = typeof fileName === 'string' ? fileName.trim().slice(0, 200) : ''
  if (!name) return NextResponse.json({ error: 'Нужно имя файла' }, { status: 400 })
  const imgError = imageDataUriError(dataUri)
  if (imgError) return NextResponse.json({ error: imgError }, { status: 400 })

  const request = await db.request.findUnique({ where: { id }, select: { id: true, number: true, status: true, winnerId: true } })
  if (!request) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
  if (auth.role === 'carrier' && request.winnerId !== auth.carrierId) {
    return NextResponse.json({ error: 'Документы загружает только перевозчик, за которым закреплён рейс' }, { status: 403 })
  }
  if (!['AWARDED', 'DOCS_REVIEW'].includes(request.status)) {
    return NextResponse.json({ error: 'Документы принимаются, пока заявка у агента' }, { status: 400 })
  }

  // повторная загрузка заменяет прежний документ того же типа — одной транзакцией
  const doc = await inTx(async (tx) => {
    await tx.document.deleteMany({ where: { requestId: id, type } })
    const created = await tx.document.create({
      data: { requestId: id, type, fileName: name, dataUri: dataUri as string, status: 'PENDING' },
      select: DOC_SELECT,
    })
    await tx.event.create({
      data: { requestId: id, type: 'DOC_UPLOADED', message: `Загружен документ: ${name} — отправлен на проверку` },
    })
    await tx.request.updateMany({ where: { id, status: 'AWARDED' }, data: { status: 'DOCS_REVIEW' } })
    return created
  })
  notifyLive({ type: 'DOC_UPLOADED', requestId: id })

  const fresh = await loadRequestFor(id, viewer)
  return NextResponse.json({ document: toDocumentDTO(doc), request: fresh ? toRequestDTO(fresh, viewer) : null }, { status: 201 })
}
