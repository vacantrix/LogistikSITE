/* Отчёт: стек дорожной обстановки 2ГИС — сборка и тестирование (Template C, R1/DS-1). */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, PageBreak, Header, Footer, PageNumber, NumberFormat,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  TableLayoutType, SectionType, TableOfContents, LevelFormat,
} = require("docx");
const fs = require("fs");

// ---------- данные тестов ----------
const direct = Object.fromEntries(
  JSON.parse(fs.readFileSync("/home/z/my-project/download/2gis-tests/2gis-report.json", "utf8")).results.map(r => [r.test, r])
);
const proxy = Object.fromEntries(
  JSON.parse(fs.readFileSync("/home/z/my-project/download/2gis-tests-proxy/2gis-report.json", "utf8")).results.map(r => [r.test, r])
);

const fmtEta = (s) => (s == null ? "—" : Math.floor(s / 60) + " мин " + String(Math.round(s % 60)).padStart(2, "0") + " с");
const fmtKm = (m) => (m == null ? "—" : (m / 1000).toFixed(1).replace(".", ",") + " км");
const fmtMs = (v) => (v == null ? "—" : String(v));

// ---------- палитра DS-1 (Deep Sea, general business) ----------
const PAL = {
  bg: "0B1C2C", accent: "529286",
  cover: { titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078" },
  table: { headerBg: "529286", headerText: "FFFFFF", accentLine: "529286", innerLine: "BECFCC", surface: "E8ECEB" },
  headingDark: "0B1C2C",
};

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const allNoBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE };

const FONT_BODY = { ascii: "Times New Roman", hAnsi: "Times New Roman", eastAsia: "SimSun" };
const FONT_HEAD = { ascii: "Times New Roman", hAnsi: "Times New Roman", eastAsia: "SimHei" };

// ---------- calcTitleLayout / splitTitleLines / calcCoverSpacing (design-system.md) ----------
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."，。、；：！？", ..."的与和及之在于为", ..."-_—–·/", ..." \t"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) {
      breakAt = charsPerLine;
      const prevChar = remaining[breakAt - 1];
      const nextChar = remaining[breakAt];
      if (prevChar && nextChar && !breakAfter.has(prevChar) && !breakAfter.has(nextChar) &&
          /[\u4e00-\u9fff]/.test(prevChar) && /[\u4e00-\u9fff]/.test(nextChar)) breakAt -= 1;
    }
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += last;
  }
  return lines;
}

function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 20;
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt;
  let lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    const cpl = charsPerLine(minPt);
    lines = splitTitleLines(title, cpl);
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}

function calcCoverSpacing(params) {
  const {
    titleLineCount = 1, titlePt = 36, hasSubtitle = false,
    hasEnglishLabel = false, metaLineCount = 0,
    fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0,
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

// ---------- Recipe R1: Pure Paragraph Cover ----------
function buildCoverR1(config) {
  const P = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, config.preferredPt || 40, 24);
  console.log("cover title:", titlePt + "pt", JSON.stringify(titleLines));
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length,
    fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));
  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "),
        size: 18, color: P.accent, font: { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "SimHei" }, characterSpacing: 40 })],
    }));
  }
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true,
        color: P.cover.titleColor, font: { eastAsia: "SimHei", ascii: "Arial", hAnsi: "Arial" } })],
    }));
  }
  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 800 },
      children: [new TextRun({ text: config.subtitle, size: 24, color: P.cover.subtitleColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial", hAnsi: "Arial" } })],
    }));
  }
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 24, color: P.cover.metaColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial", hAnsi: "Arial" } })],
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: P.cover.footerColor, font: { ascii: "Arial", hAnsi: "Arial" } }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: P.cover.footerColor, font: { ascii: "Arial", hAnsi: "Arial" } }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders,
        children,
      })],
    })],
  })];
}

