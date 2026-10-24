'use client'

/** «Отчёты» (Task 72) — понятная структура из четырёх блоков:
 *  1) портфель заявок — воронка по шагам (в работе → проверка → логист → подтверждено);
 *  2) ключевые показатели месяца; 3) ставки по направлениям; 4) экономия по заявкам и история перевозчиков. */
import { useCallback, useEffect, useState, type ComponentType } from 'react'
import {
  Banknote, CheckCheck, FileCheck, FolderOpen, Hourglass, ScanSearch, ShieldCheck, TrendingDown, Users,
} from 'lucide-react'
import {
  ErrorBlock, KpiCard, LoadingBlock, SectionHeader, type TabProps,
} from '@/components/platform/common'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { api } from '@/lib/api'
import { rate } from '@/lib/status'
import type { ReportSummary } from '@/lib/types'

/** «1 заявка / 2 заявки / 5 заявок» */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

const FUNNEL_TONES: Record<string, string> = {
  sky: 'bg-sky-50 text-sky-600 ring-sky-100',
  amber: 'bg-amber-50 text-amber-600 ring-amber-100',
  blue: 'bg-blue-50 text-blue-600 ring-blue-100',
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
}

/** плитка воронки: сколько заявок на конкретном шаге прямо сейчас */
function FunnelTile({ icon: Icon, label, value, hint, tone }: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string
  hint: string
  tone: keyof typeof FUNNEL_TONES
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${FUNNEL_TONES[tone]}`} aria-hidden>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-xl font-bold leading-tight tabular-nums text-slate-900">{value}</div>
        <div className="truncate text-sm font-medium text-slate-700">{label}</div>
        <div className="truncate text-xs text-slate-400">{hint}</div>
      </div>
    </div>
  )
}

export default function ReportsTab({ activeCarrierId: _activeCarrierId, onNavigate: _onNavigate, liveTick }: TabProps) {
  const [report, setReport] = useState<ReportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await api.reports()
      setReport(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // real-time: событие из шины WS мгновенно догружает отчёты
  useEffect(() => {
    if (liveTick > 0) void load()
  }, [liveTick, load])

  // повторная загрузка по кнопке «Повторить» в блоке ошибки
  const refresh = () => {
    void load()
  }

  if (loading && !report) return <LoadingBlock label="Загрузка отчётов…" />
  if (error && !report) return <ErrorBlock message={error} onRetry={refresh} />

  const kpi = report?.kpi
  const directions = [...(report?.byDirection ?? [])].sort((a, b) => b.avgRate - a.avgRate)
  const maxAvg = Math.max(...directions.map((d) => d.avgRate), 1)
  const savings = report?.savingsByRequest ?? []
  const carriers = [...(report?.carriers ?? [])].sort((a, b) => b.taken - a.taken)
  const bestSavings = [...savings].sort((a, b) => b.savings - a.savings).slice(0, 1)[0]

  return (
    <div>
      <SectionHeader
        title="Отчёты"
        desc="Сводка площадки: портфель заявок, экономия и работа перевозчиков"
      />

      {error && report && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Не удалось обновить данные: {error}. Показаны последние загруженные значения.
        </div>
      )}

      {/* 1. Портфель заявок — воронка по шагам */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-base text-slate-900">Портфель заявок</CardTitle>
          <CardDescription>Сколько заявок сейчас находится на каждом шаге цикла</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FunnelTile
            icon={FolderOpen}
            tone="sky"
            label="В работе"
            value={kpi ? String(kpi.openRequests) : '—'}
            hint="открытые и активные заявки"
          />
          <FunnelTile
            icon={Hourglass}
            tone="amber"
            label="Проверка документов"
            value={kpi ? String(kpi.atVerify) : '—'}
            hint="сканы проверяет нейросеть"
          />
          <FunnelTile
            icon={ScanSearch}
            tone="blue"
            label="У логиста"
            value={kpi ? String(kpi.atLogist) : '—'}
            hint="ждут сверки и утверждения"
          />
          <FunnelTile
            icon={CheckCheck}
            tone="emerald"
            label="Подтверждено"
            value={kpi ? String(kpi.confirmed) : '—'}
            hint="рейсы в работе и закрытые"
          />
        </CardContent>
      </Card>

      {/* 2. Ключевые показатели */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Banknote className="h-5 w-5" aria-hidden />}
          label="Экономия за месяц"
          value={rate(kpi?.savingsMonth ?? null)}
          hint="разница стартовой и итоговой ставки"
          tone="green"
        />
        <KpiCard
          icon={<Users className="h-5 w-5" aria-hidden />}
          label="Ставок на заявку"
          value={kpi ? String(kpi.avgBids) : '—'}
          hint="средняя конкуренция на торгах"
          tone="blue"
        />
        <KpiCard
          icon={<ShieldCheck className="h-5 w-5" aria-hidden />}
          label="Документов принято авто"
          value={kpi ? `${kpi.docsAutoShare}%` : '—'}
          hint="без ручной проверки логистом"
          tone="navy"
        />
        <KpiCard
          icon={<FileCheck className="h-5 w-5" aria-hidden />}
          label="Рейсы с ЭТрН"
          value={kpi ? `${kpi.etrnShare}%` : '—'}
          hint="доля рейсов с электронной накладной"
          tone="violet"
        />
      </div>

      {/* 3. Ставки по направлениям */}
      <Card className="mt-6 border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-slate-900">Ставки по направлениям</CardTitle>
          <CardDescription>Средняя и минимальная итоговая ставка по каждому маршруту, сверху — самые дорогие</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {directions.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              Пока нет закрытых рейсов по направлениям
            </div>
          )}
          {directions.map((d) => {
            const width = Math.max(6, Math.round((d.avgRate / maxAvg) * 100))
            return (
              <div key={d.direction}>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-slate-800">{d.direction}</span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      {d.count} {plural(d.count, 'заявка', 'заявки', 'заявок')}
                    </span>
                  </span>
                  <span className="font-semibold text-slate-900">{rate(d.avgRate)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-2.5 rounded-full bg-gradient-to-r from-blue-600 to-sky-400 transition-all" style={{ width: `${width}%` }} />
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">мин {rate(d.minRate)}</span>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* 4. Экономия по заявкам + история перевозчиков */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">Экономия по заявкам</CardTitle>
            <CardDescription>
              Стартовая ставка → итоговая, сортировка по эффекту
              {bestSavings && bestSavings.savings > 0 && (
                <> · лучшая — <b className="text-emerald-700">№{bestSavings.number}</b> ({rate(bestSavings.savings)})</>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead>Заявка</TableHead>
                    <TableHead>Груз</TableHead>
                    <TableHead>Ставка</TableHead>
                    <TableHead className="text-right">Экономия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {savings.map((row) => (
                    <TableRow key={row.number}>
                      <TableCell className="whitespace-nowrap font-bold text-blue-700">№{row.number}</TableCell>
                      <TableCell className="max-w-[180px] truncate text-slate-600" title={row.cargo}>{row.cargo}</TableCell>
                      <TableCell className="whitespace-nowrap text-slate-600">
                        {rate(row.startRate)} → <span className="font-semibold text-slate-900">{rate(row.bestRate)}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold text-emerald-600">
                        <span className="inline-flex items-center gap-1">
                          <TrendingDown className="h-3.5 w-3.5" aria-hidden />
                          {rate(row.savings)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {savings.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-slate-400">Данных пока нет</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">История перевозчиков</CardTitle>
            <CardDescription>Кто сколько рейсов взял, по каким ставкам работает и сколько раз отказался</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead>Перевозчик</TableHead>
                    <TableHead className="text-center">Взято</TableHead>
                    <TableHead className="text-right">Средняя ставка</TableHead>
                    <TableHead className="text-right">Отказов</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {carriers.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="font-medium text-slate-800">{c.name}</TableCell>
                      <TableCell className="text-center font-semibold tabular-nums text-slate-800">{c.taken}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums text-slate-700">{rate(c.avgRate)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {c.refused > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                            {c.refused}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {carriers.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-slate-400">Данных пока нет</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
