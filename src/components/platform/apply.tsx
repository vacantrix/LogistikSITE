'use client'

/**
 * «Подать заявку» — линия агента с заранее включённой нейросетью.
 *
 * Ключевое отличие от «Моих заявок»: нейросеть проверяет КАЖДЫЙ документ
 * сразу при загрузке, ещё до отправки заявки. Если агент по ошибке загрузил
 * не тот документ (например, страницу паспорта с фото в слот «страница
 * регистрации») — платформа мгновенно выдаёт ошибку несоответствия вида
 * документа и просит заменить файл. Заявка уходит только с проверенным
 * комплектом.
 *
 * Раздел также принял на себя нейро-функционал справочника: нового водителя
 * здесь можно добавить по документам (карточку заполнит нейросеть).
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Car,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  FileCheck2,
  FileSignature,
  FileSpreadsheet,
  FileText,
  Handshake,
  IdCard,
  Info,
  Loader2,
  MapPin,
  MousePointerClick,
  RefreshCw,
  Send,
  Truck,
  Upload,
  UserCheck,
  UserRoundPlus,
  XCircle,
} from 'lucide-react'
import { DocStatusBadge, ModeBadge, SectionHeader, StatusBadge, type TabProps } from '@/components/platform/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import DriverIntakeDialog from '@/components/platform/driver-intake'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { demoSampleUri, fileToCompressedDataUri, sleep } from '@/lib/demo-media'
import { money, REQUEST_STATUS_META } from '@/lib/status'
import type { CarrierDTO, DocStatus, DocType, IntakeDocVerdict, RequestDTO, RequestStatus } from '@/lib/types'

const DOC_ORDER: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'LICENSE', 'STS', 'REQUEST_DOC', 'POA']

const SLOT_META: Record<DocType, { label: string; hint: string; icon: typeof IdCard }> = {
  PASSPORT_PHOTO: { label: 'Паспорт: стр. с фото', hint: 'Разворот с фото и ФИО', icon: IdCard },
  PASSPORT_REG: { label: 'Паспорт: регистрация', hint: 'Штамп регистрации', icon: MapPin },
  LICENSE: { label: 'Водительское удостоверение', hint: 'Лицевая сторона ВУ', icon: Car },
  STS: { label: 'СТС тягача', hint: 'Лицевая сторона СТС', icon: FileText },
  REQUEST_DOC: { label: 'Заявка (скан)', hint: 'Скан заявки на перевозку', icon: ClipboardList },
  POA: { label: 'Доверенность', hint: 'На водителя от перевозчика', icon: FileSignature },
}

interface SlotState {
  upload: { fileName: string; dataUri: string } | null
  checking: boolean
  verdict: IntakeDocVerdict | null
  error: string | null
}

const EMPTY_SLOT: SlotState = { upload: null, checking: false, verdict: null, error: null }

const EMPTY_SLOTS: Record<DocType, SlotState> = {
  PASSPORT_PHOTO: EMPTY_SLOT, PASSPORT_REG: EMPTY_SLOT, LICENSE: EMPTY_SLOT, STS: EMPTY_SLOT, REQUEST_DOC: EMPTY_SLOT, POA: EMPTY_SLOT,
}

/** госномер: латиница/кириллица — для сопоставления из Excel */
const PLATE_MAP: Record<string, string> = {
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X',
}
const normSpace = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim()
const normFio = (s: unknown): string => normSpace(s).toUpperCase().replace(/Ё/g, 'Е')
const normPlate = (s: unknown): string => normSpace(s).toUpperCase().split('').map((c) => PLATE_MAP[c] ?? c).join('')

/** Номер заявки из ячейки Excel: «1042» → «Z-1042», русская «З» → латинская «Z» */
function normRequestNo(s: unknown): string {
  let v = normSpace(s).toUpperCase()
  if (!v) return ''
  if (/^\d{3,4}$/.test(v)) v = `Z-${v}`
  v = v.replace(/^З/, 'Z')
  return v
}

/** Строка предпросмотра массовой загрузки Excel */
interface ImportRow {
  line: number
  requestNo: string
  driverName: string
  truckPlate: string
  trailerPlate: string
  requestId?: string
  driverId?: string
  truckId?: string
  trailerId?: string
  ok: boolean
  message: string
}

/** Цвет рамки слота по вердикту нейросети */
function slotBorder(s: SlotState): string {
  if (s.checking) return 'border-blue-300 bg-blue-50/30'
  if (s.error) return 'border-red-300 bg-red-50/40'
  if (!s.verdict) return 'border-slate-200'
  switch (s.verdict.status) {
    case 'PASSED': return 'border-emerald-300 bg-emerald-50/40'
    case 'MANUAL': return 'border-blue-300 bg-blue-50/30'
    case 'REUPLOAD': return 'border-amber-300 bg-amber-50/40'
    case 'REJECTED': return 'border-red-300 bg-red-50/40'
    default: return 'border-slate-200'
  }
}

