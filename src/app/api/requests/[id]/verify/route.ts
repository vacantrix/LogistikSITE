import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toRequestDTO } from '@/lib/serialize'
import { verifyDocument, expectedFor } from '@/lib/verify'
import type { DocType } from '@/lib/verify'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/requests/[id]/verify — нейросеть проверяет документы.
 * Пайплайн: качество → тип → распознавание (VLM / фолбэк) → сверка → правила.
 * Итог по каждому документу: PASSED | REUPLOAD | REJECTED | MANUAL.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const request = await db.request.findUnique({
    where: { id },
    include: { documents: true, winner: true },
  })
  if (!request) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })

  const settingsRow = await db.setting.findUnique({ where: { id: 'main' } })
  const settings = {
    confReupload: settingsRow?.confReupload ?? 0.6,
    confAuto: settingsRow?.confAuto ?? 0.95,
    minQuality: settingsRow?.minQuality ?? 60,
  }

  const driver = request.driverId ? await db.driver.findUnique({ where: { id: request.driverId } }) : null
  const truck = request.truckId ? await db.truck.findUnique({ where: { id: request.truckId } }) : null
  const expected = expectedFor(driver, truck, { number: request.number, cargo: request.cargo })

  const pending = request.documents.filter((d) => d.status === 'PENDING')
  if (pending.length === 0) {
    // ничего нового — просто вернуть состояние
    const fresh = await db.request.findUnique({
      where: { id },
      include: { bids: { include: { carrier: true } }, documents: true, events: true, winner: true, cargoType: true },
    })
    return NextResponse.json({ request: toRequestDTO(fresh!) })
  }

  if (driver == null || truck == null) {
    return NextResponse.json({ error: 'Сначала укажите водителя и автомобиль — с ними сверяются документы' }, { status: 400 })
  }

  await db.request.update({ where: { id }, data: { status: request.status === 'AWARDED' ? 'DOCS_REVIEW' : request.status } })

  const results = await Promise.all(
    pending.map(async (doc) => {
      try {
        const verdict = await verifyDocument(doc.id, doc.type as DocType, doc.dataUri, expected, settings, doc.fileName)
        return db.document.update({
          where: { id: doc.id },
          data: {
            status: verdict.status,
            quality: verdict.quality,
            engine: verdict.engine,
            fields: JSON.stringify(verdict.fields),
            confidence: JSON.stringify(verdict.confidences),
            issues: JSON.stringify(verdict.issues),
            message: verdict.message,
          },
        })
      } catch (e) {
        console.error('verify doc error', doc.id, e)
        return db.document.update({
          where: { id: doc.id },
          data: { status: 'MANUAL', message: 'Ошибка распознавания — требуется ручная проверка', engine: '—', issues: JSON.stringify(['Ошибка распознавания']) },
        })
      }
    }),
  )

  // пересчёт статуса заявки по комплекту (6 документов: паспорт, регистрация, ВУ, СТС, заявка, доверенность)
  const allTypes: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'LICENSE', 'STS', 'REQUEST_DOC', 'POA']
  const docsAfter = await db.document.findMany({ where: { requestId: id } })
  const complete = allTypes.every((t) => docsAfter.some((d) => d.type === t))
  const anyPending = docsAfter.some((d) => d.status === 'PENDING')

  let newStatus: string | null = null
  if (complete && !anyPending) {
    const blocked = docsAfter.filter((d) => d.status === 'REUPLOAD' || d.status === 'REJECTED')
    if (blocked.length > 0) {
      newStatus = 'DOCS_REVIEW'
      await db.event.create({
        data: { requestId: id, type: 'DOC_VERIFIED', message: `Проверка завершена: требуется исправление — ${blocked.map((d) => d.fileName).join(', ')}` },
      })
    } else {
      newStatus = 'AT_LOGIST'
      const passed = docsAfter.filter((d) => d.status === 'PASSED').length
      const manual = docsAfter.filter((d) => d.status === 'MANUAL').length
      await db.event.create({
        data: { requestId: id, type: 'DOC_VERIFIED', message: `Комплект прошёл проверку — передан логисту (принято автоматически: ${passed}, на ручной сверке: ${manual})` },
      })
    }
    await db.request.update({ where: { id }, data: { status: newStatus } })
  }

  void results
  const fresh = await db.request.findUnique({
    where: { id },
    include: { bids: { include: { carrier: true } }, documents: true, events: true, winner: true, cargoType: true },
  })
  return NextResponse.json({ request: toRequestDTO(fresh!) })
}
