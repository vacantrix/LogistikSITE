/**
 * Общие хелперы для генерации корпоративных .docx платформы «АЭМЗ Логистика».
 *
 * Основано на рекомендациях навыка docx (design-system.md):
 *  - обложка по рецепту R1 (Pure Paragraph Left): единственная таблица-обёртка
 *    высотой 16838 twips с rule "exact", borders allNoBorders, секция с margin 0;
 *  - динамические отступы через calcCoverSpacing();
 *  - контроль ширины заголовка (кириллица ≈ pt × 12.5 twips на символ);
 *  - таблицы: WidthType.PERCENTAGE, margins, tableHeader, cantSplit, ShadingType.CLEAR;
 *  - межстрочный интервал 1.3 (line: 312) во всём документе.
 *
 * Шрифты (кириллица): заголовки — Arial, текст — Times New Roman, код — Consolas.
 */
import {
  Paragraph, TextRun, Table, TableRow, TableCell, Footer, Header,
  PageNumber, AlignmentType, HeadingLevel, WidthType, BorderStyle,
  ShadingType, TableLayoutType,
} from 'docx'

// ── Палитра DS-1 Deep Sea (совпадает с фирменным цветом платформы #0E1B2C) ──
export const PAL = {
  bg: '0B1C2C',
  titleColor: 'FFFFFF',
  subtitleColor: 'B0B8C0',
  metaColor: '90989F',
  footerColor: '687078',
  accent: '529286',
  headingColor: '0F2537',
  headingAlt: '2E6B60', // затемнённый акцент для H2/H3 (яркий 529286 слишком насыщен на белом)
  body: '1A1A1A',
  secondary: '505A63',
  table: { headerBg: '529286', headerText: 'FFFFFF', accentLine: '529286', innerLine: 'BECFCC', surface: 'E8ECEB' },
  codeBg: 'F0F3F5',
}

// ── Шрифты: явные ascii+hAnsi+cs — иначе кириллица может отрисоваться не тем шрифтом ──
export const F = (name) => ({ ascii: name, hAnsi: name, eastAsia: name, cs: name })
export const FONT_BODY = F('Times New Roman')
export const FONT_HEAD = F('Arial')
export const FONT_CODE = F('Courier New')

// ── Границы ──
const NB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
export const noBorders = { top: NB, bottom: NB, left: NB, right: NB }
export const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB }

/**
 * Динамические отступы обложки (design-system.md § calcCoverSpacing).
 * Возвращает { topSpacing, midSpacing, bottomSpacing } в twips.
 */
export function calcCoverSpacing(params) {
  const {
    titleLineCount = 1, titlePt = 36, hasSubtitle = false,
    hasEnglishLabel = false, metaLineCount = 0,
    fixedHeight = 800, pageHeight = 16838,
    marginTop = 0, marginBottom = 0,
  } = params
  const SAFETY = 1200
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY
  const titleHeight = titleLineCount * (titlePt * 23 + 200)
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0
  const metaHeight = metaLineCount * (10 * 23 + 100)
  const implicitParaHeight = 3 * 300
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight
  const remainingSpace = usableHeight - contentHeight
  const safeRemaining = Math.max(remainingSpace, 400)
  const FOOTER_MIN = 800
  const rawTop = Math.floor(safeRemaining * 0.45)
  const rawBottom = Math.floor(safeRemaining * 0.45)
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN)
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400)
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0)
  return { topSpacing, midSpacing, bottomSpacing }
}

/**
 * Контроль ширины заголовка обложки (адаптация calcTitleLayout для кириллицы).
 * Строки заголовка задаются вручную по смысловым границам (по пробелу),
 * функция проверяет, что каждая строка помещается, и что строк не более трёх.
 * Кириллица Arial Bold: средняя ширина ≈ 0.62 em → pt × 12.5 twips на символ.
 */
export function checkTitleLayout(titleLines, titlePt, availableWidth) {
  if (titleLines.length > 3) throw new Error(`Заголовок обложки: больше 3 строк (${titleLines.length})`)
  const charW = titlePt * 12.5
  for (const line of titleLines) {
    const w = line.length * charW
    if (w > availableWidth) {
      throw new Error(`Строка «${line}» (${line.length} симв.) не помещается: ${Math.round(w)} > ${availableWidth} twips при ${titlePt}pt`)
    }
  }
  return { titlePt, titleLines }
}

