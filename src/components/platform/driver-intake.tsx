'use client'

/**
 * Мастер «Добавить водителя с нейросетью».
 *
 * Интерфейс построен вокруг нейросети: агент загружает фото документов
 * (паспорт, ВУ, опционально СТС и регистрацию) → нейросеть распознаёт их,
 * сама заполняет карточку водителя и тягача и сверяет данные между собой →
 * агент проверяет распознанное и подтверждает → водитель попадает в справочник,
 * а по заявке — сразу назначается, документы прикрепляются и уходят на проверку.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Car,
  CheckCircle2,
  FileText,
  IdCard,
  Loader2,
  MapPin,
  RotateCcw,
  ScanLine,
  Send,
  ShieldCheck,
  Sparkles,
  Truck,
  Upload,
  User,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DocStatusBadge } from '@/components/platform/common'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { fileToCompressedDataUri, DEMO_DOC_SAMPLES, sampleSvg, sleep } from '@/lib/demo-media'
import { DOC_TYPE_LABEL } from '@/lib/status'
import type {
  CarrierDTO, DocStatus, DocType, DriverIntakeSaved, IntakeDocVerdict, IntakeDriverDraft, IntakeResult, IntakeTruckDraft, RequestDTO,
} from '@/lib/types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300'

const SCAN_STAGES = [
  'Читаем паспорт…',
  'Читаем водительское удостоверение…',
  'Сверяем данные между собой…',
]

/** Демо-образцы: { [вид документа]: { fileName, title, lines, accent } } */
const DEMO: Record<DocType, { fileName: string; title: string; lines: string[]; accent: string }> = Object.fromEntries(
  DEMO_DOC_SAMPLES.map((s) => [s.type, { fileName: s.fileName, title: s.title, lines: s.lines, accent: s.accent }]),
) as Record<DocType, { fileName: string; title: string; lines: string[]; accent: string }>

interface Upload {
  fileName: string
  dataUri: string
}

type Uploads = Partial<Record<DocType, Upload>>

interface DriverField {
  key: keyof Pick<IntakeDriverDraft, 'fullName' | 'birthDate' | 'passport' | 'license' | 'licenseTill' | 'categories'>
  label: string
  placeholder: string
  mono?: boolean
  wide?: boolean
}

const DRIVER_FIELDS: DriverField[] = [
  { key: 'fullName', label: 'ФИО', placeholder: 'Фамилия Имя Отчество', wide: true },
  { key: 'birthDate', label: 'Дата рождения', placeholder: 'ДД.ММ.ГГГГ', mono: true },
  { key: 'passport', label: 'Паспорт (серия и номер)', placeholder: '52 07 987654', mono: true },
  { key: 'license', label: 'Номер ВУ', placeholder: '52 10 555444', mono: true },
  { key: 'licenseTill', label: 'ВУ действует до', placeholder: 'ДД.ММ.ГГГГ', mono: true },
  { key: 'categories', label: 'Категории', placeholder: 'C, CE' },
]

interface TruckField {
  key: keyof Pick<IntakeTruckDraft, 'brand' | 'plate' | 'vin' | 'sts' | 'owner'>
  label: string
  placeholder: string
  mono?: boolean
  wide?: boolean
}

const TRUCK_FIELDS: TruckField[] = [
  { key: 'brand', label: 'Марка', placeholder: 'MAN TGX' },
  { key: 'plate', label: 'Госномер', placeholder: 'А321ВС777', mono: true },
  { key: 'vin', label: 'VIN', placeholder: '17 символов', mono: true, wide: true },
  { key: 'sts', label: 'Номер СТС', placeholder: '99 00 654321', mono: true },
  { key: 'owner', label: 'Собственник', placeholder: 'ООО «Перевозчик»', wide: true },
]

/** Цвет процента уверенности распознавания */
function confCls(c: number): string {
  if (c >= 0.95) return 'text-emerald-600'
  if (c >= 0.6) return 'text-blue-600'
  return 'text-amber-600'
}

function ConfChip({ c }: { c: number }) {
  if (!c) return <span className="text-[10px] font-semibold text-slate-400">не распознано</span>
  return <span className={`text-[10px] font-semibold ${confCls(c)}`}>{Math.round(c * 100)}%</span>
}

