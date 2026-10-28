'use client'

/**
 * «Отчёты» — каталог отчётов для бухгалтерии и руководства с настройкой выгрузки.
 *
 * Слева — каталог (src/lib/reports/catalog.ts): что можно выгрузить сейчас и что «Скоро»
 * (для них в платформе пока нет данных — что именно, видно по наведению). Справа — настройка
 * выбранного отчёта: период, отбор, НДС, группировка, колонки, разделы, шапка и подписи.
 * Под формой — сколько строк и на какую сумму попадёт в документ (сервер считает по тем же
 * настройкам), кнопка «Сформировать DOCX» собирает документ на сервере и скачивает его.
 * Настройки каждого отчёта запоминаются в браузере (кроме периода).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { endOfMonth, startOfMonth, subDays, subMonths } from 'date-fns'
import { ru } from 'date-fns/locale'
import { CalendarRange, Download, Loader2, RotateCcw } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { ErrorBlock, InfoTip, LoadingBlock, SectionHeader, StatusDot, type TabProps } from '@/components/platform/common'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import {
  GROUPING_LABEL, REPORTS, VAT_RATES, defaultSettings, reportDef,
  type ReportDef, type ReportId, type ReportPreview, type ReportSettings,
} from '@/lib/reports/catalog'
import { cn, dayOf, fmtDayRu } from '@/lib/utils'
import type { CarrierDTO } from '@/lib/types'

const STORE_KEY = 'aemz.reports.v1'
const AUDIENCES: { id: ReportDef['audience']; label: string }[] = [
  { id: 'accounting', label: 'Для бухгалтерии' },
  { id: 'management', label: 'Для руководства' },
]

/** пресеты периода: метка → границы (даты включительно) */
const PERIOD_PRESETS: { label: string; range: () => DateRange }[] = [
  { label: 'Текущий месяц', range: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  { label: 'Прошлый месяц', range: () => ({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }) },
  { label: 'Последние 7 дней', range: () => ({ from: subDays(new Date(), 6), to: new Date() }) },
  { label: 'Последние 30 дней', range: () => ({ from: subDays(new Date(), 29), to: new Date() }) },
  { label: 'С начала года', range: () => ({ from: new Date(new Date().getFullYear(), 0, 1), to: new Date() }) },
]

/** шаги формирования — порядок работы сервера; показываются по одному, пока идёт запрос */
const GEN_STEPS = ['собираем данные за период', 'считаем итоги', 'верстаем документ'] as const
const GEN_STEP_MS = 500

const money = (v: number): string => `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} ₽`
const toDate = (iso: string): Date => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d) }

type Stored = { report?: ReportId; settings?: Partial<Record<ReportId, Partial<ReportSettings>>> }
function readStore(): Stored {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Stored } catch { return {} }
}
function writeStore(v: Stored): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(v)) } catch { /* приватный режим — без запоминания */ }
}

/* ── мелкие элементы формы ──────────────────────────────────────────────── */

