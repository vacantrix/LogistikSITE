import { Resvg } from '@resvg/resvg-js'
import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, ImageRun, PageNumber, Packer,
  Paragraph, ShadingType, Table, TableCell, TableRow, TabStopType, TextRun, VerticalAlign, WidthType, type ISectionOptions,
} from 'docx'
import { existsSync } from 'node:fs'
import type { ReportSummary } from '@/lib/types'
import { buildPieSvg } from '@/lib/pie-svg'

/**
 * Бумажные проформы раздела «Отчёты» (Task 100): DOCX с круговыми диаграммами,
 * формируются автоматически по выбранному периоду (ReportSummary.period).
 *
 * Диаграммы строятся тем же кодом, что и на странице (buildPieSvg), затем
 * растеризуются в PNG через @resvg/resvg-js с явными шрифтами DejaVu
 * (кириллица и знак ₽). Правила вёрстки — по методичке docx: межстрочный 1.3,
 * у таблиц отступы ячеек, шапка повторяется (tableHeader), строки не рвутся
 * (cantSplit), заголовки таблиц прилипают к таблице (keepNext).
 */

const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
}

const GRID_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
}

const CELL_MARGINS = { top: 70, bottom: 70, left: 110, right: 110 }

const FONT_FILES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
].filter((p) => existsSync(p))

/** SVG → PNG (буфер), для вставки диаграмм в документ */
function svgToPng(svg: string, width = 1200): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: 'rgba(255,255,255,1)',
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: FONT_FILES.length === 0,
      // без DejaVu (Windows) — системный Arial, а не шрифт с засечками
      defaultFontFamily: FONT_FILES.length ? 'DejaVu Sans' : 'Arial',
      sansSerifFamily: FONT_FILES.length ? 'DejaVu Sans' : 'Arial',
    },
  })
  return Buffer.from(resvg.render().asPng())
}

