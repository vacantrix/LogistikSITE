'use client'

/** Раздел «Мои заявки» — кабинет агента: полная история заявок, экипаж, документы, проверка нейросетью */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Archive,
  ArrowRight,
  Car,
  CheckCircle2,
  ChevronDown,
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
  TrendingDown,
  Truck,
  Upload,
  User,
  Users,
  Wrench,
  X,
} from 'lucide-react'
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
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
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
}

const DOC_SHORT: Record<DocType, string> = {
  PASSPORT_PHOTO: 'Паспорт (стр. с фото)',
  PASSPORT_REG: 'Паспорт: регистрация',
  LICENSE: 'Водительское удостоверение',
  STS: 'СТС',
  REQUEST_DOC: 'Заявка (скан)',
  POA: 'Доверенность',
}

const STATUS_ORDER: Record<RequestDTO['status'], number> = {
  PUBLISHED: 0,
  AWARDED: 1,
  DOCS_REVIEW: 1,
  AT_LOGIST: 2,
  CONFIRMED: 3,
  CLOSED: 4,
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
      return { text: 'Назначьте экипаж в разделе «Назначение экипажей» и загрузите документы здесь', cls: 'border-amber-200 bg-amber-50 text-amber-900' }
    case 'DOCS_REVIEW': {
      const bad = r.documents.some((d) => d.status === 'REUPLOAD' || d.status === 'REJECTED')
      return bad
        ? { text: 'Требует исправления: причина по каждому документу, догрузка — в ту же заявку', cls: 'border-amber-300 bg-amber-50 text-amber-900' }
        : { text: 'Нейросеть проверяет документы', cls: 'border-blue-200 bg-blue-50 text-blue-900' }
    }
    case 'AT_LOGIST':
      return { text: 'Комплект у логиста — идёт сверка фото с полями', cls: 'border-blue-200 bg-blue-50 text-blue-900' }
    case 'CONFIRMED':
      return { text: 'Готово — водитель может выезжать на погрузку', cls: 'border-emerald-200 bg-emerald-50 text-emerald-900' }
    default:
      return { text: 'Рейс закрыт', cls: 'border-slate-300 bg-slate-100 text-slate-600' }
  }
}

