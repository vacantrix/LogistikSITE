'use client'

/**
 * Раздел «ИИ-помощник» — чат с нейросетью-консультантом платформы.
 *
 * Экран нейросети — чисто-чёрный (терминальная эстетика harness):
 *  — заголовков раздела нет: сразу чат; вверху слева — вращающийся светящийся
 *    индикатор активности нейросети с подписью («Готова» / текущий шаг),
 *    справа — кнопки «Права» и «Новый чат»;
 *  — история переписки хранится на сервере (AiChatMessage) и не теряется;
 *    «Новый чат» начинает диалог с чистого листа;
 *  — ход работы нейросеть пишет ПРОСТЫМ ТЕКСТОМ прямо в ленте — как в harness:
 *    каждая строка («Проверяю права…», «Спрашиваю GigaChat…») появляется вживую
 *    и остаётся над ответом в истории;
 *  — ответ печатается медленно и постепенно: сервер стримит чанки, а клиент
 *    «печатает» их с плавным темпом (rAF-тайперайтер) + мигающая каретка;
 *  — новые сообщения, строки хода работы и виджеты появляются с мягкими
 *    анимациями (fade/slide-in);
 *  — выбор уровня модели GigaChat — компактный переключатель в композере,
 *    рядом с кнопкой «Спросить»;
 *  — кнопка «добавить файл»: текстовые файлы читаются и попадают в контекст;
 *  — кнопки-вкладки «Чат», «Логи», «Список ИИ» убраны: всё отражается в самом
 *    чате; «Права» — кнопка в верхней панели: матрица доступа ИИ,
 *    которую редактирует администратор (AiRight), она действует сразу;
 *  — любой ответ агента можно сохранить кнопкой «В избранное» — он попадает
 *    в календарь раздела «Избранное» (AiSavedMessage) вместе с вопросом.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmptyState, LoadingBlock, ErrorBlock, type TabProps } from '@/components/platform/common'
import { AI_RIGHT_MODE_LABELS, AI_ENGINE_LABELS, type AiRightMode, type AiRight } from '@/lib/ai/rights'
import { type AiBestOffer, type AiCard, type AiLinkRef, type AiReport } from '@/lib/ai/tools'
import { AiOfferList } from '@/components/platform/ai-offer-list'
import { AiCardList, AiLinkChips, AiReportCard } from '@/components/platform/ai-widgets'
import { aiFetch } from '@/components/platform/ai-shared'
import { GIGA_MODELS, DEFAULT_GIGA_MODEL, gigaModelLabel } from '@/lib/ai/models'
import { useToast } from '@/hooks/use-toast'
import {
  ArrowLeft, Ban, Cpu, Eye, FileText, Loader2, Lock, MessagesSquare, Paperclip, PenLine, Send,
  ShieldCheck, Star, X,
} from 'lucide-react'

type SubKey = 'chat' | 'rights'

/** шаг хода работы — строка текста (harness-лог: «что я сейчас делаю») */
type ChatStep = { at: number; text: string }
/** метаданные прикреплённого файла в истории */
type ChatFileMeta = { name: string; size: number; excerpt?: string }
/** файл, прикреплённый в композере (текст уже прочитан на клиенте) */
type AttachedFile = { name: string; size: number; type: string; text: string }

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  engine?: string
  modelKey?: string
  createdAt?: string
  steps?: ChatStep[]
  files?: ChatFileMeta[]
  saved?: string[]
  best?: AiBestOffer[]
  bestQuery?: string
  bestEngine?: string
  cards?: AiCard[]
  report?: AiReport | null
  links?: AiLinkRef[]
}

const RIGHT_ICON: Record<AiRightMode, typeof Ban> = { 'write': PenLine, 'read-partial': Eye, 'denied': Ban }
const RIGHT_BADGE: Record<AiRightMode, string> = {
  'write': 'bg-emerald-100 text-emerald-700',
  'read-partial': 'bg-amber-100 text-amber-700',
  'denied': 'bg-red-100 text-red-700',
}

/** прикреплять можно текстовые файлы — их содержимое попадает в контекст модели */
const TEXT_FILE_RE = /\.(txt|md|markdown|csv|tsv|json|xml|log|html?|ya?ml)$/i
const MAX_FILES = 3
const MAX_FILE_BYTES = 64_000

