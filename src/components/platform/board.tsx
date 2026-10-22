'use client'

/** Раздел «Площадка заявок» — перевозчик выбирает заявку и делает ставку; логист публикует и контролирует */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import * as XLSX from 'xlsx'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Clock,
  ClockPlus,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Gavel,
  HandCoins,
  Handshake,
  History,
  Lock,
  Map as MapIcon,
  MapPin,
  Paperclip,
  Plus,
  ScanSearch,
  Search,
  Send,
  Timer,
  TrendingDown,
  TrendingUp,
  Trash2,
  Trophy,
  Undo2,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  AgentStatusBadge,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  ModeBadge,
  SectionHeader,
  StatusBadge,
  DocStatusBadge,
  type TabProps,
} from '@/components/platform/common'
import { RouteButton, RoutePointsInline } from '@/components/platform/route-dialog'
import { PointAutocomplete } from '@/components/platform/point-autocomplete'
import { AnimatedRate } from '@/components/platform/animated-rate'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { pointInfo } from '@/lib/points'
import { formatKm, haversineKm, pointCoords, routeDistanceKm } from '@/lib/geo'
import type { MapPoint } from '@/components/platform/delivery-map'
import { DOC_TYPE_LABEL, fmtDateTime, MODE_META, num, rate, REQUEST_CATEGORIES, REQUEST_STATUS_META, DELETABLE_STATUSES, timeLeft } from '@/lib/status'
import { fileToCompressedDataUri } from '@/lib/demo-media'
import type { BidDTO, CarrierDTO, EventFeedItem, RequestDTO, RequestMode } from '@/lib/types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300'

// ——— создание заявки (Task 64, редизайн формы) ———

/** Ключ черновика формы в localStorage: если экран случайно закрыли — данные не теряются */
const CREATE_DRAFT_KEY = 'aemz_request_draft_v1'

const EMPTY_CREATE_FORM = {
  // 1 · основная информация
  category: 'Перевозка груза',
  title: '', // наименование груза / суть заявки
  // 2 · параметры логистики
  fromPoint: '',
  toPoint: '',
  loadDate: '', // YYYY-MM-DD (input type=date); в заявку уходит ДД.ММ.ГГГГ
  loadWindow: '08:00–12:00',
  // 3 · дополнительно
  comment: '',
  // торговые параметры (секция по клику)
  tonnage: '20',
  truckType: 'Тент',
  mode: 'AUCTION' as RequestMode,
  startRate: '8400',
  deadlineHours: '4',
}
type CreateFormState = typeof EMPTY_CREATE_FORM

/** ISO-дата input[type=date] → ДД.ММ.ГГГГ (формат заявок платформы) */
function isoToRuDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

/** Максимальный размер вложения и число файлов (Task 64) */
const MAX_FILE_SIZE = 8 * 1024 * 1024
const MAX_FILES = 8

/** Карта доставки: Leaflet работает только в браузере — подключаем без SSR */
const DeliveryMap = dynamic(() => import('@/components/platform/delivery-map'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-slate-500">Загружаем карту…</div>,
})

type ModeFilter = 'ALL' | RequestMode | 'MY_BIDS'

const MODE_FILTERS: { value: ModeFilter; label: string }[] = [
  { value: 'ALL', label: 'Все виды' },
  { value: 'AUCTION', label: 'Торги' },
  { value: 'CLOSED', label: 'Закрытые ставки' },
]

/** Только для роли перевозчика: заявки, куда он подавал ставку */
const MY_BIDS_FILTER: { value: ModeFilter; label: string } = { value: 'MY_BIDS', label: 'Мои отклики' }

/** Ставка в таблице: текущая лучшая и стартовая */
function RateCell({ request }: { request: RequestDTO }) {
  if (request.mode === 'CLOSED') {
    return (
      <div>
        <div className="flex items-center gap-1 font-semibold text-slate-900">
          <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          Скрыта
        </div>
        <div className="text-xs text-muted-foreground">старт {rate(request.startRate)}</div>
      </div>
    )
  }
  if (request.bestRate == null) {
    return (
      <div>
        <div className="text-sm font-medium text-slate-500">Ставок нет</div>
        <div className="text-xs text-muted-foreground">старт {rate(request.startRate)}</div>
      </div>
    )
  }
  return (
    <div>
      <AnimatedRate value={request.bestRate} format={rate} className="font-semibold text-slate-900" />
      <div className="text-xs text-muted-foreground">старт {rate(request.startRate)}</div>
    </div>
  )
}

/** Обратный отсчёт до окончания приёма ставок (без hydration mismatch) */
function DeadlineCell({ request, now }: { request: RequestDTO; now: number | null }) {
  if (!request.deadline) return <span className="text-slate-400">—</span>
  if (now === null) return <span className="text-slate-400">—</span>
  const tl = timeLeft(request.deadline)
  if (!tl) return <span className="text-slate-400">—</span>
  return (
    <span className={`tabular-nums ${tl.urgent ? 'font-semibold text-red-600' : 'text-slate-700'}`}>
      {tl.text}
    </span>
  )
}

/** Компактная метрика торгового стенда */
function Metric({ label, value, tone = 'default' }: { label: string; value: React.ReactNode; tone?: 'default' | 'green' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 text-sm font-bold ${tone === 'green' ? 'text-emerald-600' : 'text-slate-900'}`}>{value}</div>
    </div>
  )
}

// ——— сортировка таблицы заявок (Task 49): клик по заголовку asc → desc → как было ———

type SortKey = 'km' | 'cargo' | 'load' | 'truck' | 'mode' | 'rate' | 'deadline'
type SortState = { key: SortKey; dir: 'asc' | 'desc' } | null

/** Порядок вида тендера: торги → закрытые ставки */
const MODE_ORDER: Record<string, number> = { AUCTION: 0, CLOSED: 1 }

/** Дата «DD.MM.YYYY» → timestamp; «—»/пустое → Infinity (пустые всегда в конце списка) */
function loadDateTs(s: string): number {
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (!m) return Number.POSITIVE_INFINITY
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime()
}

/** Значение колонки для сортировки: число или строка; «нет данных» = Infinity */
function sortValue(r: RequestDTO, key: SortKey): string | number {
  switch (key) {
    case 'km': return routeDistanceKm(r.fromPoint, r.toPoint) ?? Number.POSITIVE_INFINITY
    case 'cargo': return r.cargo.toLowerCase()
    case 'load': return loadDateTs(r.loadDate)
    case 'truck': return r.truckType.toLowerCase()
    case 'mode': return MODE_ORDER[r.mode] ?? 99
    case 'rate': return r.bestRate ?? r.startRate
    case 'deadline': return r.deadline ? new Date(r.deadline).getTime() : Number.POSITIVE_INFINITY
  }
}

/** Заголовок с сортировкой: стрелки, aria-sort, третий клик сбрасывает */
function SortableTh({ k, label, sort, onSort, title }: {
  k: SortKey
  label: string
  sort: SortState
  onSort: (k: SortKey) => void
  title?: string
}) {
  const active = sort?.key === k
  const dir = active ? sort!.dir : null
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={title}
      className="border-b border-slate-200 pb-2.5 pr-3 font-semibold"
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-slate-800 ${active ? 'text-blue-700' : ''}`}
        aria-label={`Сортировать по «${label}»${active ? (dir === 'asc' ? ', сейчас: по возрастанию' : ', сейчас: по убыванию') : ''}`}
      >
        {label}
        {active && dir === 'asc' && <ChevronUp className="h-3.5 w-3.5" aria-hidden />}
        {active && dir === 'desc' && <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
        {!active && <ChevronsUpDown className="h-3.5 w-3.5 text-slate-300" aria-hidden />}
      </button>
    </th>
  )
}

/**
 * Торговый стенд логиста — раскрывается прямо в строке площадки:
 * обратный отсчёт, метрики, ставки и решения по заявке.
 * Победителя логист не выбирает: по окончании приёма ставок заявка автоматически
 * уходит минимальной ставке (при равных — более ранней). Логист может продлить срок,
 * поднять стартовую ставку или предложить заявку напрямую.
 */