// ---------- хелперы тела ----------
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160, line: 312 },
    children: [new TextRun({ text, bold: true, size: 32, color: PAL.headingDark, font: FONT_HEAD })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120, line: 312 },
    children: [new TextRun({ text, bold: true, size: 28, color: PAL.headingDark, font: FONT_HEAD })],
  });
}
function body(runsOrText, opts = {}) {
  const runs = typeof runsOrText === "string"
    ? [new TextRun({ text: runsOrText, size: 24, color: "000000", font: FONT_BODY })]
    : runsOrText;
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: opts.noIndent ? 0 : 480 },
    spacing: { line: 312, after: opts.after ?? 80 },
    keepNext: opts.keepNext || false,
    children: runs,
  });
}
function b(text) { return new TextRun({ text, bold: true, size: 24, color: "000000", font: FONT_BODY }); }
function t(text) { return new TextRun({ text, size: 24, color: "000000", font: FONT_BODY }); }
function caption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 80, after: 240, line: 276 },
    children: [new TextRun({ text, size: 21, color: "595959", font: FONT_BODY })],
  });
}
function tableTitle(text) {
  return new Paragraph({
    keepNext: true, spacing: { before: 160, after: 100, line: 312 },
    children: [new TextRun({ text, bold: true, size: 21, color: PAL.headingDark, font: FONT_BODY })],
  });
}

/** Таблица в стиле «шапка + тонкие линии». widths — проценты. */
function dataTable(widths, header, rows, opts = {}) {
  const mk = (text, isHead, wPct, alignLeft) => new TableCell({
    width: { size: wPct, type: WidthType.PERCENTAGE },
    shading: isHead ? { type: ShadingType.CLEAR, fill: PAL.table.headerBg } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: alignLeft ? AlignmentType.LEFT : AlignmentType.CENTER,
      spacing: { line: 264 },
      children: [new TextRun({
        text: String(text), bold: isHead, size: opts.small ? 19 : 21,
        color: isHead ? PAL.table.headerText : "000000", font: FONT_BODY,
      })],
    })],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: PAL.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: PAL.table.accentLine },
      left: NONE, right: NONE,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: PAL.table.innerLine },
      insideVertical: NONE,
    },
    rows: [
      new TableRow({
        tableHeader: true, cantSplit: true,
        children: header.map((x, i) => mk(x, true, widths[i], false)),
      }),
      ...rows.map((r, ri) => new TableRow({
        cantSplit: true,
        children: r.map((x, i) => {
          const cell = mk(x, false, widths[i], (opts.leftCols || []).includes(i));
          return cell;
        }),
      })),
    ],
  });
}

function img(path, widthPx, origW, origH) {
  return new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 },
    children: [new ImageRun({
      data: fs.readFileSync(path), type: "png",
      transformation: { width: widthPx, height: Math.round(widthPx * origH / origW) },
    })],
  });
}

// ---------- контент ----------
const bodyChildren = [];

// 1. Резюме
bodyChildren.push(h1("1. Резюме"));
bodyChildren.push(body([
  t("Получен демо-ключ платформы 2ГИС (Platform Manager, маска "), b("4a10…6395"),
  t("), и задача настоящей работы состояла в том, чтобы собрать готовый стек дорожной обстановки на его основе, провести испытания и отчитаться о результатах. Стек был собран в демо-приложении «АЗМЗ Логистика» (вкладка «2ГИС»: карта MapGL со слоем пробок, серверный прокси Routing API, панель проверки обстановки и логика перемаршрутизации). Испытания выполнены по матрице из восьми сценариев T1–T6 двумя способами: напрямую в Routing API 2ГИС и через серверный прокси демо-стенда."),
]));
bodyChildren.push(body([
  t("Итог: "), b("все основные проверки пройдены"),
  t(". Пять информационных сценариев (T1–T5) вернули статус OK на обоих путях вызова; невалидный ключ корректно отклоняется с кодом HTTP 403 (T6). Полный рейс Абинск → Новороссийск (~65 км) рассчитывается без ограничений — предполагавшийся ранее лимит демо-ключа «50 км между точками» не подтвердился. Грузовой профиль (18 т, высота 3,5 м) обрабатывается и даёт маршрут, отличный от легкового; альтернативные маршруты возвращаются (3 варианта); кеш прокси сокращает повторный отклик с 233 мс до 4 мс. Средний отклик Routing API через прокси — 233–310 мс, напрямую — 713–1097 мс."),
]));
bodyChildren.push(body([
  t("Выявлено и устранено два дефекта интеграции (ключ, «запекаемый» в клиентский бандл; исключение map.addLine, затиравшее результат проверки). Зафиксировано одно внешнее ограничение: для ключа не включён сервис «MapGL JS API», поэтому слой карты 2ГИС с пробками пока не отрисовывается — Routing API при этом работает полностью. Вкладка переведена в отказоустойчивый режим без карты 2ГИС (проверка обстановки и SVG-схема проблемных участков по реальной геометрии Routing API). "),
  b("Вердикт: стек готов к демонстрации и к промышленной интеграции при выполнении одного действия со стороны владельца ключа — включения сервиса MapGL JS API в Platform Manager."),
]));

