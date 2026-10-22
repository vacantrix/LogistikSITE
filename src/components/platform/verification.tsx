'use client'

/** «Сверка документов» — экран логиста: очередь с вычисляемыми состояниями (новая /
 *  ожидают / расхождения / сверено / отклонено), фильтры и поиск, ожидаемые данные
 *  из системы, сканы с зумом, сверка полей OCR, экспресс-сличение и вердикт (Task 62) */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Ban, Check, CheckCheck, CircleAlert, ClipboardCheck, Download, Info,
  ListChecks, Maximize2, Search, Undo2, UserCog, X,
} from 'lucide-react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DocStatusBadge, EmptyState, ErrorBlock, LoadingBlock, SectionHeader, StatusBadge, type TabProps,
} from '@/components/platform/common'
import { DocumentPreviewModal, ZoomableThumb } from '@/components/platform/document-preview'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { ToastAction } from '@/components/ui/toast'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { api, secureFileUrl } from '@/lib/api'
import { DOC_TYPE_LABEL, rate } from '@/lib/status'
import type {
  DocType, DocumentDTO, DriverDTO, RequestDTO, TrailerDTO, TruckDTO, VerifyCheck,
} from '@/lib/types'
import { cn } from '@/lib/utils'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full'

const DOC_ORDER: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'LICENSE', 'STS', 'REQUEST_DOC', 'POA']

/** экспресс-сличение: ключевые вопросы логиста по пакету документов (Task 62) */
const VERIFY_CHECKS: { key: string; label: string }[] = [
  { key: 'amount', label: 'Сумма по ТОРГ-12 / АКТ совпадает?' },
  { key: 'doc-number', label: 'Номер ТН совпадает?' },
  { key: 'stamps', label: 'Подписи и печати на месте?' },
]

/** причины возврата агенту — выбор из списка, не свободный текст */
const RETURN_REASONS = ['Нет печати', 'Расхождение по весу', 'Нечитаемый скан', 'Не тот документ', 'Другое'] as const

/** госномер: латиница/кириллица — взаимно однозначное приведение */
const PLATE_MAP: Record<string, string> = {
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H',
  'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X',
}

function normBase(s: string): string {
  return s.toUpperCase().replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim()
}

function normValue(s: string, kind: 'fio' | 'plate' | 'digits' | 'text'): string {
  const base = normBase(s)
  if (kind === 'fio') return base
  if (kind === 'plate') return base.split('').map((c) => PLATE_MAP[c] ?? c).join('')
  if (kind === 'digits') return s.replace(/\D/g, '')
  return base
}

interface VerifyRow {
  label: string
  expected: string | null // null — сверка не требуется
  actual: string
  conf: number | null
  kind: 'fio' | 'plate' | 'digits' | 'text'
}

