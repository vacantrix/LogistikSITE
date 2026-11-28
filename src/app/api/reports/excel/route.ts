import { NextResponse, type NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { allowedFor, permDenied } from '@/lib/permissions'
import { REQUEST_STATUS_META, requestGroupOf, type RequestGroup } from '@/lib/status'
import { plog } from '@/lib/platform-log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * «Скачать Excel» в разделе «Отчёты»: книга с исходными данными и методикой,
 * из которых собираются готовые отчёты DOCX. Один лист — один шаг алгоритма:
 * заявки → ставки → рейсы → экономия → сводные по перевозчикам и направлениям →
 * документы. Лист «Методика» описывает формулы и отборы, чтобы бухгалтерия и
 * руководство видели, откуда взялась каждая цифра.
 *
 * Период — по дате погрузки (как в отчётах каталога); если дата погрузки
 * не распознана, используется дата создания заявки. Удалённые заявки исключены.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })

const money = (v: number | null | undefined): number => Math.round(Number(v ?? 0))
const loadIso = (s: string): string | null => {
  const m = s.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}
const isoOf = (d: Date): string => {
  const p = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
const ruDay = (iso: string): string => {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}
const ruDateTime = (d: Date): string =>
  d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const GROUP_LABEL: Record<RequestGroup, string> = {
  draft: 'Черновик', new: 'Новая', working: 'В работе', done: 'Завершена', deleted: 'Удалена',
}
const TRANSPORT_LABEL: Record<string, string> = { OWNED: 'Собственный', HIRED: 'Наёмный', LEASE: 'Лизинг' }
const DOC_STATUS_LABEL: Record<string, string> = {
  PENDING: 'На проверке', PASSED: 'Принят', REUPLOAD: 'Перезагрузить', REJECTED: 'Отказ', MANUAL: 'Ручная проверка',
}

type Row = (string | number | null)[]

/** Лист из массива строк: ширины колонок, автофильтр по шапке (если нужно) */
function sheetOf(rows: Row[], widths?: number[], headerRow = 0): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  if (widths) ws['!cols'] = widths.map((wch) => ({ wch }))
  if (rows.length > headerRow + 1) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { c: 0, r: headerRow }, e: { c: Math.max(0, (rows[headerRow]?.length ?? 1) - 1), r: Math.max(headerRow, rows.length - 1) } }),
    }
  }
  return ws
}

