import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/auth'
import { plog, plogError } from '@/lib/platform-log'
import { isoDay, mskDay, parseIsoDay } from '@/lib/report-period'
import { normalizeSettings, reportDef } from '@/lib/reports/catalog'
import { buildReportDoc } from '@/lib/reports/build'
import { renderReportDocx } from '@/lib/reports/docx'
import { allowedFor, permDenied } from '@/lib/permissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/reports/export — отчёт из каталога раздела «Отчёты» по настройкам выгрузки.
 * Тело: { report, settings, preview? }. preview: true — только сводка (сколько строк и на
 * какую сумму попадёт в отчёт), иначе — готовый DOCX. Выгрузка пишется в журнал платформы.
 */
export async function POST(req: NextRequest) {
  // выгрузка — только внутренний контур АЭМЗ, как и сам раздел «Отчёты»
  const user = await requireUser('admin', 'logist')
  if (user instanceof NextResponse) return user
  // права (Task 111): выгрузка отчётов — тем же правом reports:view
  if (!(await allowedFor(user, 'reports:view'))) {
    return NextResponse.json({ error: permDenied('reports:view') }, { status: 403 })
  }

  const body = (await req.json().catch(() => null)) as { report?: unknown; settings?: unknown; preview?: unknown } | null
  const def = typeof body?.report === 'string' ? reportDef(body.report) : undefined
  if (!def) return NextResponse.json({ error: 'Неизвестный отчёт' }, { status: 404 })
  if (def.missing) return NextResponse.json({ error: `Отчёт «${def.title}» пока недоступен. ${def.missing}` }, { status: 400 })

  const settings = normalizeSettings(def, body?.settings, { today: isoDay(mskDay(new Date())), userName: user.name })
  if (!settings || !parseIsoDay(settings.from) || !parseIsoDay(settings.to)) {
    return NextResponse.json({ error: 'Период задаётся существующими датами в формате ГГГГ-ММ-ДД' }, { status: 400 })
  }

  try {
    const doc = await buildReportDoc(def, settings)
    if (body?.preview === true) return NextResponse.json({ preview: doc.preview })

    const buffer = await renderReportDocx(doc)
    await plog({
      type: 'REPORT_EXPORTED', source: 'api/reports/export',
      actor: { login: user.login, name: user.name, role: user.role },
      message: `Отчёт «${def.title}» ${doc.period} — ${doc.preview.rowsLabel}`,
    })
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${doc.fileName}"; filename*=UTF-8''${encodeURIComponent(doc.displayName)}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    await plogError('api/reports/export', e, {
      type: 'REPORT_FAILED', source: 'api/reports/export',
      actor: { login: user.login, name: user.name, role: user.role },
      message: `Не удалось сформировать отчёт «${def.title}»`,
    })
    return NextResponse.json({ error: 'Не удалось сформировать отчёт — повторите' }, { status: 500 })
  }
}
