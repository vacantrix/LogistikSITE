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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Car,
  CheckCircle2,
  FileText,
  FileWarning,
  IdCard,
  Info,
  Loader2,
  MapPin,
  RefreshCw,
  Send,
  Sparkles,
  Truck,
  Upload,
  UserRoundPlus,
  XCircle,
} from 'lucide-react'
import { DocStatusBadge, ModeBadge, SectionHeader, StatusBadge, type TabProps } from '@/components/platform/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import DriverIntakeDialog from '@/components/platform/driver-intake'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { demoSampleName, demoSampleUri, fileToCompressedDataUri, sleep } from '@/lib/demo-media'
import { money } from '@/lib/status'
import type { CarrierDTO, DocStatus, DocType, IntakeDocVerdict, RequestDTO } from '@/lib/types'

const DOC_ORDER: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'LICENSE', 'STS']

const SLOT_META: Record<DocType, { label: string; hint: string; icon: typeof IdCard }> = {
  PASSPORT_PHOTO: { label: 'Паспорт: стр. с фото', hint: 'Разворот с фото и ФИО', icon: IdCard },
  PASSPORT_REG: { label: 'Паспорт: регистрация', hint: 'Штамп регистрации', icon: MapPin },
  LICENSE: { label: 'Водительское удостоверение', hint: 'Лицевая сторона ВУ', icon: Car },
  STS: { label: 'СТС тягача', hint: 'Лицевая сторона СТС', icon: FileText },
}

interface SlotState {
  upload: { fileName: string; dataUri: string } | null
  checking: boolean
  verdict: IntakeDocVerdict | null
  error: string | null
}

const EMPTY_SLOT: SlotState = { upload: null, checking: false, verdict: null, error: null }

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

export default function ApplyTab({ activeCarrierId, role, onNavigate }: TabProps) {
  const { toast } = useToast()
  const [requests, setRequests] = useState<RequestDTO[] | null>(null)
  const [carrier, setCarrier] = useState<CarrierDTO | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [requestId, setRequestId] = useState('')
  const [slots, setSlots] = useState<Record<DocType, SlotState>>({
    PASSPORT_PHOTO: EMPTY_SLOT, PASSPORT_REG: EMPTY_SLOT, LICENSE: EMPTY_SLOT, STS: EMPTY_SLOT,
  })
  const [driverId, setDriverId] = useState('')
  const [truckId, setTruckId] = useState('')
  const [trailerId, setTrailerId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<RequestDTO | null>(null)
  const [intakeOpen, setIntakeOpen] = useState(false)
  const fileInputs = useRef<Partial<Record<DocType, HTMLInputElement | null>>>({})

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

  /** Демо: правильные образцы во все 4 слота */
  const fillDemo = () => {
    for (const t of DOC_ORDER) {
      void checkUpload(t, demoSampleName(t), demoSampleUri(t))
    }
    toast({ title: 'Демо-образцы загружены', description: 'Нейросеть проверяет каждый слот — вердикты появятся через секунду' })
  }

  /** Демо-ошибка: в слоты загружены ЧУЖИЕ документы (как в примере агента) */
  const fillDemoMismatch = () => {
    void checkUpload('PASSPORT_REG', 'passport_demo.jpg', demoSampleUri('PASSPORT_PHOTO'))
    void checkUpload('STS', 'license_demo.jpg', demoSampleUri('LICENSE'))
    toast({
      title: 'Документы перепутаны (демо)',
      description: 'В слот «регистрация» загружена страница с фото, в СТС — ВУ. Нейросеть должна выдать ошибку несоответствия.',
      variant: 'destructive',
    })
  }

  const resetAll = () => {
    setSlots({ PASSPORT_PHOTO: EMPTY_SLOT, PASSPORT_REG: EMPTY_SLOT, LICENSE: EMPTY_SLOT, STS: EMPTY_SLOT })
    setRequestId('')
    setDriverId('')
    setTruckId('')
    setTrailerId('')
    setSubmitted(null)
  }

  const selected = useMemo(
    () => requests?.find((r) => r.id === requestId) ?? null,
    [requests, requestId],
  )

  // доступные цели заявки: свои заявки без документов + открытые фиксированные рейсы
  const { mineNeedDocs, openFixed, needBid } = useMemo(() => {
    const all = requests ?? []
    return {
      mineNeedDocs: all.filter((r) => r.winnerId === activeCarrierId && (r.status === 'AWARDED' || r.status === 'DOCS_REVIEW')),
      openFixed: all.filter((r) => r.status === 'PUBLISHED' && r.mode === 'FIXED'),
      needBid: all.filter((r) => r.status === 'PUBLISHED' && (r.mode === 'AUCTION' || r.mode === 'CLOSED')),
    }
  }, [requests, activeCarrierId])

  const drivers = carrier?.drivers ?? []
  const trucks = carrier?.trucks ?? []
  const trailers = carrier?.trailers ?? []

  // готовность: все 4 документа приняты нейросетью (PASSED/MANUAL), выбраны рейс, водитель и тягач
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
  if (!docsOk) blockers.push('проверьте документы — все 4 должны быть приняты')

  const submit = async () => {
    if (!canSubmit || !selected) return
    setSubmitting(true)
    try {
      // 1. если рейс ещё открыт и фиксированный — берём его
      let req = selected
      if (req.status === 'PUBLISHED') {
        const taken = await api.action(req.id, 'take', { carrierId: activeCarrierId })
        req = taken.request
      }
      // 2. назначаем водителя и ТС
      const assigned = await api.action(req.id, 'assign', { carrierId: activeCarrierId, driverId, truckId, trailerId: trailerId || undefined })
      req = assigned.request
      // 3. прикрепляем проверенный комплект документов
      for (const t of DOC_ORDER) {
        const up = slots[t].upload
        if (up) await api.uploadDocument(req.id, { type: t, fileName: up.fileName, dataUri: up.dataUri })
      }
      // 4. прогон нейропроверки платформы и передача логисту
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
        <SectionHeader eyebrow="ЛИНИЯ АГЕНТА · НЕЙРОСЕТЬ ВКЛЮЧЕНА" title="Заявка подана" />
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
      <SectionHeader
        title="Подать заявку"
      >
        <span className="flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700" role="status">
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Нейросеть активна
        </span>
      </SectionHeader>

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
                  <SelectValue placeholder={mineNeedDocs.length + openFixed.length > 0 ? 'Выберите рейс' : 'Нет доступных рейсов'} />
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
                  {openFixed.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Открытые рейсы · фиксированная ставка</SelectLabel>
                      {openFixed.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.number} · {r.fromPoint} → {r.toPoint} · {money(r.startRate)}
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
                <span className="text-xs font-medium text-slate-500">проверено {checkedCount} из 4</span>
              </div>
              <Progress value={(checkedCount / 4) * 100} className="mb-4 h-1.5" aria-label={`Проверено документов: ${checkedCount} из 4`} />

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
                <Button size="sm" variant="outline" className="gap-1.5" onClick={fillDemo}>
                  <Sparkles className="h-4 w-4 text-blue-600" aria-hidden />
                  Демо-образцы (правильные)
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 border-red-200 text-red-700 hover:bg-red-50" onClick={fillDemoMismatch}>
                  <FileWarning className="h-4 w-4" aria-hidden />
                  Демо-ошибка: не тот документ
                </Button>
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
