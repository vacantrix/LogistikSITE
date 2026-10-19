import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toDocumentDTO, toRequestDTO } from '@/lib/serialize'

export const dynamic = 'force-dynamic'

/** POST /api/requests/[id]/documents — агент загружает документ (догрузка в ту же заявку) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const { type, fileName, dataUri } = (body ?? {}) as { type?: string; fileName?: string; dataUri?: string }

  if (!type || !fileName || !dataUri) return NextResponse.json({ error: 'Нужны type, fileName и dataUri' }, { status: 400 })
  if (!['PASSPORT_PHOTO', 'PASSPORT_REG', 'LICENSE', 'STS'].includes(type)) {
    return NextResponse.json({ error: 'Неизвестный тип документа' }, { status: 400 })
  }
  if (dataUri.length > 12_000_000) return NextResponse.json({ error: 'Файл слишком большой (до ~8 МБ)' }, { status: 400 })

  const request = await db.request.findUnique({ where: { id }, include: { documents: true } })
  if (!request) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
  if (!['AWARDED', 'DOCS_REVIEW'].includes(request.status)) {
    return NextResponse.json({ error: 'Документы принимаются, пока заявка у агента' }, { status: 400 })
  }

  // повторная загрузка заменяет прежний документ того же типа
  await db.document.deleteMany({ where: { requestId: id, type } })
  const doc = await db.document.create({
    data: { requestId: id, type, fileName, dataUri, status: 'PENDING' },
  })
  await db.event.create({
    data: { requestId: id, type: 'DOC_UPLOADED', message: `Загружен документ: ${fileName} — отправлен на проверку нейросети` },
  })
  if (request.status === 'AWARDED') {
    await db.request.update({ where: { id }, data: { status: 'DOCS_REVIEW' } })
  }

  const fresh = await db.request.findUnique({
    where: { id },
    include: { bids: { include: { carrier: true } }, documents: true, events: true, winner: true },
  })
  return NextResponse.json({ document: toDocumentDTO(doc), request: toRequestDTO(fresh!) }, { status: 201 })
}
