'use client'

/** Раздел «Мои заявки» — кабинет агента: открытые и доступные к отклику заявки, торги, выигранные рейсы */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CircleAlert,
  ArrowRight,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ClipboardList,
  FileSignature,
  FileText,
  FileX,
  History,
  IdCard,
  Loader2,
  Lock,
  MapPin,
  Search,
  SearchX,
  Send,
  Sparkles,
  Trash2,
  TrendingDown,
  Trophy,
  Truck,
  Upload,
  User,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  DocStatusBadge,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  SectionHeader,
  type TabProps,
} from '@/components/platform/common'
import { PIPELINE_STAGES, STAGE_OF_STATUS, StatusPipeline } from '@/components/platform/status-pipeline'
import { RouteButton, RoutePointsInline } from '@/components/platform/route-dialog'
import { AnimatedRate } from '@/components/platform/animated-rate'
import { useToast } from '@/hooks/use-toast'
import { api, secureFileUrl } from '@/lib/api'
import { fileToCompressedDataUri, sampleSvg } from '@/lib/demo-media'
import { DOC_TYPE_LABEL, fmtDateTime, rate, timeLeft } from '@/lib/status'
import { pointInfo } from '@/lib/points'
import type { BidDTO, CarrierDTO, DocStatus, DocType, RequestDTO } from '@/lib/types'

const DOC_ORDER: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'LICENSE', 'STS', 'REQUEST_DOC', 'POA']

const DOC_ICONS: Record<DocType, typeof IdCard> = {
  PASSPORT_PHOTO: IdCard,
  PASSPORT_REG: MapPin,
  LICENSE: Car,
  STS: FileText,
  REQUEST_DOC: ClipboardList,
  POA: FileSignature,
  ATTACHMENT: FileText,
}

const DOC_SHORT: Record<DocType, string> = {
  PASSPORT_PHOTO: 'Паспорт (стр. с фото)',
  PASSPORT_REG: 'Паспорт: регистрация',
  LICENSE: 'Водительское удостоверение',
  STS: 'СТС',
  REQUEST_DOC: 'Заявка (скан)',
  POA: 'Доверенность',
  ATTACHMENT: 'Вложение',
}

const STATUS_ORDER: Record<RequestDTO['status'], number> = {
  PUBLISHED: 0,
  AWARDED: 1,
  DOCS_REVIEW: 1,
  AT_LOGIST: 2,
  CONFIRMED: 3,
  CLOSED: 4,
  DELETED: 5, // удалённые заявки в кабинет агента не попадают (фильтр выше), но тип требует полноты
}

/** Этап плашки для заявки из «Моих заявок»: ставка уже подана — «Согласование ставки» */
const stageOf = (r: RequestDTO): number => (r.status === 'PUBLISHED' ? 1 : STAGE_OF_STATUS[r.status])

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300'

/** Текст-подсказка для агента по статусу заявки */
function agentLine(r: RequestDTO, myBid: BidDTO | null): { text: string; cls: string } {
  switch (r.status) {
    case 'PUBLISHED':
      if (r.mode === 'CLOSED')
        return { text: 'Закрытая ставка подана — цену увидит только логист при подведении итогов', cls: 'border-blue-200 bg-blue-50 text-blue-900' }
      if (r.bestRate == null)
        return { text: 'Ставка подана — ждём первых конкурентов по рейсу', cls: 'border-blue-200 bg-blue-50 text-blue-900' }
      if (myBid && myBid.amount <= r.bestRate)
        return { text: 'Ваша ставка сейчас лучшая — ждём закрытия приёма ставок', cls: 'border-emerald-200 bg-emerald-50 text-emerald-900' }
      return { text: 'Вашу ставку перебили — подайте новую, пониженную', cls: 'border-amber-200 bg-amber-50 text-amber-900' }
    case 'AWARDED':
      return { text: 'Вы выиграли — рейс закреплён за вами', cls: 'border-emerald-200 bg-emerald-50 text-emerald-900' }
    case 'DOCS_REVIEW': {
      const bad = r.documents.some((d) => d.status === 'REUPLOAD' || d.status === 'REJECTED')
      return bad
        ? { text: 'Требует исправления: причина у каждого документа — догрузите исправленные сканы через «Подать документы»', cls: 'border-amber-300 bg-amber-50 text-amber-900' }
        : { text: 'Нейросеть проверяет документы — статус обновится автоматически', cls: 'border-blue-200 bg-blue-50 text-blue-900' }
    }
    case 'AT_LOGIST':
      return { text: 'Комплект у логиста — идёт сверка фото с полями заявки', cls: 'border-blue-200 bg-blue-50 text-blue-900' }
    case 'CONFIRMED':
      return { text: 'Данные переданы в 1С — водитель может выезжать на погрузку', cls: 'border-emerald-200 bg-emerald-50 text-emerald-900' }
    case 'CLOSED':
      return { text: 'Рейс выполнен и закрыт — данные в реестре рейсов и бухгалтерии АЭМЗ', cls: 'border-emerald-300 bg-emerald-50 text-emerald-900' }
    default:
      return { text: 'Рейс закрыт', cls: 'border-slate-300 bg-slate-100 text-slate-600' }
  }
}

/** Цвет списка замечаний по статусу документа */
function issueClass(status: DocStatus): string {
  if (status === 'REJECTED') return 'text-red-600'
  if (status === 'REUPLOAD') return 'text-amber-600'
  if (status === 'MANUAL') return 'text-blue-600'
  return 'text-slate-500'
}

const DEMO_NAMES: Record<DocType, string> = {
  PASSPORT_PHOTO: 'passport_photo_demo.jpg',
  PASSPORT_REG: 'passport_reg_demo.jpg',
  LICENSE: 'license_demo.jpg',
  STS: 'sts_demo.jpg',
  REQUEST_DOC: 'zayavka_scan_demo.jpg',
  POA: 'doverennost_demo.jpg',
  ATTACHMENT: 'vlozhenie_demo.jpg',
}

/** Чипы назначенного экипажа: водитель, тягач, прицеп */
function CrewChips({ r, carrier }: { r: RequestDTO; carrier: CarrierDTO | null }) {
  const d = carrier?.drivers.find((x) => x.id === r.driverId)
  const t = carrier?.trucks.find((x) => x.id === r.truckId)
  const z = carrier?.trailers.find((x) => x.id === r.trailerId)
  if (!d && !t && !z) return null
  const chip = 'inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800'
  return (
    <div className="flex flex-wrap gap-2">
      {d && <span className={chip}><User className="h-3 w-3 text-slate-500" aria-hidden />{d.fullName}</span>}
      {t && <span className={chip}><Truck className="h-3 w-3 text-slate-500" aria-hidden />{t.brand} · {t.plate}</span>}
      {z && <span className={chip}><Wrench className="h-3 w-3 text-slate-500" aria-hidden />{z.plate} · {z.type}</span>}
    </div>
  )
}