// 2. Цели, объём, окружение
bodyChildren.push(h1("2. Цели, объём и окружение тестирования"));
bodyChildren.push(h2("2.1. Цели и критерии готовности"));
bodyChildren.push(body([
  t("Цель испытаний — подтвердить, что выбранное решение 2ГИС закрывает потребности корпоративной ТМС «АЗМЗ Логистика» по трём пунктам: (а) достоверная картина обстановки на магистральном коридоре рейсов (А-146/М-4, Краснодарский край); (б) грузовой маршрутизации с учётом массы и габаритов; (в) основе для перемаршрутизации по отклонению расчётного времени прибытия (ETA). Критерии готовности: каждый информационный сценарий возвращает статус OK и физически правдоподобные значения ETA и расстояния; ошибки авторизации обрабатываются предсказуемо; отклик укладывается в интерактивные рамки (менее 2 с); интеграция в демо-приложение работает без ошибок в браузере."),
]));
bodyChildren.push(h2("2.2. Объём испытаний"));
bodyChildren.push(body([
  t("Полностью проверены серверная часть (Routing API 7.0.0 напрямую и через прокси), обработка ошибок, кеширование и интеграция в интерфейс. Частично проверен клиентский слой MapGL: из-за состава сервисов ключа карта 2ГИС не отрисовывается, поэтому визуальная проверка слоя пробок (trafficOn, обновление каждую минуту) отложена до включения соответствующего сервиса и перенесена в раздел открытых вопросов. За рамками отчёта остались сопутствующие сервисы 2ГИС (Distance Matrix, Isochrone, Map Matching) — они не входят в минимальный стек рейса."),
]));
bodyChildren.push(h2("2.3. Окружение"));
bodyChildren.push(body([
  t("Испытания проводились на демо-стенде Next.js 16 (App Router, API-контракты зеркалируют каркас Spring Boot «АЗМЗ»), база SQLite, dev-сервер на порту 3000. Браузерные проверки выполнены в headless Chromium (автоматизация agent-browser) с фиксацией консоли, сетевых запросов и скриншотов. Внешняя точка вызова — Routing API 2ГИС версии 7.0.0 (routing.api.2gis.com/routing/7.0.0/global), авторизация — демо-ключ Platform Manager, передаваемый параметром key. Транспортная сеть проверок — реальные координаты коридора А-146: Абинск (38,157; 44,868), Крымск (37,993; 44,931), Новороссийск (37,776; 44,724)."),
]));

// 3. Состав стека
bodyChildren.push(h1("3. Состав собранного стека"));
bodyChildren.push(h2("3.1. Архитектура и компоненты"));
bodyChildren.push(body([
  t("Стек встроен в существующую навигационную архитектуру демо: вкладка «2ГИС» открывается из нижнего меню, поверх базовой карты остаётся доступным рейс Z-1067. Все обращения к 2ГИС идут через серверный прокси — ключ не покидает сервер, квота контролируется в одной точке, ответы повторных запросов кешируются на 30 секунд."),
], { keepNext: true }));
bodyChildren.push(tableTitle("Таблица 1 — Компоненты стека дорожной обстановки 2ГИС"));
bodyChildren.push(dataTable(
  [30, 30, 40],
  ["Компонент", "Расположение", "Назначение"],
  [
    ["Вкладка «2ГИС»", "src/components/azmz/gis2-screen.tsx", "Карта MapGL со слоем пробок (trafficOn), рейс А-146 поверх, панель «Проверить обстановку», SVG-фолбэк"],
    ["Прокси Routing API", "src/app/api/2gis/routing/route.ts", "POST к routing.api.2gis.com (7.0.0/global): ключ на сервере, белый список полей, кеш 30 с (FIFO, 300 записей), замер латентности"],
    ["Эндпоинт ключа", "src/app/api/2gis/mapkey/route.ts", "Отдаёт ключ MapGL клиенту в рантайме — без «запекания» в бандл"],
    ["Тест-матрица", "scripts/test_2gis.py", "Сценарии T1–T6, прогон напрямую и через прокси, отчёты JSON/MD"],
    ["Страница изоляции ключа", "public/mapgl-test.html", "Независимая проверка ключа MapGL вне приложения (реальный против заведомо неверного)"],
  ],
  { leftCols: [0, 1, 2], small: true }
));
bodyChildren.push(h2("3.2. Поток данных и логика перемаршрутизации"));
bodyChildren.push(body([
  t("Панель проверки отправляет запрос с точками рейса, профилем truck (масса 18 т, высота 3,5 м, ширина 2,55 м, длина 9 м) и режимом трафика jam (реалтайм). В детальном ответе каждый участок геометрии несёт цвет fast/normal/slow — по нему проблемные места подсвечиваются на карте или на SVG-схеме. При каждом повторном запросе расчётная ETA сравнивается с базовым значением первой проверки: отклонение +5 минут и более признаётся ухудшением и поднимает предупреждение о перемаршрутизации с указанием выигрыша альтернативного маршрута, улучшение на 3 минуты и более отмечается как благоприятное изменение. Такой контракт (сравнение ETA вместо сырых скоростей участков) выбран осознанно: публичный Routing API 2ГИС не отдаёт поточечные скорости пробок, но отдаёт цвет участков и точную ETA — этого достаточно для решения «перестраивать ли рейс»."),
]));

