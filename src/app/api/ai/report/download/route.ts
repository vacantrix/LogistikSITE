import { NextResponse } from 'next/server'
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { requireUser } from '@/lib/auth'
import { aiLog } from '@/lib/ai/core'
import { plog } from '@/lib/platform-log'
import { toAiReport } from '@/lib/ai/tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/ai/report/download — скачать Word-файл отчёта нейросети (ai-report).
 *
 * Тело — отчёт из чата; сервер ПОВТОРНО валидирует его тем же парсером
 * (toAiReport: белые списки полей, клампы длин, количество), что и при разборе
 * ответа модели: сквозь этот роут нельзя протащить произвольный DOCX — собираем
 * документ только из проверенных полей. Отчёт — один объект, не массив.
 */
export async function POST(req: Request) {
  const auth = await requireUser('logist', 'admin')
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as { report?: unknown } | null
  const report = toAiReport(body?.report)
  if (!report) {
    return NextResponse.json({ error: 'Отчёт не прошёл проверку — попросите нейросеть собрать его заново' }, { status: 400 })
  }

  // титул: название, период, главный вывод + таблицы разделов
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: report.title, heading: HeadingLevel.HEADING_1 }),
  ]
  if (report.period) {
    children.push(new Paragraph({ children: [new TextRun({ text: report.period, italics: true, color: '666666' })] }))
  }
  if (report.summary) {
    children.push(new Paragraph({ children: [new TextRun({ text: report.summary, bold: true })] }))
  }

  // показатели (KPI) — строка за показателем: «Метка — Значение (примечание)»
  if (report.kpis.length > 0) {
    children.push(new Paragraph({ text: 'Показатели', heading: HeadingLevel.HEADING_2 }))
    for (const k of report.kpis) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${k.label}: `, bold: true }),
            new TextRun({ text: k.value }),
            ...(k.note ? [new TextRun({ text: ` (${k.note})`, color: '666666' })] : []),
          ],
        }),
      )
    }
  }

  // разделы: заголовок, абзацы, таблица (у раздела не больше одной)
  for (const s of report.sections) {
    children.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_2 }))
    for (const p of s.paragraphs) {
      children.push(new Paragraph({ text: p }))
    }
    if (s.table && s.table.columns.length >= 2) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: s.table.columns.map(
                (c) =>
                  new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: c, bold: true })] })],
                  }),
              ),
            }),
            ...s.table.rows.map(
              (r) =>
                new TableRow({
                  children: s.table!.columns.map((_, k) =>
                    new TableCell({
                      children: [new Paragraph({ text: r[k] ?? '—' })],
                    }),
                  ),
                }),
            ),
          ],
        }),
      )
      // пустой абзац после таблицы — Word не любит таблицу в самом конце ячейки/документа
      children.push(new Paragraph({ text: '' }))
    }
  }

  // подпись: кто и чем собрано
  children.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: `Собрано нейросетью платформы «АЭМЗ Поток» · ${auth.name}`, color: '888888', size: 18 }),
      ],
    }),
  )

  const doc = new Document({
    creator: 'АЭМЗ Поток — ИИ-помощник',
    title: report.title,
    sections: [{ children }],
  })

  const buffer = await Packer.toBuffer(doc)
  await aiLog('info', 'report_download', `Word-отчёт из чата скачан: «${report.title}»`)
  await plog({
    type: 'AI_REPORT_DOWNLOADED', source: 'api/ai/report/download',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    message: `Скачан Word-отчёт ИИ «${report.title}»`,
    objectType: 'ai_report',
    meta: { title: report.title, period: report.period ?? null, kpis: report.kpis.length, sections: report.sections.length },
  })

  const fileName = 'ai-report.docx'
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(report.title.slice(0, 60))}`,
      'Cache-Control': 'no-store',
    },
  })
}
