'use client'

/** «Проверка документов» — экран логиста (Task 71: экспресс-сличение убрано, вердикт «Утвердить»,
 *  статусы — иконками, очередь как в «Моих заявках»; Task 72: статус документа — иконкой-чипом,
 *  кнопки «Увеличить»/«Скачать» убраны (клик по скану / окно предосмотра), яркая плашка решения):
 *  очередь с вычисляемыми состояниями (новые / ожидают проверки / расхождения / проверено /
 *  отклонено), фильтры и поиск, данные рейса из системы, сканы с зумом, сверка полей OCR. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCheck,
  ClipboardCheck,
  Download,
  FileText,
  Files,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  MapPin,
  Package,
  Search,
  Trash2,
  Truck as TruckIcon,
  Undo2,
  Upload,
  UserCog,
  UserRound,
  X,
} from 'lucide-react'
import {
  EmptyState, ErrorBlock, InfoTip, LoadingBlock, NoticeLine, SectionHeader, StatusBadge, StatusDot, WithTip, type TabProps,
} from '@/components/platform/common'
import { DocumentPreviewModal, ZoomableThumb } from '@/components/platform/document-preview'
import { useCan } from '@/components/platform/perms'
import { Button } from '@/components/ui/button'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToastAction } from '@/components/ui/toast'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { api, secureFileUrl } from '@/lib/api'
import { fileToCompressedDataUri } from '@/lib/demo-media'
import { DOC_STATUS_META, DOC_TYPE_LABEL, fmtDateTime, rate } from '@/lib/status'
import { REQUEST_FILE_META } from '@/lib/types'
import type {
  DocStatus, DocType, DocumentDTO, DriverDTO, RequestDTO, RequestStatus, TrailerDTO, TruckDTO,
} from '@/lib/types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full'

const DOC_ORDER: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'STS', 'REQUEST_DOC', 'POA']

/** причины возврата агенту — выбор из списка, не свободный текст */
const RETURN_REASONS = ['Нет печати', 'Расхождение по весу', 'Нечитаемый скан', 'Не тот документ', 'Другое'] as const