// 4. Программа и методика
bodyChildren.push(h1("4. Программа и методика испытаний"));
bodyChildren.push(body([
  t("Матрица построена по принципу «от простого к сложному»: сначала короткий городской маршрут-смок, затем грузовой профиль на магистрали, затем полный рейс и режимы трафика, в конце — альтернативы и негативный сценарий авторизации. Каждый сценарий прогонялся дважды: напрямую в Routing API и через прокси демо-стенда; повтор идентичного запроса через прокси дополнительно проверяет кеш."),
], { keepNext: true }));
bodyChildren.push(tableTitle("Таблица 2 — Матрица испытаний"));
bodyChildren.push(dataTable(
  [10, 44, 46],
  ["ID", "Сценарий", "Что проверяется"],
  [
    ["T1", "Новороссийск: порт → центр, ~1,7 км, car + jam", "Smoke: доступность сервиса, адекватность ETA, формат ответа"],
    ["T2a", "Абинск → Крымск (А-146), ~21 км, car + jam", "Базовый легковой маршрут для сравнения профилей"],
    ["T2b", "Тот же маршрут, truck: 18 т, высота 3,5 м", "Грузовой профиль: учёт массы и габаритов"],
    ["T3", "Абинск → Новороссийск, ~65 км (рейс Z-1067)", "Предполагавшийся лимит демо-ключа «50 км между точками»"],
    ["T4a", "Абинск → Крымск, car + statistics", "Прогнозный режим трафика против реалтайма"],
    ["T5", "Абинск → Крымск, truck, alternative = 2", "Альтернативные маршруты для перемаршрутизации"],
    ["T6", "Запрос с заведомо неверным ключом", "Обработка отказа авторизации (ожидается ошибка)"],
    ["T2a-rep", "Повтор T2a через прокси", "Кеш прокси: ожидается cached = true и отклик в единицы миллисекунд"],
  ],
  { leftCols: [1, 2] }
));

