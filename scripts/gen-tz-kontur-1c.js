// Генератор ТЗ «Веб-платформа «Контур 1С»» — docx по рецепту R1 (палитра DM-1).
// Секции: обложка (margin 0) → Содержание (римские) → тело (арабские с 1).

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, NumberFormat, AlignmentType, HeadingLevel,
  WidthType, BorderStyle, ShadingType, TableLayoutType, SectionType,
  TableOfContents, PageBreak, LevelFormat,
} = require('docx');
const fs = require('fs');
const path = require('path');
const { blocks, meta } = require('./tz-kontur-1c-content.js');

// ── Палитра DM-1 (Deep Cyan — технические ТЗ) ──────────────────────────────
const PAL = {
  bg: '162235',
  accent: '37DCF2',
  cover: { titleColor: 'FFFFFF', subtitleColor: 'B0B8C0', metaColor: '90989F', footerColor: '687078' },
  table: { headerBg: '1B6B7A', headerText: 'FFFFFF', accentLine: '1B6B7A', innerLine: 'C8DDE2', surface: 'EDF3F5' },
  primary: '162235',
  h2: '1B6B7A',
  body: '000000',
  secondary: '5B6B7D',
};

const FONT_H = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Arial', cs: 'Arial' };
const FONT_B = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Calibri', cs: 'Calibri' };
const FONT_M = { ascii: 'Courier New', hAnsi: 'Courier New', eastAsia: 'Courier New', cs: 'Courier New' };

const noBorders = {
  top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
};
const allNoBorders = {
  ...noBorders,
  insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
};

// ── Кириллическая версия calcTitleLayout (ширины в em, слова не рвутся) ─────
const CW = (ch) => {
  if (/[A-ZА-ЯЁ]/.test(ch)) return 0.72;
  if (/[a-zа-яё0-9]/.test(ch)) return 0.56;
  if (ch === ' ') return 0.30;
  if (/[«»()]/.test(ch)) return 0.45;
  return 0.35;
};
const textWidthEm = (s) => [...s].reduce((a, ch) => a + CW(ch), 0);

function splitTitleLinesCyr(title, maxWidthTwips, pt) {
  const words = title.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? cur + ' ' + w : w;
    if (textWidthEm(cand) * pt * 20 <= maxWidthTwips || !cur) cur = cand;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  // сирота: последняя строка короче 22% ширины — влить в предыдущую
  if (lines.length > 1 && textWidthEm(lines[lines.length - 1]) * pt * 20 < maxWidthTwips * 0.22) {
    const last = lines.pop();
    lines[lines.length - 1] += ' ' + last;
  }
  return lines;
}

function calcTitleLayoutCyr(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    lines = splitTitleLinesCyr(title, maxWidthTwips, titlePt);
    const fits = lines.every((l) => textWidthEm(l) * titlePt * 20 <= maxWidthTwips);
    if (lines.length <= 3 && fits) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) { titlePt = minPt; lines = splitTitleLinesCyr(title, maxWidthTwips, minPt); }
  return { titlePt, titleLines: lines };
}

function calcCoverSpacing(params) {
  const {
    titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0,
  } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const remainingSpace = usableHeight - contentHeight;
  const safeRemaining = Math.max(remainingSpace, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

// ── Обложка R1 (Pure Paragraph Left) ────────────────────────────────────────
function buildCoverR1(config) {
  const P = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayoutCyr(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];

  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));

  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({
        text: config.englishLabel.split('').join('  '),
        size: 18, color: P.accent, font: FONT_H, characterSpacing: 40,
      })],
    }));
  }

  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: 'atLeast' },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true, color: P.cover.titleColor, font: FONT_H })],
    }));
  }

  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 800 },
      children: [new TextRun({ text: config.subtitle, size: 24, color: P.cover.subtitleColor, font: FONT_B })],
    }));
  }

  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 24, color: P.cover.metaColor, font: FONT_B })],
    }));
  }

  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));

  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || '', size: 16, color: P.cover.footerColor, font: FONT_H }),
      new TextRun({ text: '                                        ', font: FONT_H }),
      new TextRun({ text: config.footerRight || '', size: 16, color: P.cover.footerColor, font: FONT_H }),
    ],
  }));

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: 'exact' },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg },
        borders: noBorders,
        children,
      })],
    })],
  })];
}

