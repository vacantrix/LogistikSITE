/**
 * Приведение старых данных к справочникам — при старте сервера (instrumentation.ts).
 * Идемпотентно: повторный запуск ничего не меняет.
 *  — точки маршрута «Завод», «Порт», «Склад», «Новороссийск (порт)» → города
 *    справочника точек («Абинск», «Санкт-Петербург», …);
 *  — груз без ссылки на справочник получает её, если название однозначно
 *    узнаётся (например, «металлолом» → «Перевозка металлолома»);
 *  — старые тексты событий и уведомлений про передачу данных в 1С — к единым
 *    формулировкам «рейс выполняется» / Диадок (интеграция с 1С пока не используется);
 *  — «АО «АЭМЗ»» в реквизитах документов ЭДО → «ООО «АЭМЗ»»; поручение экспедитору — номер ПОР-…;
 *  — дубли документов ЭДО одного вида по рейсу (одновременный добор) — лишние
 *    копии удаляются, остаётся самая ранняя (отправленные в Диадок не трогаем).
 */
import { db } from '@/lib/db'
import { canonicalPoint } from '@/lib/points'

export async function normalizeLegacyData(): Promise<void> {
  const requests = await db.request.findMany({
    select: { id: true, fromPoint: true, toPoint: true, cargo: true, cargoTypeId: true },
  })
  const cargoTypes = await db.cargoType.findMany({ select: { id: true, name: true } })
  // ключ груза — последнее слово названия без окончаний: «металлолома» и «металлолом» совпадут
  const stem = (v: string) => v.toLowerCase().replace(/[^а-яё ]/g, ' ').trim().split(/\s+/).pop()?.slice(0, 7) ?? ''

  let points = 0
  let cargo = 0
  for (const r of requests) {
    const data: { fromPoint?: string; toPoint?: string; cargo?: string; cargoTypeId?: string } = {}
    const from = canonicalPoint(r.fromPoint)
    const to = canonicalPoint(r.toPoint)
    if (from && from !== r.fromPoint) data.fromPoint = from
    if (to && to !== r.toPoint) data.toPoint = to
    if (!r.cargoTypeId) {
      const key = stem(r.cargo)
      const hits = key ? cargoTypes.filter((c) => stem(c.name) === key) : []
      if (hits.length === 1) {
        data.cargoTypeId = hits[0].id
        data.cargo = hits[0].name
      }
    }
    if (Object.keys(data).length === 0) continue
    await db.request.update({ where: { id: r.id }, data })
    if (data.fromPoint || data.toPoint) points++
    if (data.cargoTypeId) cargo++
  }
  const has1c = [{ message: { contains: '1C' } }, { message: { contains: '1С' } }]
  const events = await db.event.updateMany({
    where: { type: 'CONFIRMED_1C', OR: has1c },
    data: { message: 'Документы сверены и подтверждены — рейс выполняется' },
  })
  const etrn = await db.event.updateMany({
    where: { type: 'ETRN_SENT', message: { contains: 'Логистика.Про' } },
    data: { message: 'Транспортная накладная подготовлена — отправка в Диадок в разделе «Подписать ЭДО»' },
  })
  const notes = await db.notification.updateMany({
    where: { type: 'DOCS_CONFIRMED', body: { contains: '1С' } },
    data: { body: 'Логист сверил пакет — рейс выполняется: пропуск готовится, ЭТрН придёт на подпись в Диадок' },
  })
  const org = await db.$executeRaw`UPDATE "EdoDocument" SET payload = REPLACE(payload, 'АО «АЭМЗ»', 'ООО «АЭМЗ»') WHERE payload LIKE '%АО «АЭМЗ»%'`
  // поручение экспедитору нумеруется ПОР-…, а не ЗАК-… (как заказ-заявка перевозчику)
  const orderNo = await db.$executeRaw`UPDATE "EdoDocument" SET number = 'ПОР-' || SUBSTR(number, 5) WHERE kind = 'ORDER' AND party = 'EXPEDITOR' AND number LIKE 'ЗАК-%'`
  const texts = events.count + etrn.count + notes.count + org + orderNo

  const edoDocs = await db.edoDocument.findMany({
    select: { id: true, requestId: true, kind: true, aemzSigned: true, partySigned: true, diadocMessageId: true },
    orderBy: { createdAt: 'asc' },
  })
  const seen = new Set<string>()
  const dupes: string[] = []
  for (const d of edoDocs) {
    const key = `${d.requestId}:${d.kind}`
    if (!seen.has(key)) { seen.add(key); continue }
    // договорной документ (ORDER) платформа добирает сама, в том числе сразу подписанным
    // у закрытых рейсов, — его копии лишние всегда; прочие — только неподписанные
    if (!d.diadocMessageId && (d.kind === 'ORDER' || (!d.aemzSigned && !d.partySigned))) dupes.push(d.id)
  }
  if (dupes.length) {
    await db.edoDocument.deleteMany({ where: { id: { in: dupes } } })
    console.log(`[data-fixes] удалены дубли документов ЭДО: ${dupes.length}`)
  }
  if (points || cargo || texts) {
    console.log(`[data-fixes] точки маршрута приведены к городам: ${points}, груз связан со справочником: ${cargo}, тексты про 1С обновлены: ${texts}`)
  }
}