/**
 * Обложка — рецепт R1 «Pure Paragraph Left» (design-system.md).
 * config: { titleLines, titlePt, subtitle, englishLabel, metaLines, footerLeft, footerRight }
 */
export function buildCoverR1(config) {
  const P = PAL
  const padL = 1200, padR = 800
  const availableWidth = 11906 - padL - padR - 300
  const { titlePt, titleLines } = checkTitleLayout(config.titleLines, config.titlePt ?? 40, availableWidth)
  const titleSize = titlePt * 2

  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length,
    fixedHeight: 400,
  })

  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 }
  const children = []

  // 1. Верхний отступ (динамический)
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }))

  // 2. Английская метка с акцентной линией снизу (граница абзаца, не символы)
  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split('').join('  '), size: 18, color: P.accent, font: FONT_HEAD, characterSpacing: 40 })],
    }))
  }

  // 3. Заголовок (динамический размер, явный line по правилу 8: pt × 23)
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: 'atLeast' },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true, color: P.titleColor, font: FONT_HEAD })],
    }))
  }

  // 4. Подзаголовок
  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL }, spacing: { after: 800 },
      children: [new TextRun({ text: config.subtitle, size: 24, color: P.subtitleColor, font: FONT_HEAD })],
    }))
  }

  // 5. Мета-строки с левой акцентной границей
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 24, color: P.metaColor, font: FONT_HEAD })],
    }))
  }

  // 6. Нижний отступ (динамический)
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }))

  // 7. Подвал обложки с верхней акцентной линией
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || '', size: 16, color: P.footerColor, font: FONT_HEAD }),
      new TextRun({ text: '                                        ', font: FONT_HEAD }),
      new TextRun({ text: config.footerRight || '', size: 16, color: P.footerColor, font: FONT_HEAD }),
    ],
  }))

  // Единственная таблица-обёртка 16838 twips, rule exact, без границ
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: 'exact' },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders,
        children,
      })],
    })],
  })]
}

// ── Абзацы ──

/** Заголовок уровня 1: Arial 16pt, pageBreakBefore — каждая глава с новой страницы. */
export function h1(text, opts = {}) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: opts.newPage !== false,
    keepNext: true,
    spacing: { before: 360, after: 200, line: 312 },
    children: [new TextRun({ text, bold: true, size: 32, color: PAL.headingColor, font: FONT_HEAD })],
  })
}

/** Заголовок уровня 2: Arial 14pt. */
export function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    keepNext: true,
    spacing: { before: 280, after: 140, line: 312 },
    children: [new TextRun({ text, bold: true, size: 28, color: PAL.headingAlt, font: FONT_HEAD })],
  })
}

/** Заголовок уровня 3: Arial 12pt. */
export function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    keepNext: true,
    spacing: { before: 220, after: 110, line: 312 },
    children: [new TextRun({ text, bold: true, size: 24, color: PAL.headingColor, font: FONT_HEAD })],
  })
}

/**
 * Абзац основного текста: Times New Roman 12pt, выравнивание по ширине,
 * красная строка 1,25 см (709 twips), интервал 1.3.
 * parts — строка или массив { t, b, i, mono }.
 */
export function body(parts, opts = {}) {
  const arr = typeof parts === 'string' ? [{ t: parts }] : parts
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: opts.noIndent ? undefined : { firstLine: 709 },
    spacing: { line: 312, after: opts.after ?? 80 },
    children: arr.map((r) => new TextRun({
      text: r.t, bold: !!r.b, italics: !!r.i,
      size: r.mono ? 21 : 24,
      color: r.color || (r.mono ? PAL.headingAlt : PAL.body),
      font: r.mono ? FONT_CODE : FONT_BODY,
    })),
  })
}

/** Элемент нумерованного списка (reference уникален для каждого списка). */
export function numItem(reference, parts) {
  const arr = typeof parts === 'string' ? [{ t: parts }] : parts
  return new Paragraph({
    numbering: { reference, level: 0 },
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: 60 },
    children: arr.map((r) => new TextRun({ text: r.t, bold: !!r.b, size: 24, color: PAL.body, font: FONT_BODY })),
  })
}

