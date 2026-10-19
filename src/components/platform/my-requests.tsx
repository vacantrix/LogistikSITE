'use client'

/** Раздел «Мои заявки» — кабинет агента: водитель и ТС, документы, проверка нейросетью */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Car,
  FileText,
  FileX,
  History,
  IdCard,
  Loader2,
  MapPin,
  ScanLine,
  Send,
  Sparkles,
  Truck,
  Upload,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  DocStatusBadge,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  ModeBadge,
  SectionHeader,
  StatusBadge,
  type TabProps,
} from '@/components/platform/common'
import DriverIntakeDialog from '@/components/platform/driver-intake'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { fileToCompressedDataUri, sampleSvg } from '@/lib/demo-media'
import { DOC_TYPE_LABEL, fmtDateTime, money } from '@/lib/status'
import type { CarrierDTO, DocStatus, DocType, RequestDTO } from '@/lib/types'

const DOC_ORDER: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'LICENSE', 'STS']

const DOC_ICONS: Record<DocType, typeof IdCard> = {
  PASSPORT_PHOTO: IdCard,
  PASSPORT_REG: MapPin,
  LICENSE: Car,
  STS: FileText,
}

const DOC_SHORT: Record<DocType, string> = {
  PASSPORT_PHOTO: 'Паспорт (стр. с фото)',
  PASSPORT_REG: 'Паспорт: регистрация',
  LICENSE: 'Водительское удостоверение',
  STS: 'СТС',
}

const STATUS_ORDER: Record<RequestDTO['status'], number> = {
  AWARDED: 0,
  DOCS_REVIEW: 0,
  AT_LOGIST: 1,
  CONFIRMED: 2,
  CLOSED: 3,
  PUBLISHED: 4,
}

const TRAILER_NONE = 'NONE'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300'

interface SelState {
  driverId?: string
  truckId?: string
  trailerId?: string
}