export default function MyRequestsTab({ activeCarrierId, onNavigate, liveTick }: TabProps) {
  const { toast } = useToast()
  const [requests, setRequests] = useState<RequestDTO[] | null>(null)
  const [carriers, setCarriers] = useState<CarrierDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [timelineOpen, setTimelineOpen] = useState<Record<string, boolean>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | number>('ALL')
  // Task 61/63: «Доступна для отклика» по умолчанию скрыта — в кабинете остаются только заявки,
  // по которым агент реально участвует. Тумблера больше нет (Task 63): увидеть доступные
  // можно, выбрав этап «Выбор рейса» в фильтре этапов выше.
  const [now, setNow] = useState<number | null>(null)
  // свёрнутый загрузчик документов на этапе «Подтверждено» (Task 50)
  const [docsOpenId, setDocsOpenId] = useState<string | null>(null)
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})
  // ——— окно ставки: форма → подтверждение → успех (как на площадке) ———
  const [bidReq, setBidReq] = useState<RequestDTO | null>(null)
  const [bidAmount, setBidAmount] = useState('')
  const [bidStep, setBidStep] = useState<'form' | 'confirm' | 'success'>('form')
  const [lastBid, setLastBid] = useState<number | null>(null)

  // тик для обратного отсчёта приёма ставок (без hydration mismatch)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    try {
      const [list, dir] = await Promise.all([api.listRequests(), api.directory()])
      setRequests(list.requests)
      setCarriers(dir.carriers)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // real-time (Task 49): событие из шины WS мгновенно догружает список заявок
  useEffect(() => {
    if (liveTick > 0) void load()
  }, [liveTick, load])

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

  const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Неизвестная ошибка')

  // ——— окно новой ставки: валидация и отправка ———
  const closeBid = () => {
    setBidReq(null)
    setBidAmount('')
    setBidStep('form')
    setLastBid(null)
  }

  /** Валидация ставки; при ошибке — toast, при успехе — число ₽/т */
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

  const doBid = async () => {
    if (!bidReq || !activeCarrierId) return
    const amount = validateBidAmount()
    if (amount == null) return
    setBusy(bidReq.id)
    try {
      const { request } = await api.action(bidReq.id, 'bid', { amount })
      applyRequest(request)
      setLastBid(amount)
      setBidStep('success')
    } catch (e) {
      toast({ title: 'Ошибка', description: errMsg(e), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const toastDocVerdict = (docType: DocType, status: DocStatus | undefined, issues: string[], message: string | null) => {
    const label = DOC_SHORT[docType]
    switch (status) {
      case 'PASSED':
        toast({ title: `${label} принят автоматически`, description: 'Порог уверенности пройден — документ передаётся дальше' })
        break
      case 'MANUAL':
        toast({ title: `${label} — на ручной проверке`, description: 'Логист сверит данные вручную' })
        break
      case 'REUPLOAD':
        toast({ title: `${label}: перезагрузите документ`, description: issues[0] ?? 'Качество или данные не прошли порог' })
        break
      case 'REJECTED':
        toast({ title: `${label}: отказ`, description: issues.join('; ') || message || undefined, variant: 'destructive' })
        break
      default:
        toast({ title: `${label} отправлен на проверку нейросети` })
    }
  }

  // ——— загрузка файла через скрытый input ———
  const handleFile = async (r: RequestDTO, type: DocType, file: File) => {
    setBusy(`${r.id}:up:${type}`)
    try {
      const dataUri = await fileToCompressedDataUri(file)
      const up = await api.uploadDocument(r.id, { type, fileName: file.name, dataUri })
      applyRequest(up.request)
      setVerifyingId(r.id)
      try {
        const v = await api.verifyDocuments(r.id)
        applyRequest(v.request)
        const doc = v.request.documents.find((d) => d.type === type)
        toastDocVerdict(type, doc?.status, doc?.issues ?? [], doc?.message ?? null)
      } finally {
        setVerifyingId(null)
      }
    } catch (e) {
      toast({ title: 'Ошибка', description: errMsg(e), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  // ——— демо: комплект из 6 образцов ———
  const runDemo = async (r: RequestDTO) => {
    setBusy(`${r.id}:demo`)
    try {
      const samples: [DocType, string][] = [
        ['PASSPORT_PHOTO', sampleSvg('ПАСПОРТ РФ · СТР. С ФОТО', ['ИВАНОВ ИВАН ИВАНОВИЧ', '15.05.1990', '99 12 345678'], '#0f3b66')],
        ['PASSPORT_REG', sampleSvg('ПАСПОРТ РФ · РЕГИСТРАЦИЯ', ['01.02.2020  770-001', 'Г. МОСКВА, УЛ. ПРИМЕРНАЯ', 'Д. 1'], '#0f3b66')],
        ['LICENSE', sampleSvg('ВОДИТЕЛЬСКОЕ УДОСТОВЕРЕНИЕ', ['ИВАНОВ ИВАН ИВАНОВИЧ', '15.05.1990', '99 12 345678', 'C, CE'], '#5b3413')],
        ['STS', sampleSvg('СТС ТЯГАЧА', ['А123ВС777', 'X9622277XKG123456', '99 00 123456'], '#14532d')],
        ['REQUEST_DOC', sampleSvg('ЗАЯВКА НА ПЕРЕВОЗКУ', [`№ ${r.number}`, '18.10.2026', 'ГРУЗ: МЕТАЛЛОКОНСТРУКЦИИ, 20 Т', 'СТАВКА: 8 200 РУБ/Т'], '#9a3412')],
        ['POA', sampleSvg('ДОВЕРЕННОСТЬ № 47', ['№ 47', '18.10.2026', 'ООО «ПЕРЕВОЗЧИК А»', 'ИВАНОВ ИВАН ИВАНОВИЧ', '31.12.2026'], '#3f6212')],
      ]
      for (const [type, dataUri] of samples) {
        const up = await api.uploadDocument(r.id, { type, fileName: DEMO_NAMES[type], dataUri })
        applyRequest(up.request)
      }
      setVerifyingId(r.id)
      const v = await api.verifyDocuments(r.id)
      applyRequest(v.request)
      const passed = v.request.documents.filter((d) => d.status === 'PASSED').length
      toast({
        title: 'Проверка завершена',
        description: `Автоматически принято: ${passed} из ${v.request.documents.length}. Итоги по каждому документу — в карточке заявки.`,
      })
    } catch (e) {
      toast({ title: 'Ошибка', description: errMsg(e), variant: 'destructive' })
    } finally {
      setVerifyingId(null)
      setBusy(null)
    }
  }

  // ——— демо: заведомо размытое ВУ ———
  const runBlurDemo = async (r: RequestDTO) => {
    setBusy(`${r.id}:blur`)
    try {
      const dataUri = sampleSvg('ВОДИТЕЛЬСКОЕ УДОСТОВЕРЕНИЕ', ['ИВАНОВ ИВАН ИВАНОВИЧ', '15.05.1990', '99 12 345678', 'C, CE'], '#5b3413')
      const up = await api.uploadDocument(r.id, { type: 'LICENSE', fileName: 'license_blur_demo.jpg', dataUri })
      applyRequest(up.request)
      setVerifyingId(r.id)
      try {
        const v = await api.verifyDocuments(r.id)
        applyRequest(v.request)
        const doc = v.request.documents.find((d) => d.type === 'LICENSE')
        if (doc?.status === 'REUPLOAD') {
          toast({ title: 'Брак обнаружен', description: `ВУ получил статус «Перезагрузить документ». ${doc.issues[0] ?? ''}`.trim() })
        } else {
          toastDocVerdict('LICENSE', doc?.status, doc?.issues ?? [], doc?.message ?? null)
        }
      } finally {
        setVerifyingId(null)
      }
    } catch (e) {
      toast({ title: 'Ошибка', description: errMsg(e), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  // ——— отправить PENDING-документы на проверку ———
  const doVerify = async (r: RequestDTO) => {
    setBusy(`${r.id}:verify`)
    setVerifyingId(r.id)
    try {
      const { request } = await api.verifyDocuments(r.id)
      applyRequest(request)
      toast({ title: 'Проверка завершена', description: 'Статусы и замечания — у каждого документа в комплекте' })
    } catch (e) {
      toast({ title: 'Ошибка', description: errMsg(e), variant: 'destructive' })
    } finally {
      setVerifyingId(null)
      setBusy(null)
    }
  }

  // ——— отправить PENDING-документы на проверку ———

  const carrier = carriers.find((c) => c.id === activeCarrierId) ?? null
  const carrierName = carrier?.name ?? 'перевозчик'

  /** Лучшая (минимальная) активная ставка активного перевозчика по заявке.
   *  Отозванные ставки (агент снялся, Task 52) не учитываются */
  const myBidOf = useCallback(
    (r: RequestDTO): BidDTO | null => {
      if (!activeCarrierId) return null
      const mine = r.bids.filter((b) => b.carrierId === activeCarrierId && !b.withdrawn)
      if (mine.length === 0) return null
      return mine.reduce((best, b) => (b.amount < best.amount ? b : best))
    },
    [activeCarrierId],
  )

  // ——— состояние карточки агента (Task 52/54, сводная таблица пользователя) ———
  // available: заявка опубликована, агент ещё не откликнулся — доступна для отклика (Task 54)
  // normal: лидирует в тендере / выиграл — стандартная карточка (+ иконка отмены на торгах)
  // outbid: ставка перебита, торги ещё идут — красная карточка со статусом «Ставка перебита»
  // withdrawn: агент сам снялся — серая карточка с кнопкой «Удалить»
  // lost: тендер завершён не в пользу агента — статус замораживается на «Согласовании ставки»
  //       (или «Ставка перебита», если цену перебили) — дальше этапы не показываются (Task 54)
  type CardState = 'available' | 'normal' | 'outbid' | 'withdrawn' | 'lost'
  const cardStateOf = useCallback(
    (r: RequestDTO, nowTs: number | null): CardState => {
      const myBid = myBidOf(r)
      const hasWithdrawn = r.bids.some((b) => b.carrierId === activeCarrierId && b.withdrawn)
      if (r.status !== 'PUBLISHED') return r.winnerId === activeCarrierId ? 'normal' : 'lost'
      if (!myBid) return hasWithdrawn ? 'withdrawn' : 'available'
      const deadlinePassed = r.deadline != null && nowTs != null && new Date(r.deadline).getTime() <= nowTs
      const outbid = r.bestRate != null && myBid.amount > r.bestRate
      if (outbid) return deadlinePassed ? 'lost' : 'outbid'
      return 'normal'
    },
    [activeCarrierId, myBidOf],
  )

  /** был ли агент перебит по заявке (для потерянных карточек — итоговый статус «Ставка перебита», Task 54) */
  const lostOutbid = useCallback(
    (r: RequestDTO): boolean => {
      const myBid = myBidOf(r)
      return myBid != null && r.bestRate != null && myBid.amount > r.bestRate
    },
    [myBidOf],
  )

  /**
   * Этап линии для карточки агента (Task 54): доступная к отклику заявка стоит на
   * «Выборе рейса» (0); торгующиеся и замороженные — на «Согласовании ставки» (1);
   * выигранные — дальше по конвейеру. Проигранные заявки дальше 1 не уходят никогда.
   */
  const displayStageOf = useCallback(
    (r: RequestDTO): number => {
      const state = cardStateOf(r, now)
      if (state === 'available') return 0
      if (state === 'outbid' || state === 'withdrawn' || state === 'lost') return 1
      return stageOf(r)
    },
    [cardStateOf, now],
  )

  // ——— добровольный выход из заявки (Task 52) ———
  const [withdrawReq, setWithdrawReq] = useState<RequestDTO | null>(null)
  const doWithdraw = async () => {
    if (!withdrawReq || !activeCarrierId) return
    setBusy(withdrawReq.id)
    try {
      const { request } = await api.action(withdrawReq.id, 'withdraw', {})
      applyRequest(request)
      toast({ title: 'Вы снялись с заявки', description: `${request.number} — ставка отозвана, торги продолжаются без вас` })
    } catch (e) {
      toast({ title: 'Ошибка', description: errMsg(e), variant: 'destructive' })
    } finally {
      setBusy(null)
      setWithdrawReq(null)
    }
  }

  // ——— «Удалить» на серых карточках: скрыть только из кабинета этого агента (Task 52) ———
  const HIDDEN_KEY = 'aemz-hidden-requests'
  const loadHidden = useCallback((carrierId: string | null): Set<string> => {
    try {
      const raw = localStorage.getItem(HIDDEN_KEY)
      const obj = raw ? (JSON.parse(raw) as Record<string, string[]>) : {}
      return new Set((carrierId && obj[carrierId]) ?? [])
    } catch { return new Set() }
  }, [])
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    setHiddenIds(loadHidden(activeCarrierId))
  }, [activeCarrierId, loadHidden])
  const hideRequest = (id: string) => {
    if (!activeCarrierId) return
    try {
      const raw = localStorage.getItem(HIDDEN_KEY)
      const obj = raw ? (JSON.parse(raw) as Record<string, string[]>) : {}
      const arr = new Set(obj[activeCarrierId] ?? [])
      arr.add(id)
      localStorage.setItem(HIDDEN_KEY, JSON.stringify({ ...obj, [activeCarrierId]: [...arr] }))
    } catch { /* ignore */ }
    setHiddenIds((cur) => new Set([...cur, id]))
    toast({ title: 'Карточка удалена из вашего кабинета', description: 'Данные на площадке не затронуты — это скрытие только для вашего аккаунта' })
  }

  /**
   * Кабинет агента — сквозная синхронизация с логистом (Task 68):
   * — заявки, где агент участвует (ставка или победа), видны на ВСЕХ этапах жизненного
   *   цикла: торги → документы → подготовка к рейсу → готово → завершено;
   * — новые заявки, открытые для отклика (скрыты, пока не выбран этап «Выбор рейса»);
   * статус в кабинете зеркалит то, что видит логист в «Реестре заявок»: один источник —
   * статус заявки в БД, мгновенное обновление — liveTick по событию шины WS.
   */
  const mine = (requests ?? [])
    .filter((r) => r.status === 'PUBLISHED' || r.winnerId === activeCarrierId || r.bids.some((b) => b.carrierId === activeCarrierId))
    .filter((r) => !hiddenIds.has(r.id))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.updatedAt < b.updatedAt ? 1 : -1))

  // ——— быстрый поиск + фильтр по статусу ———
  const q = query.trim().toLowerCase()
  /** доступные для отклика скрыты всегда, кроме явного выбора этапа «Выбор рейса» (Task 63) */
  const availableHidden = statusFilter !== 0
  const isFiltered = q !== '' || statusFilter !== 'ALL'
  const visible = mine.filter((m) => {
    const state = cardStateOf(m, now)
    if (availableHidden && state === 'available') return false
    if (statusFilter !== 'ALL' && displayStageOf(m) !== statusFilter) return false
    if (!q) return true
    const hay = [
      m.number, m.fromPoint, m.toPoint, m.cargo,
      pointInfo(m.fromPoint).short, pointInfo(m.toPoint).short,
      pointInfo(m.fromPoint).address, pointInfo(m.toPoint).address,
    ]
    return hay.some((v) => v.toLowerCase().includes(q))
  })
  // статусы фильтра фиксированы — все 7 этапов линии видны всегда,
  // а не только те, что случайно есть среди заявок
  const stageOptions = PIPELINE_STAGES.map((_, i) => i)
  const resetFilters = () => {
    setQuery('')
    setStatusFilter('ALL')
  }

  /** выбранная в списке заявка (по умолчанию — первая видима) */
  const active = visible.find((r) => r.id === activeId) ?? visible[0] ?? null

  return (
    <section aria-label="Мои заявки — кабинет агента">
      <SectionHeader title={`Мои заявки · ${carrierName}`} />

      {!activeCarrierId && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          Выберите перевозчика в шапке, чтобы действовать от его имени
        </div>
      )}

      {loading && <LoadingBlock label="Загружаем ваши заявки…" />}
      {!loading && error && <ErrorBlock message={error} onRetry={() => void load()} />}

      {!loading && !error && requests && activeCarrierId && mine.length === 0 && (
        <div className="space-y-4">
          <EmptyState
            title="Заявок нет"
            hint="Откройте «Площадку заявок» — открытые к отклику рейсы появятся здесь сразу, а после ставки заявка останется в кабинете до итогов торгов"
          />
          <div className="flex justify-center">
            <Button onClick={() => onNavigate('board')} className="gap-2" aria-label="Перейти к площадке заявок">
              <Truck className="h-4 w-4" aria-hidden />
              К площадке заявок
            </Button>
          </div>
        </div>
      )}

      {!loading && !error && requests && activeCarrierId && mine.length > 0 && visible.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center" role="status">
          <SearchX className="mx-auto h-8 w-8 text-slate-300" aria-hidden />
          <p className="mt-2 text-sm font-semibold text-slate-700">Ничего не найдено</p>
          <p className="mt-1 text-xs text-slate-500">
            {q
              ? `По запросу «${query.trim()}» заявок нет — измените условия или сбросьте фильтр`
              : statusFilter !== 'ALL'
                ? 'По выбранному этапу заявок нет — измените условия или сбросьте фильтр'
                : 'Все ваши заявки сейчас «Доступны для отклика» и скрыты — выберите этап «Выбор рейса» в фильтре выше, чтобы увидеть их'}
          </p>
          <Button variant="outline" size="sm" onClick={resetFilters} className="mt-3" aria-label="Сбросить поиск и фильтр">
            Сбросить поиск и фильтр
          </Button>
        </div>
      )}

      {!loading && !error && requests && activeCarrierId && visible.length > 0 && active && (() => {
        const r = active
        const myBid = myBidOf(r)
        const bidding = r.status === 'PUBLISHED'
        // сводная таблица состояний карточки (Task 52/54)
        const cardState = cardStateOf(r, now)
        const available = cardState === 'available'
        const lost = cardState === 'lost'
        const grey = cardState === 'withdrawn' || cardState === 'lost'
        const outbidLost = lost && lostOutbid(r)
        const line =
          cardState === 'available'
            ? { text: 'Заявка открыта для отклика — подайте ставку, чтобы участвовать в торгах', cls: 'border-sky-200 bg-sky-50 text-sky-900' }
            : cardState === 'withdrawn'
              ? { text: 'Вы снялись с заявки — ставка отозвана, торги идут без вас', cls: 'border-slate-300 bg-slate-100 text-slate-600' }
              : outbidLost
                ? r.status === 'PUBLISHED'
                  ? { text: 'Торги завершены: вашу ставку перебили — заявка остаётся в полной истории', cls: 'border-red-200 bg-red-50 text-red-800' }
                  : { text: 'Ставка перебита — рейс забрал другой перевозчик по более низкой цене', cls: 'border-red-200 bg-red-50 text-red-800' }
                : lost && r.status === 'PUBLISHED'
                  ? { text: 'Торги завершены: ваша цена не победила — заявка остаётся в полной истории', cls: 'border-slate-300 bg-slate-100 text-slate-600' }
                  : lost
                    ? { text: `Рейс забрал другой перевозчик${r.winnerName ? ` (${r.winnerName})` : ''} — заявка остаётся в полной истории`, cls: 'border-slate-300 bg-slate-100 text-slate-600' }
                    : cardState === 'outbid'
                      ? { text: 'Ставка перебита — подайте новую, пониженную, пока тендер не закрыт', cls: 'border-red-300 bg-red-100 text-red-800' }
                      : agentLine(r, myBid)
        const tl = bidding && now !== null && r.deadline ? timeLeft(r.deadline) : null
        const awarded = !grey && r.status === 'AWARDED'
        /** завершённый рейс (Task 68): карточка остаётся в кабинете с итоговым статусом,
            агенту доступно только скрытие из кабинета — операции с рейсом у логиста */
        const closed = r.status === 'CLOSED'
        const hasPending = r.documents.some((d) => d.status === 'PENDING')
        /** пропущенные документы: обязательные типы, по которым нет загрузки — подсвечиваем */
        const missingDocs = DOC_ORDER.filter((t) => !r.documents.some((d) => d.type === t))
        const docsOpen = docsOpenId === r.id
        /** итоговый статус для линии этапов (Task 54): не выигранные заявки заморожены на «Согласовании ставки» */
        const frozenState: 'outbid' | 'outbid-final' | 'lost' | 'withdrawn' | null =
          cardState === 'outbid'
            ? 'outbid'
            : outbidLost
              ? 'outbid-final'
              : cardState === 'lost'
                ? 'lost'
                : cardState === 'withdrawn'
                  ? 'withdrawn'
                  : null
        /** цвет большой карточки по состоянию (Task 52): красная — перебита, серая — выход/проигрыш,
            приглушённая — завершённый рейс (Task 68) */
        const cardCls =
          cardState === 'outbid'
            ? 'border-red-300 bg-red-50/50 shadow-sm'
            : grey
              ? 'border-slate-200 bg-slate-100/80 shadow-sm'
              : closed
                ? 'border-emerald-200 bg-emerald-50/40 shadow-sm'
                : 'border-slate-200 shadow-sm'

        /** Секция документов: единый вид для «Подтверждено» (свёрнуто) и «Документы» (раскрыто) */
        const docsSection = (
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FileText className="h-4 w-4 text-blue-600" aria-hidden />
                Документы (6 файлов к заявке)
              </h4>
              {missingDocs.length > 0 && (
                <Badge variant="outline" className="border-amber-300 bg-amber-100 text-[11px] font-semibold text-amber-800" aria-label={`Пропущено документов: ${missingDocs.length} из ${DOC_ORDER.length}`}>
                  Пропущено: {missingDocs.length} из {DOC_ORDER.length}
                </Badge>
              )}
              {hasPending && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={busy !== null}
                  onClick={() => void doVerify(r)}
                  aria-label={`Отправить документы заявки ${r.number} на проверку нейросети`}
                >
                  <Send className="h-4 w-4" aria-hidden />
                  Отправить на проверку
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {DOC_ORDER.map((type) => {
                const doc = r.documents.find((d) => d.type === type)
                const Icon = DOC_ICONS[type]
                const key = `${r.id}:${type}`
                return (
                  <div
                    key={type}
                    className={`flex flex-col rounded-xl border p-3 ${doc ? 'border-slate-200 bg-white' : 'border-dashed border-amber-300 bg-amber-50/70'}`}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700" aria-hidden>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="text-xs font-semibold leading-tight text-slate-800">{DOC_TYPE_LABEL[type]}</span>
                      </span>
                      {doc ? (
                        <DocStatusBadge status={doc.status} />
                      ) : (
                        <Badge variant="outline" className="border-amber-300 bg-amber-100 text-[10px] font-semibold text-amber-800">Не загружен</Badge>
                      )}
                    </div>

                    {doc && (
                      <img
                        src={secureFileUrl(doc.url)}
                        alt={`Документ «${DOC_TYPE_LABEL[type]}» — ${doc.fileName}`}
                        className="mb-2 h-20 w-full rounded-md border border-slate-200 object-cover"
                      />
                    )}

                    <div className="mb-2 min-h-0 flex-1 space-y-1">
                      {doc?.quality != null && (
                        <div className="text-[11px] text-muted-foreground">Качество: {doc.quality}</div>
                      )}
                      {doc?.message && <p className="text-[11px] leading-snug text-slate-600">{doc.message}</p>}
                      {doc && doc.issues.map((is, i) => (
                        <p key={i} className={`text-[11px] leading-snug ${issueClass(doc.status)}`}>• {is}</p>
                      ))}
                    </div>

                    <input
                      ref={(el) => {
                        fileInputs.current[key] = el
                      }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      aria-label={`Загрузить ${DOC_TYPE_LABEL[type]}`}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        e.target.value = ''
                        if (f) void handleFile(r, type, f)
                      }}
                    />
                    <Button
                      size="sm"
                      variant={doc ? 'outline' : 'default'}
                      className="w-full gap-1.5"
                      disabled={busy !== null}
                      onClick={() => fileInputs.current[key]?.click()}
                      aria-label={doc ? `Заменить ${DOC_TYPE_LABEL[type]}` : `Загрузить ${DOC_TYPE_LABEL[type]}`}
                    >
                      {busy === `${r.id}:up:${type}`
                        ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        : <Upload className="h-4 w-4" aria-hidden />}
                      {doc ? 'Заменить' : 'Загрузить файл'}
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        )

        /** Демо-кнопки комплекта документов */
        const demoButtons = (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={busy !== null}
              onClick={() => void runDemo(r)}
              aria-label={`Загрузить демо-образцы документов по заявке ${r.number}`}
            >
              {busy === `${r.id}:demo` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
              Загрузить образцы документов (демо)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={busy !== null}
              onClick={() => void runBlurDemo(r)}
              aria-label={`Загрузить демо-образец с браком по заявке ${r.number}`}
            >
              {busy === `${r.id}:blur` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileX className="h-4 w-4" aria-hidden />}
              Брак: размытое ВУ (демо)
            </Button>
            {verifyingId === r.id && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-blue-700" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Нейросеть проверяет…
              </span>
            )}
          </div>
        )

        return (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
            {/* Список заявок: поиск, фильтр по статусу, прокрутка вниз и выбор нужной */}
            <div className="lg:sticky lg:top-4">
              <div className="mb-2 flex items-center justify-between px-1">
                <span
                  className="text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                  title={visible.length !== mine.length ? `Показаны не все заявки: всего ${mine.length}` : undefined}
                >
                  Ваши заявки · {visible.length}{visible.length !== mine.length ? ` из ${mine.length}` : ''}
                </span>
                {isFiltered && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="text-[11px] font-medium text-blue-600 hover:text-blue-700 hover:underline"
                    aria-label="Сбросить поиск и фильтр"
                  >
                    Сбросить
                  </button>
                )}
              </div>
              <div className="mb-2 space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Номер, маршрут, груз…"
                    aria-label="Быстрый поиск по заявкам"
                    className="h-9 border-slate-200 bg-white pl-8 pr-8 text-sm placeholder:text-slate-400"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      aria-label="Очистить поиск"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </div>
                <Select
                  value={statusFilter === 'ALL' ? 'ALL' : String(statusFilter)}
                  onValueChange={(v) => setStatusFilter(v === 'ALL' ? 'ALL' : Number(v))}
                >
                  <SelectTrigger aria-label="Фильтр по этапу заявки" className="h-9 w-full border-slate-200 bg-white text-sm">
                    <SelectValue placeholder="Все этапы" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Все этапы</SelectItem>
                    {stageOptions.map((idx) => (
                      <SelectItem key={idx} value={String(idx)}>
                        <span className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${PIPELINE_STAGES[idx].circle}`} aria-hidden />
                          {PIPELINE_STAGES[idx].label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <nav aria-label="Список ваших заявок" className={`max-h-56 space-y-2 overflow-y-auto pr-1 sm:max-h-72 lg:max-h-[calc(100vh-14rem)] ${THIN_SCROLL}`}>
                {visible.map((m) => {
                  const selected = m.id === r.id
                  // цветовые состояния мини-карточки (Task 52/54): красная — перебита,
                  // серые — выход/проигрыш; этап линии — по статусной модели агента
                  const state = cardStateOf(m, now)
                  const stage = displayStageOf(m)
                  const st = PIPELINE_STAGES[stage]
                  // красный фон — только активное перебитие в идущих торгах;
                  // завершённый проигрыш остаётся серым, но со статусом «Ставка перебита»
                  const red = state === 'outbid'
                  const lostOutbidMini = state === 'lost' && lostOutbid(m)
                  const greyMini = state === 'withdrawn' || state === 'lost'
                  const miniCls = red
                    ? `border-red-300 bg-red-50 hover:border-red-400 ${selected ? 'shadow-sm ring-1 ring-red-400' : ''}`
                    : greyMini
                      ? 'border-slate-200 bg-slate-100 hover:border-slate-300'
                      : selected
                        ? 'border-blue-500 bg-blue-50/70 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  const dotCls = red ? 'bg-red-500' : greyMini ? 'bg-slate-400' : st.circle
                  // статусная модель агента (Task 54): перебитым — «Ставка перебита»,
                  // проигранным без перебития — замороженное «Согласование ставки»
                  const miniLabel = red || lostOutbidMini
                    ? 'Ставка перебита'
                    : state === 'withdrawn'
                      ? 'Вы снялись с заявки'
                      : state === 'lost'
                        ? 'Согласование ставки'
                        : state === 'available'
                          ? 'Доступна для отклика'
                          : st.label
                  const labelCls = red || lostOutbidMini ? 'text-red-600' : greyMini ? 'text-slate-500' : state === 'available' ? 'text-sky-700' : 'text-slate-400'
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setActiveId(m.id)}
                      aria-current={selected ? 'true' : undefined}
                      className={`w-full rounded-xl border p-3 text-left transition-colors ${miniCls}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className={`font-mono text-sm font-bold ${red ? 'text-red-700' : greyMini ? 'text-slate-500' : 'text-blue-700'}`}>{m.number}</span>
                        <span className={`h-2 w-2 shrink-0 rounded-full ${dotCls}`} aria-hidden title={red ? 'Ставка перебита' : `Этап: ${st.label}`} />
                      </span>
                      <span className="mt-1 flex items-center gap-1 text-xs text-slate-700">
                        {pointInfo(m.fromPoint).short}
                        <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                        {pointInfo(m.toPoint).short}
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-slate-500">{m.cargo}, {m.tonnage} т</span>
                        <span className="shrink-0 font-semibold text-slate-900">
                          <AnimatedRate value={state === 'available' ? (m.bestRate ?? m.startRate) : m.status === 'PUBLISHED' ? (myBidOf(m)?.amount ?? m.bestRate) : m.bestRate} format={rate} />
                        </span>
                      </span>
                      <span className={`mt-1 block truncate text-[10px] font-semibold uppercase tracking-wide ${labelCls}`}>
                        {miniLabel}
                      </span>
                    </button>
                  )
                })}
              </nav>
            </div>

            <div className="space-y-4">
              {/* Task 54: не выигранные заявки заморожены на «Согласовании ставки» — линия не идёт дальше */}
              <StatusPipeline activeIdx={displayStageOf(r)} request={r} frozen={frozenState} />
            <Card className={cardCls}>
              <CardContent className="space-y-4 p-4 sm:p-6">
                  {/* Шапка карточки */}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-slate-900">Заявка {r.number}</h3>
                        {lost && r.status !== 'PUBLISHED' && (
                          <Badge variant="outline" className="whitespace-nowrap border-slate-300 bg-slate-100 text-slate-600">
                            Забрал другой перевозчик
                          </Badge>
                        )}
                        {/* красный индикатор «Ставка перебита» (Task 52) */}
                        {cardState === 'outbid' && (
                          <Badge variant="outline" className="whitespace-nowrap border-red-300 bg-red-100 text-red-800">
                            <CircleAlert className="mr-1 h-3 w-3" aria-hidden />
                            Ставка перебита
                          </Badge>
                        )}
                        {/* иконка отмены — добровольный выход из идущих торгов (Task 52) */}
                        {bidding && myBid && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-slate-400 hover:text-red-600"
                            title="Отменить участие — выйти из заявки"
                            aria-label={`Отменить участие в заявке ${r.number}`}
                            disabled={busy !== null}
                            onClick={() => setWithdrawReq(r)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        )}
                      </div>
                      <RoutePointsInline from={r.fromPoint} to={r.toPoint} className="mt-1 max-w-xl" />
                      <p className="mt-1 text-sm text-slate-600">{r.cargo}, {r.tonnage} т</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">
                          {available ? (r.bestRate == null ? 'Стартовая ставка' : 'Лучшая на площадке') : bidding ? 'Ваша ставка' : lost ? 'Ставка победителя' : 'Итоговая ставка'}
                        </div>
                        <div className={`text-lg font-bold ${grey ? 'text-slate-500' : 'text-slate-900'}`}>
                          <AnimatedRate value={available ? (r.bestRate ?? r.startRate) : bidding ? (myBid?.amount ?? null) : r.bestRate} format={rate} />
                        </div>
                        {lost && myBid && (
                          <div className="whitespace-nowrap text-xs text-slate-500">ваша ставка: {rate(myBid.amount)}</div>
                        )}
                      </div>
                      {(grey || closed) ? (
                        /* серые карточки (выход/проигрыш) и завершённые рейсы: кнопка «Удалить» —
                           скрыть только из своего кабинета (Task 52/68) */
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 border-slate-300 bg-white text-slate-600 hover:bg-slate-200"
                          onClick={() => hideRequest(r.id)}
                          aria-label={`Удалить карточку заявки ${r.number} из кабинета`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          Удалить
                        </Button>
                      ) : (
                        <RouteButton from={r.fromPoint} to={r.toPoint} number={r.number} />
                      )}
                    </div>
                  </div>

                  {/* Статусная строка для агента */}
                  <div className={`rounded-lg border px-3 py-2 text-sm font-medium ${line.cls}`} role="status">
                    {line.text}
                  </div>

                  {/* ——— Участие в торгах: ставка подана, рейс ещё на площадке.
                      Для серых карточек (выход/проигрыш) блок скрыт (Task 52) ——— */}
                  {bidding && myBid && !grey && (
                    <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
                      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <TrendingDown className="h-4 w-4 text-sky-700" aria-hidden />
                        Участвуете в торгах
                      </h4>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="rounded-lg border border-sky-200 bg-white px-3 py-2">
                          <div className="text-xs text-muted-foreground">Моя ставка</div>
                          <div className="text-base font-bold tabular-nums text-sky-800">
                            <AnimatedRate value={myBid?.amount ?? null} format={rate} />
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <div className="text-xs text-muted-foreground">{r.mode === 'CLOSED' ? 'Ставки конкурентов' : 'Лучшая сейчас'}</div>
                          <div className="flex items-center gap-1.5 text-base font-bold tabular-nums text-slate-900">
                            {r.mode === 'CLOSED' ? (
                              <>
                                <Lock className="h-4 w-4 text-slate-400" aria-hidden />
                                Скрыта
                              </>
                            ) : (
                              <AnimatedRate value={r.bestRate ?? r.startRate} format={rate} />
                            )}
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <div className="text-xs text-muted-foreground">Стартовая</div>
                          <div className="text-base font-bold tabular-nums text-slate-900">{rate(r.startRate)}</div>
                        </div>
                      </div>
                      {r.deadline && (
                        /* «Приём ставок до» — заметная плашка (Task 53): фон, крупный шрифт,
                           срочный вариант красным, когда время заканчивается */
                        <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border px-3 py-2.5 ${tl?.urgent ? 'border-red-300 bg-red-100/80' : 'border-sky-300 bg-sky-100'}`}>
                          <Clock className={`h-5 w-5 shrink-0 ${tl?.urgent ? 'text-red-600' : 'text-sky-700'}`} aria-hidden />
                          <span className={`text-sm font-bold ${tl?.urgent ? 'text-red-800' : 'text-sky-900'}`}>
                            Приём ставок до
                          </span>
                          <span className={`text-base font-extrabold tabular-nums ${tl?.urgent ? 'text-red-900' : 'text-slate-900'}`}>
                            {fmtDateTime(r.deadline)}
                          </span>
                          {tl && (
                            <span className={`ml-auto rounded-full border bg-white px-2.5 py-0.5 text-xs font-bold tabular-nums ${tl.urgent ? 'border-red-300 text-red-700' : 'border-sky-300 text-sky-800'}`}>
                              {tl.text}
                            </span>
                          )}
                        </div>
                      )}
                      <p className="text-xs leading-snug text-slate-600">
                        Когда приём ставок закончится, заявка автоматически уйдёт минимальной ставке — если это ваша, здесь появятся водитель, ТС и документы. До этого можно подать новую, пониженную ставку.
                      </p>
                      <div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          disabled={!r.deadline || (now !== null && Date.parse(r.deadline) <= now)}
                          onClick={() => { setBidReq(r); setBidAmount(''); setBidStep('form') }}
                          aria-label={`Подать новую ставку по заявке ${r.number}`}
                        >
                          <TrendingDown className="h-4 w-4" aria-hidden />
                          Подать новую ставку
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* ——— Доступна для отклика (Task 54): заявка на площадке, агент ещё не ставил ставку ——— */}
                  {available && (
                    <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
                      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <TrendingDown className="h-4 w-4 text-sky-700" aria-hidden />
                        Заявка открыта для отклика
                      </h4>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <div className="text-xs text-muted-foreground">{r.mode === 'CLOSED' ? 'Ставки конкурентов' : 'Лучшая сейчас'}</div>
                          <div className="flex items-center gap-1.5 text-base font-bold tabular-nums text-slate-900">
                            {r.mode === 'CLOSED' ? (
                              <>
                                <Lock className="h-4 w-4 text-slate-400" aria-hidden />
                                Скрыта
                              </>
                            ) : (
                              <AnimatedRate value={r.bestRate ?? r.startRate} format={rate} />
                            )}
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <div className="text-xs text-muted-foreground">Стартовая</div>
                          <div className="text-base font-bold tabular-nums text-slate-900">{rate(r.startRate)}</div>
                        </div>
                      </div>
                      {r.deadline && (
                        <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border px-3 py-2.5 ${tl?.urgent ? 'border-red-300 bg-red-100/80' : 'border-sky-300 bg-sky-100'}`}>
                          <Clock className={`h-5 w-5 shrink-0 ${tl?.urgent ? 'text-red-600' : 'text-sky-700'}`} aria-hidden />
                          <span className={`text-sm font-bold ${tl?.urgent ? 'text-red-800' : 'text-sky-900'}`}>
                            Приём ставок до
                          </span>
                          <span className={`text-base font-extrabold tabular-nums ${tl?.urgent ? 'text-red-900' : 'text-slate-900'}`}>
                            {fmtDateTime(r.deadline)}
                          </span>
                          {tl && (
                            <span className={`ml-auto rounded-full border bg-white px-2.5 py-0.5 text-xs font-bold tabular-nums ${tl.urgent ? 'border-red-300 text-red-700' : 'border-sky-300 text-sky-800'}`}>
                              {tl.text}
                            </span>
                          )}
                        </div>
                      )}
                      <p className="text-xs leading-snug text-slate-600">
                        Подайте ставку — заявка останется в вашем кабинете: здесь видно торги, перебитие ставки и победу.
                      </p>
                      <div>
                        <Button
                          size="sm"
                          disabled={!r.deadline || (now !== null && Date.parse(r.deadline) <= now)}
                          onClick={() => { setBidReq(r); setBidAmount(''); setBidStep('form') }}
                          aria-label={`Сделать ставку по заявке ${r.number}`}
                        >
                          <TrendingDown className="h-4 w-4" aria-hidden />
                          Сделать ставку
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* ——— Подтверждено: агент выиграл тендер (Task 50) ——— */}
                  {awarded && (
                    <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 sm:p-5" role="status">
                      <div className="flex items-start gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm" aria-hidden>
                          <Trophy className="h-6 w-6" />
                        </span>
                        <div className="min-w-0">
                          <h4 className="text-lg font-bold leading-snug text-emerald-900">Вы выиграли!</h4>
                          <p className="mt-0.5 text-sm leading-snug text-emerald-800">
                            Поздравляем: ставка {rate(r.bestRate)} согласована — рейс закреплён за «{carrierName}».
                          </p>
                        </div>
                      </div>

                      {/* Экипаж: что уже выбрано по рейсу */}
                      <div className="rounded-xl border border-emerald-200 bg-white p-3.5">
                        <h5 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                          Экипаж
                        </h5>
                        <div className="mt-2">
                          {r.driverId && r.truckId ? (
                            <CrewChips r={r} carrier={carrier} />
                          ) : (
                            <p className="text-sm text-slate-600">Ещё не назначен — выберите состав, чтобы подготовить рейс.</p>
                          )}
                        </div>
                      </div>

                      <p className="text-sm leading-relaxed text-slate-700">
                        Перейдите к{' '}
                        <span className="font-semibold text-slate-900">«Подать документы»</span>, если требуется
                        загрузить новые данные по новым водителям, ТС или прицепу, или выберите уже имеющегося
                        из раздела{' '}
                        <span className="font-semibold text-slate-900">«Назначение экипажей»</span>.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => onNavigate('apply')}
                          className="gap-1.5"
                          aria-label="Перейти к разделу «Подать документы»"
                        >
                          <Upload className="h-4 w-4" aria-hidden />
                          Подать документы
                        </Button>
                        <Button
                          onClick={() => onNavigate('crew')}
                          variant="outline"
                          className="gap-1.5 border-emerald-200 bg-white hover:bg-emerald-50"
                          aria-label="Перейти к разделу «Назначение экипажей»"
                        >
                          <Users className="h-4 w-4" aria-hidden />
                          Назначение экипажей
                        </Button>
                      </div>

                      {/* Документы: свёрнутый загрузчик — раскрывается, когда пора подавать комплект */}
                      <div className="border-t border-emerald-200 pt-3">
                        <button
                          type="button"
                          onClick={() => setDocsOpenId((cur) => (cur === r.id ? null : r.id))}
                          aria-expanded={docsOpen}
                          className="flex items-center gap-1.5 text-sm font-medium text-emerald-800 transition-colors hover:text-emerald-900"
                          aria-label={`${docsOpen ? 'Скрыть' : 'Открыть'} загрузку документов по заявке ${r.number}`}
                        >
                          {docsOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                          Загрузить документы по заявке
                          {missingDocs.length > 0 && (
                            <span className="text-xs font-normal text-emerald-700">
                              · не загружено: {missingDocs.length} из {DOC_ORDER.length}
                            </span>
                          )}
                        </button>
                        {docsOpen && (
                          <div className="mt-3 space-y-3">
                            {docsSection}
                            {demoButtons}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ——— История заявки: таблица без обрыва, всё видно целиком ——— */}
                  <div className="border-t border-slate-200 pt-3">
                    <button
                      type="button"
                      onClick={() => setTimelineOpen((prev) => ({ ...prev, [r.id]: !(prev[r.id] ?? true) }))}
                      className="flex items-center gap-1.5 text-sm font-medium text-blue-700 transition-colors hover:text-blue-900"
                      aria-expanded={timelineOpen[r.id] ?? true}
                    >
                      <History className="h-4 w-4" aria-hidden />
                      {(timelineOpen[r.id] ?? true) ? 'Скрыть историю' : 'Показать историю'}
                    </button>
                    {(timelineOpen[r.id] ?? true) && (
                      r.events.length === 0 ? (
                        <p className="mt-2 text-sm text-muted-foreground">Событий пока нет</p>
                      ) : (
                        <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-slate-50">
                                <TableHead className="w-[55%]">Событие</TableHead>
                                <TableHead>Ставка</TableHead>
                                <TableHead className="whitespace-nowrap">Дата и время</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {r.events.map((e) => {
                                // события ставок: «ООО «Перевозчик А»: ставка 7 900 ₽/т» → участник + ставка
                                const bid = e.message.match(/^(.*?):\s*ставка\s+([\d\s\u00A0]+)\s*₽/)
                                return (
                                  <TableRow key={e.id}>
                                    <TableCell className="break-words text-slate-800">
                                      {bid ? bid[1].trim() : e.message}
                                    </TableCell>
                                    <TableCell className="whitespace-nowrap font-semibold text-slate-900">
                                      {bid ? `${bid[2].replace(/\s|\u00A0/g, ' ')} ₽/т` : '—'}
                                    </TableCell>
                                    <TableCell className="whitespace-nowrap text-muted-foreground">
                                      {fmtDateTime(e.createdAt)}
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )
                    )}
                  </div>
                </CardContent>
            </Card>
            </div>
          </div>
        )
      })()}

      {/* ——— Окно новой ставки: форма → подтверждение → успех ——— */}
      <Dialog open={bidReq !== null} onOpenChange={(o) => { if (!o) closeBid() }}>
        <DialogContent className="sm:max-w-md">
          {bidReq && bidStep === 'form' && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {bidReq.mode === 'CLOSED' ? 'Закрытая ставка' : 'Новая ставка'} · заявка {bidReq.number}
                </DialogTitle>
                <DialogDescription>
                  {pointInfo(bidReq.fromPoint).short} → {pointInfo(bidReq.toPoint).short}, {bidReq.cargo}
                </DialogDescription>
              </DialogHeader>
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
                    Участники не видят цены друг друга — победителя определит логист по итогам.
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="my-bid-amount">Новая ставка, ₽/т</Label>
                  <Input
                    id="my-bid-amount"
                    type="number"
                    min={2500}
                    max={12000}
                    step={50}
                    inputMode="numeric"
                    placeholder="Например, 8200"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && validateBidAmount() != null) setBidStep('confirm') }}
                  />
                  <p className="text-xs text-muted-foreground">
                    {bidReq.mode === 'CLOSED' ? 'Ставку увидит только логист при подведении итогов' : 'Должна быть ниже текущей лучшей'}
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeBid}>Отмена</Button>
                <Button onClick={() => { if (validateBidAmount() != null) setBidStep('confirm') }} disabled={busy !== null || !bidAmount.trim()}>
                  Подтвердить ставку
                </Button>
              </DialogFooter>
            </>
          )}

          {bidReq && bidStep === 'confirm' && (() => {
            const amount = Math.round(Number(bidAmount.replace(/\s/g, '').replace(',', '.')))
            const floor = bidReq.bestRate ?? bidReq.startRate
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Подтверждение ставки</DialogTitle>
                  <DialogDescription>
                    Проверьте итоговые условия — после подтверждения ставка уйдёт организатору
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-sm font-bold text-blue-700">{bidReq.number}</span>
                      <span className="text-xs text-slate-500">погрузка {bidReq.loadDate} · {bidReq.loadWindow}</span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
                      {pointInfo(bidReq.fromPoint).short}
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                      {pointInfo(bidReq.toPoint).short}
                      <span className="text-slate-300" aria-hidden>·</span>
                      {bidReq.cargo}, {bidReq.tonnage} т
                    </p>
                  </div>
                  <div className="rounded-xl border-2 border-blue-600 bg-blue-50 px-4 py-3 text-center">
                    <div className="text-xs font-medium uppercase tracking-wide text-blue-700">Ваша новая ставка</div>
                    <div className="text-3xl font-bold tabular-nums text-blue-700">{rate(amount)}</div>
                    {bidReq.mode === 'AUCTION' && bidReq.bestRate != null && (
                      <div className="mt-1 text-xs text-blue-800">
                        текущая лучшая {rate(floor)} · экономия для АЭМЗ {rate(floor - amount)}
                      </div>
                    )}
                    {bidReq.mode === 'CLOSED' && (
                      <div className="mt-1 text-xs text-blue-800">цену увидит только логист при подведении итогов</div>
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setBidStep('form')} disabled={busy !== null}>Назад</Button>
                  <Button onClick={() => void doBid()} disabled={busy !== null}>
                    {busy === bidReq.id ? 'Отправляем…' : 'Подтверждаю ставку'}
                  </Button>
                </DialogFooter>
              </>
            )
          })()}

          {bidReq && bidStep === 'success' && (
            <>
              <DialogHeader>
                <DialogTitle>Ставка принята</DialogTitle>
                <DialogDescription>
                  {pointInfo(bidReq.fromPoint).short} → {pointInfo(bidReq.toPoint).short} · заявка {bidReq.number}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-1 text-center" role="status">
                <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" aria-hidden />
                <p className="text-sm font-semibold text-slate-900">
                  {lastBid != null ? <>Новая ставка: <span className="text-emerald-700">{rate(lastBid)}</span></> : 'Новая ставка принята'}
                  {bidReq.mode === 'CLOSED' && ' (закрытая)'}
                </p>
                <p className="text-sm text-slate-600">
                  Заявка остаётся на согласовании ставки — следите за этапом в списке слева
                </p>
              </div>
              <DialogFooter>
                <Button onClick={closeBid}>Закрыть</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* подтверждение добровольного выхода из заявки (Task 52) */}
      <AlertDialog open={!!withdrawReq} onOpenChange={(o) => { if (!o) setWithdrawReq(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Вы точно хотите выйти из заявки?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {withdrawReq && (
                  <>
                    Заявка <b>{withdrawReq.number}</b> ({pointInfo(withdrawReq.fromPoint).short} → {pointInfo(withdrawReq.toPoint).short}).
                    Ваша ставка <b>{rate(myBidOf(withdrawReq)?.amount ?? null)}</b> будет отозвана, торги продолжатся без вас.
                    Вернуться можно новой ставкой на площадке, пока тендер не закрыт.
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={busy !== null}
              onClick={(e) => { e.preventDefault(); void doWithdraw() }}
            >
              {busy === withdrawReq?.id ? 'Отменяем…' : 'Да, выйти'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