const fmtInt = (v: number): string => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(v))
const fmtMoney = (v: number): string => `${fmtInt(v)} ₽`
const fmtPct = (v: number): string => `${v.toFixed(1).replace('.', ',')} %`
const fmtRate = (v: number): string => `${fmtInt(v)} ₽/т`
const fmtTon = (v: number): string => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(v)} т`

function nowLabel(): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
  }).format(new Date())
}

/* ── строительные блоки бумаги ─────────────────────────────────────────── */

function p(text: string, opts: { size?: number; bold?: boolean; color?: string; before?: number; after?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; italics?: boolean } = {}): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 80, line: 312 },
    children: [new TextRun({ text, size: opts.size ?? 21, bold: opts.bold, italics: opts.italics, color: opts.color ?? '1E293B', font: 'Calibri' })],
  })
}

function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    keepNext: true,
    spacing: { before: 260, after: 130, line: 312 },
    children: [new TextRun({ text, size: 24, bold: true, color: '0F172A', font: 'Calibri' })],
  })
}

/** шапка проформы: организация · код формы · заголовок · период · линия */
function proformaHeader(opts: { formCode: string; title: string; period: string; extra?: string }): Paragraph[] {
  return [
    new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 9638 }],
      spacing: { after: 40, line: 312 },
      children: [
        new TextRun({ text: 'ПЛАТФОРМА «АЭМЗ ЛОГИСТИКА» · ВНЕШНЕТОРГОВЫЕ ПЕРЕВОЗКИ', size: 16, color: '64748B', font: 'Calibri' }),
        new TextRun({ text: `\t${opts.formCode}`, size: 16, color: '94A3B8', font: 'Calibri' }),
      ],
    }),
    new Paragraph({
      spacing: { before: 160, after: 60, line: 312 },
      children: [new TextRun({ text: opts.title, size: 34, bold: true, color: '0F172A', font: 'Calibri' })],
    }),
    new Paragraph({
      spacing: { after: opts.extra ? 30 : 200, line: 312 },
      border: opts.extra ? undefined : { bottom: { style: BorderStyle.SINGLE, size: 6, color: '0F172A', space: 8 } },
      children: [new TextRun({ text: opts.period, size: 21, color: '475569', font: 'Calibri' })],
    }),
    ...(opts.extra
      ? [new Paragraph({
          spacing: { after: 200, line: 312 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '0F172A', space: 8 } },
          children: [new TextRun({ text: opts.extra, size: 21, color: '475569', font: 'Calibri' })],
        })]
      : []),
  ]
}

/** сетка показателей: N колонок, подпись сверху, крупное значение снизу */
function kpiGrid(items: { label: string; value: string; accent?: boolean }[]): Table {
  const w = Math.floor(100 / items.length)
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    rows: [new TableRow({
      cantSplit: true,
      children: items.map((it) => new TableCell({
        width: { size: w, type: WidthType.PERCENTAGE },
        margins: CELL_MARGINS,
        verticalAlign: VerticalAlign.TOP,
        borders: NO_BORDERS,
        children: [
          new Paragraph({
            spacing: { after: 20, line: 276 },
            children: [new TextRun({ text: it.label, size: 16, color: '64748B', font: 'Calibri' })],
          }),
          new Paragraph({
            spacing: { after: 60, line: 276 },
            children: [new TextRun({ text: it.value, size: 30, bold: true, color: it.accent ? '059669' : '0F172A', font: 'Calibri' })],
          }),
        ],
      })),
    })],
  })
}

/** диаграмма по центру: PNG один на всю логическую ширину (заголовок уже внутри SVG) */
async function chartBlock(svg: string): Promise<Paragraph[]> {
  const png = svgToPng(svg)
  const displayWidth = 500
  const height = Math.round((340 / 680) * displayWidth)
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 60, after: 120 },
      children: [new ImageRun({ type: 'png', data: png, transformation: { width: displayWidth, height } })],
    }),
  ]
}

/** таблица данных с шапкой и опциональной строкой «ИТОГО» */
function dataTable(opts: {
  headers: string[]
  widths: number[] // проценты
  rows: (string | { text: string; bold?: boolean; color?: string; align?: 'left' | 'right' | 'center' })[][]
  totalRow?: (string | { text: string; bold?: boolean; color?: string })[]
}): Table {
  const alignOf = (a?: string) => (a === 'right' ? AlignmentType.RIGHT : a === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT)
  const cell = (v: string | { text: string; bold?: boolean; color?: string; align?: string }, i: number, isHeader: boolean): TableCell =>
    new TableCell({
      width: { size: opts.widths[i], type: WidthType.PERCENTAGE },
      margins: CELL_MARGINS,
      verticalAlign: VerticalAlign.CENTER,
      shading: isHeader ? { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' } : undefined,
      children: [new Paragraph({
        alignment: alignOf(typeof v === 'string' ? (i === 0 ? 'left' : 'right') : v.align),
        spacing: { line: 276 },
        children: [new TextRun({
          text: typeof v === 'string' ? v : v.text,
          size: isHeader ? 19 : 20,
          bold: isHeader || (typeof v !== 'string' && v.bold),
          color: isHeader ? '475569' : (typeof v !== 'string' && v.color) || '1E293B',
          font: 'Calibri',
        })],
      })],
    })

  const rows = [
    new TableRow({ tableHeader: true, cantSplit: true, children: opts.headers.map((h, i) => cell(h, i, true)) }),
    ...opts.rows.map((r) => new TableRow({ cantSplit: true, children: r.map((v, i) => cell(v, i, false)) })),
  ]
  if (opts.totalRow) {
    rows.push(new TableRow({
      cantSplit: true,
      children: opts.totalRow.map((v, i) => cell(typeof v === 'string' ? { text: v, bold: true } : { ...v, bold: true }, i, false)),
    }))
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: GRID_BORDERS, rows })
}

function noteAndSignature(formNo: number): Paragraph[] {
  return [
    new Paragraph({
      spacing: { before: 260, after: 60, line: 312 },
      tabStops: [{ type: TabStopType.RIGHT, position: 9638 }],
      children: [
        new TextRun({ text: 'Ответственный: ______________________ / ______________________________ /', size: 21, color: '1E293B', font: 'Calibri' }),
        new TextRun({ text: '\t(подпись, Ф.И.О.)', size: 16, color: '94A3B8', font: 'Calibri' }),
      ],
    }),
    new Paragraph({
      spacing: { after: 0, line: 276 },
      children: [new TextRun({ text: `Сформировано автоматически платформой «АЭМЗ Логистика» — ${nowLabel()} (МСК).`, size: 17, color: '94A3B8', font: 'Calibri' })],
    }),
  ]
}

function section(children: ISectionOptions['children'], formNo: number): ISectionOptions {
  return {
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 964, right: 1021, bottom: 1021, left: 1021 },
      },
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: 9638 }],
          children: [
            new TextRun({ text: `Форма АЭМЗ-ОП-${formNo} · платформа «АЭМЗ Логистика»`, size: 16, color: '94A3B8', font: 'Calibri' }),
            new TextRun({ children: ['\tСтр. ', PageNumber.CURRENT, ' из ', PageNumber.TOTAL_PAGES], size: 16, color: '94A3B8', font: 'Calibri' }),
          ],
        })],
      }),
    },
    children,
  }
}

/* ── Проформа № 1: экономия по заявкам ─────────────────────────────────── */

export async function buildProforma1Docx(data: ReportSummary, operator = '—'): Promise<{ buffer: Buffer; fileName: string; displayName: string }> {
  const p1 = data.proforma1
  const chart1 = buildPieSvg({ title: 'Экономия по направлениям', slices: p1.byDirection.map((s) => ({ label: s.label, value: s.value })), unit: '₽', centerHint: 'сэкономлено' })
  const chart2 = buildPieSvg({ title: 'Доли заявок в общей экономии', slices: p1.byRequest.map((s) => ({ label: s.label, value: s.value })), unit: '₽', centerHint: 'сэкономлено' })

  const children: ISectionOptions['children'] = [
    ...proformaHeader({
      formCode: 'АЭМЗ-ОП-1',
      title: 'Проформа № 1. Экономия по заявкам',
      period: `Период: ${p1.periodLabel}`,
      extra: `Сформировано: ${nowLabel()} (МСК) · Ответственный: ${operator}`,
    }),

    heading('1. Сводка за период'),
    kpiGrid([
      { label: 'СЭКОНОМЛЕНО ВСЕГО', value: fmtMoney(p1.savedTotal), accent: true },
      { label: p1.projectionLabel.toUpperCase(), value: fmtMoney(p1.projectionMonth) },
      { label: 'СРЕДНЯЯ ЭКОНОМИЯ НА ЗАЯВКУ', value: fmtMoney(p1.avgSaving) },
      { label: 'СРЕДНЕЕ СНИЖЕНИЕ СТАВКИ', value: fmtPct(p1.avgSavingPct) },
    ]),
    p(`Подтверждённых рейсов: ${p1.confirmedCount} · из них с экономией: ${p1.savingsCount} · стартовый оборот: ${fmtMoney(p1.startTotal)} · итоговый оборот: ${fmtMoney(p1.finalTotal)}`, { size: 18, color: '64748B', before: 60 }),

    heading('2. Структура экономии'),
    ...(await chartBlock(chart1)),
    ...(await chartBlock(chart2)),

    heading('3. Экономия по каждой заявке'),
    p1.rows.length === 0
      ? p('За выбранный период заявок с экономией нет.', { size: 20, color: '64748B' })
      : dataTable({
          headers: ['№ заявки', 'Направление', 'Груз', 'Ставка, ₽/т (старт → итог)', 'Экономия, ₽', 'Снижение', 'Перевозчик'],
          widths: [12, 20, 12, 17, 12, 12, 15],
          rows: p1.rows.map((r) => [
            { text: `№${r.number}`, bold: true, align: 'left' },
            r.direction,
            r.cargo,
            `${fmtInt(r.startRate)} → ${r.bestRate != null ? fmtInt(r.bestRate) : '—'}`,
            { text: fmtMoney(r.savings), color: '059669', bold: true },
            fmtPct(r.pct),
            r.carrier,
          ]),
          totalRow: ['ИТОГО', `${p1.savingsCount} ${pluralRu(p1.savingsCount)}`, '', '', fmtMoney(p1.savedTotal), fmtPct(p1.avgSavingPct), ''],
        }),
    ...noteAndSignature(1),
  ]

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 21, color: '1E293B' }, paragraph: { spacing: { line: 312 } } } } },
    sections: [section(children, 1)],
  })
  const buffer = await Packer.toBuffer(doc)
  return {
    buffer,
    fileName: `aemz-proforma-1-economy-${data.period.from}_${data.period.to}.docx`,
    displayName: `Проформа №1 — Экономия по заявкам (${p1.periodLabel}).docx`,
  }
}

/* ── Проформа № 2: обороты и привлечённый транспорт ────────────────────── */

export async function buildProforma2Docx(data: ReportSummary, operator = '—'): Promise<{ buffer: Buffer; fileName: string; displayName: string }> {
  const p2 = data.proforma2
  const chart1 = buildPieSvg({ title: 'Оборот по перевозчикам (привлечённый транспорт)', slices: p2.byCarrier.map((c) => ({ label: c.name, value: c.turnover })), unit: '₽', centerHint: 'оборот' })
  const chart2 = buildPieSvg({ title: 'Заявки периода по статусам', slices: p2.byStatus.map((s) => ({ label: s.label, value: s.value })), unit: 'шт', centerHint: 'заявок' })

  const children: ISectionOptions['children'] = [
    ...proformaHeader({
      formCode: 'АЭМЗ-ОП-2',
      title: 'Проформа № 2. Обороты и привлечённый транспорт',
      period: `Период: ${p2.periodLabel}`,
      extra: `Сформировано: ${nowLabel()} (МСК) · Ответственный: ${operator}`,
    }),

    heading('1. Обороты за период'),
    kpiGrid([
      { label: 'ЗАЯВОК ЗА ПЕРИОД', value: String(p2.requestsCount) },
      { label: 'РЕЙСОВ ПОДТВЕРЖДЕНО', value: String(p2.confirmedCount) },
      { label: 'ОБОРОТ', value: fmtMoney(p2.turnover), accent: true },
      { label: 'СРЕДНЯЯ СТАВКА', value: fmtRate(p2.avgRate) },
    ]),
    p(`Общий тоннаж заявок: ${fmtTon(p2.tonnageTotal)} · среднее число ставок на заявку: ${String(p2.avgBids).replace('.', ',')} · рейсов с ЭТрН: ${p2.etrnCount} из ${p2.confirmedCount}`, { size: 18, color: '64748B', before: 60 }),

    heading('2. Привлечённый транспорт'),
    ...(await chartBlock(chart1)),
    ...(await chartBlock(chart2)),

    heading('3. Перевозчики за период'),
    p2.byCarrier.length === 0
      ? p('За выбранный период подтверждённых рейсов нет.', { size: 20, color: '64748B' })
      : dataTable({
          headers: ['Перевозчик', 'Рейсов', 'Оборот, ₽', 'Средняя ставка, ₽/т', 'Доля оборота'],
          widths: [34, 12, 22, 18, 14],
          rows: p2.byCarrier.map((c) => [
            { text: c.name, align: 'left' },
            String(c.trips),
            fmtMoney(c.turnover),
            fmtRate(c.avgRate),
            fmtPct(c.share),
          ]),
          totalRow: ['ИТОГО', String(p2.confirmedCount), fmtMoney(p2.turnover), fmtRate(p2.avgRate), '100 %'],
        }),
    ...noteAndSignature(2),
  ]

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 21, color: '1E293B' }, paragraph: { spacing: { line: 312 } } } } },
    sections: [section(children, 2)],
  })
  const buffer = await Packer.toBuffer(doc)
  return {
    buffer,
    fileName: `aemz-proforma-2-turnover-${data.period.from}_${data.period.to}.docx`,
    displayName: `Проформа №2 — Обороты и привлечённый транспорт (${p2.periodLabel}).docx`,
  }
}

/** «1 заявка / 2 заявки / 5 заявок» (для строки ИТОГО) */
function pluralRu(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'заявка'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'заявки'
  return 'заявок'
}