function Row({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1.5 border-b border-slate-100 py-3 last:border-b-0 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
      <div className="flex items-center gap-1 pt-1 text-sm text-slate-500">
        {label}
        {tip && <InfoTip label={label}>{tip}</InfoTip>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** переключатель «один из»: кнопки в ряд, выбранная — тёмным контуром */
function Segmented<T extends string | number>({ value, options, onChange, disabled }: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="inline-flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={cn(
            'h-8 rounded-md border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            value === o.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** переключатели «несколько из»: выбранные — с галочкой и тёмным контуром */
function Chips({ selected, options, onToggle, disabled }: {
  selected: string[]
  options: { id: string; label: string }[]
  onToggle: (id: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.id)
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onToggle(o.id)}
            className={cn(
              'h-8 rounded-md border px-2.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              on ? 'border-slate-400 bg-slate-100 text-slate-900' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )}
          >
            {on ? '✓ ' : ''}{o.label}
          </button>
        )
      })}
    </div>
  )
}

/* ── раздел ─────────────────────────────────────────────────────────────── */

export default function ReportsTab({ liveTick }: TabProps) {
  const { toast } = useToast()
  const [userName, setUserName] = useState('')
  const [carriers, setCarriers] = useState<CarrierDTO[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [reportId, setReportId] = useState<ReportId>('trips-payable')
  const [all, setAll] = useState<Partial<Record<ReportId, ReportSettings>>>({})
  const [preview, setPreview] = useState<ReportPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genStep, setGenStep] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  /** незавершённый выбор в календаре (первый клик); полный период живёт в настройках отчёта */
  const [picking, setPicking] = useState<DateRange | undefined>(undefined)

  const def = reportDef(reportId) ?? REPORTS[0]
  const today = dayOf(new Date())

  /** настройки отчёта: сохранённые в браузере поверх настроек по умолчанию; период — текущий месяц */
  const settingsFor = useCallback((d: ReportDef, name: string): ReportSettings => {
    const base = defaultSettings(d, { today: dayOf(new Date()), userName: name })
    const saved = readStore().settings?.[d.id] ?? {}
    return { ...base, ...saved, from: base.from, to: base.to, preparedName: saved.preparedName || name }
  }, [])

  // кто формирует (подпись «Составил») и список перевозчиков для отбора
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [me, dir] = await Promise.all([api.me(), api.directory()])
        if (!alive) return
        const stored = readStore()
        const first = stored.report && reportDef(stored.report) ? stored.report : 'trips-payable'
        setUserName(me.user.name)
        setCarriers(dir.carriers)
        setReportId(first)
        setAll({ [first]: settingsFor(reportDef(first)!, me.user.name) })
        setReady(true)
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : 'Неизвестная ошибка')
      }
    })()
    return () => { alive = false }
  }, [settingsFor])

  const s = all[reportId] ?? (ready ? settingsFor(def, userName) : null)

  const update = (patch: Partial<ReportSettings>) => {
    if (!s) return
    const next = { ...s, ...patch }
    setAll((prev) => ({ ...prev, [reportId]: next }))
    const stored = readStore()
    const { from: _f, to: _t, ...keep } = next
    writeStore({ ...stored, report: reportId, settings: { ...stored.settings, [reportId]: keep } })
  }

  const selectReport = (id: ReportId) => {
    setReportId(id)
    setAll((prev) => (prev[id] ? prev : { ...prev, [id]: settingsFor(reportDef(id)!, userName) }))
    writeStore({ ...readStore(), report: id })
  }

  // календарь показывает период выбранного отчёта, пока не начат новый выбор
  const range: DateRange | undefined = picking ?? (s ? { from: toDate(s.from), to: toDate(s.to) } : undefined)

  // сводка «что попадёт в отчёт»: пересчёт при каждом изменении настроек (с паузой) и по событиям платформы
  const settingsKey = s && !def.missing ? JSON.stringify(s) : null
  useEffect(() => {
    if (!settingsKey) return
    let alive = true
    const timer = window.setTimeout(async () => {
      setPreviewing(true)
      try {
        const res = await api.reportPreview(reportId, JSON.parse(settingsKey) as ReportSettings)
        if (alive) { setPreview(res.preview); setPreviewError(null) }
      } catch (e) {
        if (alive) setPreviewError(e instanceof Error ? e.message : 'Не удалось посчитать')
      } finally {
        if (alive) setPreviewing(false)
      }
    }, 350)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [settingsKey, reportId, liveTick])

  const applyPeriod = (from?: Date, to?: Date) => {
    if (!from || !to) return
    setPicking(undefined)
    update({ from: dayOf(from), to: dayOf(to) })
  }

  /** клик по дате при полном диапазоне начинает новый выбор (у react-day-picker v9 он растягивает край) */
  const selectRange = (r: DateRange | undefined) => {
    const prev = range
    let next: DateRange | undefined = r
    if (prev?.from && prev.to && r?.from && r?.to) {
      const sameFrom = r.from.getTime() === prev.from.getTime()
      const sameTo = r.to.getTime() === prev.to.getTime()
      if (sameFrom && !sameTo) next = { from: r.to }
      else if (!sameFrom && sameTo) next = { from: r.from }
    }
    if (next?.from && next?.to) {
      applyPeriod(next.from, next.to)
      setPickerOpen(false)
    } else {
      setPicking(next)
    }
  }

  const generate = async () => {
    if (!s || generating || def.missing) return
    setGenerating(true)
    setGenStep(0)
    const timer = window.setInterval(() => setGenStep((i) => Math.min(i + 1, GEN_STEPS.length - 1)), GEN_STEP_MS)
    try {
      const [{ blob, fileName }] = await Promise.all([
        api.reportExport(reportId, s),
        new Promise((r) => window.setTimeout(r, GEN_STEP_MS * (GEN_STEPS.length - 1))),
      ])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 4000)
      toast({ title: 'Отчёт сформирован', description: fileName })
    } catch (e) {
      toast({ title: 'Не удалось сформировать отчёт', description: e instanceof Error ? e.message : 'Повторите', variant: 'destructive' })
    } finally {
      window.clearInterval(timer)
      setGenerating(false)
    }
  }

  const resetSettings = () => {
    const stored = readStore()
    if (stored.settings) delete stored.settings[reportId]
    writeStore(stored)
    setAll((prev) => ({ ...prev, [reportId]: { ...defaultSettings(def, { today, userName }), from: s?.from ?? today, to: s?.to ?? today } }))
  }

  const carrierOptions = useMemo(() => carriers.map((c) => ({ id: c.id, label: c.name })), [carriers])

  if (loadError) return <ErrorBlock message={loadError} onRetry={() => window.location.reload()} />
  if (!ready || !s) return <LoadingBlock label="Открываем отчёты…" />

  const has = (c: ReportDef['controls'][number]) => def.controls.includes(c)
  const off = def.missing !== null
  const accounting = def.audience === 'accounting'
  const rangeLabel = range?.from && range?.to
    ? (dayOf(range.from) === dayOf(range.to) ? fmtDayRu(range.from) : `${fmtDayRu(range.from)} – ${fmtDayRu(range.to)}`)
    : range?.from ? `${fmtDayRu(range.from)} – …` : 'Выберите период'

  return (
    <div>
      <SectionHeader title="Отчёты" desc="Выберите отчёт, настройте, что в него попадёт, и сформируйте документ DOCX. Настройки каждого отчёта запоминаются." />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* ── каталог ── */}
        <nav aria-label="Каталог отчётов" className="space-y-5">
          {AUDIENCES.map((aud) => (
            <div key={aud.id}>
              <div className="mb-2 px-1 text-sm text-slate-500">{aud.label}</div>
              <div className="space-y-1.5">
                {REPORTS.filter((r) => r.audience === aud.id).map((r) => {
                  const selected = r.id === reportId
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => selectReport(r.id)}
                      aria-current={selected ? 'true' : undefined}
                      className={cn(
                        'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                        selected ? 'border-slate-300 bg-slate-100 shadow-[inset_3px_0_0_#0f172a]' : 'border-slate-200 bg-white hover:bg-slate-50',
                      )}
                    >
                      <div className={cn('text-sm font-medium', r.missing ? 'text-slate-500' : 'text-slate-900')}>{r.title}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{r.summary}</div>
                      <StatusDot dot={r.missing ? 'bg-slate-300' : 'bg-emerald-500'} className="mt-1.5 text-xs text-slate-500">
                        {r.missing ? 'Скоро' : 'Можно выгрузить'}
                      </StatusDot>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* ── настройка выбранного отчёта ── */}
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-slate-900">{def.title}</h3>
                <div className="mt-0.5 text-sm text-slate-500">
                  {def.summary} · форма {def.formCode}{def.landscape ? ' · альбомный лист' : ''}
                </div>
              </div>
              {off ? (
                <span className="flex items-center gap-1">
                  <StatusDot dot="bg-slate-300" className="text-slate-500">Скоро</StatusDot>
                  <InfoTip label="Чего не хватает">{def.missing}</InfoTip>
                </span>
              ) : (
                <Button variant="ghost" size="sm" className="gap-1.5 text-slate-500" onClick={resetSettings}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  Настройки по умолчанию
                </Button>
              )}
            </div>

            <fieldset disabled={off} className="mt-1">
              {has('period') && (
                <Row label="Период">
                  <Popover open={pickerOpen} onOpenChange={(open) => { setPickerOpen(open); if (!open) setPicking(undefined) }}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="h-9 gap-2 border-slate-300 font-normal text-slate-800" disabled={off}>
                        <CalendarRange className="h-4 w-4 text-slate-500" aria-hidden />
                        {rangeLabel}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-0">
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
                                applyPeriod(r.from, r.to)
                                setPickerOpen(false)
                              }}
                            >
                              {preset.label}
                            </Button>
                          ))}
                        </div>
                        <Calendar mode="range" numberOfMonths={1} selected={range} onSelect={selectRange} locale={ru} disabled={{ after: new Date() }} defaultMonth={range?.from} />
                      </div>
                    </PopoverContent>
                  </Popover>
                </Row>
              )}

              {has('dateBasis') && (
                <Row label="Дата рейса" tip="По какой дате рейс попадает в период: по дате погрузки или по дате создания заявки">
                  <Segmented value={s.dateBasis} onChange={(v) => update({ dateBasis: v })} disabled={off}
                    options={[{ id: 'load', label: 'Погрузки' }, { id: 'created', label: 'Создания заявки' }]} />
                </Row>
              )}

              {has('carriers') && (
                <Row label="Перевозчики">
                  <div className="flex flex-wrap gap-1.5">
                    <Chips
                      selected={s.carrierIds.length === 0 ? ['__all'] : []}
                      options={[{ id: '__all', label: 'Все' }]}
                      onToggle={() => update({ carrierIds: [] })}
                      disabled={off}
                    />
                    <Chips
                      selected={s.carrierIds}
                      options={carrierOptions}
                      onToggle={(id) => update({ carrierIds: s.carrierIds.includes(id) ? s.carrierIds.filter((x) => x !== id) : [...s.carrierIds, id] })}
                      disabled={off}
                    />
                  </div>
                </Row>
              )}

              {has('scope') && (
                <Row label="Какие рейсы" tip="Закрытые — рейс выполнен и закрыт логистом. В рейсе — документы подтверждены, машина едет">
                  <Segmented value={s.scope} onChange={(v) => update({ scope: v })} disabled={off}
                    options={[{ id: 'closed', label: 'Закрытые' }, { id: 'done', label: 'Закрытые и в рейсе' }]} />
                </Row>
              )}

              {has('edoFilter') && (
                <Row label="Документы">
                  <Segmented value={s.edoFilter} onChange={(v) => update({ edoFilter: v })} disabled={off}
                    options={[{ id: 'all', label: 'Все' }, { id: 'unsigned', label: 'Ещё не подписаны' }, { id: 'signed', label: 'Подписаны' }]} />
                </Row>
              )}

              {has('vat') && (
                <Row label="НДС" tip="Как показывать НДС в суммах: не выделять, выделить из суммы (ставки с НДС) или начислить сверху (ставки без НДС)">
                  <div className="flex flex-wrap items-center gap-3">
                    <Segmented value={s.vat} onChange={(v) => update({ vat: v })} disabled={off}
                      options={[{ id: 'none', label: 'Не выделять' }, { id: 'included', label: 'В т. ч.' }, { id: 'on-top', label: 'Сверху' }]} />
                    {s.vat !== 'none' && (
                      <Segmented value={s.vatRate} onChange={(v) => update({ vatRate: v })} disabled={off}
                        options={VAT_RATES.map((r) => ({ id: r, label: `${r} %` }))} />
                    )}
                  </div>
                </Row>
              )}

              {has('grouping') && def.groupings && (
                <Row label="Группировка">
                  <Segmented value={s.grouping} onChange={(v) => update({ grouping: v })} disabled={off}
                    options={def.groupings.map((g) => ({ id: g, label: GROUPING_LABEL[g] }))} />
                </Row>
              )}

              {has('columns') && def.columns && (
                <Row label="Колонки" tip="Номер строки, заявка и суммы в таблице есть всегда">
                  <Chips
                    selected={s.columns}
                    options={def.columns.map((c) => ({ id: c.id, label: c.label }))}
                    onToggle={(id) => update({ columns: s.columns.includes(id) ? s.columns.filter((x) => x !== id) : [...s.columns, id] })}
                    disabled={off}
                  />
                </Row>
              )}

              {has('sections') && def.sections && (
                <Row label="Разделы">
                  <Chips
                    selected={s.sections}
                    options={def.sections.map((c) => ({ id: c.id, label: c.label }))}
                    onToggle={(id) => update({ sections: s.sections.includes(id) ? s.sections.filter((x) => x !== id) : [...s.sections, id] })}
                    disabled={off}
                  />
                </Row>
              )}

              {has('signers') && (
                <>
                  <Row label="Шапка документа">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Input value={s.organization} onChange={(e) => update({ organization: e.target.value })} placeholder="ООО «АЭМЗ»" aria-label="Организация" className="h-9" />
                      <Input value={s.department} onChange={(e) => update({ department: e.target.value })} placeholder="Отдел логистики" aria-label="Подразделение" className="h-9" />
                    </div>
                  </Row>
                  <Row label={accounting ? 'Составил' : 'Подготовил'}>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Input value={s.preparedPosition} onChange={(e) => update({ preparedPosition: e.target.value })} placeholder="Должность" aria-label="Должность составителя" className="h-9" />
                      <Input value={s.preparedName} onChange={(e) => update({ preparedName: e.target.value })} placeholder="Фамилия И. О." aria-label="ФИО составителя" className="h-9" />
                    </div>
                  </Row>
                  <Row label={accounting ? 'Проверил' : 'Согласовал'} tip={accounting ? undefined : 'Оставьте пустым, если строка не нужна'}>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Input value={s.checkedPosition} onChange={(e) => update({ checkedPosition: e.target.value })} placeholder="Должность" aria-label="Должность проверяющего" className="h-9" />
                      <Input value={s.checkedName} onChange={(e) => update({ checkedName: e.target.value })} placeholder="Фамилия И. О. — можно вписать от руки" aria-label="ФИО проверяющего" className="h-9" />
                    </div>
                  </Row>
                </>
              )}
            </fieldset>

            {/* ── что попадёт в отчёт и выгрузка ── */}
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
              <div className="min-w-0 flex-1 text-sm" role="status" aria-live="polite">
                {off ? (
                  <span className="text-slate-500">Выгрузка появится, когда в платформе будут нужные данные</span>
                ) : generating ? (
                  <span className="flex items-center gap-2 text-slate-700">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    {GEN_STEPS[genStep]}…
                  </span>
                ) : previewError ? (
                  <span className="text-red-700">{previewError}</span>
                ) : preview ? (
                  <span className={cn('text-slate-700', previewing && 'opacity-60')}>
                    {preview.empty ? 'За период ничего не найдено' : (
                      <>
                        В отчёт попадёт: <span className="font-medium text-slate-900">{preview.rowsLabel}</span>
                        {preview.amount != null && preview.amountLabel && (
                          <> · {preview.amountLabel} <span className="font-medium text-slate-900">{money(preview.amount)}</span></>
                        )}
                      </>
                    )}
                  </span>
                ) : (
                  <span className="text-slate-500">Считаем…</span>
                )}
              </div>
              {off ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0}>
                      <Button disabled className="gap-2"><Download className="h-4 w-4" aria-hidden />Сформировать DOCX</Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">{def.missing}</TooltipContent>
                </Tooltip>
              ) : (
                <Button onClick={() => void generate()} disabled={generating} className="gap-2">
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
                  {generating ? 'Формируем…' : 'Сформировать DOCX'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
