'use client'

/** «Отчёты» — экономия площадки, ставки по направлениям, история перевозчиков */
import { useCallback, useEffect, useState } from 'react'
import { Banknote, FileCheck, RefreshCw, ShieldCheck, TrendingDown, Users } from 'lucide-react'
import {
  ErrorBlock, KpiCard, LoadingBlock, SectionHeader, type TabProps,
} from '@/components/platform/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { api } from '@/lib/api'
import { money } from '@/lib/status'
import type { ReportSummary } from '@/lib/types'

/** «1 заявка / 2 заявки / 5 заявок» */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export default function ReportsTab({ activeCarrierId: _activeCarrierId, onNavigate: _onNavigate }: TabProps) {
  const [report, setReport] = useState<ReportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api.reports()
      setReport(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const refresh = () => {
    setRefreshing(true)
    void load()
  }

  if (loading && !report) return <LoadingBlock label="Загрузка отчётов…" />
  if (error && !report) return <ErrorBlock message={error} onRetry={refresh} />

  const kpi = report?.kpi
  const directions = report?.byDirection ?? []
  const maxAvg = Math.max(...directions.map((d) => d.avgRate), 1)

  return (
    <div>
      <SectionHeader
        eyebrow="РЕШЕНИЕ 1 · ЭФФЕКТ ПЛОЩАДКИ"
        title="Экономия и прозрачные ставки вместо переписки"
        desc="Что завод видит в отчётах площадки: экономия, ставки по направлениям, конкуренция и история заявок."
      >
        <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
          Обновить
        </Button>
      </SectionHeader>

      {error && report && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Не удалось обновить данные: {error}. Показаны последние загруженные значения.
        </div>
      )}

      {/* 1. KPI */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Banknote className="h-5 w-5" aria-hidden />}
          label="Экономия"
          value={money(kpi?.savingsMonth ?? null)}
          hint="разница стартовой и итоговой ставки"
          tone="green"
        />
        <KpiCard
          icon={<Users className="h-5 w-5" aria-hidden />}
          label="Среднее число ставок на заявку"
          value={kpi ? String(kpi.avgBids) : '—'}
          hint="конкуренция: кто участвует и кто выигрывает"
          tone="blue"
        />
        <KpiCard
          icon={<ShieldCheck className="h-5 w-5" aria-hidden />}
          label="Документов принято автоматически"
          value={kpi ? `${kpi.docsAutoShare}%` : '—'}
          hint="сомнительные случаи всегда смотрит человек"
          tone="navy"
        />
        <KpiCard
          icon={<FileCheck className="h-5 w-5" aria-hidden />}
          label="ЭТрН сформированы из 1С"
          value={kpi ? `${kpi.etrnShare}%` : '—'}
          hint="модуль «Логистика.Про», подпись КЭП и МЧД"
          tone="violet"
        />
      </div>

      {/* 2. Ставки по направлениям */}
      <Card className="mt-6 border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-slate-900">Ставки по направлениям</CardTitle>
          <CardDescription>Средняя и минимальная итоговая ставка по каждому маршруту</CardDescription>
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
                  <span className="font-medium text-slate-700">
                    {d.direction} · {d.count} {plural(d.count, 'заявка', 'заявки', 'заявок')}
                  </span>
                  <span className="font-semibold text-slate-900">{money(d.avgRate)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-3 flex-1 overflow-hidden rounded bg-slate-100">
                    <div className="h-3 rounded bg-blue-600 transition-all" style={{ width: `${width}%` }} />
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">мин {money(d.minRate)}</span>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* 3. Экономия по заявкам + история перевозчиков */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">Экономия по заявкам</CardTitle>
            <CardDescription>Стартовая ставка → итоговая, сортировка по эффекту</CardDescription>
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
                  {(report?.savingsByRequest ?? []).map((row) => (
                    <TableRow key={row.number}>
                      <TableCell className="whitespace-nowrap font-bold text-blue-700">№{row.number}</TableCell>
                      <TableCell className="text-slate-600">{row.cargo}</TableCell>
                      <TableCell className="whitespace-nowrap text-slate-600">
                        {money(row.startRate)} → <span className="font-semibold text-slate-900">{money(row.bestRate)}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold text-emerald-600">
                        <span className="inline-flex items-center gap-1">
                          <TrendingDown className="h-3.5 w-3.5" aria-hidden />
                          {money(row.savings)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(report?.savingsByRequest ?? []).length === 0 && (
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
            <CardDescription>Кто сколько рейсов взял и по каким ставкам работает</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead>Перевозчик</TableHead>
                    <TableHead>Взято заявок</TableHead>
                    <TableHead className="text-right">Средняя ставка</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(report?.carriers ?? []).map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="font-medium text-slate-800">{c.name}</TableCell>
                      <TableCell className="font-semibold text-slate-800">{c.taken}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-slate-700">{money(c.avgRate)}</TableCell>
                    </TableRow>
                  ))}
                  {(report?.carriers ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-slate-400">Данных пока нет</TableCell></TableRow>
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