function confCls(c: number): string {
  if (c >= 0.95) return 'text-emerald-600'
  if (c >= 0.6) return 'text-blue-600'
  return 'text-amber-600'
}

/** Панель вердикта нейросети под загруженным документом */
function SlotVerdict({ s, type }: { s: SlotState; type: DocType }) {
  if (s.checking) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg bg-blue-50 px-2.5 py-2 text-xs font-medium text-blue-800" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Нейросеть проверяет вид документа и данные…
      </div>
    )
  }
  if (s.error) {
    return (
      <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700">
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {s.error}
      </div>
    )
  }
  const v = s.verdict
  if (!v) {
    return <p className="mt-2 text-[11px] leading-snug text-slate-400">{SLOT_META[type].hint}. Нейросеть проверит документ сразу после загрузки.</p>
  }

  if (v.status === 'REJECTED') {
    return (
      <div className="mt-2 space-y-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-red-800">
          <XCircle className="h-3.5 w-3.5" aria-hidden />
          Отказ нейросети — замените файл
        </div>
        <p className="text-[11px] leading-snug text-red-700">{v.message}</p>
        <p className="text-[11px] leading-snug text-red-600">Заявка не будет отправлена, пока документ не заменён.</p>
      </div>
    )
  }
  if (v.status === 'REUPLOAD') {
    return (
      <div className="mt-2 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          <DocStatusBadge status={v.status} />
        </div>
        <p className="text-[11px] leading-snug text-amber-700">{v.message}</p>
      </div>
    )
  }
  if (v.status === 'MANUAL') {
    return (
      <div className="mt-2 space-y-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-800">
          <Info className="h-3.5 w-3.5" aria-hidden />
          <DocStatusBadge status={v.status} />
        </div>
        <p className="text-[11px] leading-snug text-blue-700">{v.message}</p>
      </div>
    )
  }
  // PASSED: показываем распознанные поля с уверенностью
  const fieldRows = Object.entries(v.fields)
    .filter(([, val]) => val)
    .slice(0, 3)
  return (
    <div className="mt-2 space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        Вид документа подтверждён · качество {v.quality}
      </div>
      {fieldRows.map(([label, val]) => (
        <div key={label} className="flex items-baseline justify-between gap-2 text-[11px]">
          <span className="text-slate-500">{label}:</span>
          <span className="min-w-0 truncate font-medium text-slate-700">{val}</span>
          <span className={`shrink-0 font-semibold ${confCls(v.confidence[label] ?? 0)}`}>
            {v.confidence[label] != null ? `${Math.round((v.confidence[label] ?? 0) * 100)}%` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

// ——— Визуализация статусов заявки: цветная линия с подсказками при наведении ———

/** Русское склонение: 1 заявка / 2 заявки / 5 заявок */
function zayavokWord(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'заявка'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'заявки'
  return 'заявок'
}

interface PipelineStage {
  label: string
  icon: typeof MousePointerClick
  /** демо-наполнение для визуализации работы на площадке */
  count: number
  circle: string
  ring: string
  countCls: string
  line: string
  tip: string
}

const PIPELINE_STAGES: PipelineStage[] = [
  {
    label: 'Выбор рейса',
    icon: MousePointerClick,
    count: 8,
    circle: 'bg-sky-500',
    ring: 'ring-sky-100',
    countCls: 'text-sky-700',
    line: 'from-sky-200 to-teal-200',
    tip: 'Начальный этап: перевозчик выбирает рейс на «Площадке заявок» — статусы «Торги» или «Закрытые ставки» — и подаёт ставку.',
  },
  {
    label: 'Согласование ставки',
    icon: Handshake,
    count: 5,
    circle: 'bg-teal-500',
    ring: 'ring-teal-100',
    countCls: 'text-teal-700',
    line: 'from-teal-200 to-violet-200',
    tip: 'Ставка подана: отдел сбыта АЭМЗ согласует цену по рейсу — побеждает лучшая ставка на понижение.',
  },
  {
    label: 'Подтверждено',
    icon: CheckCircle2,
    count: 4,
    circle: 'bg-violet-500',
    ring: 'ring-violet-100',
    countCls: 'text-violet-700',
    line: 'from-violet-200 to-amber-200',
    tip: 'Ставка подтверждена, рейс закреплён за перевозчиком. Можно подавать заявку: назначить водителя и загрузить документы.',
  },
  {
    label: 'Документы',
    icon: FileCheck2,
    count: 3,
    circle: 'bg-amber-500',
    ring: 'ring-amber-100',
    countCls: 'text-amber-700',
    line: 'from-amber-200 to-blue-200',
    tip: 'Заявка комплектуется: паспорт, ВУ, СТС, скан заявки и доверенность — нейросеть проверяет каждый документ сразу при загрузке.',
  },
  {
    label: 'Сверка у логиста',
    icon: UserCheck,
    count: 2,
    circle: 'bg-blue-600',
    ring: 'ring-blue-100',
    countCls: 'text-blue-700',
    line: 'from-blue-200 to-emerald-200',
    tip: 'Комплект передан логисту АЭМЗ: сверка данных с заявкой и оформление пропуска.',
  },
  {
    label: 'В 1С — готово',
    icon: Database,
    count: 6,
    circle: 'bg-emerald-500',
    ring: 'ring-emerald-100',
    countCls: 'text-emerald-700',
    line: '',
    tip: 'Данные подтверждены и загружены в 1С. Рейс оформлен — водитель может выезжать на погрузку.',
  },
]

/** Какому этапу линии соответствует каждый статус рейса */
const STAGE_OF_STATUS: Record<RequestStatus, number> = {
  PUBLISHED: 0,   // ещё на площадке — «Выбор рейса»
  AWARDED: 2,     // ставка согласована — «Подтверждено»
  DOCS_REVIEW: 3, // комплект загружается — «Документы»
  AT_LOGIST: 4,   // «Сверка у логиста»
  CONFIRMED: 5,   // «В 1С — готово»
  CLOSED: 5,
}

function StatusPipeline({ activeIdx }: { activeIdx: number }) {
  return (
    <Card className="mb-4 border-slate-200 shadow-sm">
      <CardContent className="px-3 py-4 sm:px-6">
        <div className="flex items-start overflow-x-auto pb-1" aria-label="Этапы заявки на площадке">
          {PIPELINE_STAGES.map((st, i) => {
            const Icon = st.icon
            const colored = i <= activeIdx
            const isCurrent = i === activeIdx
            return (
              <Fragment key={st.label}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`${st.label}: ${st.count} ${zayavokWord(st.count)}${isCurrent ? ' — текущий этап' : ''}`}
                      className="flex w-24 shrink-0 cursor-default flex-col items-center gap-1 rounded-lg px-1 py-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:w-auto sm:flex-1"
                    >
                      <span className={`relative flex h-11 w-11 items-center justify-center rounded-full text-white shadow-sm ring-4 ${colored ? st.circle : 'bg-slate-200'} ${colored ? st.ring : 'ring-slate-100'}`} aria-hidden>
                        <Icon className="h-5 w-5" />
                        {isCurrent && (
                          <span className="absolute -right-1 -top-1 flex h-3 w-3">
                            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${st.circle}`} />
                            <span className={`relative inline-flex h-3 w-3 rounded-full ring-2 ring-white ${st.circle}`} />
                          </span>
                        )}
                      </span>
                      <span className={`whitespace-nowrap text-sm font-bold leading-none ${colored ? st.countCls : 'text-slate-400'}`}>
                        {st.count} {zayavokWord(st.count)}
                      </span>
                      <span className={`text-[11px] leading-tight sm:text-xs ${isCurrent ? 'font-semibold text-slate-900' : colored ? 'font-medium text-slate-600' : 'font-medium text-slate-400'}`}>
                        {st.label}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-64">
                    <span className="font-semibold">{st.label}. </span>{st.tip}
                  </TooltipContent>
                </Tooltip>
                {i < PIPELINE_STAGES.length - 1 && (
                  <div aria-hidden className={`mt-5 h-1 w-7 shrink-0 rounded-full sm:w-10 ${i < activeIdx ? `bg-gradient-to-r ${st.line}` : 'bg-slate-200'}`} />
                )}
              </Fragment>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

export default function ApplyTab({ activeCarrierId, role, onNavigate }: TabProps) {
  const { toast } = useToast()
  const [requests, setRequests] = useState<RequestDTO[] | null>(null)
  const [carrier, setCarrier] = useState<CarrierDTO | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [requestId, setRequestId] = useState('')
  const [slots, setSlots] = useState<Record<DocType, SlotState>>(EMPTY_SLOTS)
  const [driverId, setDriverId] = useState('')
  const [truckId, setTruckId] = useState('')
  const [trailerId, setTrailerId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<RequestDTO | null>(null)
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [examplesOpen, setExamplesOpen] = useState(false)
  const [excelOpen, setExcelOpen] = useState(false)
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputs = useRef<Partial<Record<DocType, HTMLInputElement | null>>>({})
  const excelInput = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    try {
      const [reqs, dir] = await Promise.all([api.listRequests(), api.directory()])
      setRequests(reqs.requests)
      setCarrier(dir.carriers.find((c) => c.id === activeCarrierId) ?? null)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [activeCarrierId])

  useEffect(() => { void load() }, [load])

  // при смене перевозчика сбрасываем выбор из справочника
  useEffect(() => {
    setDriverId('')
    setTruckId('')
    setTrailerId('')
  }, [activeCarrierId])

  /** Мгновенная нейропроверка загруженного файла */
  const checkUpload = useCallback(async (type: DocType, fileName: string, dataUri: string) => {
    setSlots((prev) => ({ ...prev, [type]: { upload: { fileName, dataUri }, checking: true, verdict: null, error: null } }))
    try {
      const [res] = await Promise.all([
        api.checkDocument({ type, fileName, dataUri }),
        sleep(900), // минимальная пауза, чтобы статус «нейросеть проверяет» был заметен
      ])
      setSlots((prev) => ({ ...prev, [type]: { upload: { fileName, dataUri }, checking: false, verdict: res.verdict, error: null } }))
      const v = res.verdict
      if (v.status === 'REJECTED') {
        toast({ title: 'Несоответствие вида документа', description: v.message, variant: 'destructive' })
      } else if (v.status === 'REUPLOAD') {
        toast({ title: 'Документ нужно перезагрузить', description: v.message, variant: 'destructive' })
      } else if (v.status === 'PASSED') {
        toast({ title: `${SLOT_META[type].label}: принят`, description: 'Вид документа подтверждён нейросетью' })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка проверки'
      setSlots((prev) => ({ ...prev, [type]: { upload: { fileName, dataUri }, checking: false, verdict: null, error: msg } }))
    }
  }, [toast])

  const handleFile = async (type: DocType, file: File) => {
    try {
      const dataUri = await fileToCompressedDataUri(file)
      void checkUpload(type, file.name, dataUri)
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : 'Не удалось прочитать файл', variant: 'destructive' })
    }
  }

  const resetAll = () => {
    setSlots(EMPTY_SLOTS)
    setRequestId('')
    setDriverId('')
    setTruckId('')
    setTrailerId('')
    setSubmitted(null)
    setImportRows(null)
  }

  const selected = useMemo(
    () => requests?.find((r) => r.id === requestId) ?? null,
    [requests, requestId],
  )

  // доступные цели заявки: свои заявки без документов + открытые рейсы (нужна ставка на площадке)
  const { mineNeedDocs, needBid } = useMemo(() => {
    const all = requests ?? []
    return {
      mineNeedDocs: all.filter((r) => r.winnerId === activeCarrierId && (r.status === 'AWARDED' || r.status === 'DOCS_REVIEW')),
      needBid: all.filter((r) => r.status === 'PUBLISHED' && (r.mode === 'AUCTION' || r.mode === 'CLOSED')),
    }
  }, [requests, activeCarrierId])

  const drivers = carrier?.drivers ?? []
  const trucks = carrier?.trucks ?? []
  const trailers = carrier?.trailers ?? []

  // ——— Массовая подача из Excel ———

  /** Шаблон .xlsx из реальных данных: выигранные рейсы + база аккаунта */
  const downloadTemplate = () => {
    const header = ['Заявка', 'Водитель', 'Тягач', 'Прицеп']
    const rows = mineNeedDocs.slice(0, 5).map((r, i) => [
      r.number,
      drivers[i]?.fullName ?? drivers[0]?.fullName ?? 'Иванов Иван Иванович',
      trucks[i]?.plate ?? trucks[0]?.plate ?? 'А123ВС777',
      '',
    ])
    if (rows.length === 0) {
      rows.push(['Z-1042', drivers[0]?.fullName ?? 'Иванов Иван Иванович', trucks[0]?.plate ?? 'А123ВС777', ''])
    }
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
    ws['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 16 }, { wch: 16 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Заявки')
    XLSX.writeFile(wb, 'shablon-zayavok.xlsx')
    toast({ title: 'Шаблон скачан', description: 'Заполните по строке на каждый рейс и загрузите файл обратно' })
  }

  /** Разбор Excel: строка = заявка + водитель + тягач (+прицеп), сверка с площадкой и базой аккаунта */
  const parseExcel = async (file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer())
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws) throw new Error('В файле нет листов')
      const sheet = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
      const grid = sheet.filter((row) => Array.isArray(row) && row.some((c) => normSpace(c)))
      if (grid.length === 0) throw new Error('Лист пуст')

      // колонки: по заголовкам, иначе позиционно (Заявка · Водитель · Тягач · Прицеп)
      const head = grid[0].map((c) => normSpace(c).toLowerCase())
      const hasHeader = head.some((h) => /заявк|рейс|водител|тягач|прицеп/.test(h))
      const col = (re: RegExp, fallback: number): number => {
        if (hasHeader) {
          const i = head.findIndex((h) => re.test(h))
          if (i !== -1) return i
        }
        return fallback
      }
      const cReq = col(/заявк|рейс/, 0)
      const cDrv = col(/водител|фио/, 1)
      const cTrk = col(/тягач|автомоб/, 2)
      const cTrl = col(/прицеп/, 3)
      const body = hasHeader ? grid.slice(1) : grid

      const seen = new Set<string>()
      const rows: ImportRow[] = body.map((cells, idx) => {
        const requestNo = normRequestNo(cells[cReq])
        const driverName = normSpace(cells[cDrv])
        const truckPlate = normSpace(cells[cTrk])
        const trailerPlate = normSpace(cells[cTrl])
        const row: ImportRow = {
          line: idx + (hasHeader ? 2 : 1),
          requestNo, driverName, truckPlate, trailerPlate,
          ok: false, message: '',
        }
        if (!requestNo && !driverName && !truckPlate) {
          row.message = 'пустая строка'
          return row
        }
        const byNo = requests?.find((r) => r.number === requestNo)
        if (!byNo) {
          row.message = `заявка «${requestNo || '—'}» не найдена на площадке`
          return row
        }
        if (seen.has(byNo.id)) {
          row.requestId = byNo.id
          row.message = 'дубликат строки — эта заявка уже подаётся в файле'
          return row
        }
        if (byNo.winnerId !== activeCarrierId) {
          row.message = 'рейс не закреплён за вашей компанией'
          return row
        }
        if (byNo.status !== 'AWARDED' && byNo.status !== 'DOCS_REVIEW') {
          row.message = `статус «${REQUEST_STATUS_META[byNo.status].label}» — подача недоступна`
          return row
        }
        const drv = drivers.find((d) => normFio(d.fullName) === normFio(driverName))
        if (!drv) {
          row.message = `водитель «${driverName || '—'}» не найден в базе аккаунта`
          return row
        }
        const trk = trucks.find((t) => normPlate(t.plate) === normPlate(truckPlate))
        if (!trk) {
          row.message = `тягач «${truckPlate || '—'}» не найден в базе аккаунта`
          return row
        }
        let trl: string | undefined
        if (trailerPlate && !/^(—|-|нет|без)$/i.test(trailerPlate)) {
          const found = trailers.find((z) => normPlate(z.plate) === normPlate(trailerPlate))
          if (!found) {
            row.message = `прицеп «${trailerPlate}» не найден в базе аккаунта`
            return row
          }
          trl = found.id
        }
        seen.add(byNo.id)
        Object.assign(row, { requestId: byNo.id, driverId: drv.id, truckId: trk.id, trailerId: trl, ok: true, message: 'готова к подаче' })
        return row
      })

      setImportRows(rows)
      setExcelOpen(true)
    } catch (e) {
      toast({
        title: 'Не удалось прочитать Excel',
        description: e instanceof Error ? e.message : 'Проверьте файл: первая строка — заголовки «Заявка · Водитель · Тягач · Прицеп»',
        variant: 'destructive',
      })
    }
  }

  const importOkCount = importRows?.filter((r) => r.ok).length ?? 0

  /** Подача всех валидных строк: водитель и ТС вешаются на каждый рейс одним запросом */
  const runImport = async () => {
    const ok = (importRows ?? []).filter((r) => r.ok && r.requestId && r.driverId && r.truckId)
    if (ok.length === 0 || !activeCarrierId) return
    setImporting(true)
    try {
      const res = await api.bulkAssign({
        carrierId: activeCarrierId,
        rows: ok.map((r) => ({ requestId: r.requestId!, driverId: r.driverId!, truckId: r.truckId!, trailerId: r.trailerId })),
      })
      toast({
        title: 'Массовая подача завершена',
        description: `Водитель и ТС назначены: ${res.assigned} из ${res.total}. Фото и документы прикрепляются к каждой заявке отдельно — по одному снимку на документ.`,
      })
      setExcelOpen(false)
      setImportRows(null)
      await load()
    } catch (e) {
      toast({ title: 'Ошибка массовой подачи', description: e instanceof Error ? e.message : 'Ошибка сервера', variant: 'destructive' })
    } finally {
      setImporting(false)
    }
  }

  // готовность: все 6 документов приняты нейросетью (PASSED/MANUAL), выбраны рейс, водитель и тягач
  const docsOk = DOC_ORDER.every((t) => {
    const v = slots[t].verdict
    return v && (v.status === 'PASSED' || v.status === 'MANUAL')
  })
  const checkedCount = DOC_ORDER.filter((t) => slots[t].verdict && !slots[t].checking).length
  const canSubmit = !!selected && !!driverId && !!truckId && docsOk && !submitting

  const blockers: string[] = []
  if (!selected) blockers.push('выберите рейс')
  if (!driverId) blockers.push('выберите водителя')
  if (!truckId) blockers.push('выберите тягач')
  if (!docsOk) blockers.push('проверьте документы — все 6 должны быть приняты')

  const submit = async () => {
    if (!canSubmit || !selected) return
    setSubmitting(true)
    try {
      // 1. назначаем водителя и ТС
      let req = selected
      const assigned = await api.action(req.id, 'assign', { carrierId: activeCarrierId, driverId, truckId, trailerId: trailerId || undefined })
      req = assigned.request
      // 2. прикрепляем проверенный комплект документов
      for (const t of DOC_ORDER) {
        const up = slots[t].upload
        if (up) await api.uploadDocument(req.id, { type: t, fileName: up.fileName, dataUri: up.dataUri })
      }
      // 3. прогон нейропроверки платформы и передача логисту
      const verified = await api.verifyDocuments(req.id)
      setSubmitted(verified.request)
      toast({ title: `Заявка ${verified.request.number} подана`, description: 'Комплект документов проверен нейросетью и отправлен логисту' })
      await load()
    } catch (e) {
      toast({ title: 'Не удалось подать заявку', description: e instanceof Error ? e.message : 'Ошибка сервера', variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center">
        <div className="font-medium text-red-800">Не удалось загрузить данные</div>
        <div className="mt-1 text-sm text-red-600">{loadError}</div>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => { setLoadError(null); void load() }}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Повторить
        </Button>
      </div>
    )
  }
  if (requests === null) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-10 text-slate-500">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" aria-hidden />
        Загрузка рейсов и справочника…
      </div>
    )
  }

  // ---------- экран успеха ----------
  if (submitted) {
    return (
      <div>
        <SectionHeader title="Заявка подана" />
        <Card className="border-emerald-200 bg-emerald-50/50 shadow-sm">
          <CardContent className="p-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-6 w-6" aria-hidden />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2 text-lg font-bold text-slate-900">
                  Заявка {submitted.number}
                  <ModeBadge mode={submitted.mode} />
                  <StatusBadge status={submitted.status} />
                </div>
                <div className="text-sm text-slate-600">
                  {submitted.fromPoint} → {submitted.toPoint} · {submitted.cargo} · погрузка {submitted.loadDate} {submitted.loadWindow}
                </div>
              </div>
            </div>
            <Separator className="my-4" />
            <div className="grid gap-2 sm:grid-cols-2">
              {submitted.documents.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <span className="truncate text-sm text-slate-700">{SLOT_META[d.type].label}</span>
                  <DocStatusBadge status={d.status} />
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm text-slate-600">
              Комплект прошёл мгновенную нейропроверку при загрузке и отправлен логисту на сверку. Дальнейший статус — во вкладке «Мои заявки».
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={() => onNavigate('my')}>
                Открыть «Мои заявки»
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
              <Button variant="outline" onClick={resetAll}>Подать следующую заявку</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ---------- форма подачи ----------
  return (
    <div>
      <SectionHeader title="Подать заявку" />
      <StatusPipeline activeIdx={selected ? STAGE_OF_STATUS[selected.status] : -1} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {/* 1 · Рейс */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white" aria-hidden>1</span>
                <h3 className="text-sm font-semibold text-slate-900">Рейс</h3>
              </div>
              <Select value={requestId} onValueChange={(v) => setRequestId(v === requestId ? '' : v)}>
                <SelectTrigger aria-label="Выбор рейса для заявки" className="w-full">
                  <SelectValue placeholder={mineNeedDocs.length > 0 ? 'Выберите рейс' : 'Нет доступных рейсов'} />
                </SelectTrigger>
                <SelectContent>
                  {mineNeedDocs.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Ваши заявки — дозагрузить документы</SelectLabel>
                      {mineNeedDocs.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.number} · {r.fromPoint} → {r.toPoint} · {r.cargo}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {needBid.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Требуют ставку на площадке — недоступно здесь</SelectLabel>
                      {needBid.map((r) => (
                        <SelectItem key={r.id} value={`disabled-${r.id}`} disabled>
                          {r.number} · {r.mode === 'AUCTION' ? 'торги' : 'закрытые ставки'} · подайте ставку на площадке
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>

              {selected && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-blue-700">{selected.number}</span>
                    <ModeBadge mode={selected.mode} />
                    <StatusBadge status={selected.status} />
                  </div>
                  <div className="mt-1.5 grid gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-2">
                    <div><span className="text-slate-400">Маршрут:</span> {selected.fromPoint} → {selected.toPoint}</div>
                    <div><span className="text-slate-400">Груз:</span> {selected.cargo}, {selected.tonnage} т · {selected.truckType}</div>
                    <div><span className="text-slate-400">Погрузка:</span> {selected.loadDate} {selected.loadWindow}</div>
                    <div><span className="text-slate-400">Ставка:</span> {money(selected.bestRate ?? selected.startRate)}{selected.status === 'PUBLISHED' ? ' (стартовая)' : ''}</div>
                  </div>
                  {selected.status === 'PUBLISHED' && (
                    <p className="mt-2 text-xs text-amber-700">
                      Рейс ещё на площадке: при отправке заявки он будет закреплён за вами автоматически.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 2 · Документы с мгновенной нейропроверкой */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white" aria-hidden>2</span>
                  <h3 className="text-sm font-semibold text-slate-900">Документы · нейропроверка при загрузке</h3>
                </div>
                <span className="text-xs font-medium text-slate-500">проверено {checkedCount} из 6</span>
              </div>
              <Progress value={(checkedCount / 6) * 100} className="mb-2 h-1.5" aria-label={`Проверено документов: ${checkedCount} из 6`} />
              <p className="mb-4 text-[11px] text-slate-400">Фотографии — одиночные: один снимок в каждый слот, нейросеть проверяет его сразу после загрузки.</p>

              <div className="grid gap-3 sm:grid-cols-2">
                {DOC_ORDER.map((t) => {
                  const s = slots[t]
                  const meta = SLOT_META[t]
                  const Icon = meta.icon
                  return (
                    <div key={t} className={`rounded-xl border p-3 transition-colors ${slotBorder(s)}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold text-slate-800">{meta.label}</div>
                            <div className="text-[10px] text-slate-400">{meta.hint}</div>
                          </div>
                        </div>
                        {s.verdict && !s.checking && <DocStatusBadge status={s.verdict.status} />}
                      </div>

                      {s.upload ? (
                        <div className="mt-2 flex items-center gap-2.5">
                          <img src={s.upload.dataUri} alt={`Загружено в слот «${meta.label}»`} className="h-16 w-24 shrink-0 rounded-md border border-slate-200 object-cover" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[11px] text-slate-500">{s.upload.fileName}</div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-1 h-7 gap-1 text-xs"
                              onClick={() => fileInputs.current[t]?.click()}
                            >
                              <Upload className="h-3 w-3" aria-hidden />
                              Заменить файл
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => fileInputs.current[t]?.click()}
                          className="mt-2 flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-white/60 px-3 py-4 text-center transition-colors hover:border-blue-400 hover:bg-blue-50/40"
                          aria-label={`Загрузить ${meta.label}`}
                        >
                          <Upload className="h-4 w-4 text-slate-400" aria-hidden />
                          <span className="text-xs font-medium text-slate-600">Загрузить фото</span>
                        </button>
                      )}
                      <input
                        ref={(el) => { fileInputs.current[t] = el }}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        aria-label={`Файл ${meta.label}`}
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) void handleFile(t, f)
                          e.target.value = ''
                        }}
                      />
                      <SlotVerdict s={s} type={t} />
                    </div>
                  )
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setExamplesOpen(true)}>
                  <BookOpen className="h-4 w-4 text-blue-600" aria-hidden />
                  Примеры документов
                </Button>
                <span className="text-xs text-muted-foreground">образцы сканов — можно посмотреть перед загрузкой своих фото</span>
              </div>
            </CardContent>
          </Card>

          {/* 3 · Водитель и транспорт */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white" aria-hidden>3</span>
                  <h3 className="text-sm font-semibold text-slate-900">Водитель и транспорт</h3>
                </div>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setIntakeOpen(true)}>
                  <UserRoundPlus className="h-4 w-4 text-blue-600" aria-hidden />
                  Новый водитель по документам
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-600">Водитель (из базы аккаунта)</Label>
                  <Select value={driverId} onValueChange={setDriverId}>
                    <SelectTrigger aria-label="Выбор водителя"><SelectValue placeholder={drivers.length ? 'Выберите водителя' : 'База пуста'} /></SelectTrigger>
                    <SelectContent>
                      {drivers.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.fullName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-600">Тягач</Label>
                  <Select value={truckId} onValueChange={setTruckId}>
                    <SelectTrigger aria-label="Выбор тягача"><SelectValue placeholder={trucks.length ? 'Выберите тягач' : 'База пуста'} /></SelectTrigger>
                    <SelectContent>
                      {trucks.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.brand} · {t.plate}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-600">Прицеп (опционально)</Label>
                  <Select value={trailerId} onValueChange={(v) => setTrailerId(v === 'none' ? '' : v)}>
                    <SelectTrigger aria-label="Выбор прицепа"><SelectValue placeholder="Без прицепа" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Без прицепа</SelectItem>
                      {trailers.map((z) => (
                        <SelectItem key={z.id} value={z.id}>{z.plate} · {z.type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {drivers.length === 0 && (
                <p className="mt-3 text-xs text-amber-700">
                  В базе аккаунта нет водителей — добавьте первого по документам (кнопка выше): нейросеть сама заполнит карточку.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Отправка */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">Готовность к отправке</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {blockers.length === 0
                      ? 'Комплект проверен нейросетью — заявка уйдёт логисту'
                      : `Осталось: ${blockers.join(', ')}`}
                  </div>
                </div>
                <Button className="gap-2" disabled={!canSubmit} onClick={() => void submit()}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Подача заявки…
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" aria-hidden />
                      Отправить заявку
                    </>
                  )}
                </Button>
              </div>
              {submitting && (
                <p className="mt-3 flex items-center gap-2 text-xs text-blue-700" role="status">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Закрепляем рейс, прикрепляем документы и передаём логисту…
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Правая колонка */}
        <div className="space-y-4">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FileSpreadsheet className="h-4 w-4 text-emerald-700" aria-hidden />
                Массовая подача из Excel
              </div>
              <p className="mt-1 text-[11px] leading-snug text-slate-500">
                Строка = заявка: «Заявка · Водитель · Тягач · Прицеп». Фотографии прикладываются к каждой заявке отдельно, по одной.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <Button size="sm" variant="outline" className="justify-start gap-1.5" onClick={downloadTemplate}>
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Скачать шаблон
                </Button>
                <Button size="sm" variant="outline" className="justify-start gap-1.5" onClick={() => excelInput.current?.click()}>
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                  Загрузить Excel
                </Button>
              </div>
              <input
                ref={excelInput}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                aria-label="Файл Excel с заявками"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void parseExcel(f)
                }}
              />
              {mineNeedDocs.length === 0 && (
                <p className="mt-2 text-[11px] text-amber-700">
                  Выиграйте рейс на площадке — массовая подача заполняет ваши выигранные заявки.
                </p>
              )}
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Truck className="h-4 w-4 text-slate-500" aria-hidden />
                База аккаунта
              </div>
              <Button size="sm" variant="outline" className="mt-3 gap-1.5" onClick={() => onNavigate('directory')}>
                Открыть базу
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Примеры документов: отдельная кнопка, образцы можно посмотреть */}
      <Dialog open={examplesOpen} onOpenChange={setExamplesOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Примеры документов</DialogTitle>
            <DialogDescription>
              Как должен выглядеть скан каждого документа (демо-образцы). Сверяйте с ними свои фотографии перед загрузкой.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300">
            {DOC_ORDER.map((t) => (
              <figure key={t} className="rounded-xl border border-slate-200 p-3">
                <img
                  src={demoSampleUri(t)}
                  alt={`Пример документа: ${SLOT_META[t].label}`}
                  className="w-full rounded-lg border border-slate-100 bg-white"
                />
                <figcaption className="mt-2">
                  <div className="text-xs font-semibold text-slate-800">{SLOT_META[t].label}</div>
                  <div className="text-[11px] text-slate-500">{SLOT_META[t].hint}</div>
                </figcaption>
              </figure>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExamplesOpen(false)}>Закрыть</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Массовая подача из Excel: предпросмотр с проверкой строк */}
      <Dialog open={excelOpen} onOpenChange={(o) => { setExcelOpen(o); if (!o) setImportRows(null) }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Массовая подача из Excel</DialogTitle>
            <DialogDescription>
              Проверьте строки: заявка должна быть вашей выигранной, водитель и тягач — из базы аккаунта. Подтвердите — и данные встанут на все рейсы сразу.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-auto rounded-xl border border-slate-200 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th scope="col" className="px-3 py-2 font-semibold">Стр.</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Заявка</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Водитель</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Тягач</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Прицеп</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Проверка</th>
                </tr>
              </thead>
              <tbody>
                {(importRows ?? []).map((r) => (
                  <tr key={r.line} className={`border-t border-slate-100 ${r.ok ? '' : 'bg-red-50/50'}`}>
                    <td className="px-3 py-2 text-slate-400">{r.line}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-blue-700">{r.requestNo || '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{r.driverName || '—'}</td>
                    <td className="px-3 py-2 font-mono text-slate-700">{r.truckPlate || '—'}</td>
                    <td className="px-3 py-2 font-mono text-slate-500">{r.trailerPlate || '—'}</td>
                    <td className="px-3 py-2">
                      {r.ok ? (
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                          {r.message}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-700">
                          <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          {r.message}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400">
            Фотографии — одиночные: после подачи откройте каждую заявку и загрузите по одному снимку на документ.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setExcelOpen(false); setImportRows(null) }}>Отмена</Button>
            <Button onClick={() => void runImport()} disabled={importOkCount === 0 || importing}>
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Подача…
                </>
              ) : (
                `Подать заявки: ${importOkCount}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Нейро-мастер добавления водителя (карточка заполняется ИИ, запись идёт в базу аккаунта) */}
      <DriverIntakeDialog
        open={intakeOpen}
        onOpenChange={setIntakeOpen}
        carriers={carrier ? [carrier] : []}
        defaultCarrierId={activeCarrierId}
        lockCarrier
        onSaved={(res) => {
          toast({
            title: 'Водитель добавлен в базу аккаунта',
            description: `${res.driverName}: карточка заполнена нейросетью по документам${res.truckId ? ', тягач распознан из СТС' : ''}`,
          })
          void (async () => {
            const dir = await api.directory().catch(() => null)
            if (dir) {
              const me = dir.carriers.find((c) => c.id === activeCarrierId) ?? null
              setCarrier(me)
            }
          })()
          if (res.driverId) setDriverId(res.driverId)
          if (res.truckId) setTruckId(res.truckId)
        }}
      />
    </div>
  )
}
