'use client'

/**
 * «Избранное» ИИ-помощника — календарь всего, что дал агент:
 *  — ответы чата, сохранённые кнопкой «В избранное» (AiSavedMessage);
 *  — варианты, отобранные человеком из списков ai-best (AiFavorite).
 * Календарь показывает дни с сохранениями; клик по дню открывает всё
 * сохранённое за него — с вопросом, ответом, моделью и временем.
 * Отсюда можно позвонить, скопировать карточку или убрать сохранение.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeft,
  Bot,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  Phone,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react'
import {
  EmptyState,
  ErrorBlock,
  KpiCard,
  LoadingBlock,
  SectionHeader,
  useLiveTab,
  type TabProps,
} from '@/components/platform/common'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { aiFetch } from '@/components/platform/ai-shared'
import { gigaModelLabel } from '@/lib/ai/models'
import { AI_ENGINE_LABELS } from '@/lib/ai/rights'

interface FavoriteDTO {
  id: string
  key: string
  query: string
  rank: number
  title: string
  route: string
  rate: string
  date: string
  company: string
  contact: string
  note: string
  engine: string | null
  createdAt: string
}

/** сохранённый ответ агента (AiSavedMessage) */
interface SavedMessageDTO {
  id: string
  messageId: string | null
  question: string
  answer: string
  modelKey: string | null
  engine: string | null
  createdAt: string
}

const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtDayLong(key: string): string {
  const d = new Date(`${key}T00:00:00`)
  if (Number.isNaN(d.getTime())) return key
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' })
}

/** ключ дня «ГГГГ-ММ-ДД» — по местным часам браузера */
function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Телефон из свободного контакта: «Иван, +7 900 000-00-00» → tel:+79000000000 */
function phoneHref(contact: string): string | null {
  const match = contact.match(/\+?\d[\d\s\-()]{8,}\d/)
  if (!match) return null
  const digits = match[0].replace(/[^\d+]/g, '')
  return digits.replace(/\D/g, '').length >= 10 ? `tel:${digits}` : null
}