function buildRows(
  type: DocType, doc: DocumentDTO, driver: DriverDTO | null, truck: TruckDTO | null, requestNumber: string | null,
): VerifyRow[] {
  const f = (k: string) => doc.fields?.[k]?.trim() ?? ''
  const c = (k: string) => (doc.confidence?.[k] != null ? doc.confidence[k] : null)

  if (type === 'PASSPORT_PHOTO') {
    const parts = (driver?.fullName ?? '').split(' ')
    return [
      { label: 'Фамилия', expected: driver ? parts[0] ?? '' : null, actual: f('Фамилия'), conf: c('Фамилия'), kind: 'fio' },
      { label: 'Имя', expected: driver ? parts[1] ?? '' : null, actual: f('Имя'), conf: c('Имя'), kind: 'fio' },
      { label: 'Отчество', expected: driver ? parts[2] ?? '' : null, actual: f('Отчество'), conf: c('Отчество'), kind: 'fio' },
      { label: 'Дата рождения', expected: driver?.birthDate ?? null, actual: f('Дата рождения'), conf: c('Дата рождения'), kind: 'text' },
      { label: 'Серия и номер', expected: driver?.passport ?? null, actual: f('Серия и номер'), conf: c('Серия и номер'), kind: 'digits' },
    ]
  }
  if (type === 'PASSPORT_REG') {
    return ['Дата регистрации', 'Код подразделения', 'Адрес регистрации'].map((k) => ({
      label: k, expected: null, actual: f(k), conf: c(k), kind: 'text' as const,
    }))
  }
  if (type === 'LICENSE') {
    return [
      { label: 'ФИО', expected: driver?.fullName ?? null, actual: f('ФИО'), conf: c('ФИО'), kind: 'fio' },
      { label: 'Дата рождения', expected: driver?.birthDate ?? null, actual: f('Дата рождения'), conf: c('Дата рождения'), kind: 'text' },
      { label: 'Номер ВУ', expected: driver?.license ?? null, actual: f('Номер ВУ'), conf: c('Номер ВУ'), kind: 'digits' },
      { label: 'Действует до', expected: driver?.licenseTill ?? null, actual: f('Действует до'), conf: c('Действует до'), kind: 'text' },
    ]
  }
  if (type === 'REQUEST_DOC') {
    return [
      { label: 'Номер заявки', expected: requestNumber, actual: f('Номер заявки'), conf: c('Номер заявки'), kind: 'text' },
      { label: 'Дата заявки', expected: null, actual: f('Дата заявки'), conf: c('Дата заявки'), kind: 'text' },
      { label: 'Груз', expected: null, actual: f('Груз'), conf: c('Груз'), kind: 'text' },
      { label: 'Ставка', expected: null, actual: f('Ставка'), conf: c('Ставка'), kind: 'text' },
    ]
  }
  if (type === 'POA') {
    return [
      { label: 'Номер доверенности', expected: null, actual: f('Номер доверенности'), conf: c('Номер доверенности'), kind: 'text' },
      { label: 'Дата выдачи', expected: null, actual: f('Дата выдачи'), conf: c('Дата выдачи'), kind: 'text' },
      { label: 'Действительна до', expected: null, actual: f('Действительна до'), conf: c('Действительна до'), kind: 'text' },
      { label: 'Кем выдана (перевозчик)', expected: null, actual: f('Кем выдана (перевозчик)'), conf: c('Кем выдана (перевозчик)'), kind: 'text' },
      { label: 'Представитель (ФИО)', expected: driver?.fullName ?? null, actual: f('Представитель (ФИО)'), conf: c('Представитель (ФИО)'), kind: 'fio' },
    ]
  }
  return [
    { label: 'Госномер', expected: truck?.plate ?? null, actual: f('Госномер'), conf: c('Госномер'), kind: 'plate' },
    { label: 'VIN', expected: truck?.vin ?? null, actual: f('VIN'), conf: c('VIN'), kind: 'text' },
    { label: 'Номер СТС', expected: truck?.sts ?? null, actual: f('Номер СТС'), conf: c('Номер СТС'), kind: 'digits' },
  ]
}

function confClass(conf: number): string {
  if (conf >= 0.95) return 'text-emerald-600'
  if (conf >= 0.6) return 'text-blue-600'
  return 'text-amber-600'
}

function IssueIcon({ docStatus }: { docStatus: DocumentDTO['status'] }) {
  if (docStatus === 'REJECTED') return <Ban className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
  if (docStatus === 'MANUAL') return <UserCog className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden />
  return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
}

// ——— вычисляемое состояние заявки в очереди сверки (Task 62) ———

type QueueState = 'new' | 'pending' | 'mismatch' | 'verified' | 'rejected'

/** mismatch → pending → new → rejected → verified — порядок сортировки очереди */
const STATE_ORDER: QueueState[] = ['mismatch', 'pending', 'new', 'rejected', 'verified']

const STATE_META: Record<QueueState, { label: string; dot: string; bar: string; badge: string; chip: string }> = {
  new: {
    label: 'Новая', dot: 'bg-sky-500', bar: 'border-l-sky-500',
    badge: 'border-sky-200 bg-sky-50 text-sky-700', chip: 'border-sky-600 bg-sky-600 text-white',
  },
  pending: {
    label: 'Ожидают сверки', dot: 'bg-blue-500', bar: 'border-l-blue-500',
    badge: 'border-blue-200 bg-blue-50 text-blue-700', chip: 'border-blue-600 bg-blue-600 text-white',
  },
  mismatch: {
    label: 'Есть расхождения', dot: 'bg-red-500', bar: 'border-l-red-500',
    badge: 'border-red-200 bg-red-50 text-red-700', chip: 'border-red-600 bg-red-600 text-white',
  },
  verified: {
    label: 'Сверено', dot: 'bg-emerald-500', bar: 'border-l-emerald-500',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700', chip: 'border-emerald-600 bg-emerald-600 text-white',
  },
  rejected: {
    label: 'Отклонено', dot: 'bg-amber-500', bar: 'border-l-amber-500',
    badge: 'border-amber-200 bg-amber-50 text-amber-700', chip: 'border-amber-600 bg-amber-600 text-white',
  },
}