// 5. Результаты
bodyChildren.push(h1("5. Результаты тестирования"));
bodyChildren.push(h2("5.1. Прямые вызовы Routing API"));
bodyChildren.push(body([
  t("Все информационные сценарии завершлись со статусом OK; значения ETA и расстояний физически правдоподобны для А-146 (свободный пробег 21 км занимает порядка получаса с учётом населённых пунктов). Сценарий T3 опроверг ожидание лимита: маршрут в 65,1 км рассчитан полностью, с шестью проблемными участками по реальной обстановке."),
], { keepNext: true }));
bodyChildren.push(tableTitle("Таблица 3 — Результаты прямого прогона (напрямую в 2ГИС)"));
bodyChildren.push(dataTable(
  [9, 9, 12, 11, 12, 16, 17, 14],
  ["ID", "HTTP", "Отклик, мс", "Статус", "Вариантов", "ETA", "Дистанция", "Slow-участков"],
  [
    ["T1", "200", fmtMs(direct.T1.latency_ms), "OK", "1", fmtEta(direct.T1.eta_s), fmtKm(direct.T1.distance_m), "2"],
    ["T2a", "200", fmtMs(direct.T2a.latency_ms), "OK", "1", fmtEta(direct.T2a.eta_s), fmtKm(direct.T2a.distance_m), "1"],
    ["T2b", "200", fmtMs(direct.T2b.latency_ms), "OK", "1", fmtEta(direct.T2b.eta_s), fmtKm(direct.T2b.distance_m), "1"],
    ["T3", "200", fmtMs(direct.T3.latency_ms), "OK", "1", fmtEta(direct.T3.eta_s), fmtKm(direct.T3.distance_m), "6"],
    ["T4a", "200", fmtMs(direct.T4a.latency_ms), "OK", "1", fmtEta(direct.T4a.eta_s), fmtKm(direct.T4a.distance_m), "0"],
    ["T5", "200", fmtMs(direct.T5.latency_ms), "OK", "3", fmtEta(direct.T5.eta_s), fmtKm(direct.T5.distance_m), "2"],
    ["T6", "403", fmtMs(direct.T6.latency_ms), "отказ", "—", "—", "—", "—"],
  ],
  { small: true }
));
bodyChildren.push(h2("5.2. Прогон через серверный прокси"));
bodyChildren.push(body([
  t("Прокси воспроизводит результаты прямого прогона (ETA совпадает с точностью до пересчёта обстановки) и добавляет служебную ценность: повторные идентичные запросы обслуживаются из кеша за единицы миллисекунд, ключ клиента игнорируется (используется серверный), в ответ добавляется мета с латентностью и признаком кеша. Обратим внимание на T6 через прокси: запрос с неверным ключом был обслужен из кеша как обычный маршрут — это ожидаемое поведение, поскольку проверка ключа происходит на сервере стенда, а негативный сценарий авторизации корректно проверяется только прямым вызовом (T6 в таблице 3)."),
], { keepNext: true }));
bodyChildren.push(tableTitle("Таблица 4 — Результаты прогона через прокси демо-стенда"));
bodyChildren.push(dataTable(
  [12, 16, 22, 20, 30],
  ["ID", "Отклик, мс", "ETA", "Из кеша", "Комментарий"],
  [
    ["T1", fmtMs(proxy.T1.latency_ms), fmtEta(proxy.T1.eta_s), "нет", "Первичный запрос — уход в 2ГИС"],
    ["T2a", fmtMs(proxy.T2a.latency_ms), fmtEta(proxy.T2a.eta_s), "нет", "Первичный запрос"],
    ["T2b", fmtMs(proxy.T2b.latency_ms), fmtEta(proxy.T2b.eta_s), "нет", "Грузовой профиль"],
    ["T3", fmtMs(proxy.T3.latency_ms), fmtEta(proxy.T3.eta_s), "нет", "Полный рейс ~65 км"],
    ["T4a", fmtMs(proxy.T4a.latency_ms), fmtEta(proxy.T4a.eta_s), "нет", "Прогнозный режим"],
    ["T5", fmtMs(proxy.T5.latency_ms), fmtEta(proxy.T5.eta_s), "нет", "3 варианта маршрута"],
    ["T6", fmtMs(proxy.T6.latency_ms), fmtEta(proxy.T6.eta_s), "да", "Ключ клиента игнорируется — попадание в кеш T1"],
    ["T2a-rep", fmtMs(proxy["T2a-rep"].latency_ms), fmtEta(proxy["T2a-rep"].eta_s), "да", "Кеш работает: 233 мс → 4 мс"],
  ],
  { leftCols: [4] }
));
bodyChildren.push(h2("5.3. Латентность"));
bodyChildren.push(body([
  t("Диаграмма на рисунке 1 сопоставляет отклик обоих путей вызова. Прямые вызовы стабильно укладываются в 0,7–1,1 с (сеть до инфраструктуры 2ГИС), прокси — в 0,23–0,31 с на первичных запросах и в единицы миллисекунд на кеш-попаданиях. Для интерактивного сценария «водитель нажал кнопку — получил обстановку» оба значения приемлемы; кеш дополнительно защищает квоту демо-ключа при повторных проверках."),
], { keepNext: true }));
bodyChildren.push(img("/home/z/my-project/download/2gis-tests/latency-chart.png", 560, 1720, 819));
bodyChildren.push(caption("Рисунок 1 — Латентность Routing API 2ГИС по сценариям T1–T5: напрямую и через прокси"));
bodyChildren.push(h2("5.4. Интерпретация ключевых результатов"));
bodyChildren.push(body([
  b("Лимита 50 км нет. "),
  t("Раннее исследование исходило из упоминания ограничения демо-ключа «до 50 км между точками»; T3 показал успешный расчёт маршрута 65,1 км с ETA 87 мин. Для реальных рейсов коридора А-146/М-4 это снимает главное сомнение: полный рейс считается на демо-ключе без обходных приёмов."),
]));
bodyChildren.push(body([
  b("Грузовой профиль работает и отличается от легкового. "),
  t("Пара T2a/T2b на одном коридоре дала разные маршруты: 21,1 км / 30 мин 37 с у легкового против 21,7 км / 30 мин 46 с у грузовика 18 т. Разница скромная, но системная — 2ГИС выбирает для грузовика участки с учётом габаритов и массы; при проезде под знаками ограничения грузового движения разница будет принципиальной."),
]));
bodyChildren.push(body([
  b("Реалтайм против прогноза. "),
  t("T4a (statistics) дал ETA 27 мин 41 с против 30 мин 37 с в реалтайме (jam) — расхождение порядка трёх минут, реалтайм консервативнее. Для перемаршрутизации это аргумент использовать jam при активном рейсе и statistics — для планирования."),
]));
bodyChildren.push(body([
  b("Альтернативы и ошибки. "),
  t("T5 вернул три варианта маршрута — достаточно для предложения «быстрее на N минут» при деградации обстановки. Неверный ключ отклоняется кодом HTTP 403 за ~0,9 с: прокси и клиентская панель показывают понятную диагностику вместо молчаливой деградации."),
]));

