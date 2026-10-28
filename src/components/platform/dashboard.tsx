'use client'

/** Раздел «Сводка» — KPI, пайплайн статусов, журнал событий, быстрые действия */
import { useCallback, useEffect, useState } from 'react'
import {
  Banknote,
  ChevronRight,
  ClipboardList,
  FileBarChart2,
  ScanSearch,
  ShieldCheck,
  Truck,
  Warehouse,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  EmptyState,
  ErrorBlock,
  KpiCard,
  LoadingBlock,
  SectionHeader,
  type TabProps,
} from '@/components/platform/common'
import { api } from '@/lib/api'
import { REQUEST_STATUS_META, fmtDateTime, money } from '@/lib/status'
import type { EventFeedItem, ReportSummary, RequestDTO, RequestStatus } from '@/lib/types'

const PIPELINE: RequestStatus[] = ['PUBLISHED', 'AWARDED', 'DOCS_REVIEW', 'AT_LOGIST', 'CONFIRMED', 'CLOSED']

const QUICK_ACTIONS = [
  { key: 'board', title: 'Площадка заявок', desc: 'Ставки и заявки в работе', icon: Truck },
  { key: 'verify', title: 'Проверка документов', desc: 'Фото, поля, решение логиста', icon: ScanSearch },
  { key: 'reports', title: 'Отчёты', desc: 'Экономия и активность перевозчиков', icon: FileBarChart2 },
  { key: 'registry', title: 'Реестр рейсов', desc: 'Единый реестр рейсов', icon: Warehouse },
] as const

export default function DashboardTab({ onNavigate }: TabProps) {
  const [report, setReport] = useState<ReportSummary | null>(null)
  const [requests, setRequests] = useState<RequestDTO[]>([])
  const [events, setEvents] = useState<EventFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [r, list, ev] = await Promise.all([api.reports(), api.listRequests(), api.events(15)])
      setReport(r)
      setRequests(list.requests)
      setEvents(ev.events)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const kpi = report?.kpi
  const counts = Object.fromEntries(
    PIPELINE.map((s) => [s, requests.filter((r) => r.status === s).length]),
  ) as Record<RequestStatus, number>

  return (
    <section aria-label="Сводка платформы">
      <SectionHeader title="Сводка" />

      {loading && <LoadingBlock label="Загружаем сводку…" />}
      {!loading && error && <ErrorBlock message={error} onRetry={() => void load()} />}

      {!loading && !error && report && kpi && (
        <div className="space-y-6">
          {/* 1. KPI */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              icon={<ClipboardList className="h-5 w-5" aria-hidden />}
              label="Заявки на площадке"
              value={kpi.openRequests}
              tone="blue"
              hint="Опубликованы и ждут ставок перевозчиков"
            />
            <KpiCard
              icon={<Banknote className="h-5 w-5" aria-hidden />}
              label="Экономия к стартовым ставкам"
              value={money(kpi.savingsMonth)}
              tone="green"
              hint="Подтверждённые и закрытые рейсы: (стартовая − итоговая ставка) × тоннаж"
            />
            <KpiCard
              icon={<ScanSearch className="h-5 w-5" aria-hidden />}
              label="У логиста на сверке"
              value={kpi.atLogist}
              tone="amber"
              hint="Комплекты документов на сверке фото с полями"
            />
            <KpiCard
              icon={<ShieldCheck className="h-5 w-5" aria-hidden />}
              label="Документов принято автоматически"
              value={`${kpi.docsAutoShare}%`}
              tone="navy"
              hint={`Рейсы с ЭТрН: ${kpi.etrnShare}%`}
            />
          </div>

          {/* 2. Лента статусов (пайплайн) */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Лента статусов</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-stretch gap-y-3">
                {PIPELINE.map((s, i) => {
                  const meta = REQUEST_STATUS_META[s]
                  return (
                    <div key={s} className="flex items-center">
                      {i > 0 && <ChevronRight className="mx-1.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
                      <div className="flex min-w-[104px] flex-col items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                        <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-slate-700">
                          <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden />
                          {meta.short}
                        </span>
                        <span className="text-lg font-bold leading-none text-slate-900">{counts[s]}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* 3. Журнал событий + быстрые действия */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="border-slate-200 shadow-sm lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Журнал событий</CardTitle>
              </CardHeader>
              <CardContent>
                {events.length === 0 ? (
                  <EmptyState title="Событий пока нет" hint="События появятся, как только начнётся работа с заявками" />
                ) : (
                  <ul
                    className="max-h-96 space-y-1 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300"
                    aria-label="Лента последних событий"
                  >
                    {events.map((ev) => (
                      <li key={ev.id} className="flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm leading-snug text-slate-800">{ev.message}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <time dateTime={ev.createdAt}>{fmtDateTime(ev.createdAt)}</time>
                            {ev.requestNumber && (
                              <button
                                type="button"
                                onClick={() => onNavigate('board')}
                                className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-700 transition-colors hover:bg-slate-50"
                                aria-label={`Открыть заявку ${ev.requestNumber} на площадке заявок`}
                              >
                                {ev.requestNumber}
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Быстрые действия</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {QUICK_ACTIONS.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => onNavigate(a.key)}
                      className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
                      aria-label={`Перейти в раздел «${a.title}»`}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition-colors group-hover:bg-slate-200" aria-hidden>
                        <a.icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold leading-tight text-slate-900">{a.title}</span>
                        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{a.desc}</span>
                      </span>
                      <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </section>
  )
}