// ── Построители тела ────────────────────────────────────────────────────────
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160, line: 312 },
    keepNext: true,
    children: [new TextRun({ text, bold: true, size: 32, color: PAL.primary, font: FONT_H })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 120, line: 312 },
    keepNext: true,
    children: [new TextRun({ text, bold: true, size: 26, color: PAL.h2, font: FONT_H })],
  });
}
function body(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 709 },
    spacing: { after: 120, line: 312 },
    children: [new TextRun({ text, size: 22, color: PAL.body, font: FONT_B })],
  });
}
function bulletItem(text) {
  return new Paragraph({
    bullet: { level: 0 },
    alignment: AlignmentType.LEFT,
    spacing: { after: 60, line: 312 },
    children: [new TextRun({ text, size: 22, color: PAL.body, font: FONT_B })],
  });
}
function numberedItem(text, ref) {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    alignment: AlignmentType.LEFT,
    spacing: { after: 60, line: 312 },
    children: [new TextRun({ text, size: 22, color: PAL.body, font: FONT_B })],
  });
}
function codeBlock(lines) {
  return lines.map((ln, i) => new Paragraph({
    spacing: { before: i === 0 ? 140 : 0, after: i === lines.length - 1 ? 140 : 0, line: 312 },
    indent: { left: 240, right: 240 },
    shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: PAL.table.accentLine, space: 8 } },
    children: [new TextRun({ text: ln.length ? ln : ' ', size: 18, color: '0F2A33', font: FONT_M })],
  }));
}
function cellPara(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { line: 312 },
    children: [new TextRun({
      text, size: 19, bold: !!opts.bold,
      color: opts.color || PAL.body, font: FONT_B,
    })],
  });
}
function makeTable({ title, headers, rows, widths }) {
  const out = [];
  out.push(new Paragraph({
    keepNext: true,
    spacing: { before: 200, after: 80, line: 312 },
    children: [new TextRun({ text: title, bold: true, size: 20, color: PAL.secondary, font: FONT_B })],
  }));
  const headerRow = new TableRow({
    tableHeader: true, cantSplit: true,
    children: headers.map((htext, i) => new TableCell({
      children: [cellPara(htext, { bold: true, color: PAL.table.headerText })],
      shading: { type: ShadingType.CLEAR, fill: PAL.table.headerBg },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      width: { size: widths[i], type: WidthType.PERCENTAGE },
    })),
  });
  const dataRows = rows.map((r, ri) => new TableRow({
    cantSplit: true,
    children: r.map((c, i) => new TableCell({
      children: [cellPara(c)],
      shading: ri % 2 === 1 ? { type: ShadingType.CLEAR, fill: PAL.table.surface } : undefined,
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      width: { size: widths[i], type: WidthType.PERCENTAGE },
    })),
  }));
  out.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: PAL.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: PAL.table.accentLine },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: PAL.table.innerLine },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [headerRow, ...dataRows],
  }));
  out.push(new Paragraph({ spacing: { after: 120, line: 312 }, children: [] }));
  return out;
}

// ── Рендер блоков контента ──────────────────────────────────────────────────
const numberingRefs = [];
const bodyChildren = [];
for (const b of blocks) {
  if (b.h1) bodyChildren.push(h1(b.h1));
  else if (b.h2) bodyChildren.push(h2(b.h2));
  else if (b.p) bodyChildren.push(body(b.p));
  else if (b.ul) b.ul.forEach((it) => bodyChildren.push(bulletItem(it)));
  else if (b.ol) { numberingRefs.push(b.ol.ref); b.ol.items.forEach((it) => bodyChildren.push(numberedItem(it, b.ol.ref))); }
  else if (b.table) makeTable(b.table).forEach((el) => bodyChildren.push(el));
  else if (b.code) codeBlock(b.code).forEach((el) => bodyChildren.push(el));
}

// ── Колонтитулы ─────────────────────────────────────────────────────────────
const pageHeader = new Header({
  children: [new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { after: 60, line: 312 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: PAL.table.innerLine, space: 4 } },
    children: [new TextRun({ text: meta.headerText, size: 16, color: '8A94A0', font: FONT_B })],
  })],
});
const romanFooter = new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { line: 312 },
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: PAL.secondary, font: FONT_B })],
  })],
});
const arabicFooter = new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { line: 312 },
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: PAL.secondary, font: FONT_B })],
  })],
});

// ── Документ ────────────────────────────────────────────────────────────────
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

const doc = new Document({
  creator: 'АЗМЗ Логистика',
  title: meta.title,
  styles: {
    default: {
      document: {
        run: { font: FONT_B, size: 22, color: PAL.body },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: FONT_H, size: 32, bold: true, color: PAL.primary },
        paragraph: { spacing: { before: 360, after: 160, line: 312 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: FONT_H, size: 26, bold: true, color: PAL.h2 },
        paragraph: { spacing: { before: 260, after: 120, line: 312 }, outlineLevel: 1 },
      },
    },
  },
  numbering: {
    config: numberingRefs.map((ref) => ({
      reference: ref,
      levels: [{
        level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }],
    })),
  },
  sections: [
    { // 1. Обложка — поля 0, без колонтитулов
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1({
        title: meta.title, subtitle: meta.subtitle, englishLabel: meta.englishLabel,
        metaLines: meta.metaLines, footerLeft: meta.footerLeft, footerRight: meta.footerRight,
        palette: PAL,
      }),
    },
    { // 2. Содержание — римские
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      footers: { default: romanFooter },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 480, after: 360, line: 312 },
          children: [new TextRun({ text: 'Содержание', bold: true, size: 32, color: PAL.primary, font: FONT_H })],
        }),
        new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }),
        new Paragraph({
          spacing: { before: 200, line: 312 },
          children: [new TextRun({
            text: 'Примечание: оглавление построено на полях Word. После правок документа обновите его: правый клик по оглавлению → «Обновить поле» → «Обновить целиком».',
            italics: true, size: 18, color: '888888', font: FONT_B,
          })],
        }),
      ],
    },
    { // 3. Тело — арабские с 1
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: pageHeader },
      footers: { default: arabicFooter },
      children: bodyChildren,
    },
  ],
});

const outDir = '/home/z/my-project/download';
const outPath = path.join(outDir, meta.outFile);
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log('OK:', outPath, buf.length, 'bytes');
});