/** минимальная скорость «печати» ответа (симв./сек); при большом отставании
 *  от стрима темп плавно подрастает, чтобы не отставать больше ~3 секунд */
const TYPE_SPEED_MIN = 80
const TYPE_LAG_SEC = 3

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`
  return `${(n / 1024 / 1024).toFixed(1)} МБ`
}

/** строки хода работы — простой текст, как в harness: «› что делаю сейчас» */
function StepsLines({ steps, busy }: { steps: ChatStep[]; busy?: boolean }) {
  if (steps.length === 0 && !busy) return null
  return (
    <div className="space-y-0.5" aria-label="Ход работы нейросети">
      {steps.map((s, i) => (
        <div
          key={i}
          className="animate-in fade-in slide-in-from-bottom-1 duration-700 text-[13px] leading-relaxed text-zinc-500"
        >
          <span className="mr-1.5 select-none text-zinc-600" aria-hidden>›</span>
          <span>{s.text}</span>
        </div>
      ))}
      {busy && (
        <div className="animate-pulse text-[13px] leading-relaxed text-zinc-600" aria-hidden>
          <span className="mr-1.5 select-none text-zinc-600">›</span>
          работаю…
        </div>
      )}
    </div>
  )
}

/** Чат с нейросетью: история, модель, файлы, живой ход работы и медленно печатающийся ответ */
export default function AiAssistantTab({ onNavigate, role }: TabProps) {
  const [sub, setSub] = useState<SubKey>('chat')
  const { toast } = useToast()
  const isAdmin = role === 'admin'

  // ——— чат: история из БД ———
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  // выбранная модель чата (уровень GigaChat) — переключатель у кнопки отправить
  const [modelKey, setModelKey] = useState<string>(DEFAULT_GIGA_MODEL)
  // прикреплённые файлы (текст уже прочитан)
  const [attached, setAttached] = useState<AttachedFile[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // ход работы текущего ответа — текстом, по мере выполнения
  const [liveSteps, setLiveSteps] = useState<ChatStep[]>([])
  // потоковый текст ответа — печатается плавно (тайперайтер ниже)
  const [liveAnswer, setLiveAnswer] = useState('')
  const [clearArmed, setClearArmed] = useState(false)
  // ——— сохранение ответов в «Избранное» (календарь агента) ———
  // id уже сохранённых сообщений (звезда заполнена) + какое сохраняем прямо сейчас
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [savingAnswer, setSavingAnswer] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [messages, liveSteps, liveAnswer])

  // ——— тайперайтер: ответ печатается медленно и постепенно ———
  // стрим приносит чанки сразу пачками; клиент «печатает» их с ровным темпом,
  // чтобы текст появлялся плавно, как в живом диалоге
  const typerRef = useRef<{ target: string; shown: number; rendered: number; last: number | null }>({
    target: '', shown: 0, rendered: 0, last: null,
  })
  const rafRef = useRef<number | null>(null)
  const activeRef = useRef(false)
  const drainRef = useRef<(() => void) | null>(null)
  const tickRef = useRef<(ts: number) => void>(() => {})

  const tick = useCallback((ts: number): void => {
    const t = typerRef.current
    if (t.last == null) t.last = ts
    const dt = Math.max(0, (ts - t.last) / 1000)
    t.last = ts
    const backlog = t.target.length - t.shown
    if (backlog > 0) {
      const speed = Math.max(TYPE_SPEED_MIN, Math.ceil(backlog / TYPE_LAG_SEC))
      t.shown = Math.min(t.target.length, t.shown + speed * dt)
    }
    const shownInt = Math.floor(t.shown)
    if (shownInt !== t.rendered) {
      t.rendered = shownInt
      setLiveAnswer(t.target.slice(0, shownInt))
    }
    if (t.shown >= t.target.length && !activeRef.current) {
      // допечатано и стрим закрыт — останавливаем цикл, отпускаем ожидание
      rafRef.current = null
      t.last = null
      drainRef.current?.()
      drainRef.current = null
      return
    }
    rafRef.current = requestAnimationFrame((next) => tickRef.current(next))
  }, [])

  useEffect(() => { tickRef.current = tick }, [tick])
  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }, [])

  /** дождаться, пока тайперайтер допечатает накопленный текст */
  const waitTyped = useCallback((): Promise<void> => new Promise<void>((resolve) => {
    const t = typerRef.current
    if (t.shown >= t.target.length) return resolve()
    drainRef.current = resolve
  }), [])

  const stopTyper = useCallback((): void => {
    activeRef.current = false
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    drainRef.current = null
    typerRef.current.last = null
  }, [])

  const loadHistory = useCallback(async () => {
    setHistoryError(null)
    try {
      const res = await aiFetch('/api/ai/messages')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      const rows = (json.messages ?? []) as ChatMessage[]
      setMessages(rows)
      // какие ответы уже в «Избранном» — звезда у них заполнена
      const saved = Array.isArray(json.savedMessageIds) ? (json.savedMessageIds as string[]) : []
      setSavedIds(new Set(saved))
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e))
      setMessages([])
    }
  }, [])

  useEffect(() => {
    if (sub === 'chat') void loadHistory()
  }, [sub, loadHistory])

  // ——— сохранить ответ агента в «Избранное» (календарь ответов) ———
  const saveAnswer = useCallback(async (m: ChatMessage, question: string) => {
    if (!m.id || savingAnswer || savedIds.has(m.id)) return
    setSavingAnswer(m.id)
    try {
      const res = await aiFetch('/api/ai/saved-messages', {
        method: 'POST',
        body: JSON.stringify({
          messageId: m.id,
          question,
          answer: m.content,
          modelKey: m.modelKey,
          engine: m.engine,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setSavedIds((prev) => new Set(prev).add(m.id))
      toast({
        title: 'Ответ сохранён в избранное',
        description: 'Календарь сохранённых ответов — раздел «Избранное».',
      })
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setSavingAnswer(null)
    }
  }, [savingAnswer, savedIds, toast])

  /** вопрос, на который агент дал этот ответ: ближайшее сообщение человека выше в ленте */
  const questionBefore = useCallback((idx: number): string => {
    const list = messages ?? []
    for (let i = idx - 1; i >= 0; i--) {
      if (list[i].role === 'user') return list[i].content
    }
    return ''
  }, [messages])

  const newChat = useCallback(async () => {
    if (!clearArmed) {
      setClearArmed(true)
      window.setTimeout(() => setClearArmed(false), 4000)
      return
    }
    setClearArmed(false)
    try {
      const res = await aiFetch('/api/ai/messages', { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setMessages([])
      setLiveSteps([])
      setLiveAnswer('')
      setChatError(null)
      toast({ title: 'Новый чат начат', description: 'Предыдущая переписка очищена — только у вас.' })
    } catch (e) {
      toast({ title: 'Не удалось очистить чат', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    }
  }, [clearArmed, toast])

  // ——— прикрепление файлов: читаем текст на клиенте ———
  const pickFiles = useCallback(async (fileList: FileList | null): Promise<void> => {
    if (!fileList || fileList.length === 0) return
    const next = [...attached]
    for (const f of Array.from(fileList)) {
      if (next.length >= MAX_FILES) {
        toast({ title: 'Файлов слишком много', description: `Не больше ${MAX_FILES} файлов на один вопрос.`, variant: 'destructive' })
        break
      }
      if (!TEXT_FILE_RE.test(f.name)) {
        toast({ title: 'Файл не прочитан', description: `«${f.name}»: пока понимаем только текстовые форматы (txt, csv, json, md, xml…).`, variant: 'destructive' })
        continue
      }
      if (f.size > MAX_FILE_BYTES) {
        toast({ title: 'Файл слишком большой', description: `«${f.name}»: до 64 КБ на файл.`, variant: 'destructive' })
        continue
      }
      const text = await f.text()
      next.push({ name: f.name, size: f.size, type: f.type || 'text', text: text.slice(0, 8_000) })
    }
    setAttached(next)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [attached, toast])

  const removeFile = useCallback((name: string): void => {
    setAttached((prev) => prev.filter((f) => f.name !== name))
  }, [])

  // ——— отправка вопроса: NDJSON-стрим шагов, дельт и итога ———
  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setChatError(null)
    setLiveSteps([])
    setLiveAnswer('')
    typerRef.current = { target: '', shown: 0, rendered: 0, last: null }
    activeRef.current = true
    if (rafRef.current == null) rafRef.current = requestAnimationFrame((ts) => tickRef.current(ts))
    const localId = `local-${Date.now()}`
    const filesMeta = attached.map((f) => ({ name: f.name, size: f.size }))
    setMessages((m) => [...(m ?? []), { id: localId, role: 'user', content: text, files: filesMeta }])
    setInput('')
    const files = attached.map((f) => ({ name: f.name, size: f.size, type: f.type, text: f.text }))
    try {
      const res = await aiFetch('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message: text, model: modelKey, files }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json?.error ?? `HTTP ${res.status}`)
      }
      if (!res.body) throw new Error('Стрим недоступен — обновите страницу')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      // накопитель стрима: событие done приносит итог — все виджеты и метаданные
      const acc: {
        steps: ChatStep[]
        answer: string
        done?: {
          answer: string; engine: string; model: string; modelKey?: string; latencyMs: number
          savedContacts?: { name: string; company: string }[]
          best?: AiBestOffer[]; cards?: AiCard[]; report?: AiReport | null; links?: AiLinkRef[]
          assistantMessageId?: string
        }
        error?: string
      } = { steps: [], answer: '' }
      const handleLine = (line: string): void => {
        if (!line.trim()) return
        let ev: { type?: string; at?: number; text?: string; error?: string } & Record<string, unknown>
        try {
          ev = JSON.parse(line) as typeof ev
        } catch {
          return
        }
        if (ev.type === 'step') {
          acc.steps = [...acc.steps, { at: Number(ev.at) || Date.now(), text: String(ev.text ?? '') }]
          setLiveSteps(acc.steps)
        } else if (ev.type === 'delta') {
          // чанк стрима — в накопитель тайперайтера (он печатает ровным темпом)
          typerRef.current.target += String(ev.text ?? '')
        } else if (ev.type === 'done') {
          acc.done = ev as NonNullable<typeof acc.done>
        } else if (ev.type === 'error') {
          acc.error = String(ev.error ?? 'Ошибка')
        }
      }
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl = buf.indexOf('\n')
        while (nl !== -1) {
          handleLine(buf.slice(0, nl))
          buf = buf.slice(nl + 1)
          nl = buf.indexOf('\n')
        }
      }
      if (buf) handleLine(buf)
      if (acc.error) throw new Error(acc.error)
      const done = acc.done
      if (!done) throw new Error('Соединение оборвалось до конца ответа')
      // стрим закрыт: тайперайтер допечатывает накопленное — и только потом итог в ленту
      activeRef.current = false
      await waitTyped()
      const savedContacts = Array.isArray(done.savedContacts)
        ? done.savedContacts.map((c) => [c.name, c.company].filter(Boolean).join(' · '))
        : []
      const assistantId = done.assistantMessageId ?? `a-${Date.now()}`
      setMessages((m) => [
        ...(m ?? []),
        {
          id: assistantId,
          role: 'assistant',
          content: done.answer,
          engine: done.engine,
          modelKey: done.modelKey ?? modelKey,
          steps: acc.steps,
          saved: savedContacts,
          best: Array.isArray(done.best) ? done.best.slice(0, 8) : [],
          bestQuery: text.slice(0, 200),
          bestEngine: done.engine,
          cards: Array.isArray(done.cards) ? done.cards.slice(0, 6) : [],
          report: done.report && typeof done.report === 'object' ? done.report : null,
          links: Array.isArray(done.links) ? done.links.slice(0, 5) : [],
        },
      ])
      setAttached([])
    } catch (e) {
      // вопрос остаётся в истории (сервер сохранил до вызова модели) — ошибка показывается честно
      stopTyper()
      setChatError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
      setLiveSteps([])
      setLiveAnswer('')
    }
  }, [input, sending, attached, modelKey, waitTyped, stopTyper])

  // ——— права: действующая матрица + редактирование администратором ———
  const [rights, setRights] = useState<AiRight[] | null>(null)
  const [lockedRights, setLockedRights] = useState<string[]>([])
  const [rightsError, setRightsError] = useState<string | null>(null)
  const [rightsSavingKey, setRightsSavingKey] = useState<string | null>(null)

  const loadRights = useCallback(async () => {
    setRightsError(null)
    try {
      const res = await aiFetch('/api/ai/rights')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setRights(json.rights as AiRight[])
      setLockedRights(Array.isArray(json.locked) ? (json.locked as string[]) : [])
    } catch (e) {
      setRightsError(e instanceof Error ? e.message : String(e))
      setRights(null)
    }
  }, [])

  useEffect(() => {
    if (sub === 'rights') void loadRights()
  }, [sub, loadRights])

  const changeRight = useCallback(async (right: AiRight, mode: AiRightMode) => {
    setRightsSavingKey(right.key)
    try {
      const res = await aiFetch('/api/ai/rights', { method: 'PUT', body: JSON.stringify({ key: right.key, mode }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setRights(json.rights as AiRight[])
      toast({
        title: 'Право обновлено',
        description: `«${right.title}» → ${AI_RIGHT_MODE_LABELS[mode]}. Матрица действует для следующих вопросов.`,
      })
    } catch (e) {
      toast({ title: 'Право не сохранено', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setRightsSavingKey(null)
    }
  }, [toast])

  return (
    <div className="space-y-5">
      {/* ——— Чат: чисто-чёрный экран нейросети (заголовков раздела нет — сразу чат) ——— */}
      {sub === 'chat' && (
        <Card className="border-zinc-800 bg-black text-zinc-100 shadow-sm">
          <CardContent className="flex h-[calc(100vh-12rem)] max-h-[860px] min-h-[480px] flex-col gap-3 p-3 sm:p-4">
            {/* верхняя панель: статус нейросети + действия */}
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 pb-2">
              {/* живой индикатор нейросети: вращается и светится — цвет зависит от
                  режима (изумрудный — готова, янтарный — работает); рядом — подпись:
                  «Готова» или последний шаг хода работы */}
              <span className="inline-flex min-h-[36px] items-center gap-2 text-sm text-zinc-300" aria-live="polite">
                <span
                  aria-hidden
                  className={`inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-transparent ${
                    sending
                      ? 'border-t-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.85)]'
                      : 'border-t-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.85)]'
                  }`}
                />
                <span className="truncate">
                  {sending
                    ? (liveSteps.length > 0 ? liveSteps[liveSteps.length - 1].text : 'Работаю…')
                    : 'Готова'}
                </span>
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 border-zinc-700 bg-transparent text-zinc-400 hover:bg-zinc-800 hover:text-white"
                  onClick={() => setSub('rights')}
                  disabled={sending}
                >
                  <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Права
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={`h-9 border-zinc-700 bg-transparent hover:bg-zinc-800 hover:text-white ${
                    clearArmed ? 'border-zinc-400 text-white' : 'text-zinc-400'
                  }`}
                  onClick={() => void newChat()}
                  disabled={sending}
                >
                  <PenLine className="mr-1 h-3.5 w-3.5" aria-hidden />
                  {clearArmed ? 'Точно новый?' : 'Новый чат'}
                </Button>
              </div>
            </div>

            {/* лента сообщений: ч/б, всё отражается здесь же (grayscale — строго монохром) */}
            <div
              className="grayscale min-h-0 flex-1 animate-in fade-in duration-700 space-y-3 overflow-y-auto pr-1"
              style={{ scrollbarWidth: 'thin' }}
              aria-label="Лента чата с нейросетью"
            >
              {messages === null && !historyError && <LoadingBlock label="Загружаем историю чата…" />}
              {historyError && <ErrorBlock message={historyError} onRetry={() => void loadHistory()} />}
              {messages != null && messages.length === 0 && (
                <EmptyState
                  icon={<MessagesSquare className="h-8 w-8" aria-hidden />}
                  title="Задайте вопрос"
                  hint="Переписка сохраняется на сервере"
                />
              )}
              {messages?.map((m, idx) => (
                <div key={m.id} className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-2">
                  {/* ход работы — простой текст над ответом, как в harness */}
                  {m.role === 'assistant' && m.steps && m.steps.length > 0 && (
                    <StepsLines steps={m.steps} />
                  )}
                  <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[min(46rem,92%)] rounded-2xl px-4 py-2.5 ${
                        m.role === 'user'
                          ? 'bg-white text-neutral-950'
                          : 'border border-zinc-800 bg-zinc-900 text-zinc-100'
                      }`}
                    >
                      {m.role === 'assistant' ? (
                        <div className="markdown-view markdown-view-dark text-sm text-zinc-100">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                          {m.saved && m.saved.length > 0 && (
                            <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-2.5 py-2 text-xs text-zinc-300">
                              <span className="font-semibold">Записано в «Память контактов»:</span> {m.saved.join(', ')}
                              <span className="mt-1 block text-zinc-500">
                                Карточки помечены «Записано ИИ» — проверьте их в разделе «Привлечённый транспорт → Память контактов».
                              </span>
                            </div>
                          )}
                          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                              {m.engine && (
                                <>
                                  {AI_ENGINE_LABELS[m.engine] ?? m.engine}
                                  {m.modelKey && ` · уровень: ${gigaModelLabel(m.modelKey)}`}
                                  {m.createdAt && ` · ${fmtTime(m.createdAt)}`}
                                </>
                              )}
                            </div>
                            {/* сохранить ответ агента в «Избранное» — появится в календаре */}
                            <button
                              type="button"
                              onClick={() => void saveAnswer(m, questionBefore(idx))}
                              disabled={savingAnswer === m.id || savedIds.has(m.id)}
                              aria-label={savedIds.has(m.id) ? 'Ответ уже в избранном' : 'Сохранить ответ в избранное'}
                              title={savedIds.has(m.id) ? 'Ответ уже в избранном — календарь в разделе «Избранное»' : 'Сохранить ответ в избранное'}
                              className={`inline-flex min-h-[28px] shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
                                savedIds.has(m.id)
                                  ? 'border-zinc-500 bg-zinc-800 text-zinc-200'
                                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white'
                              }`}
                            >
                              <Star
                                className={`h-3 w-3 ${savedIds.has(m.id) ? 'fill-zinc-300 text-zinc-300' : ''}`}
                                aria-hidden
                              />
                              {savingAnswer === m.id ? 'Сохраняю…' : savedIds.has(m.id) ? 'В избранном' : 'В избранное'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="whitespace-pre-wrap text-sm">{m.content}</p>
                          {m.files && m.files.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {m.files.map((f) => (
                                <span
                                  key={f.name}
                                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-100 px-2 py-1 text-[11px] text-zinc-700"
                                >
                                  <FileText className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden />
                                  <span className="truncate">{f.name}</span>
                                  <span className="shrink-0 text-zinc-400">{fmtBytes(f.size)}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {m.role === 'assistant' && m.best && m.best.length > 0 && (
                    <div className="animate-in fade-in duration-700">
                      <AiOfferList offers={m.best} query={m.bestQuery ?? ''} engine={m.bestEngine} onNavigate={onNavigate} compact />
                    </div>
                  )}
                  {m.role === 'assistant' && m.cards && m.cards.length > 0 && (
                    <div className="animate-in fade-in duration-700">
                      <AiCardList cards={m.cards} />
                    </div>
                  )}
                  {m.role === 'assistant' && m.report && (
                    <div className="animate-in fade-in duration-700">
                      <AiReportCard report={m.report} />
                    </div>
                  )}
                  {m.role === 'assistant' && m.links && m.links.length > 0 && (
                    <div className="animate-in fade-in duration-700">
                      <AiLinkChips links={m.links} onNavigate={onNavigate} />
                    </div>
                  )}
                </div>
              ))}

              {/* живой ответ: ход работы текстом + медленно печатающийся текст */}
              {sending && (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-2">
                  <StepsLines steps={liveSteps} busy />
                  <div className="flex justify-start">
                    <div className="max-w-[min(46rem,92%)] rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100">
                      <div className="markdown-view markdown-view-dark">
                        {liveAnswer ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{liveAnswer}</ReactMarkdown>
                        ) : (
                          <span className="inline-flex items-center gap-2 text-zinc-400">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            {liveSteps.length > 0 ? liveSteps[liveSteps.length - 1].text : 'Нейросеть начинает…'}
                          </span>
                        )}
                        {liveAnswer && (
                          <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-zinc-400 align-middle" aria-hidden />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {chatError && (
              <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200">
                <span className="font-semibold">Не получилось:</span> {chatError}
              </div>
            )}

            {/* композер: файлы + вопрос + модель (у кнопки отправить) */}
            <div className="space-y-2 border-t border-zinc-800 pt-2">
              {attached.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {attached.map((f) => (
                    <span
                      key={f.name}
                      className="animate-in fade-in duration-500 inline-flex max-w-full items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300"
                    >
                      <FileText className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden />
                      <span className="truncate">{f.name}</span>
                      <span className="shrink-0 text-zinc-500">{fmtBytes(f.size)}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(f.name)}
                        aria-label={`Убрать файл ${f.name}`}
                        className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".txt,.md,.markdown,.csv,.tsv,.json,.xml,.log,.html,.htm,.yml,.yaml"
                  className="hidden"
                  onChange={(e) => void pickFiles(e.target.files)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 w-11 shrink-0 border-zinc-700 bg-zinc-900 p-0 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                  aria-label="Прикрепить файл (текстовый)"
                  title="Прикрепить файл: txt, csv, json, md, xml — до 3 файлов по 64 КБ"
                >
                  <Paperclip className="h-4 w-4" aria-hidden />
                </Button>
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
                  placeholder="Спросите про груз, ставку или риски — Enter отправить"
                  className="min-w-[12rem] flex-1 border-zinc-700 bg-zinc-900 text-sm text-zinc-100 caret-zinc-100 placeholder:text-zinc-500 focus-visible:ring-zinc-500"
                />
                {/* выбор модели перенесён к кнопке отправить: в триггере — только короткое имя уровня */}
                <Select value={modelKey} onValueChange={(v) => setModelKey(v)} disabled={sending}>
                  <SelectTrigger
                    size="sm"
                    className="h-11 w-[12rem] shrink-0 border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                    aria-label="Уровень модели GigaChat"
                    title={`Уровень модели GigaChat: ${gigaModelLabel(modelKey)}`}
                  >
                    <Cpu className="mr-1 h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
                    <span className="truncate">{gigaModelLabel(modelKey)}</span>
                  </SelectTrigger>
                  <SelectContent className="border-zinc-700 bg-zinc-900 text-zinc-100">
                    {GIGA_MODELS.map((m) => (
                      <SelectItem
                        key={m.key}
                        value={m.key}
                        className="focus:bg-zinc-800 focus:text-white [&_svg:not([class*='text-'])]:text-zinc-500"
                      >
                        <span className="flex flex-col items-start gap-0.5">
                          <span className="text-sm font-medium">{m.label}</span>
                          <span className="text-xs text-zinc-500">{m.hint}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => void send()}
                  disabled={sending || !input.trim()}
                  className="h-11 shrink-0 bg-white text-neutral-950 hover:bg-zinc-200"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                  Спросить
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ——— Права: матрица, редактируемая администратором ——— */}
      {sub === 'rights' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => setSub('chat')}
            >
              <ArrowLeft aria-hidden className="mr-1 h-3.5 w-3.5" />
              К чату
            </Button>
            <span className="text-sm text-slate-600">
              Права нейросети задаёт администратор платформы: режимы ниже редактируются и применяются
              к следующим вопросам сразу — контекст для модели собирает сервер по действующей матрице.
            </span>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-700">
            Права «Заявки, рейсы, ЭДО, 1С» и «Персональные данные» зашиты в платформу и не редактируются.
            {!isAdmin && ' Ваша роль — только просмотр; изменения вносит администрация.'}
          </div>
          {rightsError && <ErrorBlock message={rightsError} onRetry={() => void loadRights()} />}
          {rights === null && !rightsError && <LoadingBlock label="Загружаем матрицу прав…" />}
          {rights !== null && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {rights.map((r) => {
                const Icon = RIGHT_ICON[r.mode]
                const locked = lockedRights.includes(r.key)
                return (
                  <Card key={r.key} className="border-slate-200 shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Icon
                          className={`h-4 w-4 shrink-0 ${r.mode === 'denied' ? 'text-red-500' : r.mode === 'read-partial' ? 'text-amber-600' : 'text-emerald-600'}`}
                          aria-hidden
                        />
                        <span className="text-sm font-semibold text-slate-900">{r.title}</span>
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                          {locked && (
                            <Badge variant="outline" className="gap-1 border-slate-300 text-slate-500">
                              <Lock className="h-3 w-3" aria-hidden />
                              зашито
                            </Badge>
                          )}
                          {isAdmin && !locked ? (
                            <Select
                              value={r.mode}
                              onValueChange={(v) => void changeRight(r, v as AiRightMode)}
                              disabled={rightsSavingKey === r.key}
                            >
                              <SelectTrigger className="h-8 w-[210px] text-xs" aria-label={`Режим права «${r.title}»`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(['write', 'read-partial', 'denied'] as AiRightMode[]).map((mode) => (
                                  <SelectItem key={mode} value={mode} className="text-xs">
                                    {AI_RIGHT_MODE_LABELS[mode]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge className={`border-0 ${RIGHT_BADGE[r.mode]}`}>{AI_RIGHT_MODE_LABELS[r.mode]}</Badge>
                          )}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-slate-600">{r.detail}</p>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

    </div>
  )
}
