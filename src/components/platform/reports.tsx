'use client'

/**
 * «Отчёты» (Task 100) — две бумажные проформы за выбранный период:
 *  № 1 — экономия по заявкам: сколько сэкономлено всего, проекция на месяц
 *  (для идущего месяца) и из чего она складывается (по направлениям и по
 *  каждой заявке);
 *  № 2 — обороты и использование привлечённого транспорта: количество заявок,
 *  оборот, распределение по перевозчикам и статусам.
 * Период выбирается календарём (или пресетами) — и данные на странице, и DOCX
 * формируются сервером автоматически по этому периоду. Круговые диаграммы
 * строятся единым кодом с DOCX (lib/pie-svg) — на странице они выглядят так же,
 * как в скачанных файлах. Пока документ готовится, показывается анимация
 * песочных часов (Task 101, components/platform/hourglass-loader).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { endOfMonth, startOfMonth, subDays, subMonths } from 'date-fns'
import { ru } from 'date-fns/locale'
import { CalendarRange, Download } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { ErrorBlock, SectionHeader, type TabProps } from '@/components/platform/common'
import { HourglassLoader } from '@/components/platform/hourglass-loader'
import { useToast } from '@/hooks/use-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { api } from '@/lib/api'
import { rate } from '@/lib/status'
import { cn, dayOf, fmtDayRu, parseDay } from '@/lib/utils'
import { buildPieSvg } from '@/lib/pie-svg'
import type { ReportPieSlice, ReportSummary } from '@/lib/types'

const money = (v: number): string => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(v))} ₽`
const pct = (v: number): string => `${v.toFixed(1).replace('.', ',')} %`
const ton = (v: number): string => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(v)} т`

/** плитка-показатель внутри проформы */
function ProTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
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

