'use client'

/**
 * «Обращения» (Task 109-b) — чат поддержки платформы.
 * Перевозчики и экспедиторы создают обращения (тема, категория, описание, вложения),
 * описывают проблему и получают консультацию логиста или администрации прямо в ветке.
 * Логист и администрация видят все обращения, отвечают и закрывают решённые.
 * Вложения — документы и медиа (фото, PDF, офисные форматы) суммарно до 10 МБ на
 * обращение: клиент проверяет тип и остаток лимита, сервер дублирует проверку и
 * присылает понятные ошибки. Слева — список обращений (поиск и фильтр статуса считает
 * сервер), справа — ветка с сообщениями и редактором. На мобильном — сверление
 * список → ветка с кнопкой «К списку».
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  CheckCheck,
  FileText,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  SendHorizontal,
  Undo2,
  X,
} from 'lucide-react'
import {
  EmptyState, ErrorBlock, LoadingBlock, NoticeLine, SectionHeader, StatusDot, type TabProps,
} from '@/components/platform/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { api, secureFileUrl } from '@/lib/api'
import { fmtDateTime } from '@/lib/status'
import {
  TICKET_CATEGORY_META, TICKET_STATUS_META,
  type TicketCategory, type TicketDTO, type TicketMessageDTO, type TicketStatus, type TicketThreadDTO,
} from '@/lib/types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300'

/** Суммарный лимит вложений на одно обращение — 10 МБ (дублирует сервер) */
const TICKET_MAX_SIZE = 10 * 1024 * 1024

/** Какие файлы принимает обращение: фото, PDF, офисные документы, текст (как на сервере) */
const ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.rtf'

type TicketFilter = 'ALL' | TicketStatus

/** «Только что / 7 мин назад / 3 ч назад / вчера / 12.03» (как в колокольчике) */
function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'только что'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч назад`
  if (h < 48) return 'вчера'
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

/** «12 КБ» / «1.5 МБ» */
function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

/** Остаток лимита в мегабайтах для подсказки */
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} МБ`

/** Тип файла, который принимает сервер обращений — проверяем до чтения и отправки */
function isAllowedFile(file: File): boolean {
  const t = file.type.toLowerCase()
  return t.startsWith('image/')
    || t === 'application/pdf'
    || t.startsWith('application/vnd.openxmlformats')
    || t === 'application/msword'
    || t === 'application/vnd.ms-excel'
    || t === 'text/plain'
    || t === 'application/rtf'
}

/** Прочитать файл в data URI (base64) — вложения уходят на сервер строкой */
function readAsDataUri(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error('Не удалось прочитать файл'))
    r.readAsDataURL(file)
  })
}

/** Ссылка на скачивание вложения: защищённый URL + download=1 (сервер отдаст файлом) */
function downloadHref(url: string): string {
  const href = secureFileUrl(url)
  return href + (href.includes('?') ? '&' : '?') + 'download=1'
}

/** Выбранный, но ещё не отправленный файл вложения */
interface PendingFile {
  fileName: string
  size: number
  dataUri: string
}

/**
 * Выбор файлов в редакторе: тип проверяем сразу (тост), размер — против остатка
 * лимита обращения (красная строка под вложениями). Разрешённые файлы читаем
 * в data URI; превышающие — пропускаем с пояснением.
 */
async function pickFiles(
  incoming: File[],
  current: PendingFile[],
  available: number,
  onBadType: (names: string[]) => void,
): Promise<{ files: PendingFile[]; error: string | null }> {
  const next = [...current]
  let used = current.reduce((s, f) => s + f.size, 0)
  let error: string | null = null
  const badTypes: string[] = []

  for (const f of incoming) {
    if (!isAllowedFile(f)) {
      badTypes.push(f.name)
      continue
    }
    if (f.size > TICKET_MAX_SIZE) {
      error = `«${f.name}» — файл больше 10 МБ`
      continue
    }
    if (used + f.size > available) {
      error = `«${f.name}» не помещается: лимит вложений обращения — 10 МБ, можно приложить ещё ${mb(Math.max(0, available - used))}`
      continue
    }
    try {
      const dataUri = await readAsDataUri(f)
      used += f.size
      next.push({ fileName: f.name, size: f.size, dataUri })
    } catch {
      error = `Не удалось прочитать «${f.name}» — попробуйте другой файл`
    }
  }

  if (badTypes.length > 0) onBadType(badTypes)
  return { files: next, error }
}

