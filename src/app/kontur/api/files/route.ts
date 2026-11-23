import { NextResponse } from 'next/server'
import { db } from '@/lib/kontur/db'
import { recomputeDocs } from '@/lib/kontur/engine'

export const dynamic = 'force-dynamic'

// B7.2.3/B5.4: доставку файла подтверждаем через confirm; потеря — через lost
export async function POST(req: Request) {
  const body = await req.json()
  const action: 'confirm' | 'lost' = body.action
  const clientIds: string[] = body.clientIds ?? []

  if (action === 'confirm') {
    for (const clientId of clientIds) {
      const file = await db.fileRec.findUnique({ where: { clientId } })
      if (!file || file.state === 'confirmed') continue
      await db.fileRec.update({ where: { clientId }, data: { state: 'confirmed' } })
      await db.auditLog.create({
        data: {
          actorRole: 'driver', actorName: file.eventClientId || undefined,
          object: 'file', objectId: file.id, field: 'state', was: file.state, became: 'confirmed',
        },
      })
      await recomputeDocs(file.ownerId)
    }
    return NextResponse.json({ ok: true, confirmed: clientIds.length })
  }

  if (action === 'lost') {
    const clientId = body.clientId as string
    const file = await db.fileRec.findUnique({ where: { clientId } })
    if (!file) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Файл не найден' } }, { status: 404 })
    await db.fileRec.update({ where: { clientId }, data: { state: 'lost' } })
    await recomputeDocs(file.ownerId)
    // B5.4: docs_lost -> немедленный красный бейдж
    await db.auditLog.create({
      data: { actorRole: 'system', object: 'file', objectId: file.id, field: 'state', was: file.state, became: 'lost' },
    })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: { code: 'VALIDATION', message: 'Неизвестное действие' } }, { status: 400 })
}