// 6. Браузерная верификация
bodyChildren.push(h1("6. Браузерная верификация вкладки «2ГИС»"));
bodyChildren.push(body([
  t("Сквозной сценарий проверен в headless-браузере на живом стенде: открытие демо, переход на вкладку «2ГИС», нажатие «Проверить обстановку (truck, пробки)». Панель отработала корректно: получены два варианта маршрута (основной 22 км / 29 мин с одним проблемным участком и альтернатива 21 км / 29 мин), отклик 722 мс, построена SVG-схема маршрута по реальной геометрии Routing API с подсветкой проблемных участков. Повторная проверка обслужена кешем (метка «из кеша»), отклонение ETA к базовому значению составило менее порога — предупреждение о перемаршрутизации не поднималось, ложных срабатываний нет."),
]));
bodyChildren.push(img("/home/z/my-project/download/2gis-tests/screenshot-2gis-tab-crop.png", 300, 520, 592));
bodyChildren.push(caption("Рисунок 2 — Вкладка «2ГИС» демо-стенда: карточки вариантов, подсказка перемаршрутизации и SVG-схема маршрута А-146 по геометрии 2ГИС"));
bodyChildren.push(body([
  t("Поскольку сервис «MapGL JS API» для ключа не включён, вкладка отрисовала диагностическое сообщение с точной причиной и инструкцией (см. раздел 7, позиция O1) и автоматически перешла в режим без карты 2ГИС — при этом проверка обстановки, история ETA и схема проблемных участков остаются полностью работоспособными. После включения сервиса вкладка сама поднимет карту MapGL со слоем пробок: код её инициализации уже в прод-состоянии (trafficOn: true, маркеры погрузки/выгрузки, отрисовка цветных участков поверх карты)."),
]));

