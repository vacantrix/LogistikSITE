'use client'

/**
 * Окно «Что найти на ATI.SU» — кнопка в разделе ATI.SU вызывает диалог, в котором
 * логист описывает, что хочет найти. Нейросеть видит ОБА вида поиска: и выдачу
 * грузов витрины, и машины фирмы (при подключённом ATI.SU). Разбор сохраняется
 * в её собственный список и выводится сразу после выполнения; предыдущий
 * последний разбор показывается свёрнутым.
 */
import { useCallback, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/kontur/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/kontur/ui/dialog'
import { Input } from '@/components/kontur/ui/input'
import { Label } from '@/components/kontur/ui/label'
import { Textarea } from '@/components/kontur/ui/textarea'
import { InfoTip, Pill } from './bits'
import { AI_KIND_LABELS } from '@/lib/ai/rights'
import { ArrowRight, Bot, ChevronDown, Clock, Loader2, ListChecks, Sparkles } from 'lucide-react'

type Mode = 'load' | 'truck' | 'both'

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'load', label: 'Грузы', hint: 'ищем груз для своей/привлечённой машины' },
  { id: 'truck', label: 'Машины', hint: 'ищем перевозчика под груз' },
  { id: 'both', label: 'И то и другое', hint: 'нейросеть видит и грузы, и поиск машин' },
]

type AiItem = { id: string; kind: string; query: string; answer: string; status: string; createdAt: string }

/** fetch к платформенным API (без префикса /kontur) с токеном вкладки */
async function platformFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (init?.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  try {
    const token = window.sessionStorage.getItem('aemz_session_token')
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  } catch {
    /* приватный режим — остаёмся на cookie-сессии */
  }
  return fetch(path, { ...init, headers })
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function AtiAiSearchDialog({ onOpenAi }: { onOpenAi?: () => void }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('both')
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [budget, setBudget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AiItem | null>(null)
  const [latest, setLatest] = useState<AiItem | null>(null)
  const [latestOpen, setLatestOpen] = useState(false)

  const loadLatest = useCallback(async () => {
    try {
      const res = await platformFetch('/api/ai/list?latest=1')
      if (!res.ok) return
      const json = await res.json().catch(() => null)
      setLatest(json?.item ?? null)
    } catch {
      /* последний разбор не критичен */
    }
  }, [])

  useEffect(() => {
    if (open) void loadLatest()
  }, [open, loadLatest])

  const close = useCallback((next: boolean) => {
    setOpen(next)
    if (!next) {
      setResult(null)
      setError(null)
    }
  }, [])

  const run = useCallback(async () => {
    if (busy || !query.trim()) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await platformFetch('/api/ai/search', {
        method: 'POST',
        body: JSON.stringify({ mode, query, from, to, budget }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setResult(json.item as AiItem)
      await loadLatest()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [busy, mode, query, from, to, budget, loadLatest])

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8" title="Нейросеть-консультант: разберёт, что ищем, и покажет оба вида поиска">
          <Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden />
          Найти с ИИ
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-slate-500" aria-hidden />
            Что найти на ATI.SU
          </DialogTitle>
          <DialogDescription>
            Опишите задачу — нейросеть-консультант разберёт запрос, покажет ориентиры по ставке, риски и план звонка. Разбор сохранится в её список.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* что ищем: грузы / машины / оба */}
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">Что ищем</Label>
            <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 text-sm">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  title={m.hint}
                  aria-current={mode === m.id ? 'true' : undefined}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-3.5 font-medium transition-colors ${
                    mode === m.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-snug text-slate-500">
              Нейросеть видит оба вида: демо-выдачу грузов витрины и (при подключённом ATI.SU) машины фирмы.
            </p>
          </div>

          {/* маршрут и бюджет */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="ai-from" className="text-xs text-slate-600">Откуда</Label>
              <Input id="ai-from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Скопин" className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-to" className="text-xs text-slate-600">Куда</Label>
              <Input id="ai-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Ростов-на-Дону" className="h-9 text-sm" />
            </div>
            <div className="col-span-2 space-y-1 sm:col-span-1">
              <Label htmlFor="ai-budget" className="text-xs text-slate-600">Бюджет, ₽</Label>
              <Input id="ai-budget" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="до 170 000" className="h-9 text-sm" />
            </div>
          </div>

          {/* описание задачи */}
          <div className="space-y-1">
            <Label htmlFor="ai-query" className="text-xs text-slate-600">
              Что найти
            </Label>
            <Textarea
              id="ai-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={3}
              placeholder="Например: тент 20 т, металл, погрузка завтра, без НДС; или: машина из Краснодара на 15-е, тент, до 110 тысяч"
              className="text-sm"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void run()} disabled={busy || !query.trim()} className="h-10">
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="mr-1 h-4 w-4" aria-hidden />}
              {busy ? 'Нейросеть работает…' : 'Спросить ИИ'}
            </Button>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              разбор будет сохранён в список нейросети
              <InfoTip label="О правах нейросети">
                Нейросеть может писать только в свой список и журнал. Контакты видит частично (без телефонов),
                изменить что-либо на платформе не может.
              </InfoTip>
            </span>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          )}

          {/* последний разбор нейросети (до нового поиска) */}
          {!result && latest && (
            <div className="rounded-xl border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setLatestOpen((v) => !v)}
                aria-expanded={latestOpen}
                className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
              >
                <ListChecks className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <span className="text-xs font-semibold text-slate-700">Последний разбор нейросети</span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{latest.query}</span>
                <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-500">
                  <Clock className="h-3 w-3" aria-hidden />
                  {fmtTime(latest.createdAt)}
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${latestOpen ? 'rotate-180' : ''}`} aria-hidden />
              </button>
              {latestOpen && (
                <div className="markdown-view border-t border-slate-100 px-3.5 py-2.5 text-sm text-slate-800">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{latest.answer}</ReactMarkdown>
                </div>
              )}
            </div>
          )}

          {/* результат: выводится сразу после выполнения */}
          {result && (
            <div className="space-y-2.5 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Pill className="bg-emerald-100 text-emerald-700">{AI_KIND_LABELS[result.kind] ?? result.kind}</Pill>
                <span className="text-sm font-bold text-slate-900">{result.query}</span>
                <span className="ml-auto flex items-center gap-1 text-xs text-slate-500">
                  <Clock className="h-3 w-3" aria-hidden />
                  {fmtTime(result.createdAt)}
                </span>
              </div>
              <div className="markdown-view rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-800">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer}</ReactMarkdown>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Pill className="bg-emerald-100 text-emerald-700">сохранено в список ИИ</Pill>
                {onOpenAi && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => {
                      close(false)
                      onOpenAi()
                    }}
                  >
                    Открыть список ИИ
                    <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    setResult(null)
                    setQuery('')
                    setFrom('')
                    setTo('')
                    setBudget('')
                  }}
                >
                  Новый поиск
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