/**
 * Таблица в деловом стиле «горизонтальные линии»:
 * шапка с заливкой accentLine (ShadingType.CLEAR), белые полужирные подписи,
 * все строки cantSplit, шапка tableHeader, ширины — проценты.
 * headers: string[], rows: (string | {t,b,mono})[][], widths: number[] (проценты)
 */
export function table(headers, rows, widths, opts = {}) {
  const T = PAL.table
  const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 }
  const mkPara = (v, isHeader) => {
    const item = typeof v === 'string' ? { t: v } : v
    return new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { line: 312 },
      children: [new TextRun({
        text: item.t,
        bold: isHeader || !!item.b,
        size: item.mono ? 19 : 21,
        color: isHeader ? T.headerText : (item.mono ? PAL.headingAlt : PAL.body),
        font: item.mono ? FONT_CODE : (isHeader ? FONT_HEAD : FONT_BODY),
      })],
    })
  }
  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: headers.map((text, i) => new TableCell({
      children: [mkPara(text, true)],
      shading: { type: ShadingType.CLEAR, fill: T.headerBg },
      margins: cellMargins,
      width: { size: widths[i], type: WidthType.PERCENTAGE },
    })),
  })
  const dataRows = rows.map((row, ri) => new TableRow({
    cantSplit: true,
    children: row.map((v, i) => new TableCell({
      children: [mkPara(v, false)],
      shading: opts.zebra && ri % 2 === 1 ? { type: ShadingType.CLEAR, fill: T.surface } : undefined,
      margins: cellMargins,
      width: { size: widths[i], type: WidthType.PERCENTAGE },
    })),
  }))
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: T.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: T.accentLine },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: T.innerLine },
      insideVertical: NB,
    },
    rows: [headerRow, ...dataRows],
  })
}

/** Подпись к таблице (keepNext — не отрывается от таблицы). */
export function tableTitle(text) {
  return new Paragraph({
    keepNext: true,
    spacing: { before: 200, after: 80, line: 312 },
    children: [new TextRun({ text, bold: true, size: 21, color: PAL.secondary, font: FONT_HEAD })],
  })
}

/**
 * Блок кода/JSON: моноширинный, светлая подложка, левая акцентная граница.
 * lines: string[] — каждый элемент отдельным абзацем (без красной строки).
 */
export function codeBlock(lines) {
  return lines.map((line, i) => new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: PAL.codeBg },
    border: {
      left: { style: BorderStyle.SINGLE, size: 10, color: PAL.accent, space: 10 },
      ...(i === 0 ? { top: { style: BorderStyle.SINGLE, size: 2, color: PAL.table.innerLine, space: 4 } } : {}),
      ...(i === lines.length - 1 ? { bottom: { style: BorderStyle.SINGLE, size: 2, color: PAL.table.innerLine, space: 4 } } : {}),
    },
    indent: { left: 240 },
    spacing: { line: 312, before: i === 0 ? 120 : 0, after: i === lines.length - 1 ? 120 : 0 },
    children: [new TextRun({ text: line.length ? line : ' ', size: 18, color: PAL.body, font: FONT_CODE })],
  }))
}

/** Врезка «Примечание/Важно»: левая акцентная граница + светлая заливка. */
export function note(label, text) {
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: PAL.table.surface },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: PAL.accent, space: 10 } },
    indent: { left: 240 },
    spacing: { line: 312, before: 160, after: 160 },
    children: [
      new TextRun({ text: `${label}. `, bold: true, size: 22, color: PAL.headingAlt, font: FONT_HEAD }),
      new TextRun({ text, size: 22, color: PAL.body, font: FONT_BODY }),
    ],
  })
}

// ── Колонтитулы ──

/** Нижний колонтитул с номером страницы (только текущий номер — без «X из Y»). */
export function pageFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { line: 240 },
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: PAL.secondary, font: FONT_HEAD })],
    })],
  })
}

/** Верхний колонтитул основного блока: короткое имя документа, линия снизу. */
export function pageHeader(text) {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: PAL.table.innerLine, space: 4 } },
      spacing: { line: 240, after: 0 },
      children: [new TextRun({ text, size: 16, color: '8A939B', font: FONT_HEAD })],
    })],
  })
}