// 7. Дефекты
bodyChildren.push(h1("7. Выявленные дефекты и их устранение"));
bodyChildren.push(body([
  t("В ходе браузерной верификации обнаружены два дефекта интеграции, оба локализованы и устранены; дополнительно зафиксировано внешнее ограничение, не связанное с кодом."),
], { keepNext: true }));
bodyChildren.push(tableTitle("Таблица 5 — Дефекты и ограничения"));
bodyChildren.push(dataTable(
  [8, 27, 30, 23, 12],
  ["ID", "Симптом", "Причина", "Исправление", "Статус"],
  [
    ["D1", "Карта 2ГИС показывает «Your MapGL key is invalid», хотя Routing API принимает тот же ключ", "Ключ NEXT_PUBLIC_* инлайнится в клиентский бандл при первой компиляции; записанный позже ключ в бандл не попал и не обновился", "Рантайм-эндпоинт GET /api/2gis/mapkey; единый источник истины 2GIS_API_KEY в .env (в git не попадает)", "Исправлен"],
    ["D2", "После успешного ответа блок «Вариантов» исчезал, появлялся хинт сетевой ошибки", "TypeError map.addLine is not a function у деградировавшего объекта MapGL; обработчик перезаписывал свежий результат ошибкой network", "Рисование только при рабочем API (проверка typeof addLine); try/catch в drawLine; сетевая ошибка больше не затирает результат", "Исправлен"],
    ["O1", "Слой карты 2ГИС не отрисовывается (заглушка в контейнере карты)", "Для ключа не включён сервис «MapGL JS API» в Platform Manager (Routing API при этом работает)", "Включить сервис «MapGL JS API» для ключа или снять привязку к доменам; правки кода не требуются", "Действие владельца ключа"],
  ],
  { leftCols: [1, 2, 3], small: true }
));
bodyChildren.push(body([
  t("Диагностика O1 выполнена изолированно: на служебной странице /mapgl-test.html один и тот же SDK с реальным и с заведомо неверным ключом ведёт себя идентично (одинаковая заглушка, ни одного запроса тайлов) — это однозначно указывает на состав сервисов ключа, а не на код интеграции. Оба исправления покрыты повторным сквозным прогоном: блоки «Вариантов», предупреждение перемаршрутизации и SVG-схема воспроизводятся стабильно, ошибок в консоли нет."),
]));

// 8. Риски
bodyChildren.push(h1("8. Оценка рисков, квоты и тарифы"));
bodyChildren.push(body([
  t("Ключевое эксплуатационное ограничение — срок демо-ключа (1 месяц) и его квоты. Расход за сессию тестирования составил около двадцати запросов Routing API (порядка 2 % квоты навигации в 1 000 запросов на сервис): кеш прокси и короткие сценарии берегут лимит. Ориентиры стоимости после демо приведены в таблице 6; итоговый счёт зависит от фактического профиля нагрузки парка и уточняется в Platform Manager при переходе на платный тариф."),
], { keepNext: true }));
bodyChildren.push(tableTitle("Таблица 6 — Квоты демо-периода и ориентиры стоимости"));
bodyChildren.push(dataTable(
  [42, 58],
  ["Параметр", "Значение"],
  [
    ["Демо-квота навигации (Routing API и другие навигационные сервисы)", "1 000 запросов на сервис, срок демо — 1 месяц"],
    ["Израсходовано за сессию тестирования", "≈20 запросов Routing API (≈2 % квоты)"],
    ["Routing API после демо", "от 6 700 ₽ за 10 000 маршрутов; −10 % при годовой оплате"],
    ["Map Tiles после демо", "от 8 000 ₽ за 100 000 тайлов"],
    ["Слой пробок в MapGL", "опция trafficOn, обновление данных каждую минуту; тариф по прайсу Platform Manager"],
  ],
  { leftCols: [0, 1] }
));
bodyChildren.push(body([
  t("Риски, которые учитывает архитектура: (а) недоступность внешнего API — прокси отвечает понятной ошибкой, кеш сглаживает пики, в прод-контуре закладывается повтор и деградация к последнему снимку обстановки; (б) зависимость ETA от режима трафика — реалтайм консервативнее прогноза на ~3 минуты, порог перемаршрутизации +5 минут выбран выше этого шума; (в) требования 152-ФЗ — телеметрия парка не обязана покидать контур: для жёстких сценариев сохраняется вариант on-premise платформы 2ГИС (Kubernetes/Helm, сервис traffic-proxy) либо собственный слой пробок из GPS-треков парка (план «Б», уже отражён в каркасе V7)."),
]));

