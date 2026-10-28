import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isStaff, requireUser, viewerOf } from '@/lib/auth'
import { notifyLive } from '@/lib/notify'
import { notifyCarrier, notifyLogists } from '@/lib/notify-users'
import { plog } from '@/lib/platform-log'
import { loadRequestFor } from '@/lib/requests'
import { imageDataUriError, isPdfDataUri } from '@/lib/settings'
import { toRequestDTO } from '@/lib/serialize'

export const dynamic = 'force-dynamic'

/** Виды файлов обмена: перевозчик передаёт логисту «Доверенность» и «Заявка», логист выкладывает документы для перевозчика */
const CARRIER_KINDS = ['POA', 'REQUEST_DOC'] as const
const FILE_KIND_META: Record<string, string> = {
  POA: 'Доверенность',
  REQUEST_DOC: 'Заявка',
  FOR_CARRIER: 'Документ от логиста',
}

/**
 * POST /api/requests/[id]/files — обмен документами по заявке без почты (Task 109).
 *  — перевозчик-победитель: kind POA («Доверенность») или REQUEST_DOC («Заявка») — файл уходит логисту;
 *  — логист/администрация: kind FOR_CARRIER — документ выкладывается перевозчику на скачивание
 *    (нужно, например, когда работаем с экспедитором и он должен получить от нас комплект).
 * Повторная загрузка файла того же вида заменяет прежний.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const viewer = viewerOf(auth)
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { kind?: unknown; fileName?: unknown; dataUri?: unknown } | null

  const kind = typeof body?.kind === 'string' ? body.kind : ''
  const allowed: readonly string[] = isStaff(auth.role) ? [...CARRIER_KINDS, 'FOR_CARRIER'] : CARRIER_KINDS
  if (!allowed.includes(kind)) {
    return NextResponse.json({ error: 'Неизвестный вид файла обмена' }, { status: 400 })
  }

  let name = typeof body?.fileName === 'string' ? body.fileName.trim().slice(0, 200) : ''
  if (!name) return NextResponse.json({ error: 'Нужно имя файла' }, { status: 400 })
  const imgError = imageDataUriError(body?.dataUri, { pdf: true })
  if (imgError) return NextResponse.json({ error: imgError }, { status: 400 })
  if (isPdfDataUri(body?.dataUri as string) && !/\.pdf$/i.test(name)) name = `${name.slice(0, 196)}.pdf`

  const request = await db.request.findUnique({ where: { id }, select: { id: true, number: true, winnerId: true } })
  if (!request) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
  if (auth.role === 'carrier' && request.winnerId !== auth.carrierId) {
    return NextResponse.json({ error: 'Файлы по заявке передаёт перевозчик, за которым она закреплена' }, { status: 403 })
  }

  const sizeBytes = Math.floor(((body?.dataUri as string).length * 3) / 4) // base64 → байты

  const file = await db.requestFile.create({
    data: {
      requestId: id,
      kind,
      fileName: name,
      dataUri: body?.dataUri as string,
      sizeBytes,
      uploadedBy: isStaff(auth.role) ? 'logist' : 'carrier',
      uploadedByName: auth.name,
    },
  })

  // повторная загрузка того же вида заменяет прежний файл (кроме документов от логиста — копятся)
  if (kind !== 'FOR_CARRIER') {
    await db.requestFile.deleteMany({
      where: { requestId: id, kind, id: { not: file.id } },
    })
  }

  // журнал и уведомления — вне транзакции создания, правил P1008 не нарушаем
  await plog({
    type: 'REQUEST_FILE_UPLOADED', source: 'api/requests/files',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    requestId: id, requestNumber: request.number, carrierName: null,
    message: `${FILE_KIND_META[kind]} передан по заявке №${request.number}: ${name} (${auth.name})`,
  })

  const payload = {
    type: 'DOCS_EXCHANGED' as const,
    title: `${FILE_KIND_META[kind]} · №${request.number}`,
    body: isStaff(auth.role)
      ? `${auth.name} выложил документ для перевозчика: ${name} — можно скачать в кабинете`
      : `${auth.name} передал «${FILE_KIND_META[kind]}» (${name}) — файл доступен в карточке заявки`,
    requestId: id,
  }
  try {
    if (isStaff(auth.role)) {
      if (request.winnerId) await notifyCarrier(request.winnerId, payload)
    } else {
      await notifyLogists(payload)
    }
  } catch (e) {
    console.error('request file notification error', e)
  }
  notifyLive({ type: 'REQUEST_FILE_UPLOADED', requestId: id })

  const fresh = await loadRequestFor(id, viewer)
  if (!fresh) return NextResponse.json({ ok: true })
  return NextResponse.json({ file: { id: file.id, kind, fileName: file.fileName }, request: toRequestDTO(fresh, viewer) }, { status: 201 })
}

/**
 * DELETE /api/requests/[id]/files?fileId=… — удалить файл обмена.
 * Перевозчик удаляет только свои переданные файлы, логист/администрация — любые.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const fileId = req.nextUrl.searchParams.get('fileId') ?? ''

  const file = await db.requestFile.findUnique({ where: { id: fileId } })
  if (!file || file.requestId !== id) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
  if (!isStaff(auth.role) && file.uploadedBy !== 'carrier') {
    return NextResponse.json({ error: 'Удалять можно только свои файлы' }, { status: 403 })
  }

  await db.requestFile.delete({ where: { id: fileId } })
  await plog({
    type: 'REQUEST_FILE_DELETED', source: 'api/requests/files',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    requestId: id,
    message: `Удалён файл обмена (${file.kind}): ${file.fileName}`,
  })
  notifyLive({ type: 'REQUEST_FILE_UPLOADED', requestId: id })
  return NextResponse.json({ ok: true })
}