/** Цвет процента уверенности распознавания */
function confClass(c: number): string {
  if (c >= 0.95) return 'text-emerald-600'
  if (c >= 0.6) return 'text-blue-600'
  return 'text-amber-600'
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

export default function MyRequestsTab({ activeCarrierId, onNavigate }: TabProps) {
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
  const [now, setNow] = useState<number | null>(null)
  const [doneOpen, setDoneOpen] = useState(true)
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
      const { request } = await api.action(bidReq.id, 'bid', { carrierId: activeCarrierId, amount })
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
        ['PASSPORT_REG', sampleSvg('ПАСПОРТ РФ · РЕГИСТРАЦИЯ', ['13.03.2024  230-027', 'Г. АБИНСК, УЛ. ИНТЕРНАЦИОНАЛЬНАЯ', 'Д. 110'], '#0f3b66')],
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
      toast({ title: 'Проверка завершена', description: 'Итоги — в блоке «Результаты проверки нейросети»' })
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

  /** Лучшая (минимальная) ставка активного перевозчика по заявке */
  const myBidOf = useCallback(
    (r: RequestDTO): BidDTO | null => {
      if (!activeCarrierId) return null
      const mine = r.bids.filter((b) => b.carrierId === activeCarrierId)
      if (mine.length === 0) return null
      return mine.reduce((best, b) => (b.amount < best.amount ? b : best))
    },
    [activeCarrierId],
  )

  // Полная история: каждая заявка, где участвовал агент — ставки (в т.ч. перебитые)
  // и выигранные рейсы. Закрытые (отработанные) показываются отдельной подкатегорией ниже.
  const mine = (requests ?? [])
    .filter((r) => r.winnerId === activeCarrierId || r.bids.some((b) => b.carrierId === activeCarrierId))
    .filter((r) => !(r.status === 'CLOSED' && r.winnerId === activeCarrierId))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.updatedAt < b.updatedAt ? 1 : -1))

  /** Отработанные: заявки, которые логист утвердил и закрыл после выполнения */
  const done = (requests ?? [])
    .filter((r) => r.status === 'CLOSED' && r.winnerId === activeCarrierId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))

  // ——— быстрый поиск + фильтр по статусу ———
  const q = query.trim().toLowerCase()
  const isFiltered = q !== '' || statusFilter !== 'ALL'
  const visible = mine.filter((m) => {
    if (statusFilter !== 'ALL' && stageOf(m) !== statusFilter) return false
    if (!q) return true
    const hay = [
      m.number, m.fromPoint, m.toPoint, m.cargo,
      pointInfo(m.fromPoint).short, pointInfo(m.toPoint).short,
      pointInfo(m.fromPoint).address, pointInfo(m.toPoint).address,
    ]
    return hay.some((v) => v.toLowerCase().includes(q))
  })
  const stageOptions = [...new Set(mine.map(stageOf))].sort((a, b) => a - b)
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
            title="Пока нет заявок"
            hint="Подайте ставку на Площадке заявок — заявка сразу появится здесь, даже если торги ещё идут"
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
            {q ? `По запросу «${query.trim()}»` : 'По выбранному этапу'} заявок нет — измените условия или сбросьте фильтр
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
        const lost = !bidding && r.winnerId !== activeCarrierId
        const line = lost
          ? { text: `Рейс забрал другой перевозчик${r.winnerName ? ` (${r.winnerName})` : ''} — заявка остаётся в полной истории`, cls: 'border-slate-300 bg-slate-100 text-slate-600' }
          : agentLine(r, myBid)
        const tl = bidding && now !== null && r.deadline ? timeLeft(r.deadline) : null
        const inControl = !lost && (r.status === 'AWARDED' || r.status === 'DOCS_REVIEW')
        const hasPending = r.documents.some((d) => d.status === 'PENDING')
        const compact = r.status === 'CONFIRMED' || r.status === 'CLOSED'

        return (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
            {/* Список заявок: поиск, фильтр по статусу, прокрутка вниз и выбор нужной */}
            <div className="lg:sticky lg:top-4">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Ваши заявки · {visible.length}{isFiltered ? ` из ${mine.length}` : ''}
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
                  const st = PIPELINE_STAGES[stageOf(m)]
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setActiveId(m.id)}
                      aria-current={selected ? 'true' : undefined}
                      className={`w-full rounded-xl border p-3 text-left transition-colors ${selected ? 'border-blue-500 bg-blue-50/70 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-bold text-blue-700">{m.number}</span>
                        <span className={`h-2 w-2 shrink-0 rounded-full ${st.circle}`} aria-hidden title={`Этап: ${st.label}`} />
                      </span>
                      <span className="mt-1 flex items-center gap-1 text-xs text-slate-700">
                        {pointInfo(m.fromPoint).short}
                        <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                        {pointInfo(m.toPoint).short}
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-slate-500">{m.cargo}, {m.tonnage} т</span>
                        <span className="shrink-0 font-semibold text-slate-900">
                          {m.status === 'PUBLISHED' ? rate(myBidOf(m)?.amount ?? m.bestRate) : rate(m.bestRate)}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        {st.label}
                      </span>
                    </button>
                  )
                })}
              </nav>
            </div>

            <div className="space-y-4">
              <StatusPipeline activeIdx={stageOf(r)} request={r} />
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="space-y-4 p-4 sm:p-6">
                  {/* Шапка карточки */}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-slate-900">Заявка {r.number}</h3>
                        {lost && (
                          <Badge variant="outline" className="whitespace-nowrap border-slate-300 bg-slate-100 text-slate-600">
                            Забрал другой перевозчик
                          </Badge>
                        )}
                      </div>
                      <RoutePointsInline from={r.fromPoint} to={r.toPoint} className="mt-1 max-w-xl" />
                      <p className="mt-1 text-sm text-slate-600">{r.cargo}, {r.tonnage} т</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">{bidding ? 'Ваша ставка' : lost ? 'Ставка победителя' : 'Итоговая ставка'}</div>
                        <div className="text-lg font-bold text-slate-900">{bidding ? rate(myBid?.amount) : rate(r.bestRate)}</div>
                        {lost && myBid && (
                          <div className="whitespace-nowrap text-xs text-slate-500">ваша ставка: {rate(myBid.amount)}</div>
                        )}
                      </div>
                      <RouteButton from={r.fromPoint} to={r.toPoint} number={r.number} />
                    </div>
                  </div>

                  {/* Статусная строка для агента */}
                  <div className={`rounded-lg border px-3 py-2 text-sm font-medium ${line.cls}`} role="status">
                    {line.text}
                  </div>

                  {/* ——— Участие в торгах: ставка подана, рейс ещё на площадке ——— */}
                  {bidding && (
                    <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
                      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <TrendingDown className="h-4 w-4 text-sky-700" aria-hidden />
                        Участвуете в торгах
                      </h4>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="rounded-lg border border-sky-200 bg-white px-3 py-2">
                          <div className="text-xs text-muted-foreground">Моя ставка</div>
                          <div className="text-base font-bold tabular-nums text-sky-800">{rate(myBid?.amount)}</div>
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
                              rate(r.bestRate ?? r.startRate)
                            )}
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <div className="text-xs text-muted-foreground">Стартовая</div>
                          <div className="text-base font-bold tabular-nums text-slate-900">{rate(r.startRate)}</div>
                        </div>
                      </div>
                      {r.deadline && (
                        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                          <Clock className="h-4 w-4 text-sky-700" aria-hidden />
                          <span>Приём ставок до {fmtDateTime(r.deadline)}</span>
                          {tl && (
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${tl.urgent ? 'border-red-200 bg-red-50 text-red-700' : 'border-sky-200 bg-white text-sky-800'}`}>
                              {tl.text}
                            </span>
                          )}
                        </div>
                      )}
                      <p className="text-xs leading-snug text-slate-600">
                        Как только логист согласует ставку, заявка перейдёт в работу — здесь появятся водитель, ТС и документы. До этого можно подать новую, пониженную ставку.
                      </p>
                      <div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => { setBidReq(r); setBidAmount(''); setBidStep('form') }}
                          aria-label={`Подать новую ставку по заявке ${r.number}`}
                        >
                          <TrendingDown className="h-4 w-4" aria-hidden />
                          Подать новую ставку
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Компактные бейджи для подтверждённых/закрытых заявок */}
                  {compact && (
                    <div className="flex flex-wrap gap-2">
                      {r.passPackage && (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                          Пакет на пропуск сформирован
                        </Badge>
                      )}
                      {r.etrnStatus === 'SENT' && (
                        <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-800">
                          ЭТрН отправлена
                        </Badge>
                      )}
                      {r.etrnStatus === 'SIGNED' && (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                          ЭТрН подписана
                        </Badge>
                      )}
                      {r.winnerName && (
                        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                          Перевозчик: {r.winnerName}
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Экипаж закрытого/подтверждённого рейса — в истории */}
                  {compact && !lost && r.driverId && <CrewChips r={r} carrier={carrier} />}

                  {/* ——— Панель заявки в работе (AWARDED / DOCS_REVIEW) ——— */}
                  {inControl && (
                    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                      {/* a) Экипаж: только справочная информация — назначение выполняется в отдельном разделе */}
                      <div>
                        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <Users className="h-4 w-4 text-blue-600" aria-hidden />
                          Экипаж
                        </h4>
                        {r.driverId && r.truckId ? (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5">
                            <CrewChips r={r} carrier={carrier} />
                          </div>
                        ) : (
                          <p className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs leading-snug text-slate-500">
                            Экипаж ещё не назначен — состав выбирается в разделе «Назначение экипажей».
                          </p>
                        )}
                      </div>

                      {/* b) Документы — 4 слота */}
                      <div>
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                            <FileText className="h-4 w-4 text-blue-600" aria-hidden />
                            Документы (6 файлов к заявке)
                          </h4>
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
                                className={`flex flex-col rounded-xl border p-3 ${doc ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-white/70'}`}
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
                                    <Badge variant="outline" className="border-slate-200 bg-slate-100 text-[10px] text-slate-500">Не загружен</Badge>
                                  )}
                                </div>

                                {doc && (
                                  <img
                                    src={doc.dataUri}
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

                      {/* c) Демо-кнопки */}
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
                    </div>
                  )}

                  {/* ——— Результаты проверки нейросети ——— */}
                  {r.documents.length > 0 && (
                    <div className="rounded-xl border border-slate-200 p-4">
                      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <Sparkles className="h-4 w-4 text-blue-600" aria-hidden />
                        Результаты проверки нейросети
                      </h4>
                      <div className="space-y-3">
                        {r.documents.map((doc) => (
                          <div key={doc.id} className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900">{DOC_TYPE_LABEL[doc.type]}</span>
                              <DocStatusBadge status={doc.status} />
                              {doc.engine && (
                                <Badge variant="outline" className="border-slate-200 text-[11px] font-normal text-slate-500">
                                  движок: {doc.engine}
                                </Badge>
                              )}
                              {doc.quality != null && (
                                <span className="text-xs text-muted-foreground">качество фото: {doc.quality}</span>
                              )}
                            </div>
                            {doc.message && <p className="mt-1 text-xs text-slate-600">{doc.message}</p>}
                            {doc.fields && Object.keys(doc.fields).length > 0 && (
                              <div className="mt-2 overflow-x-auto rounded-md border border-slate-200">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="h-8 text-xs">Поле</TableHead>
                                      <TableHead className="h-8 text-xs">С документа</TableHead>
                                      <TableHead className="h-8 text-xs">Уверенность</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {Object.entries(doc.fields).map(([k, v]) => {
                                      const c = doc.confidence?.[k]
                                      return (
                                        <TableRow key={k}>
                                          <TableCell className="py-1.5 text-xs text-slate-600">{k}</TableCell>
                                          <TableCell className="py-1.5 text-xs font-medium text-slate-900">{v || '—'}</TableCell>
                                          <TableCell className="py-1.5">
                                            {c != null ? (
                                              <span className={`text-xs font-semibold ${confClass(c)}`}>{Math.round(c * 100)}%</span>
                                            ) : (
                                              <span className="text-xs text-muted-foreground">—</span>
                                            )}
                                          </TableCell>
                                        </TableRow>
                                      )
                                    })}
                                  </TableBody>
                                </Table>
                              </div>
                            )}
                            {doc.issues.length > 0 && (
                              <ul className="mt-2 space-y-0.5">
                                {doc.issues.map((is, i) => (
                                  <li key={i} className={`text-xs ${issueClass(doc.status)}`}>• {is}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
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

      {/* ——— Отработанные: заявки, утверждённые логистом и закрытые после выполнения ——— */}
      {!loading && !error && requests && activeCarrierId && done.length > 0 && (() => {
        const closedCarrier = carriers.find((c) => c.id === activeCarrierId) ?? null
        return (
          <section aria-label="Отработанные заявки" className="mt-8">
            <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
              <button
                type="button"
                onClick={() => setDoneOpen((o) => !o)}
                aria-expanded={doneOpen}
                className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 transition-colors hover:text-slate-700"
              >
                <Archive className="h-4 w-4 text-slate-400" aria-hidden />
                Отработанные · {done.length}
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${doneOpen ? 'rotate-180' : ''}`} aria-hidden />
              </button>
            </div>
            {doneOpen ? (
              <div className={`overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm ${THIN_SCROLL}`}>
                <Table className="min-w-[900px]">
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>Заявка</TableHead>
                      <TableHead>Маршрут</TableHead>
                      <TableHead>Груз</TableHead>
                      <TableHead>Ставка</TableHead>
                      <TableHead>Погрузка</TableHead>
                      <TableHead>Экипаж</TableHead>
                      <TableHead>Закрыта</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {done.map((r) => {
                      const d = closedCarrier?.drivers.find((x) => x.id === r.driverId)
                      const t = closedCarrier?.trucks.find((x) => x.id === r.truckId)
                      const z = closedCarrier?.trailers.find((x) => x.id === r.trailerId)
                      const crew = [d?.fullName, t ? `${t.brand} · ${t.plate}` : '', z ? `${z.plate} · ${z.type}` : ''].filter(Boolean).join(' · ')
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap font-mono text-sm font-bold text-blue-700">{r.number}</TableCell>
                          <TableCell className="whitespace-nowrap text-slate-600">
                            {pointInfo(r.fromPoint).short} → {pointInfo(r.toPoint).short}
                          </TableCell>
                          <TableCell className="text-slate-700">{r.cargo}, {r.tonnage} т</TableCell>
                          <TableCell className="whitespace-nowrap font-semibold tabular-nums text-slate-900">{rate(r.bestRate ?? r.startRate)}</TableCell>
                          <TableCell className="whitespace-nowrap text-slate-600">{r.loadDate}, {r.loadWindow}</TableCell>
                          <TableCell className="max-w-[260px] truncate text-slate-600" title={crew || undefined}>{crew || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.updatedAt)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="px-1 text-xs text-slate-400">
                Список свёрнут — раскройте, чтобы посмотреть все закрытые рейсы с маршрутами, ставками и экипажами.
              </p>
            )}
          </section>
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
    </section>
  )
}