/** Текст-подсказка для агента по статусу заявки */
function agentLine(r: RequestDTO): { text: string; cls: string } {
  switch (r.status) {
    case 'AWARDED':
      return { text: 'Укажите водителя и ТС, загрузите документы', cls: 'border-amber-200 bg-amber-50 text-amber-900' }
    case 'DOCS_REVIEW': {
      const bad = r.documents.some((d) => d.status === 'REUPLOAD' || d.status === 'REJECTED')
      return bad
        ? { text: 'Требует исправления: причина по каждому документу, догрузка — в ту же заявку', cls: 'border-amber-300 bg-amber-50 text-amber-900' }
        : { text: 'Нейросеть проверяет документы', cls: 'border-blue-200 bg-blue-50 text-blue-900' }
    }
    case 'AT_LOGIST':
      return { text: 'Комплект у логиста — идёт сверка фото с полями', cls: 'border-blue-200 bg-blue-50 text-blue-900' }
    case 'CONFIRMED':
      return { text: 'Принята — данные переданы в 1С', cls: 'border-emerald-200 bg-emerald-50 text-emerald-900' }
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
}

export default function MyRequestsTab({ activeCarrierId, onNavigate }: TabProps) {
  const { toast } = useToast()
  const [requests, setRequests] = useState<RequestDTO[] | null>(null)
  const [carriers, setCarriers] = useState<CarrierDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [sel, setSel] = useState<Record<string, SelState>>({})
  const [timelineOpen, setTimelineOpen] = useState<Record<string, boolean>>({})
  const [intakeReq, setIntakeReq] = useState<RequestDTO | null>(null)
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})

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

  // ——— демо: комплект из 4 образцов ———
  const runDemo = async (r: RequestDTO) => {
    setBusy(`${r.id}:demo`)
    try {
      const samples: [DocType, string][] = [
        ['PASSPORT_PHOTO', sampleSvg('ПАСПОРТ РФ · СТР. С ФОТО', ['ИВАНОВ ИВАН ИВАНОВИЧ', '15.05.1990', '99 12 345678'], '#0f3b66')],
        ['PASSPORT_REG', sampleSvg('ПАСПОРТ РФ · РЕГИСТРАЦИЯ', ['13.03.2024  230-027', 'Г. АБИНСК, УЛ. ИНТЕРНАЦИОНАЛЬНАЯ', 'Д. 110'], '#0f3b66')],
        ['LICENSE', sampleSvg('ВОДИТЕЛЬСКОЕ УДОСТОВЕРЕНИЕ', ['ИВАНОВ ИВАН ИВАНОВИЧ', '15.05.1990', '99 12 345678', 'C, CE'], '#5b3413')],
        ['STS', sampleSvg('СТС ТЯГАЧА', ['А123ВС777', 'X9622277XKG123456', '99 00 123456'], '#14532d')],
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

  // ——— сохранить водителя и ТС ———
  const doAssign = async (r: RequestDTO, s: SelState) => {
    if (!s.driverId || !s.truckId) return
    setBusy(`${r.id}:assign`)
    try {
      const { request } = await api.action(r.id, 'assign', {
        driverId: s.driverId,
        truckId: s.truckId,
        trailerId: s.trailerId && s.trailerId !== TRAILER_NONE ? s.trailerId : undefined,
      })
      applyRequest(request)
      toast({ title: 'Данные сохранены', description: `${r.number}: водитель и автомобиль указаны` })
    } catch (e) {
      toast({ title: 'Ошибка', description: errMsg(e), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  // ——— мастер «Добавить водителя с нейросетью» сохранил водителя ———
  const handleIntakeSaved = useCallback((res: { driverId: string; truckId?: string; request?: RequestDTO }) => {
    if (res.request) applyRequest(res.request)
    if (intakeReq) {
      setSel((prev) => ({
        ...prev,
        [intakeReq.id]: { driverId: res.driverId, truckId: res.truckId, trailerId: TRAILER_NONE },
      }))
    }
    void load() // справочник: подтянуть нового водителя и тягач
  }, [applyRequest, intakeReq, load])

  const carrier = carriers.find((c) => c.id === activeCarrierId) ?? null
  const carrierName = carrier?.name ?? 'перевозчик'

  const mine = (requests ?? [])
    .filter((r) => r.winnerId === activeCarrierId && r.status !== 'PUBLISHED')
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.updatedAt < b.updatedAt ? 1 : -1))

  return (
    <section aria-label="Мои заявки — кабинет агента">
      <SectionHeader
        eyebrow="КАБИНЕТ АГЕНТА"
        title={`Мои заявки · ${carrierName}`}
        desc="Выигранные заявки, водитель и машина, документы и статусы — всё в личном кабинете"
      />

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
            title="Пока нет выигранных заявок"
            hint="Перейдите на Площадку заявок: возьмите заявку с фиксированной ставкой или выиграйте торги"
          />
          <div className="flex justify-center">
            <Button onClick={() => onNavigate('board')} className="gap-2" aria-label="Перейти к площадке заявок">
              <Truck className="h-4 w-4" aria-hidden />
              К площадке заявок
            </Button>
          </div>
        </div>
      )}

      {!loading && !error && requests && activeCarrierId && mine.length > 0 && (
        <div className="space-y-5">
          {mine.map((r) => {
            const s: SelState = sel[r.id] ?? {
              driverId: r.driverId ?? undefined,
              truckId: r.truckId ?? undefined,
              trailerId: r.trailerId ?? TRAILER_NONE,
            }
            const line = agentLine(r)
            const inControl = r.status === 'AWARDED' || r.status === 'DOCS_REVIEW'
            const hasPending = r.documents.some((d) => d.status === 'PENDING')
            const compact = r.status === 'CONFIRMED' || r.status === 'CLOSED'

            return (
              <Card key={r.id} className="border-slate-200 shadow-sm">
                <CardContent className="space-y-4 p-4 sm:p-6">
                  {/* Шапка карточки */}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-slate-900">Заявка {r.number}</h3>
                        <ModeBadge mode={r.mode} />
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-600">
                        {r.fromPoint}
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                        {r.toPoint}
                        <span className="text-slate-300" aria-hidden>·</span>
                        {r.cargo}, {r.tonnage} т
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Итоговая ставка</div>
                      <div className="text-lg font-bold text-slate-900">{money(r.bestRate)}</div>
                    </div>
                  </div>

                  {/* Статусная строка для агента */}
                  <div className={`rounded-lg border px-3 py-2 text-sm font-medium ${line.cls}`} role="status">
                    {line.text}
                  </div>

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

                  {/* ——— Панель управления (AWARDED / DOCS_REVIEW) ——— */}
                  {inControl && (
                    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                      {/* a) Водитель и автомобиль */}
                      <div>
                        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <Users className="h-4 w-4 text-blue-600" aria-hidden />
                          Водитель и автомобиль
                        </h4>

                        {/* Основной путь: добавление водителя сразу с нейросетью */}
                        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/70 p-3.5">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                                <ScanLine className="h-4 w-4 text-blue-700" aria-hidden />
                                Добавить водителя по документам
                              </div>
                              <p className="mt-0.5 max-w-xl text-xs leading-snug text-slate-600">
                                Загрузите паспорт, ВУ и СТС — нейросеть сама прочитает их, заполнит карточку водителя и тягача,
                                сверит данные и приложит документы к заявке. Вводить вручную не нужно.
                              </p>
                            </div>
                            <Button
                              size="sm"
                              className="gap-1.5"
                              disabled={busy !== null}
                              onClick={() => setIntakeReq(r)}
                              aria-label={`Добавить водителя с нейросетью по заявке ${r.number}`}
                            >
                              <ScanLine className="h-4 w-4" aria-hidden />
                              Добавить водителя
                            </Button>
                          </div>
                        </div>

                        <div className="mb-2 flex items-center gap-3" aria-hidden>
                          <span className="text-[11px] uppercase tracking-wide text-slate-400">или выберите из справочника (повторная перевозка)</span>
                          <span className="h-px flex-1 bg-slate-200" />
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div className="space-y-1.5">
                            <Label htmlFor={`driver-${r.id}`}>Водитель</Label>
                            <Select
                              value={s.driverId ?? ''}
                              onValueChange={(v) => setSel((prev) => ({ ...prev, [r.id]: { ...s, driverId: v } }))}
                            >
                              <SelectTrigger id={`driver-${r.id}`} aria-label="Выбор водителя">
                                <SelectValue placeholder="Выберите водителя" />
                              </SelectTrigger>
                              <SelectContent>
                                {carrier?.drivers.map((d) => (
                                  <SelectItem key={d.id} value={d.id}>{d.fullName}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`truck-${r.id}`}>Тягач</Label>
                            <Select
                              value={s.truckId ?? ''}
                              onValueChange={(v) => setSel((prev) => ({ ...prev, [r.id]: { ...s, truckId: v } }))}
                            >
                              <SelectTrigger id={`truck-${r.id}`} aria-label="Выбор тягача">
                                <SelectValue placeholder="Выберите тягач" />
                              </SelectTrigger>
                              <SelectContent>
                                {carrier?.trucks.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>{`${t.brand} · ${t.plate}`}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`trailer-${r.id}`}>Прицеп (опционально)</Label>
                            <Select
                              value={s.trailerId ?? TRAILER_NONE}
                              onValueChange={(v) => setSel((prev) => ({ ...prev, [r.id]: { ...s, trailerId: v } }))}
                            >
                              <SelectTrigger id={`trailer-${r.id}`} aria-label="Выбор прицепа">
                                <SelectValue placeholder="Без прицепа" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={TRAILER_NONE}>Без прицепа</SelectItem>
                                {carrier?.trailers.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>{`${t.plate} · ${t.type}`}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            disabled={!s.driverId || !s.truckId || busy !== null}
                            onClick={() => void doAssign(r, s)}
                            aria-label={`Сохранить водителя и автомобиль по заявке ${r.number}`}
                          >
                            {busy === `${r.id}:assign` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                            Сохранить данные
                          </Button>
                          <span className="text-xs text-muted-foreground">С этими данными нейросеть сверит документы</span>
                        </div>
                      </div>

                      {/* b) Документы — 4 слота */}
                      <div>
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                            <FileText className="h-4 w-4 text-blue-600" aria-hidden />
                            Документы (4 файла к заявке)
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
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

                  {/* ——— История заявки ——— */}
                  <div className="border-t border-slate-200 pt-3">
                    <button
                      type="button"
                      onClick={() => setTimelineOpen((prev) => ({ ...prev, [r.id]: !prev[r.id] }))}
                      className="flex items-center gap-1.5 text-sm font-medium text-blue-700 transition-colors hover:text-blue-900"
                      aria-expanded={!!timelineOpen[r.id]}
                    >
                      <History className="h-4 w-4" aria-hidden />
                      {timelineOpen[r.id] ? 'Скрыть историю' : 'Показать историю'}
                    </button>
                    {timelineOpen[r.id] && (
                      r.events.length === 0 ? (
                        <p className="mt-2 text-sm text-muted-foreground">Событий пока нет</p>
                      ) : (
                        <ul className={`ml-1 mt-2 max-h-40 space-y-1.5 overflow-y-auto border-l-2 border-slate-200 pl-3 pr-1 ${THIN_SCROLL}`}>
                          {r.events.map((e) => (
                            <li key={e.id} className="relative text-xs leading-snug">
                              <span className="absolute -left-[19px] top-1.5 h-2 w-2 rounded-full bg-blue-600" aria-hidden />
                              <span className="text-slate-800">{e.message}</span>
                              <span className="ml-2 whitespace-nowrap text-muted-foreground">{fmtDateTime(e.createdAt)}</span>
                            </li>
                          ))}
                        </ul>
                      )
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Мастер «Добавить водителя с нейросетью» */}
      <DriverIntakeDialog
        open={intakeReq !== null}
        onOpenChange={(o) => { if (!o) setIntakeReq(null) }}
        carriers={carriers}
        defaultCarrierId={activeCarrierId}
        lockCarrier
        request={intakeReq}
        onSaved={handleIntakeSaved}
      />
    </section>
  )
}
