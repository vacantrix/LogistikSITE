/**
 * Вёрстка отчёта (ReportDoc) в DOCX — один код для всех отчётов раздела.
 *
 * Бланк: организация и подразделение, код формы и номер документа, заголовок, период,
 * условия отбора; затем блоки отчёта (показатели, таблицы с группами и итогами,
 * диаграммы, выводы, сумма прописью); подписи «Составил/Проверил» и номера страниц.
 * Широкие реестры — на альбомном листе. Диаграммы — тот же SVG, что на странице
 * (lib/pie-svg), растеризуется в PNG через resvg.
 */
import { Resvg } from '@resvg/resvg-js'
import {
  AlignmentType, BorderStyle, Document, Footer, ImageRun, PageNumber, PageOrientation, Packer,
  Paragraph, ShadingType, Table, TableCell, TableRow, TabStopType, TextRun, VerticalAlign, WidthType,
  type ISectionOptions,
} from 'docx'
import { existsSync } from 'node:fs'
import { buildPieSvg } from '@/lib/pie-svg'
import type { Align, DocBlock, DocRow, DocTable, ReportDoc } from '@/lib/reports/build'

const FONT = 'Arial'
const INK = '1E293B'
const MUTED = '64748B'
const FAINT = '94A3B8'
const LINE = 'CBD5E1'

const FONT_FILES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  // turbopackIgnore: иначе next build кладёт в standalone-сборку весь проект
].filter((p) => existsSync(/*turbopackIgnore: true*/ p))

function svgToPng(svg: string, width = 1200): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: 'rgba(255,255,255,1)',
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: FONT_FILES.length === 0,
      defaultFontFamily: FONT_FILES.length ? 'DejaVu Sans' : 'Arial',
      sansSerifFamily: FONT_FILES.length ? 'DejaVu Sans' : 'Arial',
    },
  })
  return Buffer.from(resvg.render().asPng())
}

const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE }
const thin = { style: BorderStyle.SINGLE, size: 4, color: LINE }
const GRID = { top: thin, bottom: thin, left: thin, right: thin, insideHorizontal: thin, insideVertical: thin }
const MARGINS = { top: 50, bottom: 50, left: 90, right: 90 }

const run = (text: string, o: { size?: number; bold?: boolean; color?: string; italics?: boolean } = {}): TextRun =>
  new TextRun({ text, size: o.size ?? 20, bold: o.bold, italics: o.italics, color: o.color ?? INK, font: FONT })

const alignOf = (a?: Align) => (a === 'right' ? AlignmentType.RIGHT : a === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT)

function para(children: TextRun[], o: { align?: Align; before?: number; after?: number; keepNext?: boolean } = {}): Paragraph {
  return new Paragraph({
    alignment: alignOf(o.align),
    keepNext: o.keepNext,
    spacing: { before: o.before ?? 0, after: o.after ?? 80, line: 300 },
    children,
  })
}

/* ── бланк ──────────────────────────────────────────────────────────────── */

function letterhead(doc: ReportDoc, width: number): Paragraph[] {
  const s = doc.settings
  const tab = [{ type: TabStopType.RIGHT, position: width }]
  return [
    new Paragraph({
      tabStops: tab,
      spacing: { after: 20, line: 280 },
      children: [run(s.organization, { bold: true, size: 20 }), run(`\tФорма ${doc.def.formCode}`, { size: 16, color: MUTED })],
    }),
    new Paragraph({
      tabStops: tab,
      spacing: { after: 0, line: 280 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: INK, space: 6 } },
      children: [run(s.department, { size: 16, color: MUTED }), run(`\t№ ${doc.number}`, { size: 16, color: MUTED })],
    }),
    para([run(doc.title, { bold: true, size: 30 })], { align: 'center', before: 280, after: 40 }),
    para([run(doc.period, { size: 20, color: MUTED })], { align: 'center', after: doc.filters.length ? 60 : 240 }),
    ...(doc.filters.length ? [para([run(doc.filters.join(' · '), { size: 17, color: MUTED })], { align: 'center', after: 240 })] : []),
  ]
}

function signatures(doc: ReportDoc): (Paragraph | Table)[] {
  const cell = (signer: ReportDoc['signers'][number]) => new TableCell({
    borders: NO_BORDERS,
    margins: { top: 0, bottom: 0, left: 0, right: 200 },
    children: [
      para([run(`${signer.role}:`, { size: 19, color: MUTED })], { after: 20 }),
      para([run(signer.position || '____________________________', { size: 20 })], { after: 160 }),
      para([run('________________', { size: 20 }), run(`   / ${signer.name || '______________________'} /`, { size: 20 })], { after: 0 }),
      para([run('подпись', { size: 14, color: FAINT }), run('                              расшифровка', { size: 14, color: FAINT })], { after: 0 }),
    ],
  })
  return [
    para([run(`Дата составления: ${doc.generatedAt.slice(0, 10)}`, { size: 19 })], { before: 320, after: 200, keepNext: true }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: NO_BORDERS,
      rows: [new TableRow({ cantSplit: true, children: doc.signers.map(cell) })],
    }),
    para([run(`Сформировано платформой «АЭМЗ Логистика» ${doc.generatedAt} (МСК). Данные — на момент формирования.`, { size: 15, color: FAINT })], { before: 240, after: 0 }),
  ]
}

/* ── блоки ──────────────────────────────────────────────────────────────── */

