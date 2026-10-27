'use client'

/**
 * «Отчёты» (Task 99) — переработанный раздел из двух бумажных проформ:
 *  № 1 — экономия по заявкам за месяц: сколько сэкономлено всего, проекция на
 *  месяц и из чего она складывается (по направлениям и по каждой заявке);
 *  № 2 — обороты и использование привлечённого транспорта: количество заявок,
 *  оборот, распределение по перевозчикам и статусам.
 * Круговые диаграммы строятся единым кодом с DOCX (lib/pie-svg) — на странице
 * они выглядят так же, как в скачанных файлах. Кнопка «Скачать DOCX» отдаёт
 * готовую бумажную форму (api/reports/docx).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import {
  ErrorBlock, InfoTip, LoadingBlock, SectionHeader, type TabProps,
} from '@/components/platform/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { api } from '@/lib/api'
import { rate } from '@/lib/status'
import { cn, monthLabel } from '@/lib/utils'
import { buildPieSvg } from '@/lib/pie-svg'
import type { ReportPieSlice, ReportSummary } from '@/lib/types'

const money = (v: number): string => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(v))} ₽`
const pct = (v: number): string => `${v.toFixed(1).replace('.', ',')} %`
const ton = (v: number): string => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(v)} т`

/** плитка-показатель внутри проформы */
function ProTile({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
        {hint && <InfoTip label={label}>{hint}</InfoTip>}
      </div>
      <div className={cn('mt-1 text-xl font-bold leading-tight tabular-nums', accent ? 'text-emerald-600' : 'text-slate-900')}>
        {value}
      </div>
    </div>
  )
}