function AuctionDesk({ request, now, busy, onExtend, onOffer, onRaise }: {
  request: RequestDTO
  now: number | null
  busy: boolean
  onExtend: () => void
  onOffer: () => void
  onRaise: () => void
}) {
  // withdrawn-ставки (агент снялся с заявки, Task 52) нигде не участвуют:
  // ни в списке, ни в счётчике, ни в лучшей цене
  const sortedBids = request.bids.filter((b) => !b.withdrawn).sort((a, b) => a.amount - b.amount || a.createdAt.localeCompare(b.createdAt))
  const minBid = sortedBids[0] ?? null
  const minAmount = minBid?.amount ?? null
  const savings = request.bestRate != null && request.bestRate < request.startRate ? request.startRate - request.bestRate : null
  const urgentClock = now !== null && timeLeft(request.deadline)?.urgent === true

  return (
    <div className="space-y-3 rounded-xl border border-blue-200 bg-white p-4">
      {/* шапка: маршрут и обратный отсчёт */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-sm text-slate-600">
          {pointInfo(request.fromPoint).short} → {pointInfo(request.toPoint).short} · {request.cargo}, {num(request.tonnage)} т
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">До окончания торгов</div>
          <div className="mt-0.5 flex items-center justify-end gap-1.5">
            <Timer className={`h-4 w-4 ${urgentClock ? 'text-red-600' : 'text-slate-500'}`} aria-hidden />
            <DeadlineCell request={request} now={now} />
          </div>
        </div>
      </div>

      {/* метрики */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Стартовая ставка" value={rate(request.startRate)} />
        <Metric
          label="Лучшая ставка"
          value={request.bestRate != null
            ? <AnimatedRate value={request.bestRate} format={rate} />
            : 'Ставок нет'}
        />
        <Metric label="Экономия" value={savings != null ? rate(savings) : '—'} tone={savings != null ? 'green' : 'default'} />
        <Metric label="Ставок" value={String(sortedBids.length)} />
      </div>

      {/* ставки: для AUCTION — таблица, для CLOSED — пояснение */}
      {request.mode === 'CLOSED' ? (
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          Закрытые ставки: цены участников скрыты от перевозчиков до подведения итогов. Победитель — минимальная ставка, определится автоматически по окончании приёма ставок.
        </div>
      ) : sortedBids.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          Ставок пока нет — заявка видна перевозчикам на площадке.
        </div>
      ) : (
        <div className={`max-h-64 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200 ${THIN_SCROLL}`}>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Перевозчик</TableHead>
                <TableHead>Ставка</TableHead>
                <TableHead>Время ставки</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedBids.map((b) => {
                const isBest = minAmount != null && b.amount === minAmount
                // свежая ставка (пришла по WebSocket меньше 20 сек назад) помечается бейджем
                const fresh = now !== null && Date.now() - new Date(b.createdAt).getTime() < 20_000
                return (
                  <TableRow key={b.id} className={isBest ? 'bg-emerald-50/60' : ''}>
                    <TableCell className="font-medium text-slate-800">
                      <span className="flex items-center gap-2">
                        {b.carrierName}
                        {fresh && <Badge variant="outline" className="whitespace-nowrap border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">новая</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-semibold text-slate-900">{rate(b.amount)}</TableCell>
                    <TableCell className="whitespace-nowrap text-slate-600">{fmtDateTime(b.createdAt)}</TableCell>
                    <TableCell>
                      {isBest && (
                        <Badge variant="outline" className="whitespace-nowrap border-emerald-300 bg-emerald-50 text-emerald-700">
                          <TrendingDown className="mr-1 h-3 w-3" aria-hidden />
                          Лучшая
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* действия над торгом */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {minBid ? (
          <span className="flex items-center gap-1.5 text-xs text-slate-600">
            <Trophy className="h-4 w-4 text-emerald-600" aria-hidden />
            Победитель определится автоматически: минимальная ставка на момент окончания приёма
          </span>
        ) : (
          <Button size="sm" disabled={busy} onClick={onRaise}>
            <TrendingUp className="h-4 w-4" aria-hidden />
            Поднять стартовую ставку
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={onExtend}>
          <ClockPlus className="h-4 w-4" aria-hidden />
          Продлить торги на 2 часа
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onOffer}>
          <Send className="h-4 w-4" aria-hidden />
          Предложить напрямую
        </Button>
        {busy && <span className="text-xs text-slate-400">Выполняется…</span>}
      </div>
    </div>
  )
}

/** Формы множественного числа: pluralRu(3, ['точка','точки','точек']) → «точки» */
function pluralRu(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return forms[2]
  if (b > 1 && b < 5) return forms[1]
  if (b === 1) return forms[0]
  return forms[2]
}

/** Точка на карте: пункт погрузки или группа заявок с одной точкой выгрузки */
interface MapGroup {
  id: string
  lat: number
  lng: number
  short: string
  name: string
  address: string
  kind: 'loading' | 'delivery'
  requests: RequestDTO[]
}

/**
 * Группирует заявки текущей выборки по координатам точек погрузки и выгрузки.
 * Точки без координат в справочнике на карту не попадают.
 */
function buildMapPoints(list: RequestDTO[]): MapPoint[] {
  const groups = new Map<string, MapGroup>()
  for (const r of list) {
    for (const [raw, kind] of [
      [r.fromPoint, 'loading'],
      [r.toPoint, 'delivery'],
    ] as const) {
      const info = pointInfo(raw)
      const c = pointCoords(raw)
      if (!c) continue
      const key = `${kind}:${c.lat},${c.lng}`
      const g = groups.get(key)
      if (g) {
        if (!g.requests.some((x) => x.id === r.id)) g.requests.push(r)
      } else {
        groups.set(key, {
          id: key,
          lat: c.lat,
          lng: c.lng,
          short: info.short,
          name: info.name,
          address: info.address,
          kind,
          requests: [r],
        })
      }
    }
  }
  const loading = [...groups.values()].find((g) => g.kind === 'loading')
  return [...groups.values()]
    .map((g): MapPoint => ({
      id: g.id,
      lat: g.lat,
      lng: g.lng,
      short: g.short,
      name: g.name,
      address: g.address,
      kind: g.kind,
      distanceKm: g.kind === 'delivery' && loading ? Math.round(haversineKm(loading, g)) : null,
      requests: g.requests.map((r) => ({
        number: r.number,
        cargo: r.cargo,
        tonnage: r.tonnage,
        loadDate: r.loadDate,
      })),
    }))
    .sort((a, b) =>
      a.kind === b.kind ? b.requests.length - a.requests.length : a.kind === 'loading' ? -1 : 1,
    )
}

export default function BoardTab({ activeCarrierId, role, onNavigate, liveTick }: TabProps) {
  const { toast } = useToast()
  const [requests, setRequests] = useState<RequestDTO[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<ModeFilter>('ALL')
  const [now, setNow] = useState<number | null>(null)
  // сортировка таблицы (Task 49): null — как пришло с сервера (новые сверху)
  const [sort, setSort] = useState<SortState>(null)
  const isLogist = role === 'logist'

  /** клик по заголовку: asc → desc → сброс */
  const toggleSort = useCallback((k: SortKey) => {
    setSort((cur) => (!cur || cur.key !== k ? { key: k, dir: 'asc' } : cur.dir === 'asc' ? { key: k, dir: 'desc' } : null))
  }, [])

  /** Пункты фильтра статуса: у перевозчика добавляется «Мои отклики» */
  const statusFilters = useMemo(
    () => (isLogist ? MODE_FILTERS : [...MODE_FILTERS, MY_BIDS_FILTER]),
    [isLogist],
  )

  // если роль сменилась на логиста — сбрасываем «Мои отклики»
  useEffect(() => {
    if (isLogist && mode === 'MY_BIDS') setMode('ALL')
  }, [isLogist, mode])

  // диалоги: держим только id, свежие данные берём из списка
  const [detailId, setDetailId] = useState<string | null>(null)
  const [bidId, setBidId] = useState<string | null>(null)
  const [bidAmount, setBidAmount] = useState('')
  // трёхшаговый диалог ставки (Task 19): форма → подтверждение → успех
  const [bidStep, setBidStep] = useState<'form' | 'confirm' | 'success'>('form')
  const [bidFinal, setBidFinal] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // карта доставки: диалог + выбранная точка (фокус из бокового списка)
  const [mapOpen, setMapOpen] = useState(false)
  const [focusPointId, setFocusPointId] = useState<string | null>(null)

  // ——— создание заявки — только логист (Task 64) ———
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<CreateFormState>(EMPTY_CREATE_FORM)
  const [files, setFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // экран успеха (Task 64): «Заявка №XXXX успешно создана» — номер созданной заявки
  const [createdNumber, setCreatedNumber] = useState<string | null>(null)

  // открытие формы: восстанавливаем черновик из localStorage (если экран случайно закрыли)
  const openCreate = useCallback(() => {
    try {
      const raw = localStorage.getItem(CREATE_DRAFT_KEY)
      setForm(raw ? { ...EMPTY_CREATE_FORM, ...(JSON.parse(raw) as Partial<CreateFormState>) } : EMPTY_CREATE_FORM)
    } catch {
      setForm(EMPTY_CREATE_FORM)
    }
    setFiles([])
    setCreateOpen(true)
  }, [])

  // автосохранение черновика (Task 64): каждое изменение формы пишется в localStorage
  useEffect(() => {
    if (!createOpen) return
    try { localStorage.setItem(CREATE_DRAFT_KEY, JSON.stringify(form)) } catch { /* приватный режим */ }
  }, [createOpen, form])

  // валидация (Task 64): «Создать» заблокирована, пока не заполнены обязательные поля
  const startRateNum = Number(form.startRate.replace(/\s/g, '').replace(',', '.'))
  const canCreate =
    form.category.trim() !== '' &&
    form.title.trim() !== '' &&
    form.fromPoint.trim() !== '' &&
    form.toPoint.trim() !== '' &&
    form.startRate.trim() !== '' &&
    Number.isFinite(startRateNum) && startRateNum > 0

  /** выбор вложений: ограничение по числу и размеру — тяжёлые файлы пропускаем с пояснением */
  const onPickFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return
    const picked = Array.from(list)
    const tooBig = picked.filter((f) => f.size > MAX_FILE_SIZE)
    const ok = picked.filter((f) => f.size <= MAX_FILE_SIZE)
    if (tooBig.length > 0) {
      toast({ title: 'Файлы пропущены', description: `Больше 8 МБ: ${tooBig.map((f) => f.name).join(', ')}`, variant: 'destructive' })
    }
    setFiles((prev) => [...prev, ...ok].slice(0, MAX_FILES))
  }

  // торговый стенд и решения логиста (вместо отдельной вкладки «Торги»)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [events, setEvents] = useState<EventFeedItem[]>([])
  const [offerReq, setOfferReq] = useState<RequestDTO | null>(null)
  const [offerCarriers, setOfferCarriers] = useState<CarrierDTO[]>([])
  const [offerCarrierId, setOfferCarrierId] = useState('')
  const [raiseReq, setRaiseReq] = useState<RequestDTO | null>(null)
  const [raiseAmount, setRaiseAmount] = useState('')
  const [raiseError, setRaiseError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await api.listRequests()
      setRequests(d.requests)
      if (isLogist) {
        const ev = await api.events(12)
        setEvents(ev.events)
      }
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setLoading(false)
    }
  }, [isLogist])

  // первичная загрузка + автообновление каждые 15 секунд (кнопки «Обновить» больше нет — Task 63)
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 15_000)
    return () => clearInterval(t)
  }, [load])

  // real-time (Task 49): событие из шины WS мгновенно догружает заявки и журнал
  useEffect(() => {
    if (liveTick > 0) void load()
  }, [liveTick, load])

  // таймер для обратного отсчёта — только после монтирования
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const applyRequest = useCallback((updated: RequestDTO) => {
    setRequests((prev) => {
      const list = prev ?? []
      const i = list.findIndex((r) => r.id === updated.id)
      if (i === -1) return [updated, ...list]
      const next = [...list]
      next[i] = updated
      return next
    })
  }, [])

  /** Лучшая (минимальная) ставка активного перевозчика по заявке — для подсветки и фильтра */
  const myBidOf = useCallback(
    (r: RequestDTO): BidDTO | null => {
      if (!activeCarrierId) return null
      const mine = r.bids.filter((b) => b.carrierId === activeCarrierId && !b.withdrawn)
      if (mine.length === 0) return null
      return mine.reduce((best, b) => (b.amount < best.amount ? b : best))
    },
    [activeCarrierId],
  )

  const filtered = useMemo(() => {
    const list = requests ?? []
    const needle = q.trim().toLowerCase()
    return list.filter((r) => {
      // Логист видит всю площадку целиком — ему нужен полный контроль над заявками
      if (isLogist) {
        if (mode !== 'ALL' && r.mode !== mode) return false
      } else if (mode === 'MY_BIDS') {
        // «Мои отклики»: исключительно заявки, куда агент уже подал отклик;
        // посторонние доступные заявки, на которые он ещё не реагировал, сюда не попадают
        if (!myBidOf(r)) return false
      } else {
        // «Площадка заявок» у агента: только новые, доступные всем заявки —
        // открытые и без его отклика; заявки с откликами живут в «Моих откликах»
        if (r.status !== 'PUBLISHED' || myBidOf(r)) return false
        if (mode !== 'ALL' && r.mode !== mode) return false
      }
      if (!needle) return true
      // поиск и по полным адресам точек (Task 22): «промышленная» найдёт АЭМЗ, «портовая» — порт
      const a = pointInfo(r.fromPoint)
      const b = pointInfo(r.toPoint)
      return [r.number, r.cargo, r.fromPoint, r.toPoint,
        a.name, a.address, b.name, b.address,
      ].some((v) => v.toLowerCase().includes(needle))
    })
  }, [requests, q, mode, myBidOf, isLogist])

  /** выборка после сортировки (Task 49): пустые значения всегда в конце, вне зависимости от направления */
  const sorted = useMemo(() => {
    if (!sort) return filtered
    const dir = sort.dir === 'asc' ? 1 : -1
    const key = sort.key
    return [...filtered].sort((a, b) => {
      const va = sortValue(a, key)
      const vb = sortValue(b, key)
      if (typeof va === 'number' && typeof vb === 'number') {
        const infA = !Number.isFinite(va)
        const infB = !Number.isFinite(vb)
        if (infA || infB) return infA && infB ? 0 : infA ? 1 : -1
        return (va - vb) * dir
      }
      return String(va).localeCompare(String(vb), 'ru') * dir
    })
  }, [filtered, sort])

  /** Точки для карты доставки — по текущей (отфильтрованной и отсортированной) выборке заявок */
  const mapPoints = useMemo(() => buildMapPoints(sorted), [sorted])
  const deliveryCount = mapPoints.filter((p) => p.kind === 'delivery').length

  /** Выгрузка текущей выборки в Excel: то, что видно в таблице с учётом фильтров и поиска */
  const exportExcel = () => {
    const withMine = !isLogist
    const header = [
      'Заявка', 'Маршрут', 'КМ', 'Груз', 'Тоннаж, т', 'Тип ТС', 'Вид тендера',
      'Ставка, ₽/т', 'Стартовая, ₽/т', 'Погрузка', 'Окно', 'Приём ставок до',
      ...(withMine ? ['Мой отклик'] : []),
    ]
    const rows = sorted.map((r) => {
      const my = myBidOf(r)
      const tenderLabel = MODE_META[r.mode].label
      const rate = r.mode === 'CLOSED' ? 'Скрыта' : (r.bestRate != null ? r.bestRate : '—')
      return [
        r.number,
        `${r.fromPoint} → ${r.toPoint}`,
        routeDistanceKm(r.fromPoint, r.toPoint) ?? '—',
        r.cargo,
        r.tonnage,
        r.truckType,
        tenderLabel,
        rate,
        r.startRate,
        r.loadDate,
        r.loadWindow,
        r.deadline ? fmtDateTime(r.deadline) : '—',
        ...(withMine ? [my ? `Ваша ставка: ${my.amount} ₽/т` : '—'] : []),
      ]
    })
    const cols = [{ wch: 10 }, { wch: 28 }, { wch: 9 }, { wch: 22 }, { wch: 10 }, { wch: 9 }, { wch: 18 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 17 }]
    if (withMine) cols.push({ wch: 19 })
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
    ws['!cols'] = cols
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Площадка')
    XLSX.writeFile(wb, 'ploschadka-zayavok.xlsx')
    toast({ title: 'Выгрузка готова', description: `В файле ${rows.length} заявок — текущая выборка с учётом фильтров и поиска` })
  }

  const detailReq = (requests ?? []).find((r) => r.id === detailId) ?? null
  const bidReq = (requests ?? []).find((r) => r.id === bidId) ?? null

  const closeBid = () => {
    setBidId(null)
    setBidAmount('')
    setBidStep('form')
    setBidFinal(null)
  }

  /** валидация ставки; возвращает число или null (с тостом о причине) */
  const validateBidAmount = (): number | null => {
    if (!bidReq) return null
    const amount = Math.round(Number(bidAmount.replace(/\s/g, '').replace(',', '.')))
    if (!amount || amount <= 0) {
      toast({ title: 'Ошибка', description: 'Укажите ставку за тонну', variant: 'destructive' })
      return null
    }
    if (bidReq.mode === 'AUCTION') {
      const floor = bidReq.bestRate ?? bidReq.startRate
      if (amount >= floor) {
        toast({ title: 'Ошибка', description: `Ставка должна быть ниже текущей лучшей (${rate(floor)})`, variant: 'destructive' })
        return null
      }
    }
    return amount
  }

  const confirmBid = () => {
    const amount = validateBidAmount()
    if (amount === null) return
    setBidFinal(amount)
    setBidStep('confirm')
  }

  const doBid = async () => {
    if (!bidReq || !activeCarrierId || bidFinal === null) return
    setBusyId(bidReq.id)
    try {
      const { request } = await api.action(bidReq.id, 'bid', { amount: bidFinal })
      applyRequest(request)
      setBidStep('success')
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : 'Не удалось подать ставку', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  /** Приём ставок закончился (или срок не задан): кнопку ставки не показываем */
  const biddingClosed = (r: RequestDTO): boolean =>
    !r.deadline || (now ?? Date.now()) >= new Date(r.deadline).getTime()

  const sortedBids = (bids: BidDTO[]) => [...bids].filter((b) => !b.withdrawn).sort((a, b) => a.amount - b.amount)
  const bestBid = (bids: BidDTO[]) => (bids.length > 0 ? Math.min(...bids.map((b) => b.amount)) : null)

  // ——— действия логиста по торгам (влиты в площадку вместо вкладки «Торги») ———
  const runAction = useCallback(async (
    id: string, action: string, payload: Record<string, unknown>, okTitle: string, okDesc: string,
  ): Promise<boolean> => {
    setBusyId(id)
    try {
      await api.action(id, action, payload)
      toast({ title: okTitle, description: okDesc })
      await load()
      return true
    } catch (e) {
      toast({
        title: 'Действие не выполнено',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
      return false
    } finally {
      setBusyId(null)
    }
  }, [load, toast])

  /** клик по строке: у логиста раскрытие торгов, иначе — детали заявки */
  const onRowClick = (r: RequestDTO) => {
    if (isLogist && r.status === 'PUBLISHED') {
      setExpandedId((cur) => (cur === r.id ? null : r.id))
    } else {
      setDetailId(r.id)
    }
  }

  const openOffer = async (r: RequestDTO) => {
    setOfferReq(r)
    if (offerCarriers.length === 0) {
      try {
        const dir = await api.directory()
        setOfferCarriers(dir.carriers)
        setOfferCarrierId(dir.carriers[0]?.id ?? '')
      } catch { /* диалог откроется, список подгрузится при следующей попытке */ }
    } else {
      setOfferCarrierId((cur) => (offerCarriers.some((c) => c.id === cur) ? cur : offerCarriers[0]?.id ?? ''))
    }
  }

  const confirmOffer = async () => {
    if (!offerReq || !offerCarrierId) return
    const carrier = offerCarriers.find((c) => c.id === offerCarrierId)
    const offerRate = offerReq.bestRate ?? offerReq.startRate
    const ok = await runAction(
      offerReq.id, 'direct-offer', { carrierId: offerCarrierId },
      'Заявка предложена напрямую',
      `№${offerReq.number}: ${carrier?.name ?? 'перевозчик'} — ${rate(offerRate)}`,
    )
    if (ok) { setOfferReq(null); setExpandedId(null) }
  }

  const openRaise = (r: RequestDTO) => {
    setRaiseAmount('')
    setRaiseError(null)
    setRaiseReq(r)
  }

  const submitRaise = async () => {
    if (!raiseReq) return
    const amt = Number(raiseAmount)
    if (!raiseAmount || Number.isNaN(amt) || amt <= raiseReq.startRate) {
      setRaiseError(`Новая ставка должна быть выше текущей (${rate(raiseReq.startRate)})`)
      return
    }
    const ok = await runAction(
      raiseReq.id, 'raise-rate', { amount: amt },
      'Стартовая ставка повышена', `№${raiseReq.number}: новая стартовая ставка ${rate(amt)}`,
    )
    if (ok) { setRaiseReq(null); setExpandedId(null) }
  }

  // ——— публикация заявки (Task 64: новая структура формы + вложения + экран успеха) ———
  const doCreate = async () => {
    if (!canCreate) return
    setCreating(true)
    try {
      const { request } = await api.createRequest({
        category: form.category,
        cargo: form.title.trim(),
        fromPoint: form.fromPoint.trim(),
        toPoint: form.toPoint.trim(),
        tonnage: Number(form.tonnage) || 20,
        truckType: form.truckType,
        mode: form.mode,
        startRate: startRateNum,
        loadDate: form.loadDate ? isoToRuDate(form.loadDate) : '—',
        loadWindow: form.loadWindow.trim() || '08:00–12:00',
        comment: form.comment.trim(),
        deadlineHours: Number(form.deadlineHours || 4),
      })
      // вложения (Task 64): загружаются после создания заявки — каждый файл отдельно;
      // сбой одного файла не отменяет заявку — сообщаем и продолжаем
      for (const f of files) {
        try {
          const dataUri = await fileToCompressedDataUri(f)
          await api.uploadDocument(request.id, { type: 'ATTACHMENT', fileName: f.name, dataUri })
        } catch {
          toast({ title: 'Файл не приложен', description: `${f.name}: заявку создали, но файл не загрузился — попробуйте позже в карточке заявки`, variant: 'destructive' })
        }
      }
      setRequests((prev) => [request, ...(prev ?? [])])
      setCreateOpen(false)
      try { localStorage.removeItem(CREATE_DRAFT_KEY) } catch { /* ignore */ }
      setFiles([])
      setForm(EMPTY_CREATE_FORM)
      setCreatedNumber(request.number) // экран успеха вместо тоста (Task 64)
    } catch (e) {
      toast({ title: 'Не удалось создать заявку', description: e instanceof Error ? e.message : 'Неизвестная ошибка', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  // ——— удаление текущей заявки логистом (Task 65, RBAC: delete_current_orders) ———
  const [deleteTarget, setDeleteTarget] = useState<RequestDTO | null>(null)
  const [deleting, setDeleting] = useState(false)
  const doDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.action(deleteTarget.id, 'delete')
      toast({ title: 'Заявка удалена', description: `№${deleteTarget.number}: снята с площадки, торги остановлены; в реестре заявок помечена «Удалена»` })
      setDeleteTarget(null)
      await load()
    } catch (e) {
      toast({ title: 'Не удалось удалить заявку', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  // ——— полоса «Требует внимания»: только реальная работа (вместо удалённой «Сводки») ———
  const attention = useMemo(() => {
    if (!isLogist || !requests) return []
    const items: { key: string; icon: LucideIcon; text: string; onClick: () => void }[] = []
    const published = requests.filter((r) => r.status === 'PUBLISHED')
    const closingSoon = published.filter((r) => {
      if (!r.deadline || now === null) return false
      const ms = new Date(r.deadline).getTime() - now
      return ms > 0 && ms <= 3_600_000
    })
    if (closingSoon.length > 0) {
      items.push({
        key: 'closing', icon: Clock,
        text: `Закрываются в ближайший час — ${closingSoon.length}`,
        onClick: () => setExpandedId(closingSoon[0].id),
      })
    }
    const noBids = published.filter((r) => r.bids.every((b) => b.withdrawn))
    if (noBids.length > 0) {
      items.push({
        key: 'nobids', icon: TrendingUp,
        text: `Без ставок, стоит поднять цену — ${noBids.length}`,
        onClick: () => setExpandedId(noBids[0].id),
      })
    }
    const atLogist = requests.filter((r) => r.status === 'AT_LOGIST').length
    if (atLogist > 0) {
      items.push({ key: 'verify', icon: ScanSearch, text: `На сверке — ${atLogist}`, onClick: () => onNavigate('verify') })
    }
    const needFix = requests.filter((r) => r.status === 'DOCS_REVIEW').length
    if (needFix > 0) {
      items.push({ key: 'fix', icon: Undo2, text: `У агента на исправлении — ${needFix}`, onClick: () => onNavigate('verify') })
    }
    return items
  }, [requests, isLogist, now, onNavigate])

  return (
    <section aria-label="Площадка заявок">
      <SectionHeader title="Площадка заявок">
        {isLogist && (
          <Button onClick={openCreate} className="gap-1.5" aria-label="Создать и опубликовать заявку">
            <Plus className="h-4 w-4" aria-hidden />
            Создать заявку
          </Button>
        )}
      </SectionHeader>

      {!isLogist && !activeCarrierId && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          Выберите перевозчика в шапке, чтобы действовать от его имени
        </div>
      )}

      {loading && <LoadingBlock label="Загружаем заявки…" />}
      {!loading && error && <ErrorBlock message={error} onRetry={() => void load()} />}

      {!loading && !error && requests && (
        <div className="space-y-4">
          {/* Полоса «Требует внимания» — появляется только когда есть работа */}
          {isLogist && attention.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
              role="status"
              aria-label="Требует внимания"
            >
              <span className="mr-1 text-xs font-bold uppercase tracking-wide text-amber-800">Требует внимания:</span>
              {attention.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={a.onClick}
                  className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100"
                >
                  <a.icon className="h-3.5 w-3.5" aria-hidden />
                  {a.text}
                </button>
              ))}
            </div>
          )}

          {/* Фильтры */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Поиск: номер, груз, маршрут…"
                  className="pl-9"
                  aria-label="Поиск по номеру, грузу или маршруту"
                />
              </div>
              <Select value={mode} onValueChange={(v) => setMode(v as ModeFilter)}>
                <SelectTrigger className="w-[200px]" aria-label="Фильтр по виду тендера">
                  <SelectValue placeholder="Все виды" />
                </SelectTrigger>
                <SelectContent>
                  {statusFilters.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={exportExcel} disabled={filtered.length === 0} className="gap-2" aria-label="Выгрузить выборку в Excel">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" aria-hidden />
                В Excel
              </Button>

              {/* Карта доставки — под поисковой строкой: точки выгрузки текущей выборки */}
              <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-3.5 py-2.5">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white" aria-hidden>
                    <MapPin className="h-4 w-4" />
                  </span>
                  <p className="min-w-0 text-sm text-slate-600">
                    <span className="font-semibold text-slate-800">Карта доставки</span>{' '}
                    — точки, куда нужно доставить груз: {deliveryCount}{' '}
                    {pluralRu(deliveryCount, ['точка', 'точки', 'точек'])} · {filtered.length}{' '}
                    {pluralRu(filtered.length, ['заявка', 'заявки', 'заявок'])} в выборке
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5 border-blue-200 bg-white hover:bg-blue-50"
                  onClick={() => { setFocusPointId(null); setMapOpen(true) }}
                  disabled={filtered.length === 0}
                  aria-label="Открыть карту доставки"
                >
                  <MapIcon className="h-4 w-4 text-blue-600" aria-hidden />
                  Открыть карту
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Таблица заявок */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              {filtered.length === 0 ? (
                <EmptyState
                  title={mode === 'MY_BIDS' ? 'Откликов пока нет' : 'Заявок не найдено'}
                  hint={mode === 'MY_BIDS'
                    ? 'Здесь собраны только заявки, куда вы подали отклик; новые доступны на «Площадке заявок»'
                    : 'Здесь только новые заявки, открытые для всех; заявки с вашим откликом — в фильтре «Мои отклики»'}
                />
              ) : (
                <div className="-mx-2 overflow-x-auto px-2">
                  <table className="w-full min-w-[1180px] table-fixed border-separate border-spacing-0 text-sm">
                    {/* Фиксированные пропорции колонок: равномерное распределение по ширине
                        таблицы — заголовки и содержимое всегда на одних и тех же позициях */}
                    <colgroup>
                      <col className="w-[7%]" />
                      <col className="w-[22%]" />
                      <col className="w-[5%]" />
                      <col className="w-[13%]" />
                      <col className="w-[7%]" />
                      <col className="w-[5%]" />
                      <col className="w-[9%]" />
                      <col className="w-[9%]" />
                      <col className="w-[8%]" />
                      <col className="w-[15%]" />
                    </colgroup>
                    <thead>
                      <tr className="whitespace-nowrap text-left text-xs uppercase tracking-wide text-slate-500">
                        <th scope="col" className="border-b border-slate-200 pb-2.5 pr-3 font-semibold">№ заявки</th>
                        <th scope="col" className="border-b border-slate-200 pb-2.5 pr-3 font-semibold">Маршрут</th>
                        <SortableTh k="km" label="КМ" sort={sort} onSort={toggleSort} title="Расстояние от погрузки до назначения, по прямой" />
                        <SortableTh k="cargo" label="Груз" sort={sort} onSort={toggleSort} />
                        <SortableTh k="load" label="Погрузка" sort={sort} onSort={toggleSort} />
                        <SortableTh k="truck" label="Тип ТС" sort={sort} onSort={toggleSort} />
                        <SortableTh k="mode" label="Вид тендера" sort={sort} onSort={toggleSort} title="Вид приёма ставок: торги на понижение или закрытые ставки" />
                        <SortableTh k="rate" label="Ставка" sort={sort} onSort={toggleSort} title="Лучшая ставка, иначе стартовая; у закрытых — стартовая" />
                        <SortableTh k="deadline" label="До окончания" sort={sort} onSort={toggleSort} title="Срок приёма ставок; без срока — в конце списка" />
                        <th scope="col" className="border-b border-slate-200 pb-2.5 font-semibold">Действие</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((r) => {
                        const my = myBidOf(r)
                        const km = routeDistanceKm(r.fromPoint, r.toPoint)
                        const expanded = isLogist && expandedId === r.id && r.status === 'PUBLISHED'
                        return (
                          <Fragment key={r.id}>
                          <tr
                            onClick={() => onRowClick(r)}
                            className={`cursor-pointer align-middle transition-colors hover:bg-blue-50/40 ${my ? 'bg-sky-50/70' : ''}`}
                          >
                            <td className="border-b border-slate-100 py-3 pr-3">
                              <div className="flex flex-col items-start gap-1">
                                <span className="font-semibold text-blue-700">{r.number}</span>
                                {my && (
                                  /* «Ваша ставка» — иконка + стоимость перевозки; цена обновляется
                                     динамически (анимация стрелки при смене значения, Task 53) */
                                  <span
                                    className="inline-flex items-center gap-1 whitespace-nowrap text-sky-700"
                                    title={`Ваша ставка: ${rate(my.amount)}`}
                                    aria-label={`Ваша ставка: ${rate(my.amount)}`}
                                  >
                                    <HandCoins className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                    <AnimatedRate value={my.amount} format={rate} className="text-xs font-semibold tabular-nums" />
                                  </span>
                                )}
                              </div>
                            </td>
                          <td className="border-b border-slate-100 py-3 pr-3">
                            <div className="flex items-center gap-2">
                              <RoutePointsInline from={r.fromPoint} to={r.toPoint} className="min-w-0 flex-1" />
                              <RouteButton from={r.fromPoint} to={r.toPoint} number={r.number} variant="ghost" className="shrink-0 px-2" />
                            </div>
                          </td>
                          <td className="whitespace-nowrap border-b border-slate-100 py-3 pr-3 tabular-nums text-slate-700">
                            {km !== null ? (
                              <span title="Расстояние по прямой">{formatKm(km)}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="border-b border-slate-100 py-3 pr-3 text-slate-700">
                            {r.cargo}
                            <span className="ml-1 whitespace-nowrap text-muted-foreground">{r.tonnage} т</span>
                          </td>
                          <td className="border-b border-slate-100 py-3 pr-3 text-slate-700">
                            <div>{r.loadDate}</div>
                            <div className="text-xs text-muted-foreground">{r.loadWindow}</div>
                          </td>
                          <td className="border-b border-slate-100 py-3 pr-3 text-slate-700">{r.truckType}</td>
                          <td className="border-b border-slate-100 py-3 pr-3"><ModeBadge mode={r.mode} /></td>
                          <td className="border-b border-slate-100 py-3 pr-3"><RateCell request={r} /></td>
                          <td className="border-b border-slate-100 py-3 pr-3"><DeadlineCell request={r} now={now} /></td>
                          <td className="border-b border-slate-100 py-3" onClick={(e) => e.stopPropagation()}>
                            {isLogist ? (
                              // логист: разворачивает торговый стенд прямо в строке или смотрит статус;
                              // рядом — удаление текущей заявки (Task 65, RBAC: delete_current_orders)
                              <div className="flex items-center justify-end gap-1.5">
                                {r.status === 'PUBLISHED' ? (
                                  <Button
                                    size="sm"
                                    variant={expandedId === r.id ? 'secondary' : 'outline'}
                                    className="gap-1.5"
                                    onClick={(e) => { e.stopPropagation(); onRowClick(r) }}
                                    aria-expanded={expandedId === r.id}
                                    aria-label={`Ставки и действия по заявке ${r.number}`}
                                  >
                                    {r.mode === 'AUCTION' ? <Gavel className="h-4 w-4" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
                                    {r.mode === 'AUCTION' ? 'Торги' : 'Ставки'}
                                    {expandedId === r.id ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                                  </Button>
                                ) : (
                                  <StatusBadge status={r.status} />
                                )}
                                {DELETABLE_STATUSES.includes(r.status) && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 shrink-0 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                    onClick={() => setDeleteTarget(r)}
                                    aria-label={`Удалить заявку ${r.number}`}
                                    title="Удалить заявку"
                                  >
                                    <Trash2 className="h-4 w-4" aria-hidden />
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <>
                                {r.status === 'PUBLISHED' && biddingClosed(r) && (
                                  <span className="text-xs font-medium text-slate-500">Приём ставок завершён</span>
                                )}
                                {r.status === 'PUBLISHED' && !biddingClosed(r) && r.mode === 'AUCTION' && (
                                  <Button
                                    size="sm"
                                    disabled={!activeCarrierId || busyId !== null}
                                    onClick={() => { setBidId(r.id); setBidAmount('') }}
                                    aria-label={`Сделать ставку по заявке ${r.number}`}
                                  >
                                    <Gavel className="h-4 w-4" aria-hidden />
                                    Сделать ставку
                                  </Button>
                                )}
                                {r.status === 'PUBLISHED' && !biddingClosed(r) && r.mode === 'CLOSED' && (
                                  <Button
                                    size="sm"
                                    disabled={!activeCarrierId || busyId !== null}
                                    onClick={() => { setBidId(r.id); setBidAmount('') }}
                                    aria-label={`Подать закрытую ставку по заявке ${r.number}`}
                                  >
                                    <Lock className="h-4 w-4" aria-hidden />
                                    Подать закрытую ставку
                                  </Button>
                                )}
                                {r.status !== 'PUBLISHED' && (isLogist ? <StatusBadge status={r.status} /> : <AgentStatusBadge status={r.status} />)}
                              </>
                            )}
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={10} className="border-b border-slate-100 bg-blue-50/40 px-2 py-3">
                              <AuctionDesk
                                request={r}
                                now={now}
                                busy={busyId === r.id}
                                onExtend={() => void runAction(r.id, 'extend', {}, 'Торги продлены', `№${r.number}: срок увеличен на 2 часа`)}
                                onOffer={() => void openOffer(r)}
                                onRaise={() => openRaise(r)}
                              />
                            </td>
                          </tr>
                        )}
                        </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Журнал событий — компактный перенос из удалённой «Сводки» */}
          {isLogist && (
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="h-4 w-4 text-blue-600" aria-hidden />
                  Журнал событий
                </CardTitle>
              </CardHeader>
              <CardContent>
                {events.length === 0 ? (
                  <p className="text-sm text-slate-500">Событий пока нет — они появятся, как только начнётся работа с заявками</p>
                ) : (
                  <ul
                    className="max-h-64 space-y-1 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300"
                    aria-label="Лента последних событий"
                  >
                    {events.map((ev) => (
                      <li key={ev.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" aria-hidden />
                        <div className="min-w-0 flex-1 text-sm leading-snug text-slate-800">{ev.message}</div>
                        <time dateTime={ev.createdAt} className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(ev.createdAt)}</time>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Диалог создания заявки (Task 64) — только логист */}
      {isLogist && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Новая заявка</DialogTitle>
              <DialogDescription>
                Заявка будет опубликована на площадке с присвоением сквозного номера Z-XXXX.
                Черновик сохраняется автоматически — случайно закрытое окно не потеряет данные.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              {/* 1 · Основная информация */}
              <section aria-label="Основная информация" className="space-y-3">
                <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700" aria-hidden>1</span>
                  Основная информация
                </h4>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="cr-category">Категория заявки <span className="text-red-500" aria-hidden>*</span></Label>
                    <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                      <SelectTrigger id="cr-category" aria-label="Категория заявки">
                        <SelectValue placeholder="Выберите категорию" />
                      </SelectTrigger>
                      <SelectContent>
                        {REQUEST_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cr-title">Наименование груза / суть заявки <span className="text-red-500" aria-hidden>*</span></Label>
                    <Input
                      id="cr-title"
                      placeholder="Труба стальная 6 м, партия 20 т"
                      value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    />
                  </div>
                </div>
              </section>

              {/* 2 · Параметры логистики */}
              <section aria-label="Параметры логистики" className="space-y-3">
                <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700" aria-hidden>2</span>
                  Параметры логистики
                </h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cr-from">Точка А (Откуда) — адрес погрузки <span className="text-red-500" aria-hidden>*</span></Label>
                    <PointAutocomplete
                      id="cr-from"
                      value={form.fromPoint}
                      onChange={(v) => setForm((f) => ({ ...f, fromPoint: v }))}
                      placeholder="Абинск, АЭМЗ"
                      ariaLabel="Точка А — адрес погрузки, с подсказками"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cr-to">Точка Б (Куда) — адрес выгрузки <span className="text-red-500" aria-hidden>*</span></Label>
                    <PointAutocomplete
                      id="cr-to"
                      value={form.toPoint}
                      onChange={(v) => setForm((f) => ({ ...f, toPoint: v }))}
                      placeholder="Порт Санкт-Петербург"
                      ariaLabel="Точка Б — адрес выгрузки, с подсказками"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cr-date">Дата — желаемый срок выполнения</Label>
                    <Input
                      id="cr-date"
                      type="date"
                      value={form.loadDate}
                      onChange={(e) => setForm((f) => ({ ...f, loadDate: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cr-window">Время — окно погрузки</Label>
                    <Input
                      id="cr-window"
                      placeholder="08:00–12:00"
                      value={form.loadWindow}
                      onChange={(e) => setForm((f) => ({ ...f, loadWindow: e.target.value }))}
                    />
                  </div>
                </div>
              </section>

              {/* 3 · Дополнительно */}
              <section aria-label="Дополнительно" className="space-y-3">
                <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700" aria-hidden>3</span>
                  Дополнительно
                </h4>
                <div className="space-y-1.5">
                  <Label htmlFor="cr-comment">Комментарий для исполнителя</Label>
                  <Textarea
                    id="cr-comment"
                    rows={3}
                    placeholder="Особые условия погрузки, контакты на месте, требования к машине…"
                    value={form.comment}
                    onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cr-files">Прикреплённые файлы / документы</Label>
                  <input
                    ref={fileInputRef}
                    id="cr-files"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(e) => { onPickFiles(e.target.files); e.target.value = '' }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={files.length >= MAX_FILES}
                  >
                    <Paperclip className="h-4 w-4 text-slate-500" aria-hidden />
                    Прикрепить файлы
                  </Button>
                  {files.length > 0 && (
                    <ul className="space-y-1.5" aria-label="Список выбранных файлов">
                      {files.map((f, i) => (
                        <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700" title={f.name}>{f.name}</span>
                          <span className="shrink-0 text-[10px] text-slate-400">{Math.max(1, Math.round(f.size / 1024))} КБ</span>
                          <button
                            type="button"
                            onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                            aria-label={`Убрать файл ${f.name}`}
                            className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Фото или сканы (JPG, PNG, WebP) до 8 МБ, до {MAX_FILES} файлов — например, ТТН или схема погрузки.
                  </p>
                </div>
              </section>

              {/* Торговые параметры: раскрыты по клику — необязательны, есть разумные значения по умолчанию */}
              <details className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3" aria-label="Параметры торгов">
                <summary className="cursor-pointer select-none text-sm font-semibold text-slate-700">
                  Параметры торгов (тоннаж, тип ТС, ставка, приём ставок)
                </summary>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cr-tonnage">Тоннаж, т</Label>
                    <Input id="cr-tonnage" type="number" min={1} max={200} value={form.tonnage} onChange={(e) => setForm((f) => ({ ...f, tonnage: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cr-truck">Тип ТС</Label>
                    <Select value={form.truckType} onValueChange={(v) => setForm((f) => ({ ...f, truckType: v }))}>
                      <SelectTrigger id="cr-truck"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['Тент', 'Реф', 'Изотерм', 'Борт'].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cr-mode">Вид тендера</Label>
                    <Select value={form.mode} onValueChange={(v) => setForm((f) => ({ ...f, mode: v as RequestMode }))}>
                      <SelectTrigger id="cr-mode"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AUCTION">Торги (аукцион на понижение)</SelectItem>
                        <SelectItem value="CLOSED">Закрытые ставки</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cr-rate">Стартовая ставка, ₽/т <span className="text-red-500" aria-hidden>*</span></Label>
                    <Input id="cr-rate" type="number" min={2500} max={12000} step={100} placeholder="8400" value={form.startRate} onChange={(e) => setForm((f) => ({ ...f, startRate: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="cr-deadline">Приём ставок ещё</Label>
                    <Select value={form.deadlineHours} onValueChange={(v) => setForm((f) => ({ ...f, deadlineHours: v }))}>
                      <SelectTrigger id="cr-deadline"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[['2', '2 часа'], ['4', '4 часа'], ['8', '8 часов'], ['24', '24 часа']].map(([v, l]) => (
                          <SelectItem key={v} value={v}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </details>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
              <Button onClick={() => void doCreate()} disabled={!canCreate || creating} aria-label="Создать заявку" title={canCreate ? 'Опубликовать заявку на площадке' : 'Заполните обязательные поля: категория, наименование, точки А и Б, стартовая ставка'}>
                {creating ? 'Создаём…' : 'Создать'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Экран успеха (Task 64): лаконичное окно с переходом в реестр или созданием следующей */}
      {isLogist && (
        <Dialog open={createdNumber !== null} onOpenChange={(o) => { if (!o) setCreatedNumber(null) }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader className="items-center text-center">
              <DialogTitle className="flex flex-col items-center gap-3 text-lg font-semibold text-slate-900">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700" aria-hidden>
                  <CheckCircle2 className="h-6 w-6" />
                </span>
                Заявка {createdNumber} успешно создана
              </DialogTitle>
              <DialogDescription className="mx-auto max-w-xs">
                Она уже на площадке — перевозчики видят её и могут подавать ставки.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="sm:justify-center">
              <Button variant="outline" onClick={() => { setCreatedNumber(null); openCreate() }}>
                Создать еще одну
              </Button>
              <Button onClick={() => { setCreatedNumber(null); onNavigate('requests') }}>
                Перейти в реестр
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Диалог ставки (торги / закрытые ставки) */}
      <Dialog open={bidReq !== null} onOpenChange={(o) => { if (!o) closeBid() }}>
        <DialogContent className="sm:max-w-md">
          {bidReq && (
            <>
              {bidStep !== 'success' && (
                <DialogHeader>
                  <DialogTitle>
                    {bidStep === 'confirm' ? 'Подтверждение ставки' : bidReq.mode === 'CLOSED' ? 'Закрытая ставка' : 'Ставка'} · заявка {bidReq.number}
                  </DialogTitle>
                  <DialogDescription>
                    {pointInfo(bidReq.fromPoint).short} → {pointInfo(bidReq.toPoint).short}, {bidReq.cargo}
                  </DialogDescription>
                </DialogHeader>
              )}
              {bidStep === 'form' && (
                <div className="space-y-4">
                  {bidReq.mode === 'AUCTION' && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      Текущая лучшая: <span className="font-semibold text-slate-900">{rate(bidReq.bestRate ?? bidReq.startRate)}</span>
                      {bidReq.bestRate == null && <span className="ml-1 text-muted-foreground">— ставок ещё нет</span>}
                    </div>
                  )}
                  {bidReq.mode === 'CLOSED' && (
                    <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                      Участники не видят цены друг друга — защита от сговора. Победителя определит логист по итогам.
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="bid-amount">Ваша ставка, ₽/т</Label>
                    <Input
                      id="bid-amount"
                      type="number"
                      min={2500}
                      max={12000}
                      step={50}
                      inputMode="numeric"
                      placeholder="Например, 8200"
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') confirmBid() }}
                    />
                    <p className="text-xs text-muted-foreground">
                      {bidReq.mode === 'CLOSED' ? 'Ставку увидит только логист при подведении итогов' : 'Должна быть ниже лучшей'}
                    </p>
                  </div>
                </div>
              )}
              {bidStep === 'confirm' && bidFinal !== null && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Заявка</div>
                      <div className="font-semibold text-slate-900">{bidReq.number}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Погрузка</div>
                      <div className="font-semibold text-slate-900">{bidReq.loadDate}, {bidReq.loadWindow}</div>
                    </div>
                    <div className="col-span-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Маршрут и груз</div>
                      <div className="font-semibold text-slate-900">
                        {pointInfo(bidReq.fromPoint).short} → {pointInfo(bidReq.toPoint).short} · {bidReq.cargo}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-center">
                    <div className="text-[11px] uppercase tracking-wide text-blue-700">Ваша ставка</div>
                    <div className="text-2xl font-bold tabular-nums text-blue-900">{rate(bidFinal)}</div>
                    {bidReq.mode === 'AUCTION' && (
                      <div className="mt-0.5 text-xs text-blue-800">
                        текущая лучшая {rate(bidReq.bestRate ?? bidReq.startRate)}
                        {bidReq.bestRate != null && bidReq.startRate > bidFinal && (
                          <> · экономия для АЭМЗ {rate(bidReq.startRate - bidFinal)}</>
                        )}
                      </div>
                    )}
                    {bidReq.mode === 'CLOSED' && (
                      <div className="mt-0.5 text-xs text-blue-800">цену увидит только логист</div>
                    )}
                  </div>
                </div>
              )}
              {bidStep === 'success' && (
                <div className="space-y-4 py-2 text-center">
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700" aria-hidden>
                    <CheckCircle2 className="h-6 w-6" />
                  </span>
                  <div>
                    <div className="text-lg font-semibold text-slate-900">Ставка принята</div>
                    {bidFinal !== null && <div className="mt-0.5 text-sm text-slate-600">Новая ставка: <span className="font-semibold text-slate-900">{rate(bidFinal)}</span></div>}
                    <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
                      Можете посмотреть заявку в разделе «Мои заявки» — она уже отображается там со статусом вашей ставки.
                    </p>
                  </div>
                </div>
              )}
              {bidStep !== 'success' ? (
                <DialogFooter>
                  {bidStep === 'confirm' && (
                    <Button variant="outline" onClick={() => setBidStep('form')} disabled={busyId !== null}>Назад</Button>
                  )}
                  {bidStep === 'form' && <Button variant="outline" onClick={closeBid}>Отмена</Button>}
                  {bidStep === 'form' && (
                    <Button onClick={confirmBid} disabled={!bidAmount.trim()}>Подтвердить ставку</Button>
                  )}
                  {bidStep === 'confirm' && (
                    <Button onClick={() => void doBid()} disabled={busyId !== null}>
                      {busyId === bidReq.id ? 'Отправляем…' : 'Подтверждаю ставку'}
                    </Button>
                  )}
                </DialogFooter>
              ) : (
                <DialogFooter className="sm:justify-center">
                  <Button variant="outline" onClick={closeBid}>Закрыть</Button>
                  <Button onClick={() => { closeBid(); onNavigate('my') }}>Открыть «Мои заявки»</Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Детали заявки */}
      <Dialog open={detailReq !== null} onOpenChange={(o) => { if (!o) setDetailId(null) }}>
        <DialogContent className={`max-h-[90vh] overflow-y-auto sm:max-w-2xl ${THIN_SCROLL}`}>
          {detailReq && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  Заявка <span className="text-blue-700">{detailReq.number}</span>
                  {/* пузырь «На площадке» в деталях не нужен (Task 34): режим и так виден рядом */}
                  {detailReq.status !== 'PUBLISHED' && (isLogist
                    ? <StatusBadge status={detailReq.status} />
                    : <AgentStatusBadge status={detailReq.status} />)}
                  <ModeBadge mode={detailReq.mode} />
                </DialogTitle>
                <DialogDescription asChild>
                  <div className="pt-1">
                    <RoutePointsInline from={detailReq.fromPoint} to={detailReq.toPoint} />
                    <RouteButton
                      from={detailReq.fromPoint}
                      to={detailReq.toPoint}
                      number={detailReq.number}
                      label="Построить маршрут"
                      className="mt-2"
                    />
                  </div>
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { label: 'Груз', value: `${detailReq.cargo}${detailReq.cargoCategory ? ` · ${detailReq.cargoCategory}` : ''}, ${detailReq.tonnage} т` },
                  { label: 'Тип ТС', value: detailReq.truckType },
                  { label: 'Погрузка', value: `${detailReq.loadDate}, ${detailReq.loadWindow}` },
                  { label: 'Стартовая ставка', value: rate(detailReq.startRate) },
                  { label: 'Текущая лучшая', value: detailReq.bestRate != null ? rate(detailReq.bestRate) : '—' },
                  { label: detailReq.winnerName ? 'Перевозчик' : 'Окончание ставок', value: detailReq.winnerName ?? '—' },
                ].map((f) => (
                  <div key={f.label} className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{f.label}</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-900">{f.value}</div>
                  </div>
                ))}
              </div>

              {/* логист: видит состояние комплекта документов прямо в деталях заявки */}
              {isLogist && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-900">Комплект документов ({detailReq.documents.length})</h4>
                  {detailReq.documents.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-center text-sm text-muted-foreground">
                      Документы пока не загружены — агент подаст их через «Подать документы».
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {detailReq.documents.map((d) => (
                        <span
                          key={d.id}
                          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700"
                        >
                          {DOC_TYPE_LABEL[d.type] ?? d.type}
                          <DocStatusBadge status={d.status} />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {detailReq.mode === 'AUCTION' && (() => {
                const activeBids = sortedBids(detailReq.bids)
                return (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    <Gavel className="h-4 w-4 text-blue-600" aria-hidden />
                    Ставки ({activeBids.length})
                  </h4>
                  {activeBids.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-muted-foreground">
                      Ставок пока нет — будьте первым.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Перевозчик</TableHead>
                            <TableHead>Ставка</TableHead>
                            <TableHead>Время</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {activeBids.map((b) => {
                            const isBest = bestBid(activeBids) === b.amount
                            return (
                              <TableRow key={b.id} className={isBest ? 'bg-emerald-50' : undefined}>
                                <TableCell className="font-medium">
                                  <span className="flex items-center gap-2">
                                    {b.carrierName}
                                    {isBest && <Badge className="border-emerald-200 bg-emerald-100 text-[10px] text-emerald-800" variant="outline">лучшая</Badge>}
                                  </span>
                                </TableCell>
                                <TableCell className={isBest ? 'font-semibold text-emerald-700' : 'text-slate-700'}>
                                  {rate(b.amount)}
                                </TableCell>
                                <TableCell className="text-muted-foreground">{fmtDateTime(b.createdAt)}</TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
                )
              })()}

              {detailReq.mode === 'CLOSED' && (
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  <Lock className="h-4 w-4 shrink-0" aria-hidden />
                  Ставки скрыты до подведения итогов — участники не видят цены друг друга.
                </div>
              )}

              {detailReq.status !== 'PUBLISHED' && detailReq.mode === 'AUCTION' && sortedBids(detailReq.bids).length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Торги завершены — победитель согласован логистом.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* прямое предложение перевозчику */}
      <Dialog open={!!offerReq} onOpenChange={(o) => { if (!o) setOfferReq(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Предложить заявку напрямую</DialogTitle>
            <DialogDescription>
              {offerReq && (
                <>№{offerReq.number} · {pointInfo(offerReq.fromPoint).short} → {pointInfo(offerReq.toPoint).short} · ставка {rate(offerReq.bestRate ?? offerReq.startRate)}</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="offer-carrier">Перевозчик</Label>
            <Select value={offerCarrierId} onValueChange={setOfferCarrierId}>
              <SelectTrigger id="offer-carrier" aria-label="Выбор перевозчика для прямого предложения">
                <SelectValue placeholder="Выберите перевозчика" />
              </SelectTrigger>
              <SelectContent>
                {offerCarriers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · взято {c.takenCount}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOfferReq(null)}>Отмена</Button>
            <Button disabled={!offerCarrierId || busyId !== null} onClick={() => void confirmOffer()}>
              <Handshake className="h-4 w-4" aria-hidden />
              Предложить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* поднятие стартовой ставки */}
      <Dialog open={!!raiseReq} onOpenChange={(o) => { if (!o) setRaiseReq(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Поднять стартовую ставку</DialogTitle>
            <DialogDescription>
              {raiseReq && (
                <>№{raiseReq.number}: ставок нет. Повысьте стартовую ставку, чтобы привлечь перевозчиков.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="raise-amount">Новая стартовая ставка, ₽/т</Label>
            <Input
              id="raise-amount"
              type="number"
              inputMode="numeric"
              min={2500}
              step={100}
              placeholder={raiseReq ? `больше ${raiseReq.startRate}` : ''}
              value={raiseAmount}
              onChange={(e) => { setRaiseAmount(e.target.value); setRaiseError(null) }}
              aria-label="Новая стартовая ставка в рублях за тонну"
            />
            {raiseReq && <div className="text-xs text-slate-500">Текущая стартовая ставка: {rate(raiseReq.startRate)}</div>}
            {raiseError && <div className="text-xs font-medium text-red-600">{raiseError}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRaiseReq(null)}>Отмена</Button>
            <Button disabled={busyId !== null} onClick={() => void submitRaise()}>Поднять ставку</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог «Карта доставки» — точки выгрузки по текущей выборке */}
      <Dialog open={mapOpen} onOpenChange={(o) => { setMapOpen(o); if (!o) setFocusPointId(null) }}>
        <DialogContent className="grid h-[92vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-blue-600" aria-hidden />
              Карта доставки
            </DialogTitle>
            <DialogDescription>
              Пункт погрузки и точки, куда нужно доставить груз по текущей выборке — {filtered.length}{' '}
              {pluralRu(filtered.length, ['заявка', 'заявки', 'заявок'])}. Нажмите на маркер или точку в списке, чтобы увидеть заявки.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-3 md:flex-row">
            {/* Боковой список точек: клик — фокус на маркере */}
            <aside
              className="flex max-h-44 w-full shrink-0 flex-col gap-1.5 overflow-y-auto pr-1 md:max-h-none md:w-64 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300"
              aria-label="Точки доставки"
            >
              {mapPoints.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setFocusPointId(p.id)}
                  className={`flex items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    focusPointId === p.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <span
                    className="mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white"
                    style={{ background: p.kind === 'loading' ? '#d97706' : '#2563eb' }}
                    aria-hidden
                  >
                    {p.kind === 'loading' ? '🏭' : p.requests.length}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-800">{p.short}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.kind === 'loading' ? 'погрузка' : 'выгрузка'}
                      {p.distanceKm != null ? ` · ≈ ${formatKm(p.distanceKm)}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </aside>
            {/* Карта */}
            <div className="relative min-h-[280px] flex-1 overflow-hidden rounded-xl border border-slate-200">
              <DeliveryMap points={mapPoints} focusId={focusPointId} />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Подтверждение удаления заявки (Task 65): модальное окно с предупреждением */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить заявку?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {deleteTarget && (
                  <>
                    Вы уверены, что хотите удалить текущую заявку{' '}
                    <span className="font-semibold text-slate-900">№{deleteTarget.number}</span>
                    {' '}({pointInfo(deleteTarget.fromPoint).short} → {pointInfo(deleteTarget.toPoint).short})?{' '}
                    Это действие нельзя отменить. Заявка будет снята с площадки, торги и ставки остановятся;
                    в реестре заявок она останется со статусом «Удалена».
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); void doDelete() }}
              className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600"
            >
              {deleting ? 'Удаляем…' : 'Да, удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
