/**
 * Сборка отчётов раздела «Отчёты»: данные платформы → модель документа (ReportDoc).
 *
 * Модель общая для всех отчётов — заголовок, отбор, показатели, таблицы с группами и
 * итогами, диаграммы, выводы, сумма прописью, подписи; DOCX верстается по ней одним
 * кодом (reports/docx.ts). Даты — по МСК; рейс попадает в период по дате погрузки
 * или по дате создания заявки (настройка dateBasis). Сумма рейса — итоговая ставка × тоннаж
 * (ставки на площадке — за тонну).
 */
import { db } from '@/lib/db'
import { etrnStageLabel } from '@/lib/diadoc/stages'
import type { PieOptions } from '@/lib/pie-svg'
import { isoDay, mskDay, parseIsoDay, ruDay, type CalendarDay } from '@/lib/report-period'
import { GROUPING_LABEL, type ReportDef, type ReportPreview, type ReportSettings } from '@/lib/reports/catalog'
import { plural, rublesInWords } from '@/lib/reports/words'
import { monthLabel } from '@/lib/utils'

export type Align = 'left' | 'right' | 'center'
export interface DocColumn { label: string; weight: number; align?: Align }
export type DocRow =
  | { kind: 'data'; cells: string[] }
  | { kind: 'group'; text: string }
  /** итоговая строка: подпись занимает колонки до первой заполненной, values — по номеру колонки */
  | { kind: 'subtotal' | 'total'; label: string; values: Record<number, string> }
export interface DocTable { columns: DocColumn[]; rows: DocRow[] }
export type DocBlock =
  | { type: 'heading'; text: string }
  | { type: 'kpis'; items: { label: string; value: string; note?: string }[] }
  | { type: 'table'; table: DocTable }
  | { type: 'charts'; items: PieOptions[] }
  | { type: 'paragraphs'; items: string[] }
  | { type: 'words'; text: string }

export interface ReportDoc {
  def: ReportDef
  settings: ReportSettings
  number: string
  generatedAt: string
  title: string
  period: string
  filters: string[]
  blocks: DocBlock[]
  signers: { role: string; position: string; name: string }[]
  preview: ReportPreview
  fileName: string
  displayName: string
}

/* ── форматирование ─────────────────────────────────────────────────────── */

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nfT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const rub0 = (v: number): string => `${nf0.format(Math.round(v))} ₽`
const rub2 = (v: number): string => nf2.format(v)
const tons = (v: number): string => `${nfT.format(v)} т`
const rateTxt = (v: number): string => `${nf0.format(Math.round(v))} ₽/т`
const pct = (v: number): string => `${v.toFixed(1).replace('.', ',')} %`
const round2 = (v: number): number => Math.round(v * 100) / 100
const trips = (n: number): string => `${n} ${plural(n, ['рейс', 'рейса', 'рейсов'])}`

/** сравнение с прошлым периодом: «было 1» и процент, если он осмыслен (при малой базе «+1000 %» не показываем) */
function delta(cur: number, prev: number, fmt: (v: number) => string): string {
  if (prev === 0) return cur === 0 ? 'как в прошлом периоде' : 'в прошлом периоде — 0'
  const d = ((cur - prev) / prev) * 100
  if (Math.abs(d) < 0.05) return 'как в прошлом периоде'
  return Math.abs(d) <= 300 ? `было ${fmt(prev)}, ${d > 0 ? '+' : '−'}${pct(Math.abs(d))}` : `было ${fmt(prev)}`
}

/* ── данные ─────────────────────────────────────────────────────────────── */