function FieldInput({ id, label, placeholder, value, conf, mono, wide, onChange }: {
  id: string
  label: string
  placeholder: string
  value: string
  conf?: number
  mono?: boolean
  wide?: boolean
  onChange: (v: string) => void
}) {
  return (
    <div className={`space-y-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs text-slate-600">{label}</Label>
        <ConfChip c={conf ?? 0} />
      </div>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={mono ? 'font-mono text-sm' : 'text-sm'}
        aria-label={label}
      />
    </div>
  )
}

function VerdictRow({ type, verdict, upload }: { type: DocType; verdict: IntakeDocVerdict; upload?: Upload }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-2.5">
      {upload && (
        <img src={upload.dataUri} alt={`Документ «${DOC_TYPE_LABEL[type]}»`} className="h-14 w-20 shrink-0 rounded-md border border-slate-200 object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-800">{DOC_TYPE_LABEL[type]}</span>
          <DocStatusBadge status={verdict.status} />
          <span className="text-[11px] text-muted-foreground">качество: {verdict.quality} · {verdict.engine}</span>
        </div>
        {verdict.message && <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{verdict.message}</p>}
        {verdict.issues.slice(0, 2).map((is, i) => (
          <p key={i} className={`text-[11px] leading-snug ${verdict.status === 'REJECTED' ? 'text-red-600' : verdict.status === 'REUPLOAD' ? 'text-amber-600' : 'text-blue-600'}`}>• {is}</p>
        ))}
      </div>
    </div>
  )
}

export interface DriverIntakeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  carriers: CarrierDTO[]
  /** перевозчик по умолчанию (активный в шапке) */
  defaultCarrierId?: string | null
  /** запретить менять перевозчика (в кабинете агента) */
  lockCarrier?: boolean
  /** заявка: включает назначение водителя, прикрепление документов и проверку */
  request?: RequestDTO | null
  onSaved: (res: DriverIntakeSaved) => void
}

export default function DriverIntakeDialog({ open, onOpenChange, carriers, defaultCarrierId, lockCarrier, request, onSaved }: DriverIntakeDialogProps) {
  const { toast } = useToast()
  const [step, setStep] = useState<'docs' | 'scan' | 'review'>('docs')
  const [carrierId, setCarrierId] = useState('')
  const [uploads, setUploads] = useState<Uploads>({})
  const [scanStage, setScanStage] = useState(SCAN_STAGES[0])
  const [result, setResult] = useState<IntakeResult | null>(null)
  const [draftDriver, setDraftDriver] = useState<IntakeDriverDraft | null>(null)
  const [draftTruck, setDraftTruck] = useState<IntakeTruckDraft | null>(null)
  const [attach, setAttach] = useState(true)
  const [saving, setSaving] = useState(false)
  const fileInputs = useRef<Partial<Record<DocType, HTMLInputElement | null>>>({})

  const canRecognize = !!(carrierId && uploads.PASSPORT_PHOTO && uploads.LICENSE)

  // сброс и инициализация при открытии
  useEffect(() => {
    if (!open) return
    setStep('docs')
    setUploads({})
    setResult(null)
    setDraftDriver(null)
    setDraftTruck(null)
    setAttach(true)
    setSaving(false)
    setCarrierId(defaultCarrierId ?? carriers[0]?.id ?? '')
  }, [open, defaultCarrierId, carriers])

  // анимация этапов сканирования
  useEffect(() => {
    if (step !== 'scan') return
    let i = 0
    setScanStage(SCAN_STAGES[0])
    const iv = setInterval(() => {
      i = (i + 1) % SCAN_STAGES.length
      setScanStage(SCAN_STAGES[i])
    }, 700)
    return () => clearInterval(iv)
  }, [step])

  const setUpload = useCallback((type: DocType, up: Upload | null) => {
    setUploads((prev) => {
      const next = { ...prev }
      if (up) next[type] = up
      else delete next[type]
      return next
    })
  }, [])

  const handleFile = async (type: DocType, file: File) => {
    try {
      const dataUri = await fileToCompressedDataUri(file)
      setUpload(type, { fileName: file.name, dataUri })
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : 'Не удалось прочитать файл', variant: 'destructive' })
    }
  }

  const fillDemo = () => {
    // intake — только документы водителя/тягача: паспорт, ВУ, СТС, регистрация
    const intakeTypes: DocType[] = ['PASSPORT_PHOTO', 'LICENSE', 'STS', 'PASSPORT_REG']
    setUploads(Object.fromEntries(
      intakeTypes.map((t) => [t, { fileName: DEMO[t].fileName, dataUri: sampleSvg(DEMO[t].title, DEMO[t].lines, DEMO[t].accent) }]),
    ))
    toast({ title: 'Демо-образцы загружены', description: 'Паспорт, ВУ и СТС водителя Петрова П.С. — нажмите «Распознать документы»' })
  }

  const recognize = async () => {
    if (!canRecognize) return
    setStep('scan')
    try {
      const [res] = await Promise.all([
        api.intakeDriver(Object.fromEntries(Object.entries(uploads).filter(([, v]) => v)) as Partial<Record<string, Upload>>),
        sleep(2200), // минимальное время «работы» нейросети для наглядности
      ])
      setResult(res)
      setDraftDriver(res.driver)
      setDraftTruck(res.truck)
      setStep('review')
      const bad = res.documents.filter((d) => d.status === 'REUPLOAD' || d.status === 'REJECTED')
      if (bad.length > 0) {
        toast({
          title: 'Часть документов не прошла проверку',
          description: `${bad.map((d) => DOC_TYPE_LABEL[d.type]).join(', ')} — замените фото или введите данные вручную`,
          variant: 'destructive',
        })
      } else {
        toast({ title: 'Нейросеть заполнила карточку водителя', description: 'Проверьте распознанные поля и подтвердите' })
      }
    } catch (e) {
      setStep('docs')
      toast({ title: 'Ошибка распознавания', description: e instanceof Error ? e.message : 'Неизвестная ошибка', variant: 'destructive' })
    }
  }

  const save = async () => {
    if (!draftDriver || !carrierId) return
    setSaving(true)
    try {
      const driverRes = await api.createDirectory('driver', {
        carrierId,
        fullName: draftDriver.fullName,
        birthDate: draftDriver.birthDate,
        passport: draftDriver.passport,
        license: draftDriver.license,
        licenseTill: draftDriver.licenseTill,
        categories: draftDriver.categories,
      })
      const driverId = driverRes.driver?.id
      if (!driverId) throw new Error('Не удалось сохранить водителя')

      let truckId: string | undefined
      if (draftTruck?.plate) {
        const truckRes = await api.createDirectory('truck', {
          carrierId,
          brand: draftTruck.brand,
          plate: draftTruck.plate,
          vin: draftTruck.vin,
          sts: draftTruck.sts,
          owner: draftTruck.owner,
        })
        truckId = truckRes.truck?.id
      }

      let savedRequest: RequestDTO | undefined
      const attachToRequest = !!(request && attach)
      if (attachToRequest) {
        const a = await api.action(request!.id, 'assign', { driverId, truckId })
        savedRequest = a.request
        for (const [type, up] of Object.entries(uploads)) {
          if (!up) continue
          const r = await api.uploadDocument(request!.id, { type, fileName: up.fileName, dataUri: up.dataUri })
          savedRequest = r.request
        }
        const v = await api.verifyDocuments(request!.id)
        savedRequest = v.request
      }

      toast({
        title: 'Водитель сохранён в справочнике',
        description: attachToRequest
          ? `${request!.number}: карточка заполнена нейросетью, документы прикреплены и отправлены на проверку`
          : 'Карточка заполнена нейросетью по загруженным документам',
      })
      onSaved({ driverId, truckId, driverName: draftDriver.fullName, request: savedRequest })
      onOpenChange(false)
    } catch (e) {
      toast({ title: 'Не удалось сохранить водителя', description: e instanceof Error ? e.message : 'Неизвестная ошибка', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const badDocs: IntakeDocVerdict[] = result?.documents.filter((d) => d.status === 'REUPLOAD' || d.status === 'REJECTED') ?? []
  const canSave = !!(draftDriver?.fullName && draftDriver?.license && carrierId) && !saving

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-blue-700" aria-hidden />
            Новый водитель — по документам, с нейросетью
          </DialogTitle>
          <DialogDescription>
            {request
              ? `Заявка ${request.number}: загрузите документы — нейросеть прочитает их, сама заполнит карточку водителя и тягача и сверит данные. Останется подтвердить.`
              : 'Загрузите документы — нейросеть прочитает паспорт, ВУ и СТС, сама заполнит карточку водителя и тягача и проверит данные на противоречия.'}
          </DialogDescription>
        </DialogHeader>

        {/* индикатор шагов */}
        <ol className="flex flex-wrap items-center gap-1.5 text-xs font-medium" aria-label="Шаги добавления водителя">
          {[
            { n: 1, label: 'Документы', active: step === 'docs' },
            { n: 2, label: 'Нейросеть', active: step === 'scan' },
            { n: 3, label: 'Подтверждение', active: step === 'review' },
          ].map((s, i) => (
            <li key={s.n} className="flex items-center gap-1.5">
              {i > 0 && <ArrowRight className="h-3 w-3 text-slate-300" aria-hidden />}
              <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${s.active ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${s.active ? 'bg-blue-700 text-white' : 'bg-slate-300 text-white'}`} aria-hidden>{s.n}</span>
                {s.label}
              </span>
            </li>
          ))}
        </ol>

        {/* ——— Шаг 1: документы ——— */}
        {step === 'docs' && (
          <div className="space-y-4">
            {!lockCarrier && (
              <div className="space-y-1.5">
                <Label htmlFor="intake-carrier">Перевозчик</Label>
                <Select value={carrierId} onValueChange={setCarrierId}>
                  <SelectTrigger id="intake-carrier" aria-label="Выбор перевозчика">
                    <SelectValue placeholder="Выберите перевозчика" />
                  </SelectTrigger>
                  <SelectContent>
                    {carriers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {([
                { type: 'PASSPORT_PHOTO' as DocType, required: true, icon: IdCard, hint: 'Страница с фото' },
                { type: 'LICENSE' as DocType, required: true, icon: Car, hint: 'Лицевая сторона' },
                { type: 'STS' as DocType, required: false, icon: Truck, hint: 'Необязательно — добавим и тягач' },
                { type: 'PASSPORT_REG' as DocType, required: false, icon: MapPin, hint: 'Необязательно — для комплекта заявки' },
              ]).map(({ type, required, icon: Icon, hint }) => {
                const up = uploads[type]
                const key = `intake:${type}`
                return (
                  <div key={type} className={`flex flex-col rounded-xl border p-3 ${up ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-slate-50/60'}`}>
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700" aria-hidden>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="text-xs font-semibold leading-tight text-slate-800">
                          {DOC_TYPE_LABEL[type]}
                          {!required && <span className="block text-[10px] font-normal text-slate-500">{hint}</span>}
                        </span>
                      </span>
                      {required && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-[10px] text-blue-700">Обязательно</Badge>}
                    </div>
                    {up && (
                      <img src={up.dataUri} alt={`Загруженный документ «${DOC_TYPE_LABEL[type]}»`} className="mb-2 h-20 w-full rounded-md border border-slate-200 object-cover" />
                    )}
                    <input
                      ref={(el) => { fileInputs.current[type] = el }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      aria-label={`Загрузить ${DOC_TYPE_LABEL[type]}`}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        e.target.value = ''
                        if (f) void handleFile(type, f)
                      }}
                    />
                    <Button
                      size="sm"
                      variant={up ? 'outline' : 'default'}
                      className="mt-auto w-full gap-1.5"
                      onClick={() => fileInputs.current[type]?.click()}
                      aria-label={up ? `Заменить ${DOC_TYPE_LABEL[type]}` : `Загрузить ${DOC_TYPE_LABEL[type]}`}
                    >
                      <Upload className="h-4 w-4" aria-hidden />
                      {up ? 'Заменить фото' : 'Загрузить фото'}
                    </Button>
                  </div>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <span className="text-xs text-slate-600">
                Минимум — паспорт и ВУ. Нейросеть распознает поля и сама заполнит карточку: вводить руками не нужно.
              </span>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={fillDemo}>
                <Sparkles className="h-4 w-4" aria-hidden />
                Заполнить демо-образцами
              </Button>
            </div>
          </div>
        )}

        {/* ——— Шаг 2: нейросеть работает ——— */}
        {step === 'scan' && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-6 py-12 text-center" role="status">
            <Loader2 className="h-8 w-8 animate-spin text-blue-700" aria-hidden />
            <div className="text-sm font-semibold text-blue-900">Нейросеть распознаёт документы</div>
            <div className="text-sm text-blue-700">{scanStage}</div>
            <p className="max-w-sm text-xs text-muted-foreground">
              Качество фото, тип документа, поля и уверенность по каждому — как при проверке документов по заявке
            </p>
          </div>
        )}

        {/* ——— Шаг 3: подтверждение распознанного ——— */}
        {step === 'review' && result && draftDriver && (
          <div className="space-y-4">
            {/* карточка водителя */}
            <div className="rounded-xl border border-slate-200 p-4">
              <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <User className="h-4 w-4 text-blue-600" aria-hidden />
                Карточка водителя — заполнена нейросетью
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] font-normal text-emerald-700">можно исправить</Badge>
              </h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {DRIVER_FIELDS.map((f) => (
                  <FieldInput
                    key={f.key}
                    id={`intake-driver-${f.key}`}
                    label={f.label}
                    placeholder={f.placeholder}
                    value={draftDriver[f.key] ?? ''}
                    conf={draftDriver.confidence[f.key]}
                    mono={f.mono}
                    wide={f.wide}
                    onChange={(v) => setDraftDriver((prev) => (prev ? { ...prev, [f.key]: v } : prev))}
                  />
                ))}
              </div>
            </div>

            {/* карточка тягача */}
            {draftTruck && (
              <div className="rounded-xl border border-slate-200 p-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Truck className="h-4 w-4 text-blue-600" aria-hidden />
                  Тягач — распознан из СТС
                </h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {TRUCK_FIELDS.map((f) => (
                    <FieldInput
                      key={f.key}
                      id={`intake-truck-${f.key}`}
                      label={f.label}
                      placeholder={f.placeholder}
                      value={draftTruck[f.key] ?? ''}
                      conf={draftTruck.confidence[f.key]}
                      mono={f.mono}
                      wide={f.wide}
                      onChange={(v) => setDraftTruck((prev) => (prev ? { ...prev, [f.key]: v } : prev))}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* перекрёстные сверки */}
            {result.crossChecks.length > 0 && (
              <div className="rounded-xl border border-slate-200 p-4">
                <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <ShieldCheck className="h-4 w-4 text-blue-600" aria-hidden />
                  Перекрёстные сверки нейросети
                </h4>
                <ul className="space-y-1.5">
                  {result.crossChecks.map((cc) => (
                    <li key={cc.label} className="flex items-start gap-2 text-sm">
                      {cc.ok
                        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                        : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />}
                      <span className="text-slate-800">{cc.label}: <span className={cc.ok ? 'text-emerald-700' : 'text-red-700'}>{cc.detail}</span></span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* вердикты по документам */}
            <div className="space-y-2">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FileText className="h-4 w-4 text-blue-600" aria-hidden />
                Вердикты по документам
              </h4>
              {result.documents.map((v) => (
                <VerdictRow key={v.type} type={v.type} verdict={v} upload={uploads[v.type]} />
              ))}
              {badDocs.length > 0 && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Документы со статусом «Перезагрузить» лучше заменить: вернитесь к шагу «Документы» и загрузите фото заново.
                </p>
              )}
            </div>

            {/* присоединить к заявке */}
            {request && (
              <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/70 p-4">
                <Checkbox
                  id="intake-attach"
                  checked={attach}
                  onCheckedChange={(v) => setAttach(v === true)}
                  aria-label="Прикрепить документы к заявке и отправить на проверку"
                />
                <div>
                  <Label htmlFor="intake-attach" className="text-sm font-medium text-slate-900">
                    Назначить на заявку {request.number} и отправить на проверку
                  </Label>
                  <p className="mt-0.5 text-xs text-slate-600">
                    Водитель и тягач сразу встанут в заявку, документы прикрепятся к ней — нейросеть проверит комплект без повторной загрузки
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          {step === 'docs' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
              <Button disabled={!canRecognize} onClick={() => void recognize()} className="gap-1.5" aria-label="Распознать документы нейросетью">
                <ScanLine className="h-4 w-4" aria-hidden />
                Распознать документы
              </Button>
            </>
          )}
          {step === 'scan' && (
            <Button disabled aria-label="Нейросеть работает">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Нейросеть работает…
            </Button>
          )}
          {step === 'review' && (
            <>
              <Button variant="outline" className="gap-1.5" onClick={() => setStep('docs')} disabled={saving}>
                <RotateCcw className="h-4 w-4" aria-hidden />
                К документам
              </Button>
              <Button className="gap-1.5" disabled={!canSave} onClick={() => void save()} aria-label={saving ? 'Сохраняем' : request && attach ? 'Сохранить и отправить на проверку' : 'Сохранить водителя'}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : request && attach ? <Send className="h-4 w-4" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                {saving ? 'Сохраняем…' : request && attach ? 'Сохранить и отправить на проверку' : 'Сохранить водителя'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