function favoriteText(f: FavoriteDTO): string {
  return [
    f.title,
    f.route && `Маршрут: ${f.route}`,
    f.rate && `Ставка: ${f.rate}`,
    f.date && `Дата: ${f.date}`,
    f.company && `Компания: ${f.company}`,
    f.contact && `Контакт: ${f.contact}`,
    f.note && `Примечание: ${f.note}`,
    f.query && `Запрос: ${f.query}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function savedText(s: SavedMessageDTO): string {
  return [s.question && `Вопрос: ${s.question}`, `Ответ: ${s.answer}`].filter(Boolean).join('\n\n')
}

export default function FavoritesTab({ onNavigate, liveTick }: TabProps) {
  const { toast } = useToast()
  const [items, setItems] = useState<FavoriteDTO[] | null>(null)
  const [answers, setAnswers] = useState<SavedMessageDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // календарь: показываемый месяц (первое число) и выбранный день
  const [month, setMonth] = useState<Date>(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [selectedDay, setSelectedDay] = useState<string>(() => dayKey(new Date()))
  // «за день» ↔ «всё» — переключатель под календарём
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [favRes, ansRes] = await Promise.all([
        aiFetch('/api/ai/favorites'),
        aiFetch('/api/ai/saved-messages'),
      ])
      const favJson = await favRes.json().catch(() => ({}))
      if (!favRes.ok) throw new Error(favJson?.error ?? `HTTP ${favRes.status}`)
      const ansJson = await ansRes.json().catch(() => ({}))
      if (!ansRes.ok) throw new Error(ansJson?.error ?? `HTTP ${ansRes.status}`)
      setItems(Array.isArray(favJson?.favorites) ? (favJson.favorites as FavoriteDTO[]) : [])
      setAnswers(Array.isArray(ansJson?.messages) ? (ansJson.messages as SavedMessageDTO[]) : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // живое окно: избранное и сохранённые ответы обновляются сами — общий «пульс»
  // платформы (события WS + такт page.tsx) и страховочный интервал; тихо, на месте
  useLiveTab(load, liveTick, 20_000)

  const removeFavorite = useCallback(
    async (id: string) => {
      setBusy(id)
      try {
        const res = await aiFetch(`/api/ai/favorites?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
        setItems((prev) => (prev ? prev.filter((f) => f.id !== id) : prev))
        toast({ title: 'Убрано из избранного' })
      } catch (e) {
        toast({
          title: 'Не удалось убрать',
          description: e instanceof Error ? e.message : String(e),
          variant: 'destructive',
        })
      } finally {
        setBusy(null)
      }
    },
    [toast],
  )

  const removeAnswer = useCallback(
    async (id: string) => {
      setBusy(id)
      try {
        const res = await aiFetch(`/api/ai/saved-messages?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
        setAnswers((prev) => (prev ? prev.filter((s) => s.id !== id) : prev))
        toast({ title: 'Сохранённый ответ убран' })
      } catch (e) {
        toast({
          title: 'Не удалось убрать',
          description: e instanceof Error ? e.message : String(e),
          variant: 'destructive',
        })
      } finally {
        setBusy(null)
      }
    },
    [toast],
  )

  const copy = useCallback(
    async (text: string, title: string) => {
      try {
        await navigator.clipboard.writeText(text)
        toast({ title: 'Скопировано', description: title })
      } catch {
        toast({ title: 'Браузер не дал доступ к буферу', variant: 'destructive' })
      }
    },
    [toast],
  )

  // ——— календарь: всё сохранённое по дням ———
  const byDay = useMemo(() => {
    const map = new Map<string, { offers: FavoriteDTO[]; answers: SavedMessageDTO[] }>()
    const put = (key: string) => {
      let cell = map.get(key)
      if (!cell) {
        cell = { offers: [], answers: [] }
        map.set(key, cell)
      }
      return cell
    }
    for (const f of items ?? []) {
      const key = dayKey(new Date(f.createdAt))
      put(key).offers.push(f)
    }
    for (const s of answers ?? []) {
      const key = dayKey(new Date(s.createdAt))
      put(key).answers.push(s)
    }
    for (const cell of map.values()) {
      // внутри дня — от старого к новому, как в ленте чата
      cell.offers.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      cell.answers.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    }
    return map
  }, [items, answers])

  /** дни месяца: 6 недель от понедельника — чтобы сетка была ровной */
  const grid = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const shift = (first.getDay() + 6) % 7 // Пн=0 … Вс=6
    const start = new Date(first)
    start.setDate(start.getDate() - shift)
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      return d
    })
  }, [month])

  const shiftMonth = useCallback((delta: number) => {
    setMonth((prev) => {
      const next = new Date(prev.getFullYear(), prev.getMonth() + delta, 1)
      return next
    })
    setShowAll(false)
  }, [])

  const goToday = useCallback(() => {
    const now = new Date()
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1))
    setSelectedDay(dayKey(now))
    setShowAll(false)
  }, [])

  const selectDay = useCallback((key: string) => {
    setSelectedDay(key)
    setShowAll(false)
  }, [])

  const kpi = useMemo(() => {
    const offers = items ?? []
    const saved = answers ?? []
    return {
      total: offers.length + saved.length,
      answers: saved.length,
      offers: offers.length,
    }
  }, [items, answers])

  const todayKey = dayKey(new Date())
  const dayCell = byDay.get(selectedDay)
  const dayOffers = dayCell?.offers ?? []
  const dayAnswers = dayCell?.answers ?? []
  const listTitle = showAll ? 'Все сохранения' : fmtDayLong(selectedDay)

  // при «всё»: сначала новые дни
  const allDays = useMemo(() => {
    return [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, cell]) => ({ key, cell }))
  }, [byDay])

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="ИИ-помощник"
        tone="amber"
        title="Избранное"
        desc="Календарь всего, что дал агент: сохранённые ответы чата (кнопка «В избранное» у ответа) и отобранные варианты из списков нейросети. Кликните день — увидите сохранённое за него; у вариантов можно позвонить и скопировать карточку."
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-9" onClick={() => void load()}>
            <RefreshCw aria-hidden className="mr-1 h-3.5 w-3.5" />
            Обновить
          </Button>
          <Button size="sm" className="h-9" onClick={() => onNavigate('ai')}>
            <ArrowLeft aria-hidden className="mr-1 h-3.5 w-3.5" />
            К ИИ-помощнику
          </Button>
        </div>
      </SectionHeader>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard icon={<Star className="h-5 w-5" aria-hidden />} label="Сохранено всего" value={kpi.total} tone="violet" />
        <KpiCard icon={<Bot className="h-5 w-5" aria-hidden />} label="Ответов агента" value={kpi.answers} tone="navy" />
        <KpiCard icon={<Building2 className="h-5 w-5" aria-hidden />} label="Вариантов" value={kpi.offers} tone="green" />
      </div>

      {error && <ErrorBlock message={error} onRetry={() => void load()} />}
      {items === null && answers === null && !error && <LoadingBlock label="Загружаем избранное…" />}

      {items !== null && answers !== null && (
        <div className="space-y-5">
          {/* ——— календарь сохранённого ——— */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 w-9 p-0"
                    onClick={() => shiftMonth(-1)}
                    aria-label="Предыдущий месяц"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </Button>
                  <div className="min-w-[10.5rem] text-center font-semibold text-slate-900">
                    {MONTHS_RU[month.getMonth()]} {month.getFullYear()}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 w-9 p-0"
                    onClick={() => shiftMonth(1)}
                    aria-label="Следующий месяц"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
                <Button variant="outline" size="sm" className="h-9" onClick={goToday}>
                  <CalendarDays aria-hidden className="mr-1 h-3.5 w-3.5" />
                  Сегодня
                </Button>
                <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-violet-500" aria-hidden />
                    варианты
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-zinc-700" aria-hidden />
                    ответы агента
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`Календарь сохранённого: ${MONTHS_RU[month.getMonth()]}`}>
                {WEEKDAYS_RU.map((wd) => (
                  <div key={wd} className="py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {wd}
                  </div>
                ))}
                {grid.map((d) => {
                  const key = dayKey(d)
                  const inMonth = d.getMonth() === month.getMonth()
                  const cell = byDay.get(key)
                  const offersN = cell?.offers.length ?? 0
                  const answersN = cell?.answers.length ?? 0
                  const has = offersN + answersN > 0
                  const isToday = key === todayKey
                  const isSel = key === selectedDay && !showAll
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => selectDay(key)}
                      aria-label={`${d.getDate()} ${MONTHS_RU[d.getMonth()]}${has ? ` — сохранений: ${offersN + answersN}` : ''}`}
                      aria-pressed={isSel}
                      className={`flex min-h-[44px] flex-col items-center justify-center rounded-lg border text-sm transition-colors ${
                        isSel
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : has
                            ? 'border-slate-300 bg-white text-slate-900 hover:border-slate-500'
                            : 'border-transparent text-slate-400 hover:bg-slate-100'
                      } ${!inMonth ? 'opacity-35' : ''}`}
                    >
                      <span className={`leading-none ${isToday && !isSel ? 'font-bold text-slate-900' : ''}`}>
                        {d.getDate()}
                        {isToday && !isSel && <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-violet-600 align-baseline" aria-hidden />}
                      </span>
                      {has && (
                        <span className="mt-1 flex items-center gap-1" aria-hidden>
                          {offersN > 0 && <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-500" />}
                          {answersN > 0 && <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-600" />}
                          <span className="text-[10px] leading-none">{offersN + answersN}</span>
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* ——— сохранённое за выбранный день (или всё) ——— */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">{listTitle}</h3>
              {!showAll && (
                <Badge variant="outline" className="border-slate-300 font-normal text-slate-500">
                  {dayOffers.length + dayAnswers.length} шт.
                </Badge>
              )}
              <Button
                variant={showAll ? 'default' : 'outline'}
                size="sm"
                className="ml-auto h-9"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? 'Показать выбранный день' : 'Показать все сохранения'}
              </Button>
            </div>

            {!showAll && dayOffers.length === 0 && dayAnswers.length === 0 && (
              <EmptyState
                icon={<CalendarDays className="h-10 w-10" aria-hidden />}
                title="В этот день ничего не сохраняли"
                hint="Дни с сохранениями помечены точками. В чате ИИ-помощника нажмите «В избранное» у ответа — он появится здесь в этот день."
              />
            )}

            {showAll ? (
              allDays.length === 0 ? (
                <EmptyState
                  icon={<Star className="h-10 w-10" aria-hidden />}
                  title="Пока пусто"
                  hint="В чате ИИ-помощника нажмите «В избранное» у подходящего ответа — он появится здесь в календаре."
                />
              ) : (
                <div className="space-y-5">
                  {allDays.map(({ key, cell }) => (
                    <div key={key} className="space-y-3">
                      <div className="flex items-center gap-2 border-b border-slate-200 pb-1">
                        <h4 className="text-sm font-semibold text-slate-700">{fmtDayLong(key)}</h4>
                        <Badge variant="outline" className="border-slate-300 font-normal text-slate-500">
                          {cell.offers.length + cell.answers.length} шт.
                        </Badge>
                      </div>
                      <DayList
                        offers={cell.offers}
                        answers={cell.answers}
                        busy={busy}
                        onCopy={copy}
                        onRemoveFavorite={(id) => void removeFavorite(id)}
                        onRemoveAnswer={(id) => void removeAnswer(id)}
                      />
                    </div>
                  ))}
                </div>
              )
            ) : (
              <DayList
                offers={dayOffers}
                answers={dayAnswers}
                busy={busy}
                onCopy={copy}
                onRemoveFavorite={(id) => void removeFavorite(id)}
                onRemoveAnswer={(id) => void removeAnswer(id)}
              />
            )}
          </div>

          {kpi.total === 0 && (
            <div className="flex justify-center">
              <Button onClick={() => onNavigate('ai')}>Открыть ИИ-помощник</Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** содержимое одного дня: карточки вариантов и сохранённых ответов агента */
function DayList({ offers, answers, busy, onCopy, onRemoveFavorite, onRemoveAnswer }: {
  offers: FavoriteDTO[]
  answers: SavedMessageDTO[]
  busy: string | null
  onCopy: (text: string, title: string) => void
  onRemoveFavorite: (id: string) => void
  onRemoveAnswer: (id: string) => void
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {offers.map((f) => {
        const tel = phoneHref(f.contact)
        return (
          <Card key={f.id} className="border-slate-200 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-violet-50 px-2 text-xs font-bold text-violet-700">
                  #{f.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold leading-snug text-slate-900">{f.title}</div>
                  {f.route && <div className="mt-0.5 text-sm text-slate-600">{f.route}</div>}
                </div>
                <div className="shrink-0 text-right">
                  {f.rate && <div className="text-lg font-bold text-emerald-700">{f.rate}</div>}
                  <div className="text-[11px] text-slate-400">{fmtDate(f.createdAt)}</div>
                </div>
              </div>

              {(f.date || f.company || f.contact || f.engine) && (
                <div className="flex flex-wrap gap-1.5">
                  {f.date && (
                    <Badge variant="outline" className="gap-1 border-slate-300 font-normal text-slate-600">
                      <CalendarDays className="h-3 w-3" aria-hidden />
                      {f.date}
                    </Badge>
                  )}
                  {f.company && (
                    <Badge variant="outline" className="gap-1 border-slate-300 font-normal text-slate-600">
                      <Building2 className="h-3 w-3" aria-hidden />
                      {f.company}
                    </Badge>
                  )}
                  {f.contact && (
                    <Badge variant="outline" className="gap-1 border-slate-300 font-normal text-slate-600">
                      <Phone className="h-3 w-3" aria-hidden />
                      {f.contact}
                    </Badge>
                  )}
                  {f.engine && (
                    <Badge variant="outline" className="border-slate-300 font-normal text-slate-500">
                      {f.engine}
                    </Badge>
                  )}
                </div>
              )}

              {f.note && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {f.note}
                </div>
              )}

              {f.query && (
                <div className="text-xs text-slate-500">
                  <span className="font-medium text-slate-600">Запрос:</span> {f.query}
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {tel && (
                  <Button size="sm" className="h-9" onClick={() => { window.location.href = tel }}>
                    <Phone aria-hidden className="mr-1 h-3.5 w-3.5" />
                    Позвонить
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-9" onClick={() => onCopy(favoriteText(f), f.title)}>
                  <Copy aria-hidden className="mr-1 h-3.5 w-3.5" />
                  Скопировать
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-9 text-slate-500 hover:text-red-600"
                      disabled={busy === f.id}
                    >
                      {busy === f.id ? (
                        <Loader2 aria-hidden className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 aria-hidden className="mr-1 h-3.5 w-3.5" />
                      )}
                      Убрать
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Убрать вариант из избранного?</AlertDialogTitle>
                      <AlertDialogDescription>
                        «{f.title}» и переговоры по нему будут удалены. Сохранённые ответы агента не изменятся.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Отмена</AlertDialogCancel>
                      <AlertDialogAction onClick={() => onRemoveFavorite(f.id)}>Убрать</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        )
      })}

      {answers.map((s) => (
        <Card key={s.id} className="border-zinc-300 bg-zinc-50 shadow-sm">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white">
                <Bot className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 font-semibold leading-snug text-slate-900">Ответ агента</div>
              <div className="shrink-0 text-[11px] text-slate-400">{fmtDate(s.createdAt)}</div>
            </div>

            {s.question && (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <span className="font-medium text-slate-700">Вопрос:</span>{' '}
                <span className="text-slate-600">{s.question}</span>
              </div>
            )}

            <div className="max-h-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white px-3 py-2">
              <div className="markdown-view text-sm text-slate-800">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.answer}</ReactMarkdown>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {s.modelKey && (
                <Badge variant="outline" className="border-zinc-300 font-normal text-slate-600">
                  {gigaModelLabel(s.modelKey)}
                </Badge>
              )}
              {s.engine && (
                <Badge variant="outline" className="border-zinc-300 font-normal text-slate-500">
                  {AI_ENGINE_LABELS[s.engine] ?? s.engine}
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="outline" className="h-9" onClick={() => onCopy(savedText(s), 'Ответ агента')}>
                <Copy aria-hidden className="mr-1 h-3.5 w-3.5" />
                Скопировать
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-9 text-slate-500 hover:text-red-600"
                    disabled={busy === s.id}
                  >
                    {busy === s.id ? (
                      <Loader2 aria-hidden className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 aria-hidden className="mr-1 h-3.5 w-3.5" />
                    )}
                    Убрать
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Убрать сохранённый ответ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Ответ исчезнет из календаря избранного. Сама переписка в чате ИИ-помощника останется.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onRemoveAnswer(s.id)}>Убрать</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