/** пресеты периода: метка → границы (даты включительно) */
const PERIOD_PRESETS: { label: string; range: () => DateRange }[] = [
  { label: 'Текущий месяц', range: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  { label: 'Прошлый месяц', range: () => ({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }) },
  { label: 'Последние 7 дней', range: () => ({ from: subDays(new Date(), 6), to: new Date() }) },
  { label: 'Последние 30 дней', range: () => ({ from: subDays(new Date(), 29), to: new Date() }) },
]

export default function ReportsTab({ activeCarrierId: _activeCarrierId, onNavigate: _onNavigate, liveTick }: TabProps) {
  const [report, setReport] = useState<ReportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState(false)
  const [range, setRange] = useState<DateRange | undefined>(() => ({ from: startOfMonth(new Date()), to: new Date() }))
  const [pickerOpen, setPickerOpen] = useState(false)
  /** какая проформа сейчас формируется на сервере (для анимации песочных часов) */
  const [generating, setGenerating] = useState<1 | 2 | null>(null)
  const generatingRef = useRef<1 | 2 | null>(null)
  const { toast } = useToast()
  const periodRef = useRef<{ from?: string; to?: string }>({})
  /** зеркало range для selectRange: отличаем первый клик выбора от продолжения */
  const rangeRef = useRef<DateRange | undefined>({ from: startOfMonth(new Date()), to: new Date() })

  const load = useCallback(async (p?: { from?: string; to?: string }) => {
    if (!p) setSwitching(true)
    try {
      const data = await api.reports(p)
      periodRef.current = data.period
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

  // real-time: событие из шины WS мгновенно догружает отчёты за выбранный период
  useEffect(() => {
    if (liveTick > 0) void load(periodRef.current)
  }, [liveTick, load])

  /** применить период: обновить календарь и перезагрузить отчёты */
  const applyPeriod = useCallback((from?: Date, to?: Date) => {
    if (!from || !to) return
    const next = { from, to }
    rangeRef.current = next
    setRange(next)
    void load({ from: dayOf(from), to: dayOf(to) })
  }, [load])

  /**
   * Выбор диапазона. У react-day-picker v9 клик по дате при уже полном диапазоне
   * растягивает его одной границей; привычная семантика датапикеров иная — клик
   * начинает новый выбор. Поэтому один изменённый край трактуем как старт нового
   * диапазона (ждём второй клик), а полный новый диапазон — применяем сразу.
   */
  const selectRange = (r: DateRange | undefined) => {
    const prev = rangeRef.current
    const prevFull = Boolean(prev?.from && prev?.to)
    let next: DateRange | undefined = r
    if (prevFull && r?.from && r?.to) {
      const sameFrom = r.from.getTime() === prev.from?.getTime()
      const sameTo = r.to.getTime() === prev.to?.getTime()
      if (sameFrom && !sameTo) next = { from: r.to }
      else if (!sameFrom && sameTo) next = { from: r.from }
    }
    rangeRef.current = next
    setRange(next)
    if (next?.from && next?.to) {
      applyPeriod(next.from, next.to)
      setPickerOpen(false)
    }
  }

  /**
   * Скачать проформу: документ формируется на сервере по выбранному периоду,
   * пока он готовится — экран с песочными часами (Task 101). Файл приходит
   * blob'ом, чтобы имя из Content-Disposition (кириллица, пробелы) сохранилось.
   */
  const downloadDocx = useCallback(async (type: 1 | 2) => {
    if (generatingRef.current) return
    generatingRef.current = type
    setGenerating(type)
    try {
      const { blob, fileName } = await api.reportDocxBlob(type, periodRef.current)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 4000)
      toast({
        title: type === 1 ? 'Проформа № 1 сформирована' : 'Проформа № 2 сформирована',
        description: `${fileName} — скачивание началось`,
      })
    } catch (e) {
      toast({
        title: 'Не удалось сформировать отчёт',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      generatingRef.current = null
      setGenerating(null)
    }
  }, [toast])

  if (loading && !report) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-white px-6 py-14 text-slate-500">
        <HourglassLoader size={72} />
        <div className="text-sm font-medium">Готовим отчёты…</div>
      </div>
    )
  }
  if (error && !report) return <ErrorBlock message={error} onRetry={() => void load(periodRef.current)} />

  const p1 = report?.proforma1
  const p2 = report?.proforma2
  const p1Rows = p1?.rows ?? []
  const p2Carriers = p2?.byCarrier ?? []
  const today = new Date()
  const rangeLabel = range?.from && range?.to
    ? (dayOf(range.from) === dayOf(range.to) ? fmtDayRu(range.from) : `${fmtDayRu(range.from)} – ${fmtDayRu(range.to)}`)
    : range?.from
      ? `${fmtDayRu(range.from)} – …`
      : 'Выберите период'

  return (
    <div>
      <SectionHeader eyebrow="Бумажные проформы" title="Отчёты">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="h-10 gap-2 border-slate-300 font-medium text-slate-800"
              disabled={!report || switching}
              aria-label="Период отчёта"
            >
              <CalendarRange className="h-4 w-4 text-slate-500" aria-hidden />
              {rangeLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0">
            <div className="flex flex-col sm:flex-row">
              <div className="flex shrink-0 flex-col gap-0.5 border-b border-slate-100 p-2 sm:w-44 sm:border-b-0 sm:border-r">
                {PERIOD_PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    variant="ghost"
                    size="sm"
                    className="justify-start font-normal text-slate-700"
                    onClick={() => {
                      const r = preset.range()
                      if (r.from && r.to) applyPeriod(r.from, r.to)
                      setPickerOpen(false)
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <Calendar
                mode="range"
                numberOfMonths={1}
                selected={range}
                onSelect={selectRange}
                locale={ru}
                disabled={{ after: today }}
                defaultMonth={range?.from}
              />
            </div>
          </PopoverContent>
        </Popover>
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
              <CardTitle className="text-lg text-slate-900">Экономия по заявкам</CardTitle>
              <CardDescription>
                {p1?.periodLabel ?? '—'} · подтверждено рейсов: {p1?.confirmedCount ?? 0}, из них с экономией: {p1?.savingsCount ?? 0}
              </CardDescription>
            </div>
            <Button
              className="h-10 shrink-0"
              onClick={() => void downloadDocx(1)}
              disabled={generating !== null}
              title="Скачать бумажную проформу № 1 (DOCX)"
            >
              <Download className="h-4 w-4" aria-hidden />
              {generating === 1 ? 'Формируем…' : 'Скачать DOCX'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <ProTile label="Сэкономлено всего" value={money(p1?.savedTotal ?? 0)} accent />
              <ProTile label={p1?.projectionLabel ?? 'Проекция на месяц'} value={money(p1?.projectionMonth ?? 0)} />
              <ProTile label="Средняя на заявку" value={money(p1?.avgSaving ?? 0)} />
              <ProTile label="Снижение ставки" value={pct(p1?.avgSavingPct ?? 0)} />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <PieView title="Экономия по направлениям" slices={p1?.byDirection ?? []} unit="₽" centerHint="сэкономлено" />
              <PieView title="Доли заявок в общей экономии" slices={p1?.byRequest ?? []} unit="₽" centerHint="сэкономлено" />
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold text-slate-800">Из чего складывается экономия</div>
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
                          <TableCell colSpan={4} className="text-slate-700">ИТОГО за период</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums text-emerald-700">{money(p1?.savedTotal ?? 0)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums text-slate-700">{pct(p1?.avgSavingPct ?? 0)}</TableCell>
                          <TableCell />
                        </TableRow>
                      )}
                      {p1Rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="py-8 text-center text-slate-400">
                            За выбранный период заявок с экономией нет
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
                {p2?.periodLabel ?? '—'} · заявок: {p2?.requestsCount ?? 0}, рейсов на привлечённом транспорте: {p2?.confirmedCount ?? 0}
              </CardDescription>
            </div>
            <Button
              className="h-10 shrink-0"
              onClick={() => void downloadDocx(2)}
              disabled={generating !== null}
              title="Скачать бумажную проформу № 2 (DOCX)"
            >
              <Download className="h-4 w-4" aria-hidden />
              {generating === 2 ? 'Формируем…' : 'Скачать DOCX'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <ProTile label="Заявок за период" value={String(p2?.requestsCount ?? 0)} />
              <ProTile label="Рейсов подтверждено" value={String(p2?.confirmedCount ?? 0)} />
              <ProTile label="Оборот" value={money(p2?.turnover ?? 0)} accent />
              <ProTile label="Средняя ставка" value={rate(p2?.avgRate ?? null)} />
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
              <span>Тоннаж заявок: <b className="text-slate-900">{ton(p2?.tonnageTotal ?? 0)}</b></span>
              <span>Ставок на заявку: <b className="text-slate-900">{String(p2?.avgBids ?? 0).replace('.', ',')}</b></span>
              <span>Рейсов с ЭТрН: <b className="text-slate-900">{p2?.etrnCount ?? 0} из {p2?.confirmedCount ?? 0}</b></span>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <PieView title="Оборот по перевозчикам (привлечённый транспорт)" slices={(p2?.byCarrier ?? []).map((c) => ({ label: c.name, value: c.turnover, share: c.share }))} unit="₽" centerHint="оборот" />
              <PieView title="Заявки периода по статусам" slices={p2?.byStatus ?? []} unit="шт" centerHint="заявок" />
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold text-slate-800">Перевозчики за период</div>
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
                            За выбранный период подтверждённых рейсов нет
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

      {/* анимация подготовки: песочные часы, пока сервер собирает DOCX (Task 101) */}
      {generating !== null && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="w-full max-w-sm animate-in fade-in zoom-in-95 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-2xl duration-200">
            <div className="relative mx-auto flex h-40 w-40 items-center justify-center">
              <span aria-hidden className="absolute inset-2 animate-pulse rounded-full bg-amber-100 blur-2xl" />
              <HourglassLoader size={104} className="relative" />
            </div>
            <div className="mt-3 text-base font-semibold text-slate-900">Формируем отчёт…</div>
            <div className="mt-1 text-sm leading-snug text-slate-500">
              {generating === 1
                ? 'Проформа № 1 — Экономия по заявкам'
                : 'Проформа № 2 — Обороты и привлечённый транспорт'}
            </div>
            <div className="mt-0.5 text-xs text-slate-400">{rangeLabel}</div>
            <div className="mt-5 flex items-center justify-center gap-1.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-2 w-2 animate-bounce rounded-full bg-amber-500"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