function kpis(items: { label: string; value: string; note?: string }[]): Table {
  const w = Math.floor(100 / items.length)
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    rows: [new TableRow({
      cantSplit: true,
      children: items.map((it) => new TableCell({
        width: { size: w, type: WidthType.PERCENTAGE },
        borders: NO_BORDERS,
        margins: { top: 40, bottom: 80, left: 0, right: 160 },
        children: [
          para([run(it.label, { size: 16, color: MUTED })], { after: 10 }),
          para([run(it.value, { size: 28, bold: true })], { after: 10 }),
          ...(it.note ? [para([run(it.note, { size: 15, color: MUTED })], { after: 0 })] : []),
        ],
      })),
    })],
  })
}

function table(t: DocTable): Table {
  const total = t.columns.reduce((s, c) => s + c.weight, 0) || 1
  const widths = t.columns.map((c) => (c.weight / total) * 100)
  const n = t.columns.length
  const cell = (text: string, i: number, o: { bold?: boolean; header?: boolean; fill?: string; span?: number; align?: Align; color?: string } = {}) =>
    new TableCell({
      width: { size: o.span ? widths.slice(i, i + o.span).reduce((a, b) => a + b, 0) : widths[i], type: WidthType.PERCENTAGE },
      columnSpan: o.span,
      margins: MARGINS,
      verticalAlign: VerticalAlign.CENTER,
      shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined,
      children: [new Paragraph({
        alignment: alignOf(o.align ?? (o.header ? 'center' : t.columns[i]?.align)),
        spacing: { line: 252 },
        children: [run(text, { size: o.header ? 16 : 17, bold: o.bold || o.header, color: o.color ?? (o.header ? '334155' : INK) })],
      })],
    })

  const totalRow = (r: Extract<DocRow, { kind: 'subtotal' | 'total' }>): TableRow => {
    const keys = Object.keys(r.values).map(Number)
    const firstValue = keys.length ? Math.min(...keys) : n
    const span = Math.max(1, firstValue)
    const fill = r.kind === 'total' ? 'F1F5F9' : undefined
    const cells = [cell(r.label, 0, { bold: true, span, fill, align: 'left' })]
    for (let i = span; i < n; i++) cells.push(cell(r.values[i] ?? '', i, { bold: true, fill }))
    return new TableRow({ cantSplit: true, children: cells })
  }

  const rows: TableRow[] = [
    new TableRow({ tableHeader: true, cantSplit: true, children: t.columns.map((c, i) => cell(c.label, i, { header: true, fill: 'F1F5F9' })) }),
    ...t.rows.map((r) => {
      if (r.kind === 'group') return new TableRow({ cantSplit: true, children: [cell(r.text, 0, { bold: true, span: n, fill: 'F8FAFC', align: 'left' })] })
      if (r.kind === 'data') return new TableRow({ cantSplit: true, children: r.cells.map((v, i) => cell(v, i)) })
      return totalRow(r)
    }),
  ]
  if (t.rows.filter((r) => r.kind === 'data').length === 0) {
    rows.push(new TableRow({ children: [cell('Нет данных за выбранный период', 0, { span: n, align: 'center', color: MUTED })] }))
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: GRID, rows })
}

function chart(svg: string, width: number): Paragraph {
  const png = svgToPng(svg)
  const height = Math.round((340 / 680) * width)
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    keepLines: true,
    spacing: { before: 80, after: 120 },
    children: [new ImageRun({ type: 'png', data: png, transformation: { width, height } })],
  })
}

/** на альбомном листе две диаграммы — рядом, на книжном — друг под другом */
function charts(items: Parameters<typeof buildPieSvg>[0][], landscape: boolean): (Paragraph | Table)[] {
  if (!landscape || items.length < 2) return items.map((c) => chart(buildPieSvg(c), 480))
  const rows: TableRow[] = []
  for (let i = 0; i < items.length; i += 2) {
    rows.push(new TableRow({
      cantSplit: true,
      children: items.slice(i, i + 2).map((c) => new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: NO_BORDERS,
        children: [chart(buildPieSvg(c), 440)],
      })),
    }))
  }
  return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: NO_BORDERS, rows })]
}

function blockToDocx(b: DocBlock, landscape: boolean): (Paragraph | Table)[] {
  switch (b.type) {
    case 'heading':
      return [para([run(b.text, { bold: true, size: 23 })], { before: 260, after: 100, keepNext: true })]
    case 'kpis':
      return [kpis(b.items), para([], { after: 60 })]
    case 'table':
      return [table(b.table), para([], { after: 120 })]
    case 'charts':
      return charts(b.items, landscape)
    case 'paragraphs':
      return b.items.map((t) => para([run(t, { size: 20 })], { after: 100 }))
    case 'words':
      return [para([run(b.text, { size: 20, bold: true })], { before: 120, after: 80 })]
  }
}

export async function renderReportDocx(doc: ReportDoc): Promise<Buffer> {
  const landscape = !!doc.def.landscape
  // ширина текста в твипах: A4 минус поля 1021 с каждой стороны
  const width = (landscape ? 16838 : 11906) - 2 * 1021
  const children: ISectionOptions['children'] = [
    ...letterhead(doc, width),
    ...doc.blocks.flatMap((b) => blockToDocx(b, landscape)),
    ...signatures(doc),
  ]
  const section: ISectionOptions = {
    properties: {
      page: {
        size: { width: 11906, height: 16838, orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
        margin: { top: 851, right: 1021, bottom: 851, left: 1021 },
      },
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: width }],
          children: [
            run(`${doc.settings.organization} · ${doc.title} · № ${doc.number}`, { size: 14, color: FAINT }),
            new TextRun({ children: ['\tСтр. ', PageNumber.CURRENT, ' из ', PageNumber.TOTAL_PAGES], size: 14, color: FAINT, font: FONT }),
          ],
        })],
      }),
    },
    children,
  }
  const document = new Document({
    creator: 'АЭМЗ Логистика',
    title: doc.title,
    description: doc.period,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [section],
  })
  return Buffer.from(await Packer.toBuffer(document))
}
