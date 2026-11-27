'use client'

/**
 * Виджеты ответов нейросети в чате — «нейросеть сама создаёт элементы прямо
 * в окне общения», но только отображения для удобства человека:
 *
 *  • AiCardList — карточки фактов (ai-card): профиль перевозчика, характеристики,
 *    памятка, сравнение — иконка по типу, метки-фильтры, пары «параметр — значение»;
 *  • AiReportCard — отчёт (ai-report): показатели, разделы с таблицами и выводами,
 *    кнопка «Скачать Word» (сервер повторно валидирует и верстает DOCX);
 *  • AiLinkChips — кнопки-переходы (ai-links) на любой раздел платформы:
 *    ключ проверен сервером по каталогу, нажатие открывает раздел.
 *
 * Все данные приходят уже провалидированными с сервера (белые списки в
 * lib/ai/tools): виджеты не пишут в базу и не трогают платформу — это только
 * удобное отображение и навигация для человека.
 */
import { useState } from 'react'
import {
  ArrowRight,
  Briefcase,
  Download,
  FileText,
  Gauge,
  Info,
  ListChecks,
  Loader2,
  Route,
  Store,
  TrendingUp,
  Truck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { aiFetch } from '@/components/platform/ai-shared'
import { aiNavLink } from '@/lib/ai/nav-catalog'
import type { AiCard, AiLinkRef, AiReport } from '@/lib/ai/tools'
import type { TabKey } from '@/components/platform/common'

/* ——— карточки фактов (ai-card) ——— */

// Палитра тёмная: виджеты живут в чёрном терминальном чате ИИ-помощника —
// иконки и метки в тёмных оттенках (emerald-950/300 и т.д.), текст zinc.
const CARD_KIND_META: Record<string, { Icon: typeof Briefcase; title: string; accent: string; iconCls: string }> = {
  profile: { Icon: Briefcase, title: 'Профиль', accent: 'bg-emerald-950 text-emerald-300', iconCls: 'text-emerald-400' },
  vehicle: { Icon: Truck, title: 'Машина', accent: 'bg-amber-950 text-amber-300', iconCls: 'text-amber-400' },
  route: { Icon: Route, title: 'Маршрут', accent: 'bg-sky-950 text-sky-300', iconCls: 'text-sky-400' },
  market: { Icon: Store, title: 'Рынок', accent: 'bg-violet-950 text-violet-300', iconCls: 'text-violet-400' },
  analysis: { Icon: Gauge, title: 'Разбор', accent: 'bg-zinc-900 text-zinc-300', iconCls: 'text-zinc-400' },
  notice: { Icon: Info, title: 'Важно', accent: 'bg-red-950 text-red-300', iconCls: 'text-red-400' },
  checklist: { Icon: ListChecks, title: 'Памятка', accent: 'bg-teal-950 text-teal-300', iconCls: 'text-teal-400' },
}

export function AiCardList({ cards }: { cards: AiCard[] }) {
  if (cards.length === 0) return null
  return (
    <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
      {cards.map((card, i) => {
        const meta = CARD_KIND_META[card.kind] ?? CARD_KIND_META.analysis
        const Icon = meta.Icon
        return (
          <Card key={`${card.title}-${i}`} className="border-zinc-800 bg-zinc-950 shadow-none transition-colors hover:border-zinc-700">
            <CardContent className="flex h-full flex-col gap-2.5 p-4">
              <div className="flex items-start gap-2.5">
                <span aria-hidden className={`mt-0.5 shrink-0 rounded-lg ${meta.accent} p-1.5`}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{meta.title}</p>
                  <p className="text-sm font-semibold leading-snug text-zinc-100">{card.title}</p>
                </div>
              </div>

              {card.badges.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {card.badges.map((b, j) => (
                    <span key={j} className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-zinc-300">
                      {b}
                    </span>
                  ))}
                </div>
              )}

              {card.fields.length > 0 && (
                <dl className="space-y-1.5">
                  {card.fields.map((f, j) => (
                    <div key={j} className="flex gap-2 text-xs">
                      <dt className="w-24 shrink-0 truncate text-zinc-500">{f.label}</dt>
                      <dd className="min-w-0 flex-1 break-words font-medium text-zinc-200">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {card.note && (
                <p className={`mt-auto rounded-lg px-3 py-2 text-xs leading-relaxed ${card.kind === 'notice' ? 'bg-red-950/60 text-red-300' : 'bg-zinc-900 text-zinc-400'}`}>
                  {card.note}
                </p>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

/* ——— ссылки на разделы платформы (ai-links, опционально с фильтрами) ——— */

/** Сводка фильтров ссылки для подписи: «Абинск → Сочи · тент» — коротко и по-русски */
function filtersSummary(filters: Record<string, string>): string {
  const LABEL: Record<string, string> = { q: 'поиск', from: 'из', to: 'в', weight: 'т', volume: 'м³', bodies: '', payments: '', minRate: 'от' }
  const parts: string[] = []
  if (filters.from && filters.to) parts.push(`${filters.from} → ${filters.to}`)
  else {
    if (filters.from) parts.push(`из ${filters.from}`)
    if (filters.to) parts.push(`в ${filters.to}`)
  }
  if (filters.bodies) parts.push(filters.bodies)
  if (filters.weight) parts.push(`${filters.weight} ${LABEL.weight}`)
  if (filters.volume) parts.push(`${filters.volume} м³`)
  if (filters.minRate) parts.push(`от ${filters.minRate} ₽`)
  if (filters.q) parts.push(`«${filters.q}»`)
  return parts.join(' · ')
}

export function AiLinkChips({ links, onNavigate }: {
  links: AiLinkRef[]
  onNavigate?: (tab: TabKey, opts?: { filters?: Record<string, string> }) => void
}) {
  if (links.length === 0) return null
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-zinc-400">
        <ArrowRight aria-hidden className="h-3.5 w-3.5 text-emerald-400" />
        Дальше на платформе:
      </div>
      <div className="flex flex-col gap-1.5">
        {links.map((link, i) => {
          const meta = aiNavLink(link.tab)
          const summary = link.filters ? filtersSummary(link.filters) : ''
          return (
            <button
              key={`${link.tab}-${i}`}
              type="button"
              disabled={!onNavigate}
              onClick={onNavigate ? () => onNavigate(link.tab as TabKey, link.filters ? { filters: link.filters } : undefined) : undefined}
              className="group flex min-h-[44px] w-full items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-left transition-colors hover:border-emerald-700 hover:bg-zinc-900 disabled:cursor-default disabled:opacity-60"
              aria-label={`Открыть раздел «${meta?.label ?? link.tab}»${link.filters ? ` с фильтрами: ${summary}` : ''}`}
            >
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-950 text-emerald-300 transition-colors group-hover:bg-emerald-900"
              >
                <ArrowRight className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-zinc-100">
                  {meta?.label ?? link.tab}
                  {link.filters && (
                    <span className="ml-1.5 inline-flex items-center rounded-md border border-emerald-900 bg-emerald-950 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-emerald-300">
                      с фильтрами
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-zinc-500">{link.label}</span>
                {summary && (
                  <span className="mt-0.5 block truncate text-[11px] text-emerald-300">{summary}</span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ——— отчёт (ai-report) ——— */

export function AiReportCard({ report }: { report: AiReport }) {
  const { toast } = useToast()
  const [downloading, setDownloading] = useState(false)

  const download = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      const res = await aiFetch('/api/ai/report/download', {
        method: 'POST',
        body: JSON.stringify({ report }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json?.error ?? `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'ai-report.docx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: 'Word-отчёт скачан', description: report.title })
    } catch (e) {
      toast({
        title: 'Не удалось скачать отчёт',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setDownloading(false)
    }
  }

  const cells = report.kpis
  const kpiRows: AiReport['kpis'][] = []
  for (let i = 0; i < cells.length; i += 3) kpiRows.push(cells.slice(i, i + 3))

  return (
    <Card className="mt-2 border-zinc-800 bg-zinc-950 shadow-none">
      <CardContent className="space-y-4 p-4">
        {/* шапка отчёта */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 pb-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
              <FileText aria-hidden className="h-3.5 w-3.5" />
              Отчёт нейросети
              {report.period && <span className="font-normal text-zinc-500">{` · ${report.period}`}</span>}
            </p>
            <h3 className="mt-1 text-base font-bold leading-snug text-zinc-100">{report.title}</h3>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-9 shrink-0 border-zinc-700 bg-transparent text-zinc-300 hover:border-emerald-600 hover:bg-zinc-900 hover:text-emerald-300"
            disabled={downloading}
            onClick={() => void download()}
            aria-label={`Скачать отчёт «${report.title}» в Word`}
          >
            {downloading ? (
              <Loader2 aria-hidden className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download aria-hidden className="mr-1 h-3.5 w-3.5" />
            )}
            Скачать Word
          </Button>
        </div>

        {/* главный вывод */}
        {report.summary && (
          <p className="flex gap-2 rounded-xl bg-emerald-950/50 px-3.5 py-2.5 text-sm leading-relaxed text-emerald-100">
            <TrendingUp aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <span>{report.summary}</span>
          </p>
        )}

        {/* показатели */}
        {kpiRows.length > 0 && (
          <div className="space-y-2">
            {kpiRows.map((row, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {row.map((k, j) => (
                  <div key={j} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{k.label}</p>
                    <p className="mt-0.5 text-lg font-extrabold leading-none text-zinc-100">{k.value}</p>
                    {k.note && <p className="mt-1 text-[11px] leading-snug text-zinc-500">{k.note}</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* разделы: заголовок, абзацы, таблица */}
        {report.sections.map((s, i) => (
          <section key={i} className="space-y-2">
            <h4 className="flex items-center gap-2 text-sm font-bold text-zinc-200">
              <span aria-hidden className="h-4 w-1 rounded bg-emerald-500" />
              {s.heading}
            </h4>
            {s.paragraphs.map((p, j) => (
              <p key={j} className="text-sm leading-relaxed text-zinc-300">
                {p}
              </p>
            ))}
            {s.table && (
              <div className="max-h-80 overflow-auto rounded-xl border border-zinc-800" style={{ scrollbarWidth: 'thin' }}>
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-zinc-900 text-left">
                    <tr>
                      {s.table.columns.map((c, j) => (
                        <th key={j} className="whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.table.rows.map((r, j) => (
                      <tr key={j} className="border-t border-zinc-800 odd:bg-zinc-950 even:bg-zinc-900/50">
                        {s.table!.columns.map((_, k) => (
                          <td key={k} className="px-3 py-2 align-top text-zinc-300">
                            {r[k] ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </CardContent>
    </Card>
  )
}