/** Размер файла по-человечески: до 1 МБ — в килобайтах, дальше — в мегабайтах */
const kb = (n: number): string => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`)

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

/** цветной текст — только у сомнительного чтения */
function confClass(conf: number): string {
  if (conf >= 0.6) return 'text-slate-500'
  return 'text-amber-700'
}

function IssueIcon({ docStatus }: { docStatus: DocumentDTO['status'] }) {
  if (docStatus === 'REJECTED') return <Ban className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
  if (docStatus === 'MANUAL') return <UserCog className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
  return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
}

// ——— вычисляемое состояние заявки в очереди проверки (Task 62) ———

type QueueState = 'new' | 'pending' | 'mismatch' | 'verified' | 'rejected'

/** mismatch → pending → new → rejected → verified — порядок сортировки очереди */
const STATE_ORDER: QueueState[] = ['mismatch', 'pending', 'new', 'rejected', 'verified']

/** состояния очереди точкой и словом: цветной текст — у расхождений (danger) и отклонённых (warning) */
const STATE_META: Record<QueueState, { label: string; dot: string; text: string; tone?: 'warning' | 'danger' }> = {
  new: { label: 'Новые', dot: 'bg-sky-500', text: 'text-slate-600' },
  pending: { label: 'Ожидают проверки', dot: 'bg-blue-500', text: 'text-slate-600' },
  mismatch: { label: 'Расхождения', dot: 'bg-red-500', text: 'text-red-700', tone: 'danger' },
  verified: { label: 'Проверено', dot: 'bg-emerald-500', text: 'text-slate-600' },
  rejected: { label: 'Отклонено', dot: 'bg-amber-500', text: 'text-amber-700', tone: 'warning' },
}

/** состояние очереди в шапке карточки (Task 71) */
function StateChip({ state }: { state: QueueState }) {
  const meta = STATE_META[state]
  return <StatusDot dot={meta.dot} tone={meta.tone}>{meta.label}</StatusDot>
}

/** статус заявки в шапке карточки — иконка с подписью:
 *  «У логиста — сверка», «Возвращено агенту», «Проверено» */
const STATUS_CHIP_META: Partial<Record<RequestStatus, { label: string; dot: string; tone?: 'warning' }>> = {
  AT_LOGIST: { label: 'У логиста — сверка', dot: 'bg-blue-500' },
  DOCS_REVIEW: { label: 'Возвращено агенту на доработку', dot: 'bg-amber-500', tone: 'warning' },
  CONFIRMED: { label: 'Проверено — рейс выполняется', dot: 'bg-emerald-500' },
}

function StatusChip({ status }: { status: RequestStatus }) {
  const meta = STATUS_CHIP_META[status]
  if (!meta) return <StatusBadge status={status} />
  return <StatusDot dot={meta.dot} tone={meta.tone}>{meta.label}</StatusDot>
}

/** короткие названия вкладок документов — полное название в подсказке */
const DOC_TAB_LABEL: Record<string, string> = {
  PASSPORT_PHOTO: 'Паспорт',
  PASSPORT_REG: 'Прописка',
  STS: 'СТС',
  REQUEST_DOC: 'Заявка',
  POA: 'Доверенность',
  ATTACHMENT: 'Вложение',
}

/** точка статуса документа во вкладке */
function docDot(status: DocStatus): string {
  switch (status) {
    case 'PASSED': return 'bg-emerald-500'
    case 'REUPLOAD': return 'bg-amber-500'
    case 'REJECTED': return 'bg-red-500'
    case 'MANUAL': return 'bg-blue-500'
    default: return 'bg-slate-400'
  }
}

/** иконки статусов документа — чип с иконкой и подписью */
function DocStatusChip({ status }: { status: DocStatus }) {
  const meta = DOC_STATUS_META[status]
  return <StatusDot dot={meta.dot} tone={meta.tone}>{meta.label}</StatusDot>
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

  const [comment, setComment] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)

  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [returnComment, setReturnComment] = useState('')
  // скрытый input обмена документами (Task 109): загрузка файла для перевозчика
  const exchangeInput = useRef<HTMLInputElement | null>(null)
  // права платформы (Task 111): решения сверки — verify:decide, документы для перевозчика —
  // docs:upload; нет права — функция не отображается (сервер проверяет то же самое)
  const can = useCan()

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

  // real-time (Task 49): событие из шины WS мгновенно догружает очередь проверки
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

  // состояние очереди выбранной заявки — для иконки в шапке карточки (Task 71)
  const selectedState: QueueState | null = selected ? queueState(selected, driverMap, truckMap) : null

  // автоподбор заявки: только из рабочих состояний (new/pending/mismatch, т.е. статус AT_LOGIST);
  // проверенные и отклонённые заявки открываются только вручную из фильтров
  useEffect(() => {
    if (queue.some((r) => r.id === selectedId)) return
    setSelectedId(queue.find((r) => r.status === 'AT_LOGIST')?.id ?? null)
  }, [queue, selectedId])

  // смена заявки: сброс комментария, вкладки документа и модалки предосмотра
  useEffect(() => {
    setComment('')
    setDocTab(null)
    setPreviewOpen(false)
  }, [selectedId])

  // счётчики состояний для фильтров (по всей очереди, без учёта поиска)
  const stateCounts = useMemo(() => {
    const c: Record<QueueState, number> = { new: 0, pending: 0, mismatch: 0, verified: 0, rejected: 0 }
    for (const r of queue) c[queueState(r, driverMap, truckMap)]++
    return c
  }, [queue, driverMap, truckMap])

  // фильтр + поиск + сортировка: расхождения → ожидают → новые → отклонённые → проверенные
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

  const isEditable = selected?.status === 'AT_LOGIST' && can('verify:decide')

  const doConfirm = async (r: RequestDTO) => {
    setBusy(r.id)
    try {
      await api.action(r.id, 'confirm', { comment })
      toast({
        title: 'Заявка утверждена — рейс выполняется',
        description: `№${r.number} в реестре рейсов; транспортная накладная ждёт отправки в Диадок в разделе «Подписать ЭДО»`,
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

  const doReturn = async () => {
    if (!selected || !returnReason) return
    setBusy(selected.id)
    try {
      await api.action(selected.id, 'return', { reason: returnReason, comment: returnComment })
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

  // ——— обмен документами (Task 109): логист выкладывает документы для перевозчика ———
  const uploadForCarrier = async (r: RequestDTO, file: File) => {
    setBusy(`${r.id}:xf`)
    try {
      const dataUri = await fileToCompressedDataUri(file)
      const { request } = await api.uploadRequestFile(r.id, { kind: 'FOR_CARRIER', fileName: file.name, dataUri })
      setRequests((prev) => (prev ?? []).map((x) => (x.id === request.id ? request : x)))
      toast({
        title: 'Документ выложен — перевозчик получит уведомление',
        description: `Заявка №${r.number} · ${file.name} — перевозчик скачает его в «Моих заявках»`,
      })
    } catch (e) {
      toast({
        title: 'Не удалось загрузить документ',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setBusy(null)
    }
  }

  /** Персонал может удалить любой файл обмена — в том числе загруженный перевозчиком */
  const removeRequestFile = async (r: RequestDTO, fileId: string) => {
    setBusy(`${r.id}:xfd:${fileId}`)
    try {
      await api.deleteRequestFile(r.id, fileId)
      setRequests((prev) => (prev ?? []).map((x) => (x.id === r.id ? { ...x, files: x.files.filter((f) => f.id !== fileId) } : x)))
      toast({ title: 'Файл удалён из обмена', description: `Заявка №${r.number}` })
    } catch (e) {
      toast({
        title: 'Не удалось удалить файл',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setBusy(null)
    }
  }

  if (requests === null && !error) return <LoadingBlock label="Загрузка очереди проверки…" />
  if (error) return <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />

  return (
    <div>
      <SectionHeader
        title="Проверка документов"
        desc="Пакеты документов по выигранным рейсам: автопроверка нейросетью уже выполнена — остаётся сверить со сканами и принять решение"
      >
        <span className="text-sm text-slate-500">В очереди: {atLogistCount}</span>
      </SectionHeader>

      {queue.length === 0 ? (
        <EmptyState
          icon={<CheckCheck className="h-10 w-10" aria-hidden />}
          title="Очередь пуста"
          hint="Заявки, прошедшие проверку нейросети, появятся здесь"
        />
      ) : (
        <>
          {/* панель инструментов: фильтры состояний + поиск */}
          <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="hidden flex-wrap items-center gap-1.5 sm:flex" role="group" aria-label="Фильтр заявок по состоянию">
              <button
                type="button"
                onClick={() => setStateFilter('ALL')}
                aria-pressed={stateFilter === 'ALL'}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  stateFilter === 'ALL'
                    ? 'border-slate-700 bg-slate-700 text-white'
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
                      active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
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
            <div className="relative w-full max-w-md lg:w-80">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск: номер, водитель, тягач, груз…"
                className="pl-8"
                aria-label="Поиск по очереди проверки: номер, водитель, тягач, груз, документы"
              />
            </div>
          </div>

          {/* заявки, требующие исправления у агента, — компактная строка вместо крупной плашки */}
          {needFix.length > 0 && (
            <NoticeLine tone="warning" className="mb-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="font-medium text-slate-900">На доработке у агента:</span>
                {needFix.map((r) => (
                  <span key={r.id} className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-medium">
                    №{r.number}
                  </span>
                ))}
              </div>
            </NoticeLine>
          )}

          <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            {/* список очереди */}
            <div className="space-y-2">
              <div className="lg:hidden">
                <Label htmlFor="queue-select" className="sr-only">Заявка в очереди</Label>
                <Select value={selectedId ?? ''} onValueChange={setSelectedId}>
                  <SelectTrigger id="queue-select" aria-label="Выбор заявки из очереди проверки">
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
                  Ничего не найдено
                </div>
              )}
              <div className={`hidden max-h-56 space-y-2 overflow-y-auto pr-1 sm:max-h-72 lg:max-h-[calc(100vh-14rem)] lg:block ${THIN_SCROLL}`}>
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
                      className={`w-full rounded-xl border p-3 text-left transition-colors ${
                        active
                          ? 'border-slate-300 bg-slate-100 shadow-[inset_3px_0_0_#0f172a]'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span className="font-mono text-sm font-semibold text-slate-900">№{r.number}</span>
                      <span className="mt-1 flex items-center gap-1 text-xs text-slate-700">
                        <span className="truncate">{r.fromPoint}</span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                        <span className="truncate">{r.toPoint}</span>
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-slate-500">{r.winnerName ?? '—'}</span>
                        <span className="shrink-0 font-semibold text-slate-900">{rate(r.bestRate)}</span>
                      </span>
                      <span className={`mt-1.5 flex items-center gap-1.5 truncate text-xs ${meta.text}`}>
                        <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
                        {meta.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* детали выбранной заявки */}
            {selected && carriersLoaded ? (
              <Card className="min-w-0 border-slate-200 shadow-sm">
                <CardContent className="p-0">
                  {/* шапка карточки */}
                  <div className="border-b border-slate-100 p-4 sm:p-5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="text-lg font-bold text-slate-900">Заявка №{selected.number}</h3>
                      <span className="text-sm font-medium text-slate-500">· {selected.winnerName ?? '—'}</span>
                      {/* статусы шапки — иконка с подписью */}
                      <StatusChip status={selected.status} />
                      {selected.status === 'AT_LOGIST' && selectedState && <StateChip state={selectedState} />}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                      <span className="inline-flex min-w-0 items-center gap-1.5" title={driver?.fullName ?? undefined}>
                        <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                        <span className="break-words">{driver?.fullName ?? '—'}</span>
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-1.5" title={truck ? `${truck.brand} (${truck.plate})` : undefined}>
                        <TruckIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                        <span className="break-words">
                          {truck ? `${truck.brand} (${truck.plate})` : '—'}{trailer ? ` + ${trailer.plate}` : ''}
                        </span>
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-1.5" title={`${selected.fromPoint} → ${selected.toPoint}`}>
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                        <span className="break-words">{selected.fromPoint} → {selected.toPoint}</span>
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-1.5" title={`${selected.cargo}, ${selected.tonnage} т`}>
                        <Package className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                        <span className="break-words">{selected.cargo}, {selected.tonnage} т</span>
                      </span>
                      <span className="font-semibold text-slate-900">{rate(selected.bestRate)}</span>
                    </div>
                  </div>

                  {/* данные рейса из системы (автозаполнение, read-only) — компактная сетка */}
                  <div className="border-b border-slate-100 p-4 sm:p-5">
                    <div className="mb-2.5 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                      <ListChecks className="h-4 w-4 text-slate-400" aria-hidden />
                      Данные рейса из системы
                      <InfoTip label="Данные рейса">Сверяются со сканами документов.</InfoTip>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 xl:grid-cols-4">
                      {[
                        { label: 'Грузоотправитель', value: `ООО «АЭМЗ» · ${selected.fromPoint}` },
                        { label: 'Пункт выгрузки', value: selected.toPoint },
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
                        <div key={it.label} className="min-w-0">
                          <dt className="text-[11px] text-slate-400">{it.label}</dt>
                          <dd className="mt-0.5 break-words text-sm font-medium text-slate-800">{it.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  {/* документы: вкладки + рабочая область скан/сверка */}
                  <div className="border-b border-slate-100 p-4 sm:p-5">
                    {selected.documents.length > 0 ? (
                      <Tabs value={activeDocType ?? ''} onValueChange={(v) => setDocTab(v as DocType)}>
                        {/* вкладки в одну строку: короткие названия, при нехватке места — прокрутка */}
                        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-slate-100 p-1 [scrollbar-width:thin]">
                          {DOC_ORDER.flatMap((t) => {
                            const doc = selected.documents.find((d) => d.type === t)
                            if (!doc) return []
                            return [
                              <TabsTrigger
                                key={t}
                                value={t}
                                aria-label={`Документ: ${DOC_TYPE_LABEL[t]}`}
                                title={DOC_TYPE_LABEL[t]}
                                className="flex-none gap-1.5 data-[state=active]:bg-white"
                              >
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${docDot(doc.status)}`} aria-hidden />
                                {DOC_TAB_LABEL[t] ?? DOC_TYPE_LABEL[t]}
                              </TabsTrigger>,
                            ]
                          })}
                        </TabsList>
                      </Tabs>
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                        Документы не загружены
                      </div>
                    )}

                    {/* содержимое вкладки */}
                    {activeDoc && (
                      <div className="mt-3 space-y-3">
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                          {/* просмотр скана */}
                          <div className="self-start rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <ZoomableThumb
                              pdf={activeDoc.isPdf}
                              src={secureFileUrl(activeDoc.url)}
                              alt={`${DOC_TYPE_LABEL[activeDoc.type]} — ${activeDoc.fileName}`}
                              className="mx-auto max-h-64 w-auto cursor-zoom-in rounded-lg border border-slate-200 bg-slate-100 object-contain p-2"
                              onClick={() => setPreviewOpen(true)}
                            />
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-slate-500">
                              <span className="max-w-full truncate font-medium">{activeDoc.fileName}</span>
                              {activeDoc.quality != null && (
                                <span>
                                  Качество:{' '}
                                  <b className={activeDoc.quality >= 60 ? 'text-emerald-600' : 'text-amber-600'}>{activeDoc.quality}</b>
                                </span>
                              )}
                              {activeDoc.engine && <span>{activeDoc.engine}</span>}
                            </div>
                            {/* Task 72: «Увеличить»/«Скачать» убраны — клик по скану открывает
                                предосмотр (зум/поворот/скачивание), статус документа — иконкой */}
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <DocStatusChip status={activeDoc.status} />
                            </div>
                          </div>

                          {/* сверка полей */}
                          <div className="min-w-0 overflow-x-auto rounded-xl border border-slate-200">
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-slate-50">
                                  <TableHead className="w-[24%]">Поле</TableHead>
                                  <TableHead>Из заявки</TableHead>
                                  <TableHead>С документа</TableHead>
                                  <TableHead className="text-center">Результат</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {buildRows(activeDoc.type, activeDoc, driver, truck, selected?.number ?? null).map((row) => {
                                  const mismatch =
                                    row.expected != null && row.actual !== '' &&
                                    normValue(row.expected, row.kind) !== normValue(row.actual, row.kind)
                                  return (
                                    <TableRow key={row.label}>
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
                                          <StatusDot dot="bg-red-500" tone="danger">Расхождение</StatusDot>
                                        ) : (
                                          <StatusDot dot="bg-emerald-500">Совпадает</StatusDot>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  )
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </div>

                        {/* флаги проверки */}
                        {activeDoc.issues.length > 0 && (
                          <div className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="text-xs font-medium text-slate-500">Флаги автопроверки</div>
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
                  </div>

                  {/* ——— обмен документами (Task 109): перевозчик передаёт доверенность и заявку здесь,
                       документы для перевозчика выкладывает логист — почта не нужна ——— */}
                  <div className="border-b border-slate-100 p-4 sm:p-5">
                    <div className="mb-2.5 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                      <Files className="h-4 w-4 text-slate-400" aria-hidden />
                      Обмен документами
                      <InfoTip label="Обмен документами">
                        Перевозчик передаёт доверенность и заявку здесь; ваши документы он скачает из своего кабинета. Почта не нужна.
                      </InfoTip>
                    </div>
                    {selected.files.length === 0 ? (
                      <p className="text-sm text-slate-500">Перевозчик ещё не передал документы</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {selected.files.map((f) => {
                          const Icon = f.isImage ? ImageIcon : FileText
                          return (
                            <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-slate-900">{f.fileName}</span>
                                <span className="block text-[11px] text-slate-500">
                                  {REQUEST_FILE_META[f.kind].label} · {f.uploadedByName} · {fmtDateTime(f.createdAt)}
                                </span>
                              </span>
                              <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{kb(f.sizeBytes)}</span>
                              <a
                                href={secureFileUrl(f.url)}
                                download={f.fileName}
                                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                                aria-label={`Скачать ${f.fileName}`}
                              >
                                <Download className="h-3.5 w-3.5" aria-hidden />
                                Скачать
                              </a>
                              {can('docs:upload') && (
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
                                  aria-label={`Удалить файл ${f.fileName}`}
                                  disabled={busy !== null}
                                  onClick={() => void removeRequestFile(selected, f.id)}
                                >
                                  {busy === `${selected.id}:xfd:${f.id}`
                                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                    : <Trash2 className="h-4 w-4" aria-hidden />}
                                </button>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    <input
                      ref={exchangeInput}
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      aria-label="Документ для перевозчика"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file && selected) void uploadForCarrier(selected, file)
                      }}
                    />
                    <div className="mt-3">
                      {can('docs:upload') && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          disabled={busy !== null}
                          onClick={() => exchangeInput.current?.click()}
                          aria-label={`Загрузить документ для перевозчика по заявке №${selected.number}`}
                        >
                          {busy === `${selected.id}:xf`
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            : <Upload className="h-4 w-4" aria-hidden />}
                          Загрузить документ для перевозчика
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* решение по пакету (Task 72): карточка-действие, итог — строкой с иконкой */}
                  <div className="border-t border-slate-100 p-4 sm:p-5">
                    {isEditable ? (
                      <div className="overflow-hidden rounded-2xl border border-slate-200">
                        <div className="flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-3 sm:px-5">
                          <ClipboardCheck className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                              Решение по пакету
                              <InfoTip label="Решение по пакету">Сверьте сканы и поля, затем выберите одно из действий.</InfoTip>
                            </div>
                          </div>
                        </div>
                        <div className="grid items-start gap-5 bg-white px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_340px]">
                          {/* комментарий к решению */}
                          <div className="space-y-1.5">
                            <Label htmlFor="verify-comment" className="flex items-center gap-1.5">
                              Комментарий к решению (необязательно)
                              <InfoTip label="Кто увидит комментарий">Пояснение увидят перевозчик и агент — например, что именно нужно исправить.</InfoTip>
                            </Label>
                            <Textarea
                              id="verify-comment"
                              rows={3}
                              placeholder="Например: номера совпадают, печать читаема"
                              value={comment}
                              onChange={(e) => setComment(e.target.value)}
                              aria-label="Комментарий к проверке документов"
                            />
                          </div>

                          {/* кнопки решения */}
                          <div className="space-y-1.5">
                            {/* что произойдёт — по наведению на кнопку */}
                            <WithTip tip="Рейс уйдёт в работу: подготовим пропуск, ЭТрН — к отправке в Диадок">
                              <Button
                                className="h-11 w-full bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
                                disabled={busy === selected.id}
                                onClick={() => void doConfirm(selected)}
                                aria-label="Утвердить пакет — рейс уходит в работу"
                              >
                                <CheckCheck className="h-4 w-4" aria-hidden />
                                Утвердить
                              </Button>
                            </WithTip>
                            <WithTip tip="Пакет вернётся агенту с выбранной причиной">
                              <Button
                                variant="outline"
                                className="mt-2 h-11 w-full"
                                disabled={busy === selected.id}
                                onClick={() => { setReturnReason(''); setReturnComment(''); setReturnOpen(true) }}
                                aria-label="Отправить документы на доработку — вернуть агенту"
                              >
                                <Undo2 className="h-4 w-4" aria-hidden />
                                На доработку агенту
                              </Button>
                            </WithTip>
                            {busy === selected.id && <div className="text-xs text-slate-400">Выполняется…</div>}
                          </div>
                        </div>
                      </div>
                    ) : selected.status === 'CONFIRMED' ? (
                      /* утверждено — строка с зелёной иконкой */
                      <NoticeLine tone="success">
                        <div className="font-medium text-slate-900">Утверждено — рейс выполняется</div>
                        {selected.verifyComment ? (
                          <div className="mt-0.5 text-xs text-slate-600">
                            <span className="font-medium">Комментарий логиста:</span> {selected.verifyComment}
                          </div>
                        ) : (
                          <div className="mt-0.5 text-xs text-slate-500">Пропуск подготовлен, ЭТрН — в разделе «Подписать ЭДО»</div>
                        )}
                      </NoticeLine>
                    ) : selected.status === 'AT_LOGIST' && !can('verify:decide') ? (
                      /* пакет на сверке без права decide — режим просмотра: решение принимает логист (Task 110/111) */
                      <NoticeLine>
                        <div className="font-medium text-slate-900">Пакет на сверке</div>
                        <div className="mt-0.5 text-xs text-slate-600">
                          Решение (утвердить / на доработку) принимает логист — администрации доступен просмотр и правка данных через «База данных».
                        </div>
                      </NoticeLine>
                    ) : (
                      /* возвращено агенту — строка с янтарной иконкой */
                      <NoticeLine tone="warning">
                        <div className="font-medium text-slate-900">Возвращено агенту на доработку</div>
                        {selected.verifyComment ? (
                          <div className="mt-0.5 text-xs text-slate-600">
                            <span className="font-medium">Причина / комментарий:</span> {selected.verifyComment}
                          </div>
                        ) : (
                          <div className="mt-0.5 text-xs text-slate-500">Пакет ждёт исправлений от перевозчика</div>
                        )}
                      </NoticeLine>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="flex min-h-[240px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
                <CheckCheck className="mb-2 h-8 w-8 text-slate-300" aria-hidden />
                <div className="text-sm font-medium text-slate-600">Заявка не выбрана</div>
                <div className="mt-1 text-xs text-slate-400">Выберите заявку из списка, чтобы проверить документы</div>
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
              {selected && <>№{selected.number} · {selected.winnerName ?? '—'}</>}
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

      {/* модальное окно предосмотра скана */}
      {activeDoc && selected && (
        <DocumentPreviewModal
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          src={secureFileUrl(activeDoc.url)}
          title={`${DOC_TYPE_LABEL[activeDoc.type]} — №${selected.number}`}
          fileName={activeDoc.fileName}
          downloadUrl={secureFileUrl(`${activeDoc.url}?download=1`)}
          pdf={activeDoc.isPdf}
        />
      )}
    </div>
  )
}