/** есть ли OCR-расхождение хотя бы по одному обязательному полю любого документа */
function hasMismatch(
  r: RequestDTO, driverMap: Map<string, DriverDTO>, truckMap: Map<string, TruckDTO>,
): boolean {
  const driver = r.driverId ? driverMap.get(r.driverId) ?? null : null
  const truck = r.truckId ? truckMap.get(r.truckId) ?? null : null
  return r.documents.some((doc) =>
    buildRows(doc.type, doc, driver, truck, r.number).some(
      (row) => row.expected != null && row.actual !== '' &&
        normValue(row.expected, row.kind) !== normValue(row.actual, row.kind),
    ),
  )
}

function queueState(
  r: RequestDTO, driverMap: Map<string, DriverDTO>, truckMap: Map<string, TruckDTO>,
): QueueState {
  if (r.status === 'CONFIRMED') return 'verified'
  if (r.status === 'DOCS_REVIEW') return 'rejected'
  if (hasMismatch(r, driverMap, truckMap)) return 'mismatch'
  const flagged = r.documents.some(
    (d) => d.status === 'REUPLOAD' || d.status === 'REJECTED' || d.status === 'MANUAL' || d.issues.length > 0,
  )
  return flagged ? 'pending' : 'new'
}

export default function VerificationTab({ activeCarrierId: _activeCarrierId, onNavigate, liveTick }: TabProps) {
  const { toast } = useToast()
  const [requests, setRequests] = useState<RequestDTO[] | null>(null)
  const [carriersLoaded, setCarriersLoaded] = useState(false)
  const [driverMap, setDriverMap] = useState<Map<string, DriverDTO>>(new Map())
  const [truckMap, setTruckMap] = useState<Map<string, TruckDTO>>(new Map())
  const [trailerMap, setTrailerMap] = useState<Map<string, TrailerDTO>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [docTab, setDocTab] = useState<DocType | null>(null)
  const [stateFilter, setStateFilter] = useState<'ALL' | QueueState>('ALL')
  const [q, setQ] = useState('')

  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [comment, setComment] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [returnComment, setReturnComment] = useState('')

  const load = useCallback(async () => {
    try {
      const [rq, dir] = await Promise.all([api.listRequests(), api.directory()])
      setRequests(rq.requests)
      const dm = new Map<string, DriverDTO>()
      const tm = new Map<string, TruckDTO>()
      const trm = new Map<string, TrailerDTO>()
      for (const c of dir.carriers) {
        for (const d of c.drivers) dm.set(d.id, d)
        for (const t of c.trucks) tm.set(t.id, t)
        for (const tr of c.trailers) trm.set(tr.id, tr)
      }
      setDriverMap(dm)
      setTruckMap(tm)
      setTrailerMap(trm)
      setCarriersLoaded(true)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // real-time (Task 49): событие из шины WS мгновенно догружает очередь сверки
  useEffect(() => {
    if (liveTick > 0) void load()
  }, [liveTick, load])

  const queue = useMemo(
    () => (requests ?? []).filter((r) => r.status === 'AT_LOGIST' || r.status === 'DOCS_REVIEW' || r.status === 'CONFIRMED'),
    [requests],
  )
  const needFix = useMemo(() => (requests ?? []).filter((r) => r.status === 'DOCS_REVIEW'), [requests])
  const atLogistCount = useMemo(() => queue.filter((r) => r.status === 'AT_LOGIST').length, [queue])

  const selected = useMemo(() => queue.find((r) => r.id === selectedId) ?? null, [queue, selectedId])

  // автоподбор заявки: только из рабочих состояний (new/pending/mismatch, т.е. статус AT_LOGIST);
  // сверенные и отклонённые заявки открываются только вручную из фильтров
  useEffect(() => {
    if (queue.some((r) => r.id === selectedId)) return
    setSelectedId(queue.find((r) => r.status === 'AT_LOGIST')?.id ?? null)
  }, [queue, selectedId])

  // смена заявки: сброс экспресс-сличения, комментария, вкладки документа и модалки предосмотра
  useEffect(() => {
    setChecks({})
    setComment('')
    setDocTab(null)
    setPreviewOpen(false)
    setConfirmOpen(false)
  }, [selectedId])

  // счётчики состояний для фильтров (по всей очереди, без учёта поиска)
  const stateCounts = useMemo(() => {
    const c: Record<QueueState, number> = { new: 0, pending: 0, mismatch: 0, verified: 0, rejected: 0 }
    for (const r of queue) c[queueState(r, driverMap, truckMap)]++
    return c
  }, [queue, driverMap, truckMap])

  // фильтр + поиск + сортировка: расхождения → ожидают → новые → отклонённые → сверенные
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = queue.filter((r) => {
      if (stateFilter !== 'ALL' && queueState(r, driverMap, truckMap) !== stateFilter) return false
      if (!needle) return true
      const haystack = [
        r.number,
        r.driverId ? driverMap.get(r.driverId)?.fullName ?? '' : '',
        r.truckId ? truckMap.get(r.truckId)?.plate ?? '' : '',
        r.cargo,
        ...r.documents.map((d) => `${d.fields?.['Номер заявки'] ?? ''} ${d.fileName}`),
      ].join(' ').toLowerCase()
      return haystack.includes(needle)
    })
    return [...list].sort(
      (a, b) => STATE_ORDER.indexOf(queueState(a, driverMap, truckMap)) - STATE_ORDER.indexOf(queueState(b, driverMap, truckMap)),
    )
  }, [queue, stateFilter, q, driverMap, truckMap])

  // активный документ: выбранная вкладка или первый документ заявки
  const activeDocType: DocType | null = useMemo(() => {
    if (!selected) return null
    if (docTab && selected.documents.some((d) => d.type === docTab)) return docTab
    return selected.documents[0]?.type ?? null
  }, [selected, docTab])
  const activeDoc = selected?.documents.find((d) => d.type === activeDocType) ?? null

  const driver = selected ? driverMap.get(selected.driverId ?? '') ?? null : null
  const truck = selected ? truckMap.get(selected.truckId ?? '') ?? null : null
  const trailer = selected ? trailerMap.get(selected.trailerId ?? '') ?? null : null
  const savedChecks: VerifyCheck[] = selected?.verifyChecks ?? []

  const isEditable = selected?.status === 'AT_LOGIST'
  const answeredCount = VERIFY_CHECKS.filter((c) => checks[c.key] !== undefined).length
  const allAnswered = answeredCount === VERIFY_CHECKS.length
  const hasNoAnswer = VERIFY_CHECKS.some((c) => checks[c.key] === false)

  /** ответы экспресс-сличения — только отвеченные пункты */
  const buildChecks = (): VerifyCheck[] =>
    VERIFY_CHECKS
      .filter((c) => checks[c.key] !== undefined)
      .map((c) => ({ key: c.key, label: c.label, ok: checks[c.key] === true }))

  const doConfirm = async (r: RequestDTO) => {
    setBusy(r.id)
    try {
      await api.action(r.id, 'confirm', { checks: buildChecks(), comment })
      toast({
        title: 'Данные переданы в 1C:ERP: справочник и реестр',
        description: `Заявка №${r.number} записана в реестр рейсов, пакет на пропуск и ЭТрН сформированы`,
        action: (
          <ToastAction altText="Открыть реестр рейсов" onClick={() => onNavigate('registry')}>
            Открыть реестр
          </ToastAction>
        ),
      })
      setSelectedId(null)
      setDocTab(null)
      await load()
    } catch (e) {
      toast({
        title: 'Не удалось подтвердить заявку',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setBusy(null)
    }
  }

  /** подтверждение с проверкой экспресс-сличения: есть «Нет» среди всех ответов — спросить */
  const onConfirmClick = () => {
    if (!selected) return
    if (allAnswered && hasNoAnswer) {
      setConfirmOpen(true)
      return
    }
    void doConfirm(selected)
  }

  const doReturn = async () => {
    if (!selected || !returnReason) return
    setBusy(selected.id)
    try {
      await api.action(selected.id, 'return', { reason: returnReason, comment: returnComment, checks: buildChecks() })
      toast({
        title: 'Заявка возвращена агенту',
        description: `№${selected.number}: агент получит причину и догрузит документы в ту же заявку`,
      })
      setReturnOpen(false)
      setReturnReason('')
      setReturnComment('')
      setSelectedId(null)
      await load()
    } catch (e) {
      toast({
        title: 'Не удалось вернуть заявку',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setBusy(null)
    }
  }

  if (requests === null && !error) return <LoadingBlock label="Загрузка очереди сверки…" />
  if (error) return <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />

  return (
    <div>
      <SectionHeader
        title="Сверка документов"
      >
        <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
          В очереди: {atLogistCount}
        </Badge>
      </SectionHeader>

      {/* заявки, требующие исправления у агента — только информирование */}
      {needFix.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <CircleAlert className="h-4 w-4" aria-hidden />
            Требуют исправления (у агента): {needFix.length}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {needFix.map((r) => (
              <Badge key={r.id} variant="outline" className="border-amber-300 bg-white text-amber-800">
                №{r.number} · {r.fromPoint} → {r.toPoint} · документы на догрузке
              </Badge>
            ))}
          </div>
        </div>
      )}

      {queue.length === 0 ? (
        <EmptyState
          icon={<CheckCheck className="h-10 w-10" aria-hidden />}
          title="Очередь сверки пуста"
          hint="Заявки, прошедшие проверку нейросети, появятся здесь"
        />
      ) : (
        <>
          {/* фильтры состояний + поиск */}
          <div className="mb-3 space-y-2">
            <div className="hidden flex-wrap items-center gap-1.5 sm:flex" role="group" aria-label="Фильтр заявок по состоянию">
              <button
                type="button"
                onClick={() => setStateFilter('ALL')}
                aria-pressed={stateFilter === 'ALL'}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  stateFilter === 'ALL'
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                Все
                <span className={`rounded-full px-1.5 text-[10px] font-bold ${stateFilter === 'ALL' ? 'bg-white/25' : 'bg-slate-100 text-slate-600'}`}>
                  {queue.length}
                </span>
              </button>
              {STATE_ORDER.map((s) => {
                const meta = STATE_META[s]
                const active = stateFilter === s
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStateFilter(s)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      active ? meta.chip : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
                    {meta.label}
                    <span className={`rounded-full px-1.5 text-[10px] font-bold ${active ? 'bg-white/25' : 'bg-slate-100 text-slate-600'}`}>
                      {stateCounts[s]}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="sm:hidden">
              <Label htmlFor="state-filter" className="sr-only">Фильтр заявок по состоянию</Label>
              <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as 'ALL' | QueueState)}>
                <SelectTrigger id="state-filter" aria-label="Фильтр заявок по состоянию">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Все ({queue.length})</SelectItem>
                  {STATE_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATE_META[s].label} ({stateCounts[s]})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск: номер, водитель, тягач, груз…"
                className="pl-8"
                aria-label="Поиск по очереди сверки: номер, водитель, тягач, груз, документы"
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[288px_minmax(0,1fr)]">
            {/* список очереди */}
            <div className="space-y-2">
              <div className="lg:hidden">
                <Label htmlFor="queue-select" className="sr-only">Заявка в очереди</Label>
                <Select value={selectedId ?? ''} onValueChange={setSelectedId}>
                  <SelectTrigger id="queue-select" aria-label="Выбор заявки из очереди сверки">
                    <SelectValue placeholder="Выберите заявку" />
                  </SelectTrigger>
                  <SelectContent>
                    {visible.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        №{r.number} · {r.winnerName ?? '—'} · {rate(r.bestRate)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {visible.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Ничего не найдено — измените фильтр или поисковый запрос.
                </div>
              )}
              <div className={`hidden max-h-[640px] space-y-2 overflow-y-auto pr-1 lg:block ${THIN_SCROLL}`}>
                {visible.map((r) => {
                  const st = queueState(r, driverMap, truckMap)
                  const meta = STATE_META[st]
                  const active = r.id === selected?.id
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedId(r.id)}
                      aria-pressed={active}
                      aria-label={`Заявка №${r.number}, состояние: ${meta.label}`}
                      className={`w-full rounded-xl border border-slate-200 border-l-4 ${meta.bar} p-3 text-left transition-colors ${
                        active
                          ? 'border-blue-500 bg-blue-50/70 ring-1 ring-blue-200'
                          : 'bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
                          <span className="text-sm font-bold text-blue-700">№{r.number}</span>
                        </span>
                        <span className="text-sm font-semibold text-slate-900">{rate(r.bestRate)}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-600">{r.fromPoint} → {r.toPoint} · {r.cargo}</div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-slate-500">{r.winnerName ?? '—'}</span>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.badge}`}>
                          {meta.label}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* детали выбранной заявки */}
            {selected && carriersLoaded ? (
              <Card className="min-w-0 border-slate-200 shadow-sm">
                <CardContent className="space-y-4 p-4 sm:p-6">
                  {/* шапка */}
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-slate-900">
                        Заявка №{selected.number} · {selected.winnerName ?? '—'}
                      </h3>
                      <StatusBadge status={selected.status} />
                      {selected.status === 'AT_LOGIST' && (
                        <Badge variant="outline" className={`${STATE_META[queueState(selected, driverMap, truckMap)].badge} whitespace-nowrap`}>
                          {STATE_META[queueState(selected, driverMap, truckMap)].label}
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-slate-600">
                      Водитель и ТС:{' '}
                      <span className="font-medium text-slate-800">
                        {driver ? driver.fullName : '—'}{truck ? ` · ${truck.brand} (${truck.plate})` : ''}
                        {trailer ? ` + ${trailer.plate}` : ''}
                      </span>
                    </div>
                    <div className="text-sm text-slate-600">
                      {selected.fromPoint} → {selected.toPoint} · {selected.cargo} · ставка {rate(selected.bestRate)}
                    </div>
                  </div>

                  {/* ожидаемые данные из системы (автозаполнение, read-only) */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <ListChecks className="h-4 w-4 text-blue-600" aria-hidden />
                      Ожидаемые данные из системы
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">автозаполнение из заявки — сверяется со сканами</div>
                    <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {[
                        { label: 'Грузоотправитель', value: `АЭМЗ · ${selected.fromPoint}` },
                        { label: 'Грузополучатель', value: selected.toPoint },
                        { label: 'Груз', value: `${selected.cargo}, ${selected.tonnage} т` },
                        {
                          label: 'Количество мест',
                          value: selected.documents.find((d) => d.type === 'REQUEST_DOC')?.fields?.['Количество мест']?.trim() || '—',
                        },
                        {
                          label: 'Госномер тягача',
                          value: truck ? (trailer ? `${truck.plate} · прицеп ${trailer.plate}` : truck.plate) : '—',
                        },
                        { label: 'Водитель', value: driver?.fullName ?? '—' },
                        { label: 'Ставка', value: rate(selected.bestRate) },
                      ].map((it) => (
                        <div key={it.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{it.label}</dt>
                          <dd className="mt-0.5 truncate text-sm font-semibold text-slate-800" title={it.value}>{it.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  {/* вкладки документов */}
                  {selected.documents.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {DOC_ORDER.flatMap((t) => {
                        const doc = selected.documents.find((d) => d.type === t)
                        if (!doc) return []
                        const active = doc.type === activeDocType
                        return [
                          <button
                            key={t}
                            type="button"
                            onClick={() => setDocTab(t)}
                            aria-pressed={active}
                            aria-label={`Документ: ${DOC_TYPE_LABEL[t]}`}
                            className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                              active
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            {DOC_TYPE_LABEL[t]}
                            <DocStatusBadge status={doc.status} />
                          </button>,
                        ]
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                      Документы не загружены.
                    </div>
                  )}

                  {/* содержимое вкладки */}
                  {activeDoc && (
                    <div className="space-y-3">
                      {activeDoc.status === 'MANUAL' && (
                        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                          Ручная проверка: результат неоднозначен, решение за сотрудником.
                        </div>
                      )}

                      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
                        {/* просмотр скана */}
                        <div className="self-start rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <ZoomableThumb
                            src={secureFileUrl(activeDoc.url)}
                            alt={`${DOC_TYPE_LABEL[activeDoc.type]} — ${activeDoc.fileName}`}
                            className="mx-auto max-h-64 w-auto cursor-zoom-in rounded-lg border border-slate-200 bg-slate-100 object-contain p-2"
                            onClick={() => setPreviewOpen(true)}
                          />
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-slate-500">
                            <span className="max-w-full truncate font-medium">{activeDoc.fileName}</span>
                            {activeDoc.quality != null && (
                              <span>
                                Качество фото:{' '}
                                <b className={activeDoc.quality >= 60 ? 'text-emerald-600' : 'text-amber-600'}>{activeDoc.quality}</b>
                              </span>
                            )}
                            {activeDoc.engine && <span>{activeDoc.engine}</span>}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setPreviewOpen(true)}
                              aria-label="Увеличить скан документа"
                            >
                              <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                              Увеличить
                            </Button>
                            <a
                              href={secureFileUrl(`${activeDoc.url}?download=1`)}
                              download
                              aria-label={`Скачать документ: ${activeDoc.fileName}`}
                              className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}
                            >
                              <Download className="h-3.5 w-3.5" aria-hidden />
                              Скачать
                            </a>
                          </div>
                        </div>

                        {/* сверка полей */}
                        <div className="overflow-x-auto rounded-xl border border-slate-200">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-slate-50">
                                <TableHead className="w-[26%]">Поле</TableHead>
                                <TableHead>Из заявки</TableHead>
                                <TableHead>С документа</TableHead>
                                <TableHead className="text-center">Сверка</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {buildRows(activeDoc.type, activeDoc, driver, truck, selected?.number ?? null).map((row) => {
                                const mismatch =
                                  row.expected != null && row.actual !== '' &&
                                  normValue(row.expected, row.kind) !== normValue(row.actual, row.kind)
                                return (
                                  <TableRow key={row.label} className={mismatch ? 'bg-red-50' : undefined}>
                                    <TableCell className="whitespace-nowrap font-medium text-slate-700">{row.label}</TableCell>
                                    <TableCell className="text-slate-600">{row.expected ?? '—'}</TableCell>
                                    <TableCell>
                                      <div className="text-slate-900">{row.actual || '—'}</div>
                                      {row.conf != null && (
                                        <div className={`text-[11px] ${confClass(row.conf)}`}>
                                          {Math.round(row.conf * 100)}% уверенность
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-center">
                                      {row.expected == null ? (
                                        <span className="text-xs text-slate-400">—</span>
                                      ) : mismatch ? (
                                        <X className="mx-auto h-4 w-4 text-red-600" aria-label="Не совпадает" />
                                      ) : (
                                        <Check className="mx-auto h-4 w-4 text-emerald-600" aria-label="Совпадает" />
                                      )}
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                            </TableBody>
                          </Table>
                          {activeDoc.type === 'PASSPORT_REG' && (
                            <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                              Сверка с заявкой не требуется — данные со штампа фиксируются в справочнике.
                            </div>
                          )}
                        </div>
                      </div>

                      {/* флаги проверки */}
                      {activeDoc.issues.length > 0 && (
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Флаги проверки</div>
                          <ul className="mt-2 space-y-1.5">
                            {activeDoc.issues.map((issue, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                                <IssueIcon docStatus={activeDoc.status} />
                                <span>{issue}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* экспресс-сличение */}
                  <div className="space-y-2 rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <ClipboardCheck className="h-4 w-4 text-blue-600" aria-hidden />
                      Экспресс-сличение
                    </div>
                    <div className="text-xs text-slate-500">ответьте да/нет по ключевым параметрам пакета</div>

                    {isEditable ? (
                      <div className="space-y-3 pt-1">
                        <ul className="space-y-2">
                          {VERIFY_CHECKS.map((c) => (
                            <li
                              key={c.key}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
                            >
                              <span className="text-sm text-slate-700">{c.label}</span>
                              <div className="flex gap-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  aria-pressed={checks[c.key] === true}
                                  aria-label={`${c.label} — да`}
                                  className={
                                    checks[c.key] === true
                                      ? 'border-emerald-400 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-700'
                                      : 'text-slate-500'
                                  }
                                  onClick={() => setChecks((p) => ({ ...p, [c.key]: true }))}
                                >
                                  Да
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  aria-pressed={checks[c.key] === false}
                                  aria-label={`${c.label} — нет`}
                                  className={
                                    checks[c.key] === false
                                      ? 'border-red-400 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-700'
                                      : 'text-slate-500'
                                  }
                                  onClick={() => setChecks((p) => ({ ...p, [c.key]: false }))}
                                >
                                  Нет
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                        <div className="space-y-1.5">
                          <Label htmlFor="verify-comment">Комментарий к сверке (необязательно)</Label>
                          <Textarea
                            id="verify-comment"
                            rows={2}
                            placeholder="Например: номера совпадают, печать читаема"
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            aria-label="Комментарий к сверке"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 pt-1">
                        {savedChecks.length > 0 ? (
                          <ul className="space-y-1.5">
                            {savedChecks.map((c) => (
                              <li key={c.key} className="flex items-center justify-between gap-2 text-sm">
                                <span className="text-slate-700">{c.label}</span>
                                <Badge
                                  variant="outline"
                                  className={c.ok
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : 'border-red-200 bg-red-50 text-red-700'}
                                >
                                  {c.ok ? 'Да' : 'Нет'}
                                </Badge>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-xs text-slate-500">Экспресс-сличение не заполнялось.</div>
                        )}
                        {selected.verifyComment && (
                          <div className="text-xs text-slate-600">
                            <span className="font-medium text-slate-700">Комментарий логиста:</span> {selected.verifyComment}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* вердикт */}
                  {isEditable ? (
                    <div className="space-y-2 border-t border-slate-100 pt-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          className="bg-emerald-600 text-white hover:bg-emerald-700"
                          disabled={busy === selected.id}
                          onClick={onConfirmClick}
                          aria-label="Подтвердить сверку — данные в 1С"
                        >
                          <CheckCheck className="h-4 w-4" aria-hidden />
                          Документы подтверждены (Сверено)
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy === selected.id}
                          onClick={() => { setReturnReason(''); setReturnComment(''); setReturnOpen(true) }}
                          aria-label="Отправить документы на доработку — вернуть агенту"
                        >
                          <Undo2 className="h-4 w-4" aria-hidden />
                          Отправить на доработку / Отклонить
                        </Button>
                        {!allAnswered && (
                          <span className="text-xs text-amber-600">
                            Не все пункты сличения отмечены ({answeredCount}/{VERIFY_CHECKS.length})
                          </span>
                        )}
                        {busy === selected.id && <span className="text-xs text-slate-400">Выполняется…</span>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        При возврате агент получает причину и догружает документы в ту же заявку.
                      </p>
                    </div>
                  ) : (
                    <div className="border-t border-slate-100 pt-4">
                      {selected.status === 'CONFIRMED' ? (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                          <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                          Сверено · передано в 1С
                        </Badge>
                      ) : (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                          <div>
                            Возвращено агенту на доработку
                            {selected.verifyComment && (
                              <div className="mt-0.5 text-xs text-amber-700">Причина / комментарий: {selected.verifyComment}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="flex min-h-[240px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
                <CheckCheck className="mb-2 h-8 w-8 text-slate-300" aria-hidden />
                <div className="text-sm font-medium text-slate-600">Заявка не выбрана</div>
                <div className="mt-1 text-xs text-slate-400">Выберите заявку из списка, чтобы сверить документы</div>
              </div>
            )}
          </div>
        </>
      )}

      {/* диалог возврата агенту */}
      <Dialog open={returnOpen} onOpenChange={(o) => { if (!o) setReturnOpen(false) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Отправить на доработку / Отклонить</DialogTitle>
            <DialogDescription>
              {selected && <>№{selected.number} · {selected.winnerName ?? '—'}. Агент получит причину и догрузит документы в ту же заявку.</>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="return-reason">Причина</Label>
            <Select value={returnReason} onValueChange={setReturnReason}>
              <SelectTrigger id="return-reason" aria-label="Причина возврата заявки агенту">
                <SelectValue placeholder="Выберите причину" />
              </SelectTrigger>
              <SelectContent>
                {RETURN_REASONS.map((reason) => (
                  <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!returnReason && <div className="text-xs text-slate-500">Выберите причину — без неё вернуть нельзя.</div>}
            <Label htmlFor="return-comment">Комментарий для водителя / менеджера (необязательно)</Label>
            <Textarea
              id="return-comment"
              rows={3}
              placeholder="Например: перезагрузите СТС с читаемым номером"
              value={returnComment}
              onChange={(e) => setReturnComment(e.target.value)}
              aria-label="Комментарий для водителя или менеджера"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnOpen(false)}>Отмена</Button>
            <Button disabled={!returnReason || busy !== null} onClick={() => void doReturn()}>
              <Undo2 className="h-4 w-4" aria-hidden />
              Вернуть агенту
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* подтверждение сверки при отметках «Нет» в экспресс-сличении */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Подтвердить сверку с расхождениями?</AlertDialogTitle>
            <AlertDialogDescription>
              В экспресс-сличении отмечены пункты «Нет».
              {selected && <> Заявка №{selected.number} будет переведена в статус «Сверено» и передана в 1С с этими отметками.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmOpen(false)}>Вернуться</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => { setConfirmOpen(false); if (selected) void doConfirm(selected) }}
            >
              Подтвердить с отметками
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* модальное окно предосмотра скана */}
      {activeDoc && selected && (
        <DocumentPreviewModal
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          src={secureFileUrl(activeDoc.url)}
          title={`${DOC_TYPE_LABEL[activeDoc.type]} — №${selected.number}`}
          fileName={activeDoc.fileName}
          downloadUrl={secureFileUrl(`${activeDoc.url}?download=1`)}
        />
      )}
    </div>
  )
}