async function loadRequests() {
  return db.request.findMany({
    where: { status: { not: 'DELETED' } },
    include: {
      winner: { select: { id: true, name: true, inn: true, kpp: true, contractNo: true, contractDate: true } },
      bids: { select: { carrierId: true, withdrawn: true } },
      edoDocuments: {
        select: {
          kind: true, number: true, aemzSigned: true, aemzSignedAt: true, partySigned: true, partySignedAt: true,
          diadocStage: true, diadocMessageId: true, etrnUid: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })
}
type Req = Awaited<ReturnType<typeof loadRequests>>[number]

/** «21.10.2026» → «2026-10-21» */
function loadIso(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}
const dayKey = (r: Req, basis: ReportSettings['dateBasis']): string =>
  (basis === 'load' ? loadIso(r.loadDate) : null) ?? isoDay(mskDay(r.createdAt))

const isDone = (r: Req): boolean => (r.status === 'CONFIRMED' || r.status === 'CLOSED') && r.winnerId != null
const rateOf = (r: Req): number => r.bestRate ?? r.startRate
const amountOf = (r: Req): number => round2(rateOf(r) * r.tonnage)
const savingOf = (r: Req): number => round2(Math.max(0, r.startRate - rateOf(r)) * r.tonnage)
const routeOf = (r: Req): string => `${r.fromPoint} → ${r.toPoint}`
const etrnOf = (r: Req) => r.edoDocuments.find((d) => d.kind === 'ETRN')

function etrnText(r: Req): string {
  const d = etrnOf(r)
  if (!d) return 'нет'
  if (d.aemzSigned && d.partySigned) return 'подписана'
  if (d.aemzSigned) return 'ждёт перевозчика'
  return 'на подписи'
}

interface Period { first: CalendarDay; last: CalendarDay; from: string; to: string; days: number }

function periodOf(s: ReportSettings): Period {
  const a = parseIsoDay(s.from) ?? mskDay(new Date())
  const b = parseIsoDay(s.to) ?? mskDay(new Date())
  const [first, last] = isoDay(a) <= isoDay(b) ? [a, b] : [b, a]
  const days = Math.round((Date.UTC(last.y, last.m - 1, last.d) - Date.UTC(first.y, first.m - 1, first.d)) / 86_400_000) + 1
  return { first, last, from: isoDay(first), to: isoDay(last), days }
}

/** такой же по длине период прямо перед выбранным */
function previousPeriod(p: Period): Period {
  const end = new Date(Date.UTC(p.first.y, p.first.m - 1, p.first.d) - 86_400_000)
  const start = new Date(end.getTime() - (p.days - 1) * 86_400_000)
  const day = (d: Date): CalendarDay => ({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() })
  const first = day(start)
  const last = day(end)
  return { first, last, from: isoDay(first), to: isoDay(last), days: p.days }
}

const inPeriod = (r: Req, p: Period, basis: ReportSettings['dateBasis']): boolean => {
  const k = dayKey(r, basis)
  return k >= p.from && k <= p.to
}

function periodText(p: Period, basis: ReportSettings['dateBasis']): string {
  const range = p.from === p.to ? `за ${ruDay(p.first)}` : `за период с ${ruDay(p.first)} по ${ruDay(p.last)}`
  return `${range} · по дате ${basis === 'load' ? 'погрузки' : 'создания заявки'}`
}

/** топ-N долек и «Прочие» для круговой диаграммы */
function pie(title: string, items: Map<string, number>, unit: string, centerHint: string, top = 6): PieOptions {
  const sorted = [...items.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const head = sorted.slice(0, top).map(([label, value]) => ({ label, value }))
  const rest = sorted.slice(top).reduce((s, [, v]) => s + v, 0)
  if (rest > 0) head.push({ label: `Прочие (${sorted.length - top})`, value: rest })
  return { title, slices: head, unit, centerHint }
}

function addTo(map: Map<string, number>, key: string, v: number): void {
  map.set(key, (map.get(key) ?? 0) + v)
}

/** колонки таблицы: выбранные в настройках + обязательные */
interface Col<T> { id: string; label: string; weight: number; align?: Align; value: (row: T, i: number) => string }
function pick<T>(all: Col<T>[], chosen: string[], always: string[]): Col<T>[] {
  return all.filter((c) => always.includes(c.id) || chosen.includes(c.id))
}
const columnsOf = <T>(cols: Col<T>[]): DocColumn[] => cols.map((c) => ({ label: c.label, weight: c.weight, align: c.align }))

/* ── отчёты ─────────────────────────────────────────────────────────────── */

interface Ctx {
  def: ReportDef
  s: ReportSettings
  p: Period
  reqs: Req[]
  carrierName: Map<string, string>
}

const byCarrierFilter = (s: ReportSettings) => (r: Req): boolean =>
  s.carrierIds.length === 0 || (r.winnerId != null && s.carrierIds.includes(r.winnerId))

function carriersFilterText(s: ReportSettings, names: Map<string, string>): string {
  if (s.carrierIds.length === 0) return 'Перевозчики: все'
  const list = s.carrierIds.map((id) => names.get(id) ?? '—')
  return `Перевозчики: ${list.slice(0, 5).join(', ')}${list.length > 5 ? ` и ещё ${list.length - 5}` : ''}`
}

interface Built { blocks: DocBlock[]; filters: string[]; preview: Omit<ReportPreview, 'periodLabel'> }

/** Реестр рейсов к оплате (бухгалтерия) */
async function tripsPayable({ s, p, reqs, carrierName }: Ctx): Promise<Built> {
  const rows = reqs
    .filter((r) => isDone(r) && (s.scope === 'done' || r.status === 'CLOSED'))
    .filter((r) => inPeriod(r, p, s.dateBasis))
    .filter(byCarrierFilter(s))

  // экипаж — только если выбрана колонка «Водитель и ТС»
  const crew = new Map<string, string>()
  if (s.columns.includes('crew') && rows.length) {
    const [drivers, trucks, trailers] = await Promise.all([
      db.driver.findMany({ where: { id: { in: rows.map((r) => r.driverId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } }),
      db.truck.findMany({ where: { id: { in: rows.map((r) => r.truckId).filter((x): x is string => !!x) } }, select: { id: true, plate: true } }),
      db.trailer.findMany({ where: { id: { in: rows.map((r) => r.trailerId).filter((x): x is string => !!x) } }, select: { id: true, plate: true } }),
    ])
    const dn = new Map(drivers.map((d) => [d.id, d.fullName]))
    const tn = new Map(trucks.map((t) => [t.id, t.plate]))
    const zn = new Map(trailers.map((t) => [t.id, t.plate]))
    for (const r of rows) {
      const parts = [r.driverId ? dn.get(r.driverId) : null, [r.truckId ? tn.get(r.truckId) : null, r.trailerId ? zn.get(r.trailerId) : null].filter(Boolean).join(' + ')]
      crew.set(r.id, parts.filter(Boolean).join(', ') || '—')
    }
  }

  const groupKey = (r: Req): string =>
    s.grouping === 'carrier' ? (r.winner?.name ?? '—') : s.grouping === 'direction' ? routeOf(r) : ''
  rows.sort((a, b) => groupKey(a).localeCompare(groupKey(b), 'ru') || dayKey(a, 'load').localeCompare(dayKey(b, 'load')) || a.number.localeCompare(b.number))

  const k = s.vatRate
  const vatOf = (v: number): number => (s.vat === 'included' ? round2((v * k) / (100 + k)) : s.vat === 'on-top' ? round2((v * k) / 100) : 0)
  const payOf = (v: number): number => (s.vat === 'on-top' ? round2(v + vatOf(v)) : v)
  const money: Col<Req>[] = !s.columns.includes('amount') ? [] : s.vat === 'none'
    ? [{ id: 'amount', label: 'Сумма, ₽', weight: 12, align: 'right', value: (r) => rub2(amountOf(r)) }]
    : s.vat === 'included'
      ? [
          { id: 'amount', label: 'Сумма, ₽', weight: 12, align: 'right', value: (r) => rub2(amountOf(r)) },
          { id: 'vat', label: `в т. ч. НДС ${k} %, ₽`, weight: 11, align: 'right', value: (r) => rub2(vatOf(amountOf(r))) },
        ]
      : [
          { id: 'amount', label: 'Без НДС, ₽', weight: 11, align: 'right', value: (r) => rub2(amountOf(r)) },
          { id: 'vat', label: `НДС ${k} %, ₽`, weight: 10, align: 'right', value: (r) => rub2(vatOf(amountOf(r))) },
          { id: 'pay', label: 'С НДС, ₽', weight: 12, align: 'right', value: (r) => rub2(payOf(amountOf(r))) },
        ]

  const all: Col<Req>[] = [
    { id: 'n', label: '№', weight: 4, align: 'center', value: (_r, i) => String(i + 1) },
    { id: 'number', label: 'Заявка', weight: 7, value: (r) => r.number },
    { id: 'loadDate', label: 'Погрузка', weight: 8, align: 'center', value: (r) => r.loadDate },
    { id: 'carrier', label: 'Перевозчик', weight: 14, value: (r) => r.winner?.name ?? '—' },
    { id: 'route', label: 'Маршрут', weight: 16, value: routeOf },
    { id: 'cargo', label: 'Груз', weight: 14, value: (r) => r.cargo },
    { id: 'tonnage', label: 'Тоннаж, т', weight: 7, align: 'right', value: (r) => nfT.format(r.tonnage) },
    { id: 'rate', label: 'Ставка, ₽/т', weight: 8, align: 'right', value: (r) => nf0.format(rateOf(r)) },
    ...money,
    { id: 'etrn', label: 'ЭТрН', weight: 9, value: etrnText },
    { id: 'contract', label: 'Договор', weight: 10, value: (r) => (r.winner?.contractNo ? `№ ${r.winner.contractNo} от ${r.winner.contractDate}` : '—') },
    { id: 'crew', label: 'Водитель и ТС', weight: 16, value: (r) => crew.get(r.id) ?? '—' },
  ]
  const moneyIds = money.map((m) => m.id)
  const always = ['n', 'number', ...moneyIds, ...(s.grouping === 'carrier' ? [] : ['carrier'])]
  const cols = pick(all, s.columns, always)

  const totals = (list: Req[]): Record<number, string> => {
    const v: Record<number, string> = {}
    cols.forEach((c, i) => {
      if (c.id === 'tonnage') v[i] = nfT.format(list.reduce((sum, r) => sum + r.tonnage, 0))
      if (c.id === 'amount') v[i] = rub2(list.reduce((sum, r) => sum + amountOf(r), 0))
      if (c.id === 'vat') v[i] = rub2(list.reduce((sum, r) => sum + vatOf(amountOf(r)), 0))
      if (c.id === 'pay') v[i] = rub2(list.reduce((sum, r) => sum + payOf(amountOf(r)), 0))
    })
    return v
  }

  const tableRows: DocRow[] = []
  let i = 0
  if (s.grouping === 'none') {
    for (const r of rows) { const row = i++; tableRows.push({ kind: 'data', cells: cols.map((c) => c.value(r, row)) }) }
  } else {
    const groups = new Map<string, Req[]>()
    for (const r of rows) groups.set(groupKey(r), [...(groups.get(groupKey(r)) ?? []), r])
    for (const [key, list] of groups) {
      const w = list[0].winner
      const head = s.grouping === 'carrier' && w
        ? [w.name, w.inn ? `ИНН ${w.inn}${w.kpp ? ` / КПП ${w.kpp}` : ''}` : '', w.contractNo ? `договор № ${w.contractNo} от ${w.contractDate}` : ''].filter(Boolean).join(' · ')
        : key
      tableRows.push({ kind: 'group', text: head })
      for (const r of list) { const row = i++; tableRows.push({ kind: 'data', cells: cols.map((c) => c.value(r, row)) }) }
      tableRows.push({ kind: 'subtotal', label: `Итого: ${trips(list.length)}`, values: totals(list) })
    }
  }
  tableRows.push({ kind: 'total', label: `Всего: ${trips(rows.length)}`, values: totals(rows) })

  const amount = rows.reduce((sum, r) => sum + payOf(amountOf(r)), 0)
  const blocks: DocBlock[] = [{ type: 'table', table: { columns: columnsOf(cols), rows: tableRows } }]
  if (moneyIds.length && rows.length) {
    const vatTotal = rows.reduce((sum, r) => sum + vatOf(amountOf(r)), 0)
    blocks.push({ type: 'words', text: `Всего к оплате${s.vat === 'on-top' ? ' с НДС' : ''}: ${rublesInWords(amount)}${s.vat === 'none' ? '' : `, в т. ч. НДС ${k} % — ${rub2(vatTotal)} ₽`}.` })
  }
  return {
    blocks,
    filters: [
      carriersFilterText(s, carrierName),
      `Рейсы: ${s.scope === 'closed' ? 'закрытые' : 'закрытые и выполняющиеся'}`,
      `НДС: ${s.vat === 'none' ? 'не выделяется' : s.vat === 'included' ? `в т. ч. ${k} %` : `${k} % начисляется сверху`}`,
      `Группировка: ${GROUPING_LABEL[s.grouping].toLowerCase()}`,
    ],
    preview: { rows: rows.length, rowsLabel: trips(rows.length), amount: round2(amount), amountLabel: s.vat === 'on-top' ? 'к оплате с НДС' : 'к оплате', empty: rows.length === 0 },
  }
}

/** Реестр ЭТрН и актов (бухгалтерия) */
function edoRegistry({ s, p, reqs, carrierName }: Ctx): Built {
  const KIND: Record<string, string> = { ETRN: 'ЭТрН', ACT: 'Акт', POA: 'Доверенность', ORDER: 'Поручение' }
  const signedOn = (ok: boolean, at: Date | null): string => (!ok ? 'ждёт' : at ? `подписано ${ruDay(mskDay(at))}` : 'подписано')
  interface Line { r: Req; doc: Req['edoDocuments'][number] | null }
  const lines: Line[] = []
  for (const r of reqs.filter((x) => isDone(x) && inPeriod(x, p, s.dateBasis)).filter(byCarrierFilter(s))) {
    if (r.edoDocuments.length === 0) lines.push({ r, doc: null })
    for (const doc of r.edoDocuments) lines.push({ r, doc })
  }
  const both = (l: Line): boolean => !!l.doc && l.doc.aemzSigned && l.doc.partySigned
  const shown = lines
    .filter((l) => (s.edoFilter === 'signed' ? both(l) : s.edoFilter === 'unsigned' ? !both(l) : true))
    .sort((a, b) => dayKey(a.r, 'load').localeCompare(dayKey(b.r, 'load')) || a.r.number.localeCompare(b.r.number))

  const all: Col<Line>[] = [
    { id: 'n', label: '№', weight: 4, align: 'center', value: (_l, i) => String(i + 1) },
    { id: 'doc', label: 'Документ', weight: 13, value: (l) => (l.doc ? `${KIND[l.doc.kind] ?? l.doc.kind} № ${l.doc.number.replace(/^ЭТрН\s*/i, '')}` : 'не оформлен') },
    { id: 'number', label: 'Заявка', weight: 7, value: (l) => l.r.number },
    { id: 'loadDate', label: 'Погрузка', weight: 8, align: 'center', value: (l) => l.r.loadDate },
    { id: 'carrier', label: 'Перевозчик', weight: 14, value: (l) => l.r.winner?.name ?? '—' },
    { id: 'route', label: 'Маршрут', weight: 15, value: (l) => routeOf(l.r) },
    { id: 'aemz', label: 'Подпись АЭМЗ', weight: 11, value: (l) => (l.doc ? signedOn(l.doc.aemzSigned, l.doc.aemzSignedAt) : '—') },
    { id: 'party', label: 'Подпись перевозчика', weight: 11, value: (l) => (l.doc ? signedOn(l.doc.partySigned, l.doc.partySignedAt) : '—') },
    { id: 'stage', label: 'Этап в Диадоке', weight: 16, value: (l) => (!l.doc ? '—' : l.doc.diadocMessageId ? etrnStageLabel(l.doc.diadocStage) : 'подписание в платформе') },
    { id: 'uid', label: 'УИД ГИС ЭПД', weight: 14, value: (l) => l.doc?.etrnUid ?? '—' },
  ]
  const cols = pick(all, s.columns, ['n', 'doc', 'number', 'loadDate'])
  const docs = lines.filter((l) => l.doc)
  const signed = docs.filter(both).length
  return {
    blocks: [
      {
        type: 'kpis',
        items: [
          { label: 'Документов', value: String(docs.length) },
          { label: 'Подписано обеими сторонами', value: String(signed) },
          { label: 'Ждут подписи', value: String(docs.length - signed) },
          { label: 'Рейсов без документов', value: String(lines.length - docs.length) },
        ],
      },
      {
        type: 'table',
        table: {
          columns: columnsOf(cols),
          rows: [...shown.map((l, i) => ({ kind: 'data' as const, cells: cols.map((c) => c.value(l, i)) })), { kind: 'total', label: `Всего строк: ${shown.length}`, values: {} }],
        },
      },
    ],
    filters: [
      carriersFilterText(s, carrierName),
      `Документы: ${s.edoFilter === 'all' ? 'все' : s.edoFilter === 'signed' ? 'подписанные обеими сторонами' : 'ещё не подписанные'}`,
    ],
    preview: { rows: shown.length, rowsLabel: `${shown.length} ${plural(shown.length, ['строка', 'строки', 'строк'])}`, amount: null, amountLabel: null, empty: shown.length === 0 },
  }
}

interface Metrics {
  trips: number; tonnage: number; turnover: number; savings: number; startTotal: number; reduction: number
  avgRate: number; carriers: number; published: number; avgBids: number; etrnSigned: number
}

function metricsOf(reqs: Req[], p: Period, basis: ReportSettings['dateBasis']): Metrics {
  const inR = reqs.filter((r) => inPeriod(r, p, basis))
  const done = inR.filter(isDone)
  const tonnage = done.reduce((s, r) => s + r.tonnage, 0)
  const turnover = done.reduce((s, r) => s + amountOf(r), 0)
  const startTotal = done.reduce((s, r) => s + r.startRate * r.tonnage, 0)
  const withBids = inR.filter((r) => r.bids.some((b) => !b.withdrawn))
  return {
    trips: done.length,
    tonnage,
    turnover,
    savings: done.reduce((s, r) => s + savingOf(r), 0),
    startTotal,
    reduction: startTotal > 0 ? Math.max(0, ((startTotal - turnover) / startTotal) * 100) : 0,
    avgRate: tonnage > 0 ? turnover / tonnage : 0,
    carriers: new Set(done.map((r) => r.winnerId)).size,
    published: inR.filter((r) => r.status !== 'DRAFT').length,
    avgBids: withBids.length ? withBids.reduce((s, r) => s + r.bids.filter((b) => !b.withdrawn).length, 0) / withBids.length : 0,
    etrnSigned: done.filter((r) => { const d = etrnOf(r); return !!d && d.aemzSigned && d.partySigned }).length,
  }
}

/** Сводка для руководства */
function managementSummary({ s, p, reqs }: Ctx): Built {
  const cur = metricsOf(reqs, p, s.dateBasis)
  const prev = metricsOf(reqs, previousPeriod(p), s.dateBasis)
  const cmp = s.sections.includes('compare')
  const note = (a: number, b: number, fmt: (v: number) => string): string | undefined => (cmp ? delta(a, b, fmt) : undefined)
  const done = reqs.filter((r) => isDone(r) && inPeriod(r, p, s.dateBasis))

  const byCarrier = new Map<string, { trips: number; tonnage: number; turnover: number }>()
  const byDirection = new Map<string, { trips: number; tonnage: number; turnover: number; savings: number }>()
  for (const r of done) {
    const c = byCarrier.get(r.winner?.name ?? '—') ?? { trips: 0, tonnage: 0, turnover: 0 }
    c.trips++; c.tonnage += r.tonnage; c.turnover += amountOf(r)
    byCarrier.set(r.winner?.name ?? '—', c)
    const d = byDirection.get(routeOf(r)) ?? { trips: 0, tonnage: 0, turnover: 0, savings: 0 }
    d.trips++; d.tonnage += r.tonnage; d.turnover += amountOf(r); d.savings += savingOf(r)
    byDirection.set(routeOf(r), d)
  }
  const carriersSorted = [...byCarrier.entries()].sort((a, b) => b[1].turnover - a[1].turnover)
  const directionsSorted = [...byDirection.entries()].sort((a, b) => b[1].turnover - a[1].turnover)

  const blocks: DocBlock[] = []
  if (s.sections.includes('kpi')) {
    blocks.push({
      type: 'kpis',
      items: [
        { label: 'Рейсов выполнено', value: String(cur.trips), note: note(cur.trips, prev.trips, String) },
        { label: 'Перевезено', value: tons(cur.tonnage), note: note(cur.tonnage, prev.tonnage, tons) },
        { label: 'Оборот', value: rub0(cur.turnover), note: note(cur.turnover, prev.turnover, rub0) },
        { label: 'Экономия на торгах', value: rub0(cur.savings), note: note(cur.savings, prev.savings, rub0) },
      ],
    })
    blocks.push({
      type: 'kpis',
      items: [
        { label: 'Снижение к стартовой', value: pct(cur.reduction) },
        { label: 'Средняя ставка', value: rateTxt(cur.avgRate), note: note(cur.avgRate, prev.avgRate, rateTxt) },
        { label: 'Перевозчиков', value: String(cur.carriers) },
        { label: 'Ставок на заявку', value: cur.avgBids.toFixed(1).replace('.', ',') },
      ],
    })
  }
  if (s.sections.includes('conclusions')) {
    const lines: string[] = []
    if (cur.trips === 0) lines.push('За период нет выполненных рейсов.')
    else {
      lines.push(`За период выполнено ${trips(cur.trips)}, перевезено ${tons(cur.tonnage)}, оборот — ${rub0(cur.turnover)}.`
        + (cmp ? ` За такой же прошлый период — ${trips(prev.trips)}, ${tons(prev.tonnage)}, ${rub0(prev.turnover)}.` : ''))
      if (cur.savings > 0) lines.push(`Торги снизили стоимость перевозок на ${rub0(cur.savings)} — ${pct(cur.reduction)} от стартовых ставок.`)
      else lines.push('Экономии на торгах за период нет: рейсы ушли по стартовым ставкам.')
      const [topName, top] = carriersSorted[0]
      lines.push(`Крупнейший перевозчик по обороту — ${topName}: ${trips(top.trips)}, ${pct(cur.turnover ? (top.turnover / cur.turnover) * 100 : 0)} оборота.`)
      const [dirName, dir] = directionsSorted[0]
      lines.push(`Основное направление — ${dirName}: ${trips(dir.trips)}, средняя ставка ${rateTxt(dir.tonnage ? dir.turnover / dir.tonnage : 0)}.`)
      lines.push(`ЭТрН подписаны обеими сторонами по ${cur.etrnSigned} из ${trips(cur.trips)}.`)
      if (cur.published > 0) lines.push(`Опубликовано заявок: ${cur.published}, в среднем ${cur.avgBids.toFixed(1).replace('.', ',')} ставки на заявку с откликами.`)
    }
    blocks.push({ type: 'heading', text: 'Выводы' }, { type: 'paragraphs', items: lines })
  }
  if (s.sections.includes('charts') && cur.trips > 0) {
    blocks.push({
      type: 'charts',
      items: [
        pie('Оборот по перевозчикам', new Map(carriersSorted.map(([k, v]) => [k, v.turnover])), '₽', 'оборот'),
        pie('Оборот по направлениям', new Map(directionsSorted.map(([k, v]) => [k, v.turnover])), '₽', 'оборот'),
      ],
    })
  }
  if (s.sections.includes('topCarriers') && carriersSorted.length) {
    const top = carriersSorted.slice(0, 5)
    blocks.push({ type: 'heading', text: 'Крупнейшие перевозчики' }, {
      type: 'table',
      table: {
        columns: [{ label: 'Перевозчик', weight: 40 }, { label: 'Рейсов', weight: 12, align: 'right' }, { label: 'Тоннаж', weight: 14, align: 'right' }, { label: 'Оборот', weight: 20, align: 'right' }, { label: 'Доля', weight: 14, align: 'right' }],
        rows: top.map(([name, v]) => ({ kind: 'data' as const, cells: [name, String(v.trips), tons(v.tonnage), rub0(v.turnover), pct(cur.turnover ? (v.turnover / cur.turnover) * 100 : 0)] })),
      },
    })
  }
  if (s.sections.includes('directions') && directionsSorted.length) {
    blocks.push({ type: 'heading', text: 'Направления' }, {
      type: 'table',
      table: {
        columns: [{ label: 'Направление', weight: 36 }, { label: 'Рейсов', weight: 10, align: 'right' }, { label: 'Тоннаж', weight: 14, align: 'right' }, { label: 'Средняя ставка', weight: 20, align: 'right' }, { label: 'Экономия', weight: 20, align: 'right' }],
        rows: directionsSorted.map(([name, v]) => ({ kind: 'data' as const, cells: [name, String(v.trips), tons(v.tonnage), rateTxt(v.tonnage ? v.turnover / v.tonnage : 0), rub0(v.savings)] })),
      },
    })
  }
  return {
    blocks,
    filters: cmp ? [`Сравнение: с ${ruDay(previousPeriod(p).first)} по ${ruDay(previousPeriod(p).last)}`] : [],
    preview: { rows: cur.trips, rowsLabel: trips(cur.trips), amount: round2(cur.turnover), amountLabel: 'оборот', empty: cur.trips === 0 },
  }
}

/** Экономия на торгах */
function savingsReport({ s, p, reqs, carrierName }: Ctx): Built {
  const done = reqs.filter((r) => isDone(r) && inPeriod(r, p, s.dateBasis)).filter(byCarrierFilter(s))
  const rows = done.filter((r) => s.sections.includes('zeroRows') || savingOf(r) > 0)
  const groupKey = (r: Req): string =>
    s.grouping === 'carrier' ? (r.winner?.name ?? '—') : s.grouping === 'direction' ? routeOf(r) : ''
  rows.sort((a, b) => groupKey(a).localeCompare(groupKey(b), 'ru') || savingOf(b) - savingOf(a))
  const pctOf = (r: Req): number => (r.startRate > 0 ? (Math.max(0, r.startRate - rateOf(r)) / r.startRate) * 100 : 0)

  const all: Col<Req>[] = [
    { id: 'n', label: '№', weight: 4, align: 'center', value: (_r, i) => String(i + 1) },
    { id: 'number', label: 'Заявка', weight: 7, value: (r) => r.number },
    { id: 'route', label: 'Маршрут', weight: 17, value: routeOf },
    { id: 'cargo', label: 'Груз', weight: 14, value: (r) => r.cargo },
    { id: 'tonnage', label: 'Тоннаж, т', weight: 8, align: 'right', value: (r) => nfT.format(r.tonnage) },
    { id: 'startRate', label: 'Стартовая, ₽/т', weight: 9, align: 'right', value: (r) => nf0.format(r.startRate) },
    { id: 'finalRate', label: 'Итоговая, ₽/т', weight: 9, align: 'right', value: (r) => nf0.format(rateOf(r)) },
    { id: 'saving', label: 'Экономия, ₽', weight: 11, align: 'right', value: (r) => nf0.format(savingOf(r)) },
    { id: 'pct', label: 'Снижение', weight: 8, align: 'right', value: (r) => pct(pctOf(r)) },
    { id: 'carrier', label: 'Перевозчик', weight: 14, value: (r) => r.winner?.name ?? '—' },
  ]
  const cols = pick(all, s.columns, ['n', 'number', 'saving'])
  const totals = (list: Req[]): Record<number, string> => {
    const v: Record<number, string> = {}
    const start = list.reduce((sum, r) => sum + r.startRate * r.tonnage, 0)
    const saved = list.reduce((sum, r) => sum + savingOf(r), 0)
    cols.forEach((c, i) => {
      if (c.id === 'tonnage') v[i] = nfT.format(list.reduce((sum, r) => sum + r.tonnage, 0))
      if (c.id === 'saving') v[i] = nf0.format(saved)
      if (c.id === 'pct') v[i] = pct(start > 0 ? (saved / start) * 100 : 0)
    })
    return v
  }
  const tableRows: DocRow[] = []
  let i = 0
  if (s.grouping === 'none') {
    for (const r of rows) { const row = i++; tableRows.push({ kind: 'data', cells: cols.map((c) => c.value(r, row)) }) }
  } else {
    const groups = new Map<string, Req[]>()
    for (const r of rows) groups.set(groupKey(r), [...(groups.get(groupKey(r)) ?? []), r])
    for (const [key, list] of groups) {
      tableRows.push({ kind: 'group', text: key })
      for (const r of list) { const row = i++; tableRows.push({ kind: 'data', cells: cols.map((c) => c.value(r, row)) }) }
      tableRows.push({ kind: 'subtotal', label: `Итого: ${trips(list.length)}`, values: totals(list) })
    }
  }
  tableRows.push({ kind: 'total', label: `Всего: ${trips(rows.length)}`, values: totals(rows) })

  const saved = done.reduce((sum, r) => sum + savingOf(r), 0)
  const start = done.reduce((sum, r) => sum + r.startRate * r.tonnage, 0)
  const final = done.reduce((sum, r) => sum + amountOf(r), 0)
  const blocks: DocBlock[] = [{
    type: 'kpis',
    items: [
      { label: 'Сэкономлено', value: rub0(saved) },
      { label: 'По стартовым ставкам', value: rub0(start) },
      { label: 'По итоговым ставкам', value: rub0(final) },
      { label: 'Снижение', value: pct(start > 0 ? (saved / start) * 100 : 0), note: `рейсов с экономией: ${done.filter((r) => savingOf(r) > 0).length} из ${done.length}` },
    ],
  }]
  if (s.sections.includes('charts') && saved > 0) {
    const dir = new Map<string, number>()
    const car = new Map<string, number>()
    for (const r of done) { addTo(dir, routeOf(r), savingOf(r)); addTo(car, r.winner?.name ?? '—', savingOf(r)) }
    blocks.push({ type: 'charts', items: [pie('Экономия по направлениям', dir, '₽', 'сэкономлено'), pie('Экономия по перевозчикам', car, '₽', 'сэкономлено')] })
  }
  blocks.push({ type: 'table', table: { columns: columnsOf(cols), rows: tableRows } })
  return {
    blocks,
    filters: [carriersFilterText(s, carrierName), `Группировка: ${GROUPING_LABEL[s.grouping].toLowerCase()}`, s.sections.includes('zeroRows') ? 'Рейсы без экономии: показаны' : 'Рейсы без экономии: не показаны'],
    preview: { rows: rows.length, rowsLabel: trips(rows.length), amount: round2(saved), amountLabel: 'сэкономлено', empty: done.length === 0 },
  }
}

/** Перевозчики: обороты и участие в торгах */
function carriersReport({ s, p, reqs, carrierName }: Ctx): Built {
  const inR = reqs.filter((r) => inPeriod(r, p, s.dateBasis) && r.status !== 'DRAFT')
  interface Acc { trips: number; tonnage: number; turnover: number; bids: number; wins: number; withdrawals: number }
  const acc = new Map<string, Acc>()
  const get = (id: string): Acc => acc.get(id) ?? (acc.set(id, { trips: 0, tonnage: 0, turnover: 0, bids: 0, wins: 0, withdrawals: 0 }), acc.get(id)!)
  for (const r of inR) {
    const bidders = new Set(r.bids.map((b) => b.carrierId))
    for (const id of bidders) {
      const a = get(id)
      a.bids++
      if (r.bids.filter((b) => b.carrierId === id).every((b) => b.withdrawn)) a.withdrawals++
    }
    if (r.winnerId) get(r.winnerId).wins++
    if (isDone(r) && r.winnerId) {
      const a = get(r.winnerId)
      a.trips++; a.tonnage += r.tonnage; a.turnover += amountOf(r)
    }
  }
  const ids = [...acc.keys()].filter((id) => s.carrierIds.length === 0 || s.carrierIds.includes(id))
  const total = ids.reduce((sum, id) => sum + acc.get(id)!.turnover, 0)
  const list = ids.map((id) => ({ id, name: carrierName.get(id) ?? '—', ...acc.get(id)! })).sort((a, b) => b.turnover - a.turnover || b.bids - a.bids)
  type Row = (typeof list)[number]
  const all: Col<Row>[] = [
    { id: 'n', label: '№', weight: 4, align: 'center', value: (_r, i) => String(i + 1) },
    { id: 'name', label: 'Перевозчик', weight: 22, value: (r) => r.name },
    { id: 'trips', label: 'Рейсов', weight: 8, align: 'right', value: (r) => String(r.trips) },
    { id: 'tonnage', label: 'Тоннаж, т', weight: 9, align: 'right', value: (r) => nfT.format(r.tonnage) },
    { id: 'turnover', label: 'Оборот, ₽', weight: 12, align: 'right', value: (r) => nf0.format(r.turnover) },
    { id: 'share', label: 'Доля оборота', weight: 9, align: 'right', value: (r) => pct(total ? (r.turnover / total) * 100 : 0) },
    { id: 'avgRate', label: 'Средняя ставка, ₽/т', weight: 10, align: 'right', value: (r) => (r.tonnage ? nf0.format(r.turnover / r.tonnage) : '—') },
    { id: 'bids', label: 'Участвовал в торгах', weight: 10, align: 'right', value: (r) => String(r.bids) },
    { id: 'winRate', label: 'Доля побед', weight: 8, align: 'right', value: (r) => (r.bids ? pct(Math.min(100, (r.wins / r.bids) * 100)) : '—') },
    { id: 'withdrawals', label: 'Снялся с торгов', weight: 8, align: 'right', value: (r) => String(r.withdrawals) },
  ]
  const cols = pick(all, s.columns, ['n', 'name'])
  const totals: Record<number, string> = {}
  cols.forEach((c, i) => {
    if (c.id === 'trips') totals[i] = String(list.reduce((sum, r) => sum + r.trips, 0))
    if (c.id === 'tonnage') totals[i] = nfT.format(list.reduce((sum, r) => sum + r.tonnage, 0))
    if (c.id === 'turnover') totals[i] = nf0.format(total)
  })
  const blocks: DocBlock[] = []
  if (s.sections.includes('charts') && total > 0) {
    blocks.push({ type: 'charts', items: [pie('Оборот по перевозчикам', new Map(list.map((r) => [r.name, r.turnover])), '₽', 'оборот')] })
  }
  blocks.push({
    type: 'table',
    table: {
      columns: columnsOf(cols),
      rows: [...list.map((r, i) => ({ kind: 'data' as const, cells: cols.map((c) => c.value(r, i)) })), { kind: 'total', label: `Всего: ${list.length} ${plural(list.length, ['перевозчик', 'перевозчика', 'перевозчиков'])}`, values: totals }],
    },
  })
  return {
    blocks,
    filters: [carriersFilterText(s, carrierName)],
    preview: { rows: list.length, rowsLabel: `${list.length} ${plural(list.length, ['перевозчик', 'перевозчика', 'перевозчиков'])}`, amount: round2(total), amountLabel: 'оборот', empty: list.length === 0 },
  }
}

/** Ставки по направлениям */
function ratesReport({ s, p, reqs, carrierName }: Ctx): Built {
  const done = reqs.filter((r) => isDone(r) && inPeriod(r, p, s.dateBasis)).filter(byCarrierFilter(s))
  interface Acc { trips: number; tonnage: number; turnover: number; start: number; min: number; max: number }
  const acc = new Map<string, Acc>()
  for (const r of done) {
    const a = acc.get(routeOf(r)) ?? { trips: 0, tonnage: 0, turnover: 0, start: 0, min: Infinity, max: 0 }
    a.trips++; a.tonnage += r.tonnage; a.turnover += amountOf(r); a.start += r.startRate * r.tonnage
    a.min = Math.min(a.min, rateOf(r)); a.max = Math.max(a.max, rateOf(r))
    acc.set(routeOf(r), a)
  }
  const list = [...acc.entries()].sort((a, b) => b[1].trips - a[1].trips || a[0].localeCompare(b[0], 'ru'))
  const blocks: DocBlock[] = [{
    type: 'table',
    table: {
      columns: [
        { label: 'Направление', weight: 26 }, { label: 'Рейсов', weight: 8, align: 'right' }, { label: 'Тоннаж, т', weight: 10, align: 'right' },
        { label: 'Средняя, ₽/т', weight: 11, align: 'right' }, { label: 'Мин., ₽/т', weight: 10, align: 'right' }, { label: 'Макс., ₽/т', weight: 10, align: 'right' },
        { label: 'Средняя стартовая, ₽/т', weight: 13, align: 'right' }, { label: 'Снижение', weight: 12, align: 'right' },
      ],
      rows: list.map(([name, a]) => ({
        kind: 'data' as const,
        cells: [name, String(a.trips), nfT.format(a.tonnage), nf0.format(a.tonnage ? a.turnover / a.tonnage : 0), nf0.format(a.min), nf0.format(a.max),
          nf0.format(a.tonnage ? a.start / a.tonnage : 0), pct(a.start > 0 ? Math.max(0, ((a.start - a.turnover) / a.start) * 100) : 0)],
      })),
    },
  }]
  if (s.sections.includes('byMonth') && list.length) {
    const months: string[] = []
    let y = p.first.y
    let m = p.first.m
    while (y < p.last.y || (y === p.last.y && m <= p.last.m)) {
      months.push(`${y}-${String(m).padStart(2, '0')}`)
      m++; if (m > 12) { m = 1; y++ }
    }
    const shownMonths = months.slice(-12)
    const cell = new Map<string, { tonnage: number; turnover: number }>()
    for (const r of done) {
      const k = `${routeOf(r)}|${dayKey(r, s.dateBasis).slice(0, 7)}`
      const c = cell.get(k) ?? { tonnage: 0, turnover: 0 }
      c.tonnage += r.tonnage; c.turnover += amountOf(r)
      cell.set(k, c)
    }
    const w = Math.max(6, Math.floor(70 / shownMonths.length))
    blocks.push({ type: 'heading', text: 'Средняя ставка по месяцам, ₽/т' }, {
      type: 'table',
      table: {
        columns: [{ label: 'Направление', weight: 30 }, ...shownMonths.map((ym) => ({ label: monthLabel(ym), weight: w, align: 'right' as const }))],
        rows: list.map(([name]) => ({
          kind: 'data' as const,
          cells: [name, ...shownMonths.map((ym) => { const c = cell.get(`${name}|${ym}`); return c && c.tonnage ? nf0.format(c.turnover / c.tonnage) : '—' })],
        })),
      },
    })
  }
  return {
    blocks,
    filters: [carriersFilterText(s, carrierName)],
    preview: { rows: list.length, rowsLabel: `${list.length} ${plural(list.length, ['направление', 'направления', 'направлений'])}`, amount: null, amountLabel: null, empty: list.length === 0 },
  }
}

/* ── сборка документа ───────────────────────────────────────────────────── */

const BUILDERS: Partial<Record<ReportDef['id'], (ctx: Ctx) => Built | Promise<Built>>> = {
  'trips-payable': tripsPayable,
  'edo-registry': edoRegistry,
  'management-summary': managementSummary,
  savings: savingsReport,
  carriers: carriersReport,
  'rates-by-direction': ratesReport,
}

export const reportBuildable = (def: ReportDef): boolean => def.missing === null && def.id in BUILDERS

export async function buildReportDoc(def: ReportDef, s: ReportSettings): Promise<ReportDoc> {
  const builder = BUILDERS[def.id]
  if (!builder || def.missing) throw new Error(`Отчёт «${def.title}» пока недоступен`)
  const p = periodOf(s)
  const [reqs, carriers] = await Promise.all([loadRequests(), db.carrier.findMany({ select: { id: true, name: true } })])
  const carrierName = new Map(carriers.map((c) => [c.id, c.name]))
  const built = await builder({ def, s, p, reqs, carrierName })

  const now = new Date()
  const msk = new Date(now.getTime() + 3 * 3600_000)
  const hhmm = `${String(msk.getUTCHours()).padStart(2, '0')}${String(msk.getUTCMinutes()).padStart(2, '0')}`
  const today = mskDay(now)
  const generatedAt = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
  }).format(now)
  const accounting = def.audience === 'accounting'
  const signers = [
    { role: accounting ? 'Составил' : 'Подготовил', position: s.preparedPosition, name: s.preparedName },
    ...(accounting || s.checkedPosition || s.checkedName
      ? [{ role: accounting ? 'Проверил' : 'Согласовал', position: s.checkedPosition, name: s.checkedName }]
      : []),
  ]
  const periodLabel = periodText(p, s.dateBasis)
  return {
    def,
    settings: s,
    number: `${isoDay(today)}/${hhmm}`,
    generatedAt,
    title: def.title,
    period: periodLabel,
    filters: built.filters,
    blocks: built.blocks,
    signers,
    preview: { periodLabel, ...built.preview },
    fileName: `aemz-${def.id}-${p.from}_${p.to}.docx`,
    displayName: `${def.title} ${ruDay(p.first)}–${ruDay(p.last)}.docx`,
  }
}