// 9. Выводы
bodyChildren.push(h1("9. Выводы и рекомендации"));
bodyChildren.push(body([
  b("Вердикт: испытания пройдены с одним внешним условием. "),
  t("Серверный стек (Routing API, прокси, кеш, обработка ошибок), логика перемаршрутизации и интеграция в интерфейс соответствуют критериям готовности; не подтверждён только визуальный слой карты 2ГИС — по причине состава сервисов ключа, а не кода."),
]));
bodyChildren.push(body([t("Дальнейшие шаги:")], { noIndent: true, after: 40 }));
const steps = [
  "Владельцу ключа — включить сервис «MapGL JS API» в Platform Manager (или снять привязку к доменам); после этого открыть /mapgl-test.html?k1=КЛЮЧ для контрольной проверки и убедиться, что вкладка «2ГИС» сама подняла карту со слоем пробок.",
  "Разработчику (агенту) — после включения сервиса выполнить визуальную проверку слоя пробок и отрисовки цветных участков на карте, приложить скриншоты к стенду.",
  "Разработчику — перевести опрос активных рейсов в фоновый режим (раз в 2–5 минут по каждому активному рейсу) с уведомлением диспетчера при отклонении ETA на +5 минут и более.",
  "Владельцу стенда — до истечения демо-периода принять решение о платном тарифе (ориентиры в таблице 6) и о переносе ключа в защищённое хранилище (Vault) прод-контура Spring Boot.",
  "Разработчику — параллельно развивать план «Б» (собственный слой пробок из телеметрии парка, миграция V7) как проверку качества и резерв на случай ограничений внешнего API.",
];
steps.forEach((s) => {
  bodyChildren.push(new Paragraph({
    numbering: { reference: "list-next", level: 0 },
    alignment: AlignmentType.LEFT,
    spacing: { line: 312, after: 60 },
    children: [new TextRun({ text: s, size: 24, color: "000000", font: FONT_BODY })],
  }));
});
bodyChildren.push(body([
  t("Материалы испытаний приложены к проекту: сырые ответы 2ГИС и сводные отчёты — в download/2gis-tests/ и download/2gis-tests-proxy/, исправленный код — коммит 8b3e2fa в локальном репозитории стенда."),
]));

// ---------- футеры/шапки ----------
const footerRoman = new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: FONT_BODY })],
  })],
});
const footerArabic = new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: FONT_BODY })],
  })],
});
const bodyHeader = new Header({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "BECFCC", space: 4 } },
    children: [new TextRun({ text: "Стек дорожной обстановки 2ГИС · сборка и тестирование", size: 18, color: "808080", font: FONT_BODY })],
  })],
});

// ---------- сборка документа ----------
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: FONT_BODY, size: 24, color: "000000" },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: FONT_HEAD, size: 32, bold: true, color: PAL.headingDark },
        paragraph: { spacing: { before: 360, after: 160, line: 312 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: FONT_HEAD, size: 28, bold: true, color: PAL.headingDark },
        paragraph: { spacing: { before: 240, after: 120, line: 312 }, outlineLevel: 1 },
      },
    },
  },
  numbering: {
    config: [{
      reference: "list-next",
      levels: [{
        level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }],
    }],
  },
  sections: [
    { // Секция 1: обложка — без колонтитулов и номеров
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1({
        palette: PAL,
        preferredPt: 32,
        englishLabel: "2GIS STACK · TEST REPORT",
        title: "Обстановка на дорогах 2ГИС",
        subtitle: "Сборка стека, интеграция в демо ТМС «АЗМЗ Логистика» и тестирование на живом ключе",
        metaLines: [
          "Проект: корпоративная ТМС «АЗМЗ Логистика» — грузовой автопарк 100–500 ТС",
          "Стенд: Next.js 16 + SQLite, вкладка «2ГИС»; ключ Platform Manager (4a10…6395)",
          "Отчёт по тестированию · шаблон C (testing)",
          "Дата: 11 ноября 2026 г.",
        ],
        footerLeft: "АЗМЗ Логистика · внутренний документ",
        footerRight: "ноябрь 2026",
      }),
    },
    { // Секция 2: содержание — римская нумерация
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      footers: { default: footerRoman },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { before: 480, after: 360 },
          children: [new TextRun({ text: "Содержание", bold: true, size: 32, font: FONT_HEAD, color: PAL.headingDark })],
        }),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({
            text: "Примечание: содержание построено на полях документа. После редактирования отчёта обновите его: правый клик по содержанию → «Обновить поле».",
            italics: true, size: 18, color: "888888", font: FONT_BODY,
          })],
        }),
        // Без PageBreak: тело идёт отдельной секцией NEXT_PAGE — двойной разрыв дал бы пустую страницу.
      ],
    },
    { // Секция 3: тело — арабская нумерация с 1
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: bodyHeader },
      footers: { default: footerArabic },
      children: bodyChildren,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const out = "/home/z/my-project/download/Отчет_стек_2ГИС_тестирование.docx";
  fs.writeFileSync(out, buf);
  console.log("written:", out, buf.length, "bytes");
});