/**
 * Блок вложений — общий для ветки обращения и нового обращения: чипы выбранных
 * файлов с удалением, кнопка выбора, подсказка об остатке лимита и красная строка
 * при превышении. `available` — сколько байт вложений всего доступно обращению.
 */
function AttachArea({
  files, available, error, disabled, onPick, onRemove,
}: {
  files: PendingFile[]
  available: number
  error: string | null
  disabled?: boolean
  onPick: (files: File[]) => void
  onRemove: (index: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const used = files.reduce((s, f) => s + f.size, 0)
  const left = Math.max(0, available - used)
  const over = used > available

  return (
    <div>
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <span
              key={`${f.fileName}-${i}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              <span className="max-w-[180px] truncate">{f.fileName}</span>
              <span className="shrink-0 text-slate-400">{fmtSize(f.size)}</span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={`Убрать файл ${f.fileName}`}
                className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          onPick(Array.from(e.target.files ?? []))
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className="h-11" disabled={disabled} onClick={() => inputRef.current?.click()}>
          <Paperclip className="h-4 w-4" aria-hidden />
          Приложить файл
        </Button>
        <span className="text-xs text-slate-500">Можно приложить ещё {mb(left)} из 10 МБ</span>
      </div>
      {error && <p className="mt-1.5 text-sm text-red-600" role="alert">{error}</p>}
      {!error && over && <p className="mt-1.5 text-sm text-red-600" role="alert">Приложено больше лимита — уберите лишний файл</p>}
    </div>
  )
}

/**
 * Сообщение ветки — пузырь как в мессенджере (Task 112): свои сообщения справа
 * (тон плашки — как в «Проверке документов»), чужие слева; автор, роль, время,
 * текст и вложения внутри пузыря.
 */
function MessageBubble({ m, own }: { m: TicketMessageDTO; own: boolean }) {
  return (
    <div className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
      <article
        className={`max-w-[92%] rounded-2xl border px-3.5 py-3 sm:max-w-[85%] ${
          own
            ? 'rounded-br-md border-slate-300 bg-slate-100'
            : 'rounded-bl-md border-slate-200 bg-white shadow-sm'
        }`}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-slate-900">{m.authorName}</span>
          <span className="text-xs text-slate-400">{m.staff ? 'Поддержка платформы' : 'Перевозчик'}</span>
          <span className="ml-auto shrink-0 text-xs text-slate-400">{relTime(m.createdAt)}</span>
        </div>
        {m.body && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-slate-800">{m.body}</p>}
        {m.attachments.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {m.attachments.map((a) => (
              a.isImage ? (
                <a
                  key={a.id}
                  href={secureFileUrl(a.url)}
                  target="_blank"
                  rel="noreferrer"
                  title={a.fileName}
                  aria-label={`Открыть изображение ${a.fileName} в новой вкладке`}
                  className="block cursor-zoom-in"
                >
                  <img
                    src={secureFileUrl(a.url)}
                    alt={a.fileName}
                    loading="lazy"
                    className="h-24 w-36 rounded-lg border border-slate-200 object-cover"
                  />
                </a>
              ) : (
                <a
                  key={a.id}
                  href={downloadHref(a.url)}
                  download={a.fileName}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs transition-colors hover:border-blue-200"
                >
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <span className="max-w-[220px] truncate text-blue-700 underline">{a.fileName}</span>
                  <span className="shrink-0 text-slate-400">{fmtSize(a.sizeBytes)}</span>
                </a>
              )
            ))}
          </div>
        )}
      </article>
    </div>
  )
}

export default function SupportTab({ role, liveTick, activeCarrierId: _activeCarrierId, onNavigate: _onNavigate }: TabProps) {
  const { toast } = useToast()

  // ——— список обращений ———
  const [tickets, setTickets] = useState<TicketDTO[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [status, setStatus] = useState<TicketFilter>('ALL')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  // ——— ветка открытого обращения ———
  const [thread, setThread] = useState<TicketThreadDTO | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [pending, setPending] = useState<PendingFile[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [statusBusy, setStatusBusy] = useState<'close' | 'reopen' | null>(null)

  // ——— новое обращение ———
  const [newOpen, setNewOpen] = useState(false)
  const [nSubject, setNSubject] = useState('')
  const [nCategory, setNCategory] = useState<TicketCategory>('other')
  const [nBody, setNBody] = useState('')
  const [nPending, setNPending] = useState<PendingFile[]>([])
  const [nError, setNError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const filtersRef = useRef<{ status: TicketFilter; q: string }>({ status: 'ALL', q: '' })
  useEffect(() => { filtersRef.current = { status, q } }, [status, q])

  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollStateRef = useRef<{ id: string; count: number }>({ id: '', count: 0 })

  /** Список обращений: фильтры считает сервер (status, q) */
  const loadList = useCallback(async (f?: { status: TicketFilter; q: string }) => {
    const cur = f ?? filtersRef.current
    try {
      const d = await api.tickets({
        status: cur.status === 'ALL' ? undefined : cur.status,
        q: cur.q || undefined,
      })
      setTickets(d.tickets)
      setListError(null)
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  /** Ветка обращения: silent — тихое обновление без «Загрузка…» (интервал, после отправки) */
  const loadThread = useCallback(async (id: string, silent = false) => {
    if (!silent) setThreadLoading(true)
    try {
      const t = await api.ticketThread(id)
      setThread(t)
      setThreadError(null)
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      if (!silent) setThreadLoading(false)
    }
  }, [])

  // список: при монтировании и смене фильтров (поиск — с задержкой на ввод)
  useEffect(() => { void loadList({ status, q }) }, [status, q, loadList])
  useEffect(() => {
    const t = window.setTimeout(() => setQ(qInput.trim()), 400)
    return () => window.clearTimeout(t)
  }, [qInput])

  // live-событие платформы: мгновенно догружаем список
  useEffect(() => {
    if (liveTick > 0) void loadList()
  }, [liveTick, loadList])

  // смена открытого обращения: чистим редактор и грузим ветку
  useEffect(() => {
    setThread(null)
    setThreadError(null)
    setBody('')
    setPending([])
    setAttachError(null)
    if (openId) void loadThread(openId)
  }, [openId, loadThread])

  // открытая ветка обновляется сама раз в 15 с — новые ответы видны без кнопки
  useEffect(() => {
    if (!openId) return
    const t = window.setInterval(() => { void loadThread(openId, true) }, 15000)
    return () => window.clearInterval(t)
  }, [openId, loadThread])

  // автопрокрутка переписки вниз: при открытии и новом сообщении,
  // но не мешаем читать, если пользователь отмотал вверх
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !thread) return
    const prev = scrollStateRef.current
    const grew = prev.id === thread.ticket.id ? thread.messages.length > prev.count : true
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    scrollStateRef.current = { id: thread.ticket.id, count: thread.messages.length }
    if (grew || nearBottom) el.scrollTop = el.scrollHeight
  }, [thread])

  /** Выбор файлов для ветки: остаток лимита считает сервер (sizeLeft) */
  const pickComposer = (list: File[]) => {
    void pickFiles(list, pending, thread?.sizeLeft ?? TICKET_MAX_SIZE, (names) => {
      toast({ title: 'Файлы пропущены', description: `${names.join(', ')} — поддерживаются фото, PDF и офисные документы`, variant: 'destructive' })
    }).then((r) => {
      setPending(r.files)
      setAttachError(r.error)
    })
  }

  /** Выбор файлов для нового обращения: лимит ещё не тронут — 10 МБ целиком */
  const pickNew = (list: File[]) => {
    void pickFiles(list, nPending, TICKET_MAX_SIZE, (names) => {
      toast({ title: 'Файлы пропущены', description: `${names.join(', ')} — поддерживаются фото, PDF и офисные документы`, variant: 'destructive' })
    }).then((r) => {
      setNPending(r.files)
      setNError(r.error)
    })
  }

  /** Отправить сообщение в ветку */
  const send = async () => {
    if (!thread || sending) return
    const text = body.trim()
    if (!text && pending.length === 0) return
    setSending(true)
    try {
      await api.ticketMessage(thread.ticket.id, {
        body: text,
        attachments: pending.map((f) => ({ fileName: f.fileName, dataUri: f.dataUri })),
      })
      toast({ title: 'Сообщение отправлено' })
      setBody('')
      setPending([])
      setAttachError(null)
      await Promise.all([loadThread(thread.ticket.id, true), loadList()])
    } catch (e) {
      toast({ title: 'Не удалось отправить сообщение', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  /** Закрыть обращение / открыть заново */
  const doStatus = async (action: 'close' | 'reopen') => {
    if (!thread || statusBusy) return
    setStatusBusy(action)
    try {
      await api.ticketStatus(thread.ticket.id, action)
      toast({ title: action === 'close' ? 'Обращение закрыто' : 'Обращение открыто заново' })
      await Promise.all([loadThread(thread.ticket.id, true), loadList()])
    } catch (e) {
      toast({ title: 'Не удалось изменить статус обращения', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setStatusBusy(null)
    }
  }

  /** Создать обращение: первое сообщение — описание проблемы */
  const createTicket = async () => {
    const subject = nSubject.trim()
    const text = nBody.trim()
    if (!subject || !text || creating) return
    setCreating(true)
    try {
      const d = await api.createTicket({
        subject,
        category: nCategory,
        body: text,
        attachments: nPending.map((f) => ({ fileName: f.fileName, dataUri: f.dataUri })),
      })
      toast({ title: `Обращение №${d.ticket.number} создано — ответим в этой ветке` })
      setNewOpen(false)
      setNSubject('')
      setNBody('')
      setNPending([])
      setNError(null)
      setNCategory('other')
      setOpenId(d.ticket.id)
      await loadList()
    } catch (e) {
      toast({ title: 'Не удалось создать обращение', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const hasFilters = status !== 'ALL' || q !== ''
  const t = thread?.ticket ?? null
  const tMeta = t ? TICKET_STATUS_META[t.status] : null
  // сторона сообщения: свои — справа (пузырь), чужие — слева (Task 112)
  const ownOf = (m: TicketMessageDTO): boolean => (role === 'carrier' ? !m.staff : m.staff)

  return (
    <div>
      <SectionHeader
        eyebrow="Поддержка платформы"
        title="Обращения"
        desc={role === 'carrier'
          ? 'Опишите проблему — логист или администрация ответят прямо здесь. К обращению можно приложить документы и медиа до 10 МБ.'
          : 'Обращения перевозчиков: отвечайте в ветке, закрывайте решённые.'}
      />

      <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        {/* ——— левая панель: инструменты и список обращений (на мобильном скрывается за веткой) ——— */}
        <div className={openId ? 'hidden lg:block' : ''}>
          <div className="mb-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Поиск по теме и номеру…"
                className="pl-9"
                aria-label="Поиск обращений по теме и номеру"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button className="h-11 flex-1 sm:flex-none" onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Новое обращение
              </Button>
              <div className="min-w-[150px] flex-1 sm:max-w-[190px]">
                <Select value={status} onValueChange={(v) => setStatus(v as TicketFilter)}>
                  <SelectTrigger className="h-11 w-full" aria-label="Фильтр обращений по статусу">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Все</SelectItem>
                    <SelectItem value="OPEN">Открытые</SelectItem>
                    <SelectItem value="ANSWERED">Есть ответ</SelectItem>
                    <SelectItem value="CLOSED">Закрытые</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {tickets === null && !listError && <LoadingBlock label="Загрузка обращений…" />}
          {listError && <ErrorBlock message={listError} onRetry={() => void loadList()} />}

          {tickets !== null && !listError && tickets.length === 0 && (
            <EmptyState
              icon={<MessageSquare className="h-10 w-10" aria-hidden />}
              title={hasFilters ? 'Ничего не найдено' : 'Обращений пока нет'}
              hint={hasFilters
                ? 'Измените условия поиска или фильтр статуса'
                : role === 'carrier'
                  ? 'Создайте обращение — опишите проблему, платформа ответит в ветке'
                  : 'Перевозчики создают обращения кнопкой «Новое обращение»'}
            />
          )}

          {tickets !== null && !listError && tickets.length > 0 && (
            // список как в «Проверке документов» (Task 112): отдельные карточки-плашки
            // с акцентом-вкладкой слева вместо цветной рамки — ничего не наезжает
            <div className={`max-h-[calc(100vh-260px)] space-y-2 overflow-y-auto pr-1 ${THIN_SCROLL}`}>
              {tickets.map((tk) => {
                const meta = TICKET_STATUS_META[tk.status]
                const active = tk.id === openId
                // подсветка «есть новое»: платформа ответила перевозчику (синяя) или
                // перевозчик ждёт ответа персонала в открытом обращении (янтарная)
                const attention = role === 'carrier'
                  ? !!tk.lastMessage?.staff
                  : !tk.lastMessage?.staff && tk.status === 'OPEN'
                return (
                  <button
                    key={tk.id}
                    type="button"
                    onClick={() => setOpenId(tk.id)}
                    aria-label={`Обращение №${tk.number}: ${tk.subject}. Статус: ${meta.label}`}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? 'border-slate-300 bg-slate-100 shadow-[inset_3px_0_0_#0f172a]'
                        : attention
                          ? role === 'carrier'
                            ? 'border-slate-200 bg-white shadow-[inset_3px_0_0_#2563eb] hover:border-slate-300 hover:bg-slate-50'
                            : 'border-slate-200 bg-white shadow-[inset_3px_0_0_#d97706] hover:border-slate-300 hover:bg-slate-50'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 font-mono text-xs text-slate-500">№{tk.number}</span>
                        <span className="truncate text-sm font-medium text-slate-900">{tk.subject}</span>
                      </span>
                      <StatusDot dot={meta.dot} tone={meta.tone} className="shrink-0 text-xs">{meta.label}</StatusDot>
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-500">
                      {TICKET_CATEGORY_META[tk.category]}
                      {' · '}
                      {tk.authorName}
                      {role !== 'carrier' && tk.carrierName ? ` · ${tk.carrierName}` : ''}
                      {' · '}
                      {relTime(tk.lastMessageAt)}
                    </span>
                    {tk.lastMessage && (
                      <span className="mt-1 block truncate text-sm text-slate-500">{tk.lastMessage.body}</span>
                    )}
                    <span className="mt-1.5 flex items-center gap-1 text-xs text-slate-400">
                      <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {tk.messagesCount}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* ——— правая панель: ветка обращения (на мобильном открывается вместо списка) ——— */}
        <div className={openId ? '' : 'hidden lg:block'}>
          <button
            type="button"
            onClick={() => setOpenId(null)}
            className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 lg:hidden"
            aria-label="Вернуться к списку обращений"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            К списку
          </button>

          {!thread && threadError && <ErrorBlock message={threadError} onRetry={() => { if (openId) void loadThread(openId) }} />}
          {!thread && !threadError && threadLoading && <LoadingBlock label="Загрузка обращения…" />}
          {!thread && !threadError && !threadLoading && (
            <EmptyState
              icon={<MessageSquare className="h-10 w-10" aria-hidden />}
              title="Выберите обращение"
              hint="Слева — список обращений: выберите одно, чтобы прочитать переписку и ответить"
            />
          )}

          {thread && t && tMeta && (
            <div className="space-y-4">
              {/* шапка обращения: номер, тема, статус, автор + действия статуса */}
              <Card className="border-slate-200 shadow-sm">
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="shrink-0 font-mono text-sm text-slate-500">№{t.number}</span>
                        <h3 className="break-words text-lg font-bold leading-snug text-slate-900">{t.subject}</h3>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
                        <StatusDot dot={tMeta.dot} tone={tMeta.tone}>{tMeta.label}</StatusDot>
                        <span aria-hidden>·</span>
                        <span>{TICKET_CATEGORY_META[t.category]}</span>
                        <span aria-hidden>·</span>
                        <span>Автор: {t.authorName}{t.carrierName ? ` · ${t.carrierName}` : ''}</span>
                        <span aria-hidden>·</span>
                        <span>создано {fmtDateTime(t.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {t.status !== 'CLOSED' ? (
                        <Button variant="outline" className="h-11" onClick={() => void doStatus('close')} disabled={statusBusy !== null}>
                          {statusBusy === 'close'
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            : <CheckCheck className="h-4 w-4" aria-hidden />}
                          Закрыть обращение
                        </Button>
                      ) : (
                        <Button variant="outline" className="h-11" onClick={() => void doStatus('reopen')} disabled={statusBusy !== null}>
                          {statusBusy === 'reopen'
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            : <Undo2 className="h-4 w-4" aria-hidden />}
                          Открыть заново
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* переписка */}
              <div
                ref={scrollRef}
                className={`max-h-[60vh] space-y-3 overflow-y-auto pr-1 ${THIN_SCROLL}`}
                aria-label={`Переписка по обращению №${t.number}`}
              >
                {thread.messages.map((m) => <MessageBubble key={m.id} m={m} own={ownOf(m)} />)}
              </div>

              {/* редактор сообщения либо строка о закрытой ветке */}
              <div>
                {thread.canReply ? (
                  <Card className="border-slate-200 shadow-sm">
                    <CardContent className="p-4">
                      <AttachArea
                        files={pending}
                        available={thread.sizeLeft}
                        error={attachError}
                        disabled={sending}
                        onPick={pickComposer}
                        onRemove={(i) => {
                          setPending((prev) => prev.filter((_, idx) => idx !== i))
                          setAttachError(null)
                        }}
                      />
                      <div className="mt-3 flex items-end gap-2">
                        <Textarea
                          value={body}
                          onChange={(e) => setBody(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                              e.preventDefault()
                              void send()
                            }
                          }}
                          placeholder={role === 'carrier' ? 'Опишите проблему или уточните детали…' : 'Ответ перевозчику…'}
                          rows={3}
                          aria-label="Сообщение в обращение"
                        />
                        <Button
                          className="h-11 shrink-0"
                          onClick={() => void send()}
                          disabled={sending || (!body.trim() && pending.length === 0)}
                        >
                          {sending
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            : <SendHorizontal className="h-4 w-4" aria-hidden />}
                          Отправить
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <NoticeLine tone="info">Обращение закрыто — переписка недоступна</NoticeLine>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ——— новое обращение ——— */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Новое обращение</DialogTitle>
            <DialogDescription>
              Опишите проблему — логист или администрация ответят в этой ветке. К обращению можно приложить документы и медиа до 10 МБ.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ticket-subject">Тема</Label>
              <Input
                id="ticket-subject"
                value={nSubject}
                onChange={(e) => setNSubject(e.target.value)}
                placeholder="Например: Не приходит доверенность по заявке Z-1042"
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-category">Категория</Label>
              <Select value={nCategory} onValueChange={(v) => setNCategory(v as TicketCategory)}>
                <SelectTrigger id="ticket-category" className="w-full" aria-label="Категория обращения">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TICKET_CATEGORY_META) as TicketCategory[]).map((c) => (
                    <SelectItem key={c} value={c}>{TICKET_CATEGORY_META[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-body">Описание</Label>
              <Textarea
                id="ticket-body"
                rows={5}
                value={nBody}
                onChange={(e) => setNBody(e.target.value)}
                placeholder="Опишите проблему: что случилось, по какой заявке (номер Z-…), что нужно от платформы"
                aria-label="Описание проблемы"
              />
            </div>
            <div>
              <div className="mb-1.5 text-sm font-medium text-slate-700">Вложения</div>
              <AttachArea
                files={nPending}
                available={TICKET_MAX_SIZE}
                error={nError}
                disabled={creating}
                onPick={pickNew}
                onRemove={(i) => {
                  setNPending((prev) => prev.filter((_, idx) => idx !== i))
                  setNError(null)
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setNewOpen(false)} disabled={creating}>
              Отмена
            </Button>
            <Button className="h-11" onClick={() => void createTicket()} disabled={creating || !nSubject.trim() || !nBody.trim()}>
              {creating
                ? <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Создаём…
                </>
                : 'Создать обращение'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