/** круговая диаграмма на странице — тот же SVG, что уходит в DOCX */
function PieView({ title, slices, unit, centerHint }: { title: string; slices: ReportPieSlice[]; unit: string; centerHint: string }) {
  const svg = useMemo(
    () => buildPieSvg({ title, slices: slices.map((s) => ({ label: s.label, value: s.value })), unit, centerHint }),
    [title, slices, unit, centerHint],
  )
  return (
    <div
      className="rounded-xl border border-slate-200 bg-white p-2 [&_svg]:h-auto [&_svg]:w-full"
      role="img"
      aria-label={title}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export default function ReportsTab({ activeCarrierId: _activeCarrierId, onNavigate: _onNavigate, liveTick }: TabProps) {
  const [report, setReport] = useState<ReportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState(false)
  const monthRef = useRef('')

  const load = useCallback(async (m?: string) => {
    if (!m) setSwitching(true)
    try {
      const data = await api.reports(m || undefined)
      monthRef.current = data.month
      setReport(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setLoading(false)
      setSwitching(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // real-time: событие из шины WS мгновенно догружает отчёты за выбранный месяц
  useEffect(() => {
    if (liveTick > 0) void load(monthRef.current || undefined)
  }, [liveTick, load])

  const changeMonth = (m: string) => { void load(m) }

  if (loading && !report) return <LoadingBlock label="Загрузка отчётов…" />
  if (error && !report) return <ErrorBlock message={error} onRetry={() => void load(monthRef.current || undefined)} />

  const p1 = report?.proforma1
  const p2 = report?.proforma2
  const p1Rows = p1?.rows ?? []
  const p2Carriers = p2?.byCarrier ?? []

  return (
    <div>
      <SectionHeader
        eyebrow="Бумажные проформы"
        title="Отчёты"
        desc={<>Две бумажные формы за выбранный месяц: экономия по заявкам и обороты с привлечённым транспортом. Диаграммы видны на странице и попадают в скачанные DOCX.</>}
      >
        <Select value={monthRef.current || undefined} onValueChange={changeMonth} disabled={!report || switching}>
          <SelectTrigger className="h-10 w-[190px]" aria-label="Месяц отчёта">
            <SelectValue placeholder="Месяц" />
          </SelectTrigger>
          <SelectContent>
            {(report?.months ?? []).map((m) => (
              <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SectionHeader>

      {error && report && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Не удалось обновить данные: {error}. Показаны последние загруженные значения.
        </div>
      )}

      <div className={cn('space-y-8 transition-opacity', switching && 'pointer-events-none opacity-50')}>
        {/* ── Проформа № 1 — экономия по заявкам ─────────────────────────── */}
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 border-b border-slate-100 bg-slate-50/70">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-slate-900 text-slate-50 hover:bg-slate-900">Проформа № 1</Badge>
                <Badge variant="outline" className="border-slate-300 text-slate-600">Форма АЭМЗ-ОП-1</Badge>
              </div>
              <CardTitle className="text-lg text-slate-900">Экономия по заявкам за месяц</CardTitle>
              <CardDescription>
                {p1?.monthLabel ?? '—'} · подтверждено рейсов: {p1?.confirmedCount ?? 0}, из них с экономией: {p1?.savingsCount ?? 0}
                <InfoTip label="Экономия по заявкам">
                  Экономия заявки = (стартовая ставка торгов − итоговая ставка) × тоннаж. В расчёт входят подтверждённые и закрытые рейсы месяца.
                </InfoTip>
              </CardDescription>
            </div>
            <Button asChild className="h-10 shrink-0">
              <a href={api.reportDocxUrl(1, monthRef.current || undefined)} title="Скачать бумажную проформу № 1 (DOCX)">
                <Download className="h-4 w-4" aria-hidden />
                Скачать DOCX
              </a>
            </Button>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <ProTile
                label="Сэкономлено всего"
                value={money(p1?.savedTotal ?? 0)}
                accent
                hint="сумма экономии по всем заявкам месяца"
              />
              <ProTile
                label={p1?.monthComplete ? 'Факт за месяц' : 'Проекция на месяц'}
                value={money(p1?.projectionMonth ?? 0)}
                hint={p1?.monthComplete
                  ? 'месяц завершён — проекция равна фактической экономии'
                  : 'прогноз экономии на полный месяц по среднему дневному темпу'}
              />
              <ProTile
                label="Средняя на заявку"
                value={money(p1?.avgSaving ?? 0)}
                hint="средняя экономия одной заявки"
              />
              <ProTile
                label="Снижение ставки"
                value={pct(p1?.avgSavingPct ?? 0)}
                hint="средний процент снижения ставки от стартовой"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <PieView title="Экономия по направлениям" slices={p1?.byDirection ?? []} unit="₽" centerHint="сэкономлено" />
              <PieView title="Доли заявок в общей экономии" slices={p1?.byRequest ?? []} unit="₽" centerHint="сэкономлено" />
            </div>

            <div>
              <div className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-800">
                Из чего складывается экономия
                <InfoTip label="Из чего складывается экономия">Каждая заявка месяца: стартовая ставка → итоговая, экономия деньгами и процент снижения.</InfoTip>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="max-h-96 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="sticky left-0 top-0 z-10 bg-slate-50">№ заявки</TableHead>
                        <TableHead className="sticky top-0 z-10 bg-slate-50">Направление</TableHead>
                        <TableHead className="sticky top-0 z-10 bg-slate-50">Груз</TableHead>
                        <TableHead className="sticky top-0 z-10 bg-slate-50">Ставка, ₽/т</TableHead>
                        <TableHead className="sticky top-0 z-10 bg-slate-50 text-right">Экономия</TableHead>
                        <TableHead className="sticky top-0 z-10 bg-slate-50 text-right">Снижение</TableHead>
                        <TableHead className="sticky top-0 z-10 bg-slate-50">Перевозчик</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p1Rows.map((r) => (
                        <TableRow key={r.number}>
                          <TableCell className="whitespace-nowrap font-bold text-slate-900">№{r.number}</TableCell>
                          <TableCell className="max-w-[220px] truncate text-slate-700" title={r.direction}>{r.direction}</TableCell>
                          <TableCell className="max-w-[160px] truncate text-slate-600" title={r.cargo}>{r.cargo}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums text-slate-600">
                            {new Intl.NumberFormat('ru-RU').format(Math.round(r.startRate))} → <span className="font-semibold text-slate-900">{r.bestRate != null ? new Intl.NumberFormat('ru-RU').format(Math.round(r.bestRate)) : '—'}</span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums text-emerald-600">{money(r.savings)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums text-slate-600">{pct(r.pct)}</TableCell>
                          <TableCell className="max-w-[160px] truncate text-slate-700" title={r.carrier}>{r.carrier}</TableCell>
                        </TableRow>
                      ))}
                      {p1Rows.length > 1 && (
                        <TableRow className="bg-slate-50 font-semibold">
                          <TableCell colSpan={4} className="text-slate-700">ИТОГО за {p1?.monthLabel.toLowerCase() ?? 'период'}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums text-emerald-700">{money(p1?.savedTotal ?? 0)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums text-slate-700">{pct(p1?.avgSavingPct ?? 0)}</TableCell>
                          <TableCell />
                        </TableRow>
                      )}
                      {p1Rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="py-8 text-center text-slate-400">
                            За выбранный месяц заявок с экономией нет
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Проформа № 2 — обороты и привлечённый транспорт ────────────── */}
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 border-b border-slate-100 bg-slate-50/70">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-slate-900 text-slate-50 hover:bg-slate-900">Проформа № 2</Badge>
                <Badge variant="outline" className="border-slate-300 text-slate-600">Форма АЭМЗ-ОП-2</Badge>
              </div>
              <CardTitle className="text-lg text-slate-900">Обороты и привлечённый транспорт</CardTitle>
              <CardDescription>
                {p2?.monthLabel ?? '—'} · заявок: {p2?.requestsCount ?? 0}, рейсов на привлечённом транспорте: {p2?.confirmedCount ?? 0}
                <InfoTip label="Обороты и привлечённый транспорт">
                  Оборот = итоговая ставка × тоннаж по подтверждённым рейсам. Привлечённый транспорт — перевозки перевозчиков площадки (рейсы с назначенным победителем торгов).
                </InfoTip>
              </CardDescription>
            </div>
            <Button asChild className="h-10 shrink-0">
              <a href={api.reportDocxUrl(2, monthRef.current || undefined)} title="Скачать бумажную проформу № 2 (DOCX)">
                <Download className="h-4 w-4" aria-hidden />
                Скачать DOCX
              </a>
            </Button>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <ProTile label="Заявок за месяц" value={String(p2?.requestsCount ?? 0)} hint="все заявки месяца, кроме удалённых" />
              <ProTile label="Рейсов подтверждено" value={String(p2?.confirmedCount ?? 0)} hint="выполнены привлечённым транспортом перевозчиков" />
              <ProTile label="Оборот" value={money(p2?.turnover ?? 0)} accent hint="итоговые ставки подтверждённых рейсов × тоннаж" />
              <ProTile label="Средняя ставка" value={rate(p2?.avgRate ?? null)} hint="средняя итоговая ставка подтверждённых рейсов" />
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
              <span>Тоннаж заявок: <b className="text-slate-900">{ton(p2?.tonnageTotal ?? 0)}</b></span>
              <span>Ставок на заявку: <b className="text-slate-900">{String(p2?.avgBids ?? 0).replace('.', ',')}</b></span>
              <span>Рейсов с ЭТрН: <b className="text-slate-900">{p2?.etrnCount ?? 0} из {p2?.confirmedCount ?? 0}</b></span>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <PieView title="Оборот по перевозчикам (привлечённый транспорт)" slices={(p2?.byCarrier ?? []).map((c) => ({ label: c.name, value: c.turnover, share: c.share }))} unit="₽" centerHint="оборот" />
              <PieView title="Заявки месяца по статусам" slices={p2?.byStatus ?? []} unit="шт" centerHint="заявок" />
            </div>

            <div>
              <div className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-800">
                Перевозчики за период
                <InfoTip label="Перевозчики за период">Сколько рейсов взял каждый перевозчик, его оборот, средняя ставка и доля в обороте месяца.</InfoTip>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="max-h-96 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="sticky left-0 top-0 z-10 bg-slate-50">Перевозчик</TableHead>
                        <TableHead className="sticky top-0 z-10 bg-slate-50 text-center">Рейсов</TableHead>
                        <TableHead className="sticky top-0 z-10 bg-slate-50 text-right">Оборот</TableHead>
                        <TableHead className="sticky top-0 z-10 bg-slate-50 text-right">Средняя ставка</TableHead>
                        <TableHead className="sticky top-0 z-10 bg-slate-50 text-right">Доля оборота</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p2Carriers.map((c) => (
                        <TableRow key={c.name}>
                          <TableCell className="max-w-[240px] truncate font-medium text-slate-800" title={c.name}>{c.name}</TableCell>
                          <TableCell className="text-center font-semibold tabular-nums text-slate-800">{c.trips}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums text-slate-700">{money(c.turnover)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums text-slate-700">{rate(c.avgRate)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums text-slate-700">{pct(c.share)}</TableCell>
                        </TableRow>
                      ))}
                      {p2Carriers.length > 1 && (
                        <TableRow className="bg-slate-50 font-semibold">
                          <TableCell className="text-slate-700">ИТОГО</TableCell>
                          <TableCell className="text-center tabular-nums text-slate-800">{p2?.confirmedCount ?? 0}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums text-slate-900">{money(p2?.turnover ?? 0)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums text-slate-700">{rate(p2?.avgRate ?? null)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums text-slate-700">100 %</TableCell>
                        </TableRow>
                      )}
                      {p2Carriers.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="py-8 text-center text-slate-400">
                            За выбранный месяц подтверждённых рейсов нет
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