export async function GET(request: NextRequest) {
  const auth = await requireUser('admin', 'logist')
  if (auth instanceof NextResponse) return auth
  if (!(await allowedFor(auth, 'reports:view'))) {
    // в журнал: попытка выгрузки отчёта без права «Отчёты»
    await plog({
      level: 'WARN', type: 'REPORT_EXPORTED_DENIED', source: 'api/reports/excel',
      actor: { login: auth.login, name: auth.name, role: auth.role },
      message: 'Отказ в выгрузке Excel-отчёта: нет права на раздел «Отчёты»',
      meta: { format: 'excel', reason: 'reports:view' },
    })
    return NextResponse.json({ error: permDenied('reports:view') }, { status: 403 })
  }

  const sp = request.nextUrl.searchParams
  const today = isoOf(new Date())
  const from = sp.get('from') ?? `${today.slice(0, 7)}-01`
  const to = sp.get('to') ?? today
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) {
    return NextResponse.json({ error: 'Дата начала и конца периода — в формате ГГГГ-ММ-ДД' }, { status: 400 })
  }
  const lo = from <= to ? from : to
  const hi = from <= to ? to : from

  const [requests, carriers, drivers, trucks, trailers] = await Promise.all([
    db.request.findMany({
      where: { status: { not: 'DELETED' } },
      include: {
        winner: { select: { id: true, name: true, inn: true, kpp: true, contractNo: true, contractDate: true, role: true } },
        bids: { include: { carrier: { select: { id: true, name: true } } }, orderBy: { amount: 'asc' } },
        documents: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.carrier.findMany({ orderBy: { name: 'asc' } }),
    db.driver.findMany({ include: { carrier: { select: { name: true } } }, orderBy: { fullName: 'asc' } }),
    db.truck.findMany({ include: { carrier: { select: { name: true } } }, orderBy: { plate: 'asc' } }),
    db.trailer.findMany({ include: { carrier: { select: { name: true } } }, orderBy: { plate: 'asc' } }),
  ])

  const driverMap = new Map(drivers.map((d) => [d.id, d]))
  const truckMap = new Map(trucks.map((t) => [t.id, t]))
  const trailerMap = new Map(trailers.map((t) => [t.id, t]))

  const dayOf = (r: (typeof requests)[number]): string => loadIso(r.loadDate) ?? isoOf(r.createdAt)
  const inPeriod = (r: (typeof requests)[number]): boolean => { const d = dayOf(r); return d >= lo && d <= hi }
  const rateOf = (r: (typeof requests)[number]): number => r.bestRate ?? r.startRate
  const amountOf = (r: (typeof requests)[number]): number => rateOf(r) * r.tonnage
  const savingOf = (r: (typeof requests)[number]): number => Math.max(0, r.startRate - rateOf(r)) * r.tonnage
  const isDone = (r: (typeof requests)[number]): boolean => (r.status === 'CONFIRMED' || r.status === 'CLOSED') && r.winnerId != null
  const statusLabel = (s: string): string => REQUEST_STATUS_META[s as keyof typeof REQUEST_STATUS_META]?.label ?? s

  const periodRequests = requests.filter(inPeriod)
  const doneTrips = periodRequests.filter(isDone)
  const activeRequests = periodRequests.filter((r) => ['PUBLISHED', 'AWARDED', 'DOCS_REVIEW', 'AT_LOGIST'].includes(r.status))
  const docs = periodRequests.flatMap((r) => r.documents.map((d) => ({ r, d })))
  const checkedDocs = docs.filter((x) => x.d.status !== 'PENDING')
  const passedDocs = checkedDocs.filter((x) => x.d.status === 'PASSED')

  const savedTotal = doneTrips.reduce((s, r) => s + savingOf(r), 0)
  const startTotal = doneTrips.reduce((s, r) => s + r.startRate * r.tonnage, 0)
  const finalTotal = doneTrips.reduce((s, r) => s + amountOf(r), 0)
  const tonnageDone = doneTrips.reduce((s, r) => s + r.tonnage, 0)
  const tonnageAll = periodRequests.reduce((s, r) => s + r.tonnage, 0)
  const bidsCount = periodRequests.reduce((s, r) => s + r.bids.length, 0)
  const requestsWithBids = periodRequests.filter((r) => r.bids.length > 0).length

  const wb = XLSX.utils.book_new()

  /* ── 1. О книге ─────────────────────────────────────────────────────── */
  const about: Row[] = [
    ['Книга отчётов АЭМЗ', ''],
    ['Период', `${ruDay(lo)} — ${ruDay(hi)}`],
    ['Сформировано', ruDateTime(new Date())],
    ['Источник данных', 'Заявки, ставки, рейсы, документы и справочники демо-платформы АЭМЗ'],
    ['', ''],
    ['Лист', 'Что внутри и как считается'],
    ['Сводка', 'Ключевые показатели периода: заявки, рейсы, тоннаж, оборот, экономия'],
    ['Заявки', 'Все заявки периода с маршрутом, грузом, ставками и перевозчиком'],
    ['Ставки', 'Каждая ставка перевозчика — из этих строк собираются итоговые ставки'],
    ['Рейсы', 'Выполненные и выполняющиеся рейсы: экипаж, техника, сумма'],
    ['Экономия', 'Построчный расчёт: (стартовая − итоговая ставка) × тоннаж'],
    ['Перевозчики', 'Оборот, рейсы, средняя ставка, доля и участие в торгах'],
    ['Направления', 'Спрос и ставки по маршрутам «откуда → куда»'],
    ['Документы', 'Проверка документов по заявкам и доля автоматических решений'],
    ['Методика', 'Отборы, формулы и соответствие листов готовым отчётам каталога'],
    ['Справочники', 'Перевозчики, водители и техника, участвующие в перевозках'],
    ['', ''],
    ['Как читать', 'Листы «Заявки», «Ставки», «Документы» — исходные данные. Листы «Рейсы», «Экономия», «Перевозчики», «Направления» и «Сводка» — те же данные после отбора и агрегации, то есть ровно то, из чего формируются DOCX-отчёты.'],
  ]
  XLSX.utils.book_append_sheet(wb, sheetOf(about, [34, 96], 5), 'О книге')

  /* ── 2. Сводка ──────────────────────────────────────────────────────── */
  const statusCounts = new Map<string, number>()
  for (const r of periodRequests) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1)
  const summary: Row[] = [
    ['Показатель', 'Значение', 'Как считается'],
    ['Период', `${ruDay(lo)} — ${ruDay(hi)}`, 'По дате погрузки; если её нет — по дате создания заявки'],
    ['Заявок за период', periodRequests.length, 'Все заявки периода без удалённых'],
    ['Из них на площадке и в работе', activeRequests.length, 'Статусы: На площадке, Перевозчик выбран, Документы проверяются, У логиста — сверка'],
    ['Рейсов выполнено и выполняется', doneTrips.length, 'Статусы: Рейс выполняется и Рейс закрыт, перевозчик выбран'],
    ['Тоннаж всех заявок, т', tonnageAll, 'Сумма тоннажа заявок периода'],
    ['Тоннаж рейсов, т', tonnageDone, 'Сумма тоннажа выполненных и выполняющихся рейсов'],
    ['Оборот рейсов, ₽', money(finalTotal), 'Σ (итоговая ставка × тоннаж)'],
    ['Стартовая стоимость рейсов, ₽', money(startTotal), 'Σ (стартовая ставка × тоннаж)'],
    ['Экономия на торгах, ₽', money(savedTotal), 'Σ max(0, стартовая − итоговая) × тоннаж'],
    ['Средняя экономия на рейс, ₽', doneTrips.length ? money(savedTotal / doneTrips.length) : 0, 'Экономия / число рейсов'],
    ['Снижение ставок, %', startTotal > 0 ? nf2.format((savedTotal / startTotal) * 100) : '0', 'Экономия / стартовая стоимость × 100'],
    ['Средняя итоговая ставка, ₽/т', doneTrips.length ? money(finalTotal / tonnageDone || 0) : 0, 'Оборот / тоннаж рейсов'],
    ['Ставок подано', bidsCount, 'Все ставки по заявкам периода, включая отозванные'],
    ['Среднее ставок на заявку с откликами', requestsWithBids ? nf2.format(bidsCount / requestsWithBids) : '0', 'Ставки / заявки, у которых есть хотя бы одна ставка'],
    ['Документов проверено', checkedDocs.length, 'Все документы заявок периода, кроме «На проверке»'],
    ['Принято автоматически, %', checkedDocs.length ? nf2.format((passedDocs.length / checkedDocs.length) * 100) : '0', 'Принятые / проверенные документы × 100'],
    ['', '', ''],
    ['Статус заявки', 'Заявок', ''],
    ...(['DRAFT', 'PUBLISHED', 'AWARDED', 'DOCS_REVIEW', 'AT_LOGIST', 'CONFIRMED', 'CLOSED'] as const).map((s) => [statusLabel(s), statusCounts.get(s) ?? 0, ''] as Row),
  ]
  XLSX.utils.book_append_sheet(wb, sheetOf(summary, [40, 22, 74], 0), 'Сводка')

  /* ── 3. Заявки ──────────────────────────────────────────────────────── */
  const reqRows: Row[] = [[
    '№ заявки', 'Создана', 'Погрузка', 'Статус', 'Группа', 'Откуда', 'Куда', 'Груз',
    'Тоннаж, т', 'Тип ТС', 'Режим', 'Стартовая ставка, ₽/т', 'Итоговая ставка, ₽/т',
    'Экономия, ₽', 'Перевозчик', 'Ставок', 'Режим победителя',
  ]]
  for (const r of periodRequests) {
    reqRows.push([
      r.number, ruDateTime(r.createdAt), r.loadDate, statusLabel(r.status), GROUP_LABEL[requestGroupOf(r.status)],
      r.fromPoint, r.toPoint, r.cargo, r.tonnage, r.truckType, r.mode === 'AUCTION' ? 'Торги на понижение' : 'Закрытые ставки',
      money(r.startRate), money(rateOf(r)), money(savingOf(r)), r.winner?.name ?? '—', r.bids.length,
      r.bestRate != null ? 'Итоговая ставка' : 'Стартовая ставка',
    ])
  }
  XLSX.utils.book_append_sheet(wb, sheetOf(reqRows, [12, 18, 12, 26, 14, 38, 34, 34, 10, 11, 20, 16, 16, 14, 30, 8, 20]), 'Заявки')

  /* ── 4. Ставки ──────────────────────────────────────────────────────── */
  const bidRows: Row[] = [[
    '№ заявки', 'Дата ставки', 'Перевозчик', 'Ставка, ₽/т', 'Статус ставки',
    'Отклонение от стартовой, %', 'Стартовая ставка, ₽/т', 'Лучшая ставка заявки, ₽/т',
  ]]
  for (const r of periodRequests) {
    for (const b of r.bids) {
      const delta = r.startRate > 0 ? ((r.startRate - b.amount) / r.startRate) * 100 : 0
      bidRows.push([
        r.number, ruDateTime(b.createdAt), b.carrier.name, money(b.amount),
        b.withdrawn ? 'Отозвана' : b.isWinner ? 'Победитель' : 'Участник',
        nf2.format(delta), money(r.startRate), money(rateOf(r)),
      ])
    }
  }
  if (bidRows.length === 1) bidRows.push(['—', '', 'За период ставок нет', '', '', '', '', ''])
  XLSX.utils.book_append_sheet(wb, sheetOf(bidRows, [12, 18, 32, 14, 16, 24, 18, 22]), 'Ставки')

  /* ── 5. Рейсы ───────────────────────────────────────────────────────── */
  const tripRows: Row[] = [[
    '№ рейса', 'Статус', 'Погрузка', 'Маршрут', 'Перевозчик', 'Водитель', 'Телефон водителя',
    'ТС', 'Прицеп', 'Тоннаж, т', 'Ставка, ₽/т', 'Сумма, ₽', 'Пропуск', 'Документы',
    'Принадлежность транспорта', 'Исполнитель',
  ]]
  for (const r of doneTrips) {
    const driver = r.driverId ? driverMap.get(r.driverId) : undefined
    const truck = r.truckId ? truckMap.get(r.truckId) : undefined
    const trailer = r.trailerId ? trailerMap.get(r.trailerId) : undefined
    tripRows.push([
      r.number, statusLabel(r.status), r.loadDate, `${r.fromPoint} → ${r.toPoint}`, r.winner?.name ?? '—',
      driver?.fullName ?? '—', driver?.phone ?? '—',
      truck ? `${truck.brand} · ${truck.plate}` : '—', trailer?.plate ?? '—',
      r.tonnage, money(rateOf(r)), money(amountOf(r)),
      r.passPackage ? 'Оформлен' : 'Не оформлен',
      ['AT_LOGIST', 'CONFIRMED', 'CLOSED'].includes(r.status) ? 'Проверены' : 'На проверке',
      TRANSPORT_LABEL[r.transportOwnership] ?? r.transportOwnership,
      r.executorRole === 'FORWARDER' ? 'Экспедитор' : 'Перевозчик',
    ])
  }
  XLSX.utils.book_append_sheet(wb, sheetOf(tripRows, [12, 24, 12, 56, 30, 30, 18, 30, 12, 10, 13, 14, 12, 14, 22, 14]), 'Рейсы')

  /* ── 6. Экономия ────────────────────────────────────────────────────── */
  const saveRows: Row[] = [[
    '№ заявки', 'Погрузка', 'Маршрут', 'Груз', 'Тоннаж, т', 'Стартовая ставка, ₽/т',
    'Итоговая ставка, ₽/т', 'Снижение ставки, ₽/т', 'Снижение, %', 'Экономия, ₽', 'Расчёт',
  ]]
  for (const r of doneTrips) {
    const best = rateOf(r)
    const delta = Math.max(0, r.startRate - best)
    const save = delta * r.tonnage
    saveRows.push([
      r.number, r.loadDate, `${r.fromPoint} → ${r.toPoint}`, r.cargo, r.tonnage,
      money(r.startRate), money(best), money(delta), nf2.format(r.startRate > 0 ? (delta / r.startRate) * 100 : 0),
      money(save), `(${money(r.startRate)} − ${money(best)}) × ${r.tonnage} т = ${nf0.format(money(save))} ₽`,
    ])
  }
  saveRows.push([])
  saveRows.push(['Итого', '', '', '', tonnageDone, '', '', '', '', money(savedTotal), `Средняя экономия на рейс: ${nf0.format(doneTrips.length ? money(savedTotal / doneTrips.length) : 0)} ₽`])
  XLSX.utils.book_append_sheet(wb, sheetOf(saveRows, [12, 12, 56, 34, 10, 18, 18, 18, 12, 16, 52], 0), 'Экономия')

  /* ── 7. Перевозчики ─────────────────────────────────────────────────── */
  const perCarrier = new Map<string, { trips: number; tonnage: number; turnover: number; rates: number; bids: number; wins: number }>()
  for (const c of carriers) perCarrier.set(c.name, { trips: 0, tonnage: 0, turnover: 0, rates: 0, bids: 0, wins: 0 })
  for (const r of doneTrips) {
    if (!r.winner) continue
    const cur = perCarrier.get(r.winner.name) ?? { trips: 0, tonnage: 0, turnover: 0, rates: 0, bids: 0, wins: 0 }
    cur.trips += 1
    cur.tonnage += r.tonnage
    cur.turnover += amountOf(r)
    cur.rates += rateOf(r)
    perCarrier.set(r.winner.name, cur)
  }
  for (const r of periodRequests) {
    for (const b of r.bids) {
      const name = b.carrier.name
      const cur = perCarrier.get(name) ?? { trips: 0, tonnage: 0, turnover: 0, rates: 0, bids: 0, wins: 0 }
      cur.bids += 1
      if (b.isWinner) cur.wins += 1
      perCarrier.set(name, cur)
    }
  }
  const turnoverTotal = [...perCarrier.values()].reduce((s, v) => s + v.turnover, 0)
  const carrierRows: Row[] = [[
    'Перевозчик', 'ИНН', 'КПП', 'Договор', 'Рейсов', 'Тоннаж, т', 'Оборот, ₽',
    'Средняя ставка, ₽/т', 'Доля оборота, %', 'Ставок подано', 'Побед в торгах',
  ]]
  for (const c of carriers) {
    const v = perCarrier.get(c.name)
    if (!v) continue
    carrierRows.push([
      c.name, c.inn, c.kpp || '—', c.contractNo ? `№ ${c.contractNo} от ${c.contractDate}` : '—',
      v.trips, v.tonnage, money(v.turnover), v.trips ? money(v.rates / v.trips) : 0,
      turnoverTotal > 0 ? nf2.format((v.turnover / turnoverTotal) * 100) : '0', v.bids, v.wins,
    ])
  }
  XLSX.utils.book_append_sheet(wb, sheetOf(carrierRows, [34, 14, 12, 24, 9, 11, 16, 18, 15, 13, 14]), 'Перевозчики')

  /* ── 8. Направления ─────────────────────────────────────────────────── */
  const dirs = new Map<string, { trips: number; tonnage: number; rateSum: number; min: number; savings: number }>()
  for (const r of periodRequests) {
    if (!['PUBLISHED', 'AWARDED', 'DOCS_REVIEW', 'AT_LOGIST', 'CONFIRMED', 'CLOSED'].includes(r.status)) continue
    const key = `${r.fromPoint} → ${r.toPoint}`
    const cur = dirs.get(key) ?? { trips: 0, tonnage: 0, rateSum: 0, min: Infinity, savings: 0 }
    cur.trips += 1
    cur.tonnage += r.tonnage
    cur.rateSum += rateOf(r)
    cur.min = Math.min(cur.min, rateOf(r))
    cur.savings += savingOf(r)
    dirs.set(key, cur)
  }
  const dirRows: Row[] = [['Направление', 'Заявок', 'Тоннаж, т', 'Средняя ставка, ₽/т', 'Минимальная ставка, ₽/т', 'Экономия, ₽']]
  for (const [dir, v] of [...dirs.entries()].sort((a, b) => b[1].trips - a[1].trips)) {
    dirRows.push([dir, v.trips, v.tonnage, money(v.rateSum / v.trips), money(v.min), money(v.savings)])
  }
  XLSX.utils.book_append_sheet(wb, sheetOf(dirRows, [64, 9, 11, 18, 22, 15]), 'Направления')

  /* ── 9. Документы ───────────────────────────────────────────────────── */
  const docRows: Row[] = [['№ заявки', 'Рейс', 'Тип документа', 'Файл', 'Статус', 'Проверен', 'Сообщение']]
  for (const { r, d } of docs) {
    docRows.push([
      r.number, statusLabel(r.status), d.type, d.fileName, DOC_STATUS_LABEL[d.status] ?? d.status,
      d.status === 'PENDING' ? '—' : ruDateTime(d.updatedAt), d.message ?? '',
    ])
  }
  docRows.push([])
  docRows.push(['Итого документов', docs.length, 'Проверено', checkedDocs.length, 'Принято', passedDocs.length, ''])
  XLSX.utils.book_append_sheet(wb, sheetOf(docRows, [12, 24, 26, 40, 16, 18, 48], 0), 'Документы')

  /* ── 10. Методика ───────────────────────────────────────────────────── */
  const method: Row[] = [
    ['Раздел', 'Правило или формула'],
    ['Период', 'Период задаётся датами включительно. Рейс попадает в период по дате погрузки; если дату погрузки не удалось разобрать — по дате создания заявки.'],
    ['Заявки', 'В лист «Заявки» попадают все заявки периода, кроме удалённых. Статусы: Черновик, На площадке, Перевозчик выбран, Документы проверяются, У логиста — сверка, Рейс выполняется, Рейс закрыт.'],
    ['Рейсы', 'Рейс — заявка со статусом «Рейс выполняется» или «Рейс закрыт», у которой выбран перевозчик. Только такие рейсы дают оборот и экономию.'],
    ['Сумма рейса', 'Итоговая ставка × тоннаж. Если итоговая ставка не задана, берётся стартовая.'],
    ['Экономия', 'max(0, стартовая ставка − итоговая ставка) × тоннаж. Ставки в платформе — за тонну, поэтому разница ставок умножается на тоннаж.'],
    ['Снижение, %', '(стартовая − итоговая) / стартовая × 100. Показывается по каждой заявке и в целом по периоду.'],
    ['Средняя ставка', 'Сумма итоговых ставок рейсов / число рейсов. Средняя ставка по направлению — так же по заявкам направления.'],
    ['Оборот', 'Σ (итоговая ставка × тоннаж) по рейсам периода.'],
    ['Доля перевозчика', 'Оборот перевозчика / общий оборот рейсов периода × 100.'],
    ['Ставки', 'Каждая строка листа «Ставки» — одна ставка перевозчика. Победитель — ставка с isWinner; отозванные ставки не участвуют в выборе, но видны в истории.'],
    ['Документы', 'Доля автоматических решений = документы со статусом «Принят» / все проверенные документы (без «На проверке») × 100.'],
    ['', ''],
    ['Готовый отчёт каталога', 'Из каких листов собирается'],
    ['АЭМЗ-Р-1 «Реестр рейсов к оплате»', 'Лист «Рейсы»: отбор по периоду, закрытые или закрытые и выполняющиеся рейсы, группировка по перевозчику, колонки и НДС из настроек отчёта.'],
    ['АЭМЗ-Р-2 «Реестр документов рейсов»', 'Лист «Документы»: строки по документам рейсов, фильтр «подписаны / ещё не подписаны», подписи сторон и этап документа.'],
    ['АЭМЗ-У-1 «Сводка для руководства»', 'Лист «Сводка» плюс агрегаты листов «Рейсы», «Перевозчики», «Направления»; сравнение с прошлым периодом считается по тем же формулам за предыдущий диапазон.'],
    ['АЭМЗ-У-2 «Экономия на торгах»', 'Лист «Экономия»: построчный расчёт и итоги; группировка по направлению, перевозчику или без групп.'],
    ['АЭМЗ-У-3 «Перевозчики»', 'Лист «Перевозчики»: рейсы, тоннаж, оборот, доля, средняя ставка, ставки и победы.'],
    ['АЭМЗ-У-4 «Ставки по направлениям»', 'Лист «Направления»: средняя и минимальная ставка, количество заявок; динамика по месяцам — те же формулы в разрезе месяца погрузки.'],
    ['', ''],
    ['Проверка сходимости', 'Сумма экономии по строкам листа «Экономия» равна показателю «Экономия на торгах» в листе «Сводка». Сумма оборотов перевозчиков равна «Обороту рейсов». Тоннаж рейсов в «Сводке» равен сумме тоннажа листа «Рейсы».'],
  ]
  XLSX.utils.book_append_sheet(wb, sheetOf(method, [46, 120], 0), 'Методика')

  /* ── 11. Справочники ────────────────────────────────────────────────── */
  const dirRows2: Row[] = [
    ['Перевозчики', '', '', '', ''],
    ['Название', 'ИНН', 'КПП', 'Роль', 'Договор'],
    ...carriers.map((c) => [c.name, c.inn, c.kpp || '—', c.role === 'FORWARDER' ? 'Экспедитор' : 'Перевозчик', c.contractNo ? `№ ${c.contractNo} от ${c.contractDate}` : '—'] as Row),
    ['', '', '', '', ''],
    ['Водители', '', '', '', ''],
    ['ФИО', 'Перевозчик', 'Телефон', 'Вид занятости', 'Владелец'],
    ...drivers.map((d) => [d.fullName, d.carrier.name, d.phone || '—', TRANSPORT_LABEL[d.ownershipType] ?? d.ownershipType, d.ownerName || '—'] as Row),
    ['', '', '', '', ''],
    ['Техника', '', '', '', ''],
    ['Марка и госномер', 'Перевозчик', 'Прицеп', 'Вид занятости', 'Владелец'],
    ...trucks.map((t) => {
      const tr = trailers.find((x) => x.carrierId === t.carrierId)
      return [ `${t.brand} · ${t.plate}`, t.carrier.name, tr?.plate ?? '—', TRANSPORT_LABEL[t.ownershipType] ?? t.ownershipType, t.owner || '—'] as Row
    }),
  ]
  XLSX.utils.book_append_sheet(wb, sheetOf(dirRows2, [40, 30, 22, 22, 30], 1), 'Справочники')

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer
  const fileName = `АЭМЗ_отчёты_${lo}_${hi}.xlsx`
  // в журнал: выгружена книга Excel с параметрами отчёта
  await plog({
    type: 'REPORT_EXPORTED', source: 'api/reports/excel',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    message: `Выгружен Excel-отчёт за период ${ruDay(lo)} — ${ruDay(hi)} (заявок: ${periodRequests.length}, рейсов: ${doneTrips.length})`,
    meta: {
      format: 'excel',
      from: lo,
      to: hi,
      requests: periodRequests.length,
      trips: doneTrips.length,
      carriers: carriers.length,
      fileName,
    },
  })
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="aemz-reports-${lo}_${hi}.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'no-store',
    },
  })
}
