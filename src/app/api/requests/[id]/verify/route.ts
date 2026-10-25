import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, viewerOf } from '@/lib/auth'
import { toRequestDTO } from '@/lib/serialize'
import { notifyLive } from '@/lib/notify'
import { notifyCarrier, notifyLogists } from '@/lib/notify-users'
import { inTx, loadRequestFor } from '@/lib/requests'
import { loadVerifySettings } from '@/lib/settings'
import { plog, plogError } from '@/lib/platform-log'
import { verifyDocument, expectedFor, OcrUnavailableError } from '@/lib/verify'
import type { DocType, VerifyVerdict } from '@/lib/verify'

export const dynamic = 'force-dynamic'
// документы распознаются по одному (5–40 с каждый): комплект из 6–10 файлов — несколько минут
export const maxDuration = 600

/** Комплект рейса: паспорт, регистрация, СТС, заявка, доверенность */
const ALL_TYPES: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'STS', 'REQUEST_DOC', 'POA']

/**
 * POST /api/requests/[id]/verify — проверка загруженных документов.
 * Пайплайн: качество → тип → распознавание (локальный OCR) → сверка → правила.
 * Итог по каждому документу: PASSED | REUPLOAD | REJECTED | MANUAL.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const viewer = viewerOf(auth)
  const { id } = await params

  const request = await db.request.findUnique({
    where: { id },
    include: { winner: { select: { name: true } } },
  })
  if (!request) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
  if (auth.role === 'carrier' && request.winnerId !== auth.carrierId) {
    return NextResponse.json({ error: 'Проверку запускает перевозчик, за которым закреплён рейс' }, { status: 403 })
  }

  const respond = async () => {
    const fresh = await loadRequestFor(id, viewer)
    return NextResponse.json({ request: fresh ? toRequestDTO(fresh, viewer) : null })
  }

  // проверяем, только пока заявка у агента; на других этапах — вернуть текущее состояние
  if (request.status !== 'AWARDED' && request.status !== 'DOCS_REVIEW') return respond()

  const pending = await db.document.findMany({
    where: { requestId: id, status: 'PENDING' },
    select: { id: true, type: true, fileName: true, dataUri: true },
  })
  if (pending.length === 0) return respond()

  const [driver, truck] = await Promise.all([
    request.driverId ? db.driver.findUnique({ where: { id: request.driverId } }) : null,
    request.truckId ? db.truck.findUnique({ where: { id: request.truckId } }) : null,
  ])
  if (driver == null || truck == null) {
    return NextResponse.json({ error: 'Сначала укажите водителя и автомобиль — с ними сверяются документы' }, { status: 400 })
  }
  const settings = await loadVerifySettings()
  const expected = expectedFor(driver, truck, request)

  // распознавание идёт вне транзакции (долго); результат записывается, только если документ не заменили за это время.
  // Запросы к OCR-сервису выстраиваются в очередь (src/lib/ocr-service.ts) — документы распознаются по одному.
  const unavailable: string[] = []
  const verdicts: { id: string; v: VerifyVerdict }[] = await Promise.all(
    pending.map(async (doc) => {
      try {
        return { id: doc.id, v: await verifyDocument(doc.id, doc.type as DocType, doc.dataUri, expected, settings, doc.fileName) }
      } catch (e) {
        if (e instanceof OcrUnavailableError) {
          // сервис не ответил — это не повод для ручной сверки: документ остаётся «на проверке», проверку повторят
          unavailable.push(doc.fileName)
          const v: VerifyVerdict = {
            status: 'PENDING', quality: 0, engine: '—', fields: {}, confidences: {},
            issues: ['Сервис распознавания не ответил'],
            message: 'Распознавание не выполнено — сервис занят или недоступен. Повторите проверку через минуту',
          }
          return { id: doc.id, v }
        }
        console.error('verify doc error', doc.id, e)
        // журнал платформы (Task 76): сбой распознавания — ошибка в журнале
        await plogError('api/requests/verify', e, {
          type: 'OCR_FAILED', source: 'api/requests/verify',
          requestId: id, requestNumber: request.number, carrierName: request.winner?.name ?? null,
          message: `Не удалось распознать документ «${doc.fileName}» — №${request.number} (нужна ручная проверка)`,
        })
        const v: VerifyVerdict = {
          status: 'MANUAL', quality: 0, engine: '—', fields: {}, confidences: {},
          issues: ['Ошибка распознавания'], message: 'Ошибка распознавания — требуется ручная проверка',
        }
        return { id: doc.id, v }
      }
    }),
  )
  if (unavailable.length > 0) {
    await plogError('api/requests/verify', new OcrUnavailableError(), {
      type: 'OCR_FAILED', source: 'api/requests/verify',
      requestId: id, requestNumber: request.number, carrierName: request.winner?.name ?? null,
      message: `Сервис распознавания не ответил — документы остаются на проверке до повтора: ${unavailable.join(', ')} (№${request.number})`,
    })
  }

  await inTx(async (tx) => {
    for (const { id: docId, v } of verdicts) {
      await tx.document.updateMany({
        where: { id: docId, status: 'PENDING' },
        data: {
          status: v.status,
          quality: v.quality,
          engine: v.engine,
          fields: JSON.stringify(v.fields),
          confidence: JSON.stringify(v.confidences),
          issues: JSON.stringify(v.issues),
          message: v.message,
        },
      })
    }

    // пересчёт статуса заявки по комплекту
    const cur = await tx.request.findUnique({ where: { id }, select: { status: true } })
    if (!cur || (cur.status !== 'AWARDED' && cur.status !== 'DOCS_REVIEW')) return
    const docs = await tx.document.findMany({ where: { requestId: id }, select: { type: true, status: true, fileName: true } })
    const complete = ALL_TYPES.every((t) => docs.some((d) => d.type === t))
    const anyPending = docs.some((d) => d.status === 'PENDING')
    if (!complete || anyPending) {
      await tx.request.update({ where: { id }, data: { status: 'DOCS_REVIEW' } })
      return
    }
    const blocked = docs.filter((d) => d.status === 'REUPLOAD' || d.status === 'REJECTED')
    if (blocked.length > 0) {
      await tx.request.update({ where: { id }, data: { status: 'DOCS_REVIEW' } })
      await tx.event.create({
        data: { requestId: id, type: 'DOC_VERIFIED', message: `Проверка завершена: требуется исправление — ${blocked.map((d) => d.fileName).join(', ')}` },
      })
      // перевозчику — что именно нужно исправить (Task 69)
      await notifyCarrier(request.winnerId, {
        type: 'DOCS_RETURNED',
        title: `Автопроверка: нужны исправления · №${request.number}`,
        body: `Перезагрузите: ${blocked.map((d) => d.fileName).join(', ')}`,
        requestId: id,
      })
    } else {
      const passed = docs.filter((d) => d.status === 'PASSED').length
      const manual = docs.filter((d) => d.status === 'MANUAL').length
      // комплект обновился — прошлый комментарий логиста недействителен
      await tx.request.update({ where: { id }, data: { status: 'AT_LOGIST', verifyComment: null } })
      await tx.event.create({
        data: { requestId: id, type: 'DOC_VERIFIED', message: `Комплект прошёл проверку — передан логисту (принято автоматически: ${passed}, на ручной сверке: ${manual})` },
      })
      // логисту — пакет готов к сверке (Task 69)
      await notifyLogists({
        type: 'DOCS_READY',
        title: `Документы готовы к проверке · №${request.number}`,
        body: `${request.winner?.name ?? 'Перевозчик'}: комплект прошёл автопроверку — заявка в очереди «Проверка документов»`,
        requestId: id,
      })
    }
  })

  notifyLive({ type: 'DOCS_VERIFIED', requestId: id })
  // журнал событий платформы (Task 76): итог автопроверки комплекта
  const freshStatus = await db.request.findUnique({ where: { id }, select: { status: true } })
  await plog({
    type: 'DOCS_VERIFIED', source: 'api/requests/verify',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    requestId: id, requestNumber: request.number, carrierName: request.winner?.name ?? null,
    message: freshStatus?.status === 'AT_LOGIST'
      ? `Комплект документов прошёл автопроверку — передан логисту на сверку (№${request.number})`
      : unavailable.length > 0
        ? `Автопроверка не завершена: ${unavailable.length} док. ждут повторного распознавания (№${request.number})`
        : `Автопроверка выявила замечания — документы возвращены перевозчику (№${request.number})`,
  })
  return respond()
}
