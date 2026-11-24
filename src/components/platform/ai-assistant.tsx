'use client'

/**
 * Раздел «ИИ-помощник» — нейросеть-консультант логиста/экспедитора.
 * Основная работа помощника: подбор грузов и перевозчиков на ATI.SU.
 * Четыре вкладки: Чат (консультации), Список ИИ (что нейросеть нашла и разобрала —
 * в любой момент, последний разбор выводится сразу после выполнения запроса),
 * Логи (что нейросеть делала), Права (жёстко ограниченный доступ: запись — только
 * в свой список и журнал, остальное — частичное чтение).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SectionHeader, EmptyState, LoadingBlock, ErrorBlock, type TabProps } from '@/components/platform/common'
import { AI_RIGHTS, AI_RIGHT_MODE_LABELS, AI_ACTION_LABELS, AI_KIND_LABELS, type AiRightMode } from '@/lib/ai/rights'
import { getSessionToken } from '@/lib/api'
import {
  Ban, Bot, ChevronDown, Clock, Eye, ListChecks, Loader2, MessagesSquare, PenLine, RefreshCw,
  ScrollText, Send, ShieldCheck, Trash2,
} from 'lucide-react'

type SubKey = 'chat' | 'list' | 'logs' | 'rights'
type ChatMessage = { role: 'user' | 'assistant'; content: string }
type AiItem = { id: string; kind: string; query: string; answer: string; status: string; createdAt: string }
type AiLogRow = { id: string; level: string; action: string; message: string; details?: string | null; createdAt: string }

const SUBTABS: { id: SubKey; label: string; Icon: typeof Bot }[] = [
  { id: 'chat', label: 'Чат', Icon: Bot },
  { id: 'list', label: 'Список ИИ', Icon: ListChecks },
  { id: 'logs', label: 'Логи', Icon: ScrollText },
  { id: 'rights', label: 'Права', Icon: ShieldCheck },
]

const KIND_BADGE: Record<string, string> = {
  load: 'bg-slate-100 text-slate-700',
  truck: 'bg-amber-100 text-amber-700',
  both: 'bg-emerald-100 text-emerald-700',
  chat: 'bg-violet-100 text-violet-700',
}

const LEVEL_META: Record<string, { dot: string; cls: string; label: string }> = {
  info: { dot: 'bg-slate-400', cls: 'text-slate-600', label: 'инфо' },
  warn: { dot: 'bg-amber-500', cls: 'text-amber-700', label: 'внимание' },
  error: { dot: 'bg-red-500', cls: 'text-red-700', label: 'ошибка' },
}

const RIGHT_ICON: Record<AiRightMode, typeof Ban> = { 'write': PenLine, 'read-partial': Eye, 'denied': Ban }
const RIGHT_BADGE: Record<AiRightMode, string> = {
  'write': 'bg-emerald-100 text-emerald-700',
  'read-partial': 'bg-amber-100 text-amber-700',
  'denied': 'bg-red-100 text-red-700',
}

/** fetch к платформенным API с токеном этой вкладки (кука идёт сама) */
async function aiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (init?.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  try {
    const token = getSessionToken()
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

export default function AiAssistantTab({ liveTick }: TabProps) {
  const [sub, setSub] = useState<SubKey>('chat')

  // ——— чат ———
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setChatError(null)
    const history = messages.slice(-6)
    setMessages((m) => [...m, { role: 'user', content: text }])
    setInput('')
    try {
      const res = await aiFetch('/api/ai/chat', { method: 'POST', body: JSON.stringify({ message: text, history }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setMessages((m) => [...m, { role: 'assistant', content: json.answer as string }])
    } catch (e) {
      setChatError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }, [input, sending, messages])

  // ——— список ИИ ———
  const [items, setItems] = useState<AiItem[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [clearArmed, setClearArmed] = useState(false)

  const loadList = useCallback(async () => {
    setListError(null)
    try {
      const res = await aiFetch('/api/ai/list')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setItems(json.items as AiItem[])
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e))
      setItems(null)
    }
  }, [])

  useEffect(() => {
    if (sub === 'list') void loadList()
  }, [sub, liveTick, loadList])

  const clearList = useCallback(async () => {
    if (!clearArmed) {
      setClearArmed(true)
      window.setTimeout(() => setClearArmed(false), 4000)
      return
    }
    setClearArmed(false)
    try {
      await aiFetch('/api/ai/list', { method: 'DELETE' })
      await loadList()
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e))
    }
  }, [clearArmed, loadList])

  // ——— логи ———
  const [logs, setLogs] = useState<AiLogRow[] | null>(null)
  const [logsError, setLogsError] = useState<string | null>(null)

  const loadLogs = useCallback(async () => {
    setLogsError(null)
    try {
      const res = await aiFetch('/api/ai/logs?limit=100')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setLogs(json.logs as AiLogRow[])
    } catch (e) {
      setLogsError(e instanceof Error ? e.message : String(e))
      setLogs(null)
    }
  }, [])

  useEffect(() => {
    if (sub !== 'logs') return
    void loadLogs()
    const t = setInterval(() => void loadLogs(), 10000)
    return () => clearInterval(t)
  }, [sub, loadLogs])

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Нейросеть-консультант"
        title="ИИ-помощник"
        desc="Помощник по грузам и перевозчикам ATI.SU: разбирает запросы, оценивает ставки и риски, готовит черновики сообщений. Права ограничены жёстко — пишет только в свой список и журнал, остальное видит частично."
      >
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {SUBTABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSub(id)}
              aria-current={sub === id ? 'true' : undefined}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-3.5 font-medium transition-colors ${
                sub === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </SectionHeader>

      {/* ——— Чат ——— */}
      {sub === 'chat' && (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex max-h-[72vh] flex-col gap-3 p-4">
            {messages.length === 0 && (
              <EmptyState
                icon={<MessagesSquare className="h-8 w-8" aria-hidden />}
                title="Спросите нейросеть-консультанта"
                hint="Например: «груз Скопин → Ростов, тент, до 170 тысяч без НДС — на что смотреть и что спросить у грузовладельца?»"
              />
            )}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[min(46rem,92%)] rounded-2xl px-4 py-2.5 ${
                      m.role === 'user'
                        ? 'bg-slate-800 text-white'
                        : 'border border-slate-200 bg-white text-slate-800'
                    }`}
                  >
                    {m.role === 'assistant' ? (
                      <div className="markdown-view text-sm text-slate-800">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm">{m.content}</p>
                    )}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Нейросеть думает…
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            {chatError && (
              <ErrorBlock message={chatError} onRetry={() => void send()} />
            )}
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                rows={2}
                aria-label="Вопрос нейросети"
                placeholder="Спросите про груз, машину, ставку или риски сделки… (Enter — отправить)"
                className="min-h-[44px] text-sm"
              />
              <Button onClick={() => void send()} disabled={sending || !input.trim()} className="h-11 shrink-0">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                Спросить
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ——— Список ИИ ——— */}
      {sub === 'list' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">
              Список, который ведёт нейросеть: разборы поисковых запросов и консультации. Последний — сверху.
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-9" onClick={() => void loadList()}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
                Обновить
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={`h-9 ${clearArmed ? 'border-red-300 text-red-700 hover:bg-red-50' : 'text-slate-500'}`}
                onClick={() => void clearList()}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                {clearArmed ? 'Точно очистить?' : 'Очистить список'}
              </Button>
            </div>
          </div>
          {listError && <ErrorBlock message={listError} onRetry={() => void loadList()} />}
          {items === null && !listError && <LoadingBlock label="Загружаем список нейросети…" />}
          {items !== null && items.length === 0 && (
            <EmptyState
              icon={<ListChecks className="h-8 w-8" aria-hidden />}
              title="Список пока пуст"
              hint="Нейросеть запишет сюда первый разбор, как только вы зададите ей поиск — кнопка «Найти с ИИ» в разделе ATI.SU."
            />
          )}
          {items !== null && items.length > 0 && (
            <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
              {items.map((item, idx) => {
                const expanded = expandedId === item.id
                return (
                  <Card key={item.id} className={`border-slate-200 shadow-sm ${idx === 0 ? 'border-emerald-300' : ''}`}>
                    <CardContent className="p-3.5">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : item.id)}
                        aria-expanded={expanded}
                        className="flex w-full items-center gap-2 text-left"
                      >
                        <Badge className={`${KIND_BADGE[item.kind] ?? 'bg-slate-100 text-slate-700'} shrink-0 border-0`}>
                          {AI_KIND_LABELS[item.kind] ?? item.kind}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{item.query}</span>
                        {idx === 0 && (
                          <Badge className="shrink-0 border-0 bg-emerald-100 text-emerald-700">последний</Badge>
                        )}
                        <span className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
                          <Clock className="h-3 w-3" aria-hidden />
                          {fmtTime(item.createdAt)}
                        </span>
                        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
                      </button>
                      {expanded && (
                        <div className="markdown-view mt-2 border-t border-slate-100 pt-2 text-sm text-slate-800">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.answer}</ReactMarkdown>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ——— Логи ——— */}
      {sub === 'logs' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">
              Журнал нейросети: что она делала и когда. Обновляется каждые 10 секунд.
            </span>
            <Button variant="outline" size="sm" className="ml-auto h-9" onClick={() => void loadLogs()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
              Обновить
            </Button>
          </div>
          {logsError && <ErrorBlock message={logsError} onRetry={() => void loadLogs()} />}
          {logs === null && !logsError && <LoadingBlock label="Загружаем журнал нейросети…" />}
          {logs !== null && logs.length === 0 && (
            <EmptyState icon={<ScrollText className="h-8 w-8" aria-hidden />} title="Журнал пуст — нейросеть ещё ничего не делала" />
          )}
          {logs !== null && logs.length > 0 && (
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-0">
                <div className="max-h-[70vh] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="sticky top-0 border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                        <th className="px-3 py-2 font-medium">Время</th>
                        <th className="px-3 py-2 font-medium">Уровень</th>
                        <th className="px-3 py-2 font-medium">Действие</th>
                        <th className="px-3 py-2 font-medium">Что произошло</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((row) => {
                        const meta = LEVEL_META[row.level] ?? LEVEL_META.info
                        return (
                          <tr key={row.id} className="border-b border-slate-100 last:border-0">
                            <td className="whitespace-nowrap px-3 py-2 text-slate-500">{fmtTime(row.createdAt)}</td>
                            <td className="whitespace-nowrap px-3 py-2">
                              <span className={`inline-flex items-center gap-1.5 ${meta.cls}`}>
                                <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden />
                                {meta.label}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700">
                              {AI_ACTION_LABELS[row.action] ?? row.action}
                            </td>
                            <td className="px-3 py-2 text-slate-600">{row.message}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ——— Права ——— */}
      {sub === 'rights' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-700">
            Права нейросети заданы на сервере и не отключаются интерфейсом: контекст для модели собирает
            сервер из разрешённых источников, сама модель ничего, кроме своего списка и журнала, писать не может.
            Остальное — частичное чтение: контакты видны ей без телефонов и почты.
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {AI_RIGHTS.map((r) => {
              const Icon = RIGHT_ICON[r.mode]
              return (
                <Card key={r.key} className="border-slate-200 shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 shrink-0 ${r.mode === 'denied' ? 'text-red-500' : r.mode === 'read-partial' ? 'text-amber-600' : 'text-emerald-600'}`} aria-hidden />
                      <span className="text-sm font-semibold text-slate-900">{r.title}</span>
                      <Badge className={`ml-auto shrink-0 border-0 ${RIGHT_BADGE[r.mode]}`}>{AI_RIGHT_MODE_LABELS[r.mode]}</Badge>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-600">{r.detail}</p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
