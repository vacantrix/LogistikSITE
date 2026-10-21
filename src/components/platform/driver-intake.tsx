'use client'

/**
 * Линия водителя для «Подать документов» (Task 29/30/32/33/35).
 *
 * Одна линия = один водитель: проформы [Водитель | Тягач | Прицеп] в одну строку,
 * ниже — 4 слота фотографий. ВСЕ поля проформ и все 4 фото обязательны.
 * При старте ничего не горит красным, кнопка «Проверить» чёрная и всегда активна;
 * если что-то не заполнено — после нажатия подсвечиваются все пропущенные поля
 * и слоты фото. Когда всё заполнено, кнопка запускает нейросеть: она читает фото,
 * заполняет ТОЛЬКО пустые поля, сверяет данные между документами и сама допускает
 * карточки в базу аккаунта (идемпотентно, по ФИО+ВУ / госномеру) или отклоняет.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BadgeCheck, CarFront, CircleAlert, IdCard, ScanLine, Truck, Trash2, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DocStatusBadge } from '@/components/platform/common'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { DOC_TYPE_LABEL } from '@/lib/status'
import { fileToCompressedDataUri } from '@/lib/demo-media'
import type { DocType, IntakeResult } from '@/lib/types'

/** Ровно два типа прицепа (утверждено пользователем, Task 32) */
export const TRAILER_TYPES = ['Полуприцеп-штора', 'Полуприцепы-контейнеровозы'] as const

/** Человекочитаемые имена обязательных полей — для подсветки и текста ошибок (Task 44) */
export const DRIVER_LABELS: Record<string, string> = {
  fullName: 'ФИО', birthDate: 'Дата рождения', citizenship: 'Гражданство', phone: 'Телефон',
  birthPlace: 'Адрес регистрации', passport: 'Паспорт', passportIssuedBy: 'Кем выдан',
  passportIssuedDate: 'Дата выдачи', position: 'Должность', license: 'ВУ номер',
  licenseTill: 'ВУ действует до', categories: 'Категории',
}
export const TRUCK_LABELS: Record<string, string> = {
  brand: 'Марка, модель', plate: 'Госномер тягача', sts: 'СТС тягача', color: 'Цвет тягача', owner: 'Собственник тягача',
}
export const TRAILER_LABELS: Record<string, string> = {
  type: 'Тип прицепа', plate: 'Госномер прицепа', sts: 'СТС прицепа', color: 'Цвет прицепа', owner: 'Собственник прицепа',
}

type Upload = { fileName: string; dataUri: string }
const LINE_DOC_TYPES: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'LICENSE', 'STS']

const EMPTY_UPLOADS: Partial<Record<DocType, Upload>> = {}
const EMPTY_VERDICTS: Partial<Record<DocType, IntakeResult['documents'][number]>> = {}

/** Данные линии, подставленные из Excel/демо — поля, уже известные до проверки */
export interface DriverLineInitial {
  driver?: Partial<Record<'fullName' | 'birthDate' | 'citizenship' | 'phone' | 'birthPlace' | 'passport' | 'passportIssuedBy' | 'passportIssuedDate' | 'position' | 'license' | 'licenseTill' | 'categories', string>>
  truck?: Partial<Record<'brand' | 'plate' | 'sts' | 'color' | 'owner', string>>
  trailer?: Partial<Record<'type' | 'plate' | 'sts' | 'color' | 'owner', string>>
}

function confCls(c: number): string {
  if (c >= 0.8) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (c >= 0.55) return 'bg-amber-50 text-amber-700 border-amber-200'
  return 'bg-red-50 text-red-700 border-red-200'
}

function ConfChip({ c }: { c: number }) {
  const pct = Math.round(c * 100)
  return <span className={`ml-1.5 inline-flex items-center rounded border px-1 py-px text-[10px] font-semibold ${confCls(c)}`}>{pct}%</span>
}

/** Поле проформы: красная подсветка незаполненного обязательного — только после «Проверить» (Task 44) */
function FieldInput({
  id, label, placeholder, value, conf, mono, invalid, onChange, disabled,
}: {
  id: string
  label: string
  placeholder?: string
  value: string
  conf?: number
  mono?: boolean
  invalid?: boolean
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id} className={`text-xs ${invalid ? 'font-semibold text-red-600' : 'text-muted-foreground'}`}>
        {label}
        {invalid && <span aria-hidden> — заполните</span>}
        {conf !== undefined && conf > 0 && <ConfChip c={conf} />}
      </Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={`mt-1 h-8 text-sm ${mono ? 'font-mono' : ''} ${invalid ? 'border-red-400 bg-red-50/40 focus-visible:ring-red-300' : ''}`}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export interface DriverLineProps {
  id: string
  index: number
  carrierId: string
  /** данные, подставленные из Excel-строки */
  initial?: DriverLineInitial
  /** регистрация функции проверки линии для кнопки «Проверить все» */
  registerCheck: (id: string, fn: ((quiet?: boolean) => Promise<boolean>) | null) => void
  onRemove: (id: string) => void
  /** уведомление о допуске карточек в базу — раздел обновит счётчики */
  onAdmitted: () => void
}

export default function DriverLine({
  id, index, carrierId, initial, registerCheck, onRemove, onAdmitted,
}: DriverLineProps) {
  const { toast } = useToast()

  // ——— проформа водителя (12 полей) ———
  const [d, setD] = useState({
    fullName: initial?.driver?.fullName ?? '',
    birthDate: initial?.driver?.birthDate ?? '',
    citizenship: initial?.driver?.citizenship ?? '',
    phone: initial?.driver?.phone ?? '',
    birthPlace: initial?.driver?.birthPlace ?? '', // поле «Адрес регистрации» (Task 33)
    passport: initial?.driver?.passport ?? '',
    passportIssuedBy: initial?.driver?.passportIssuedBy ?? '',
    passportIssuedDate: initial?.driver?.passportIssuedDate ?? '',
    position: initial?.driver?.position ?? '',
    license: initial?.driver?.license ?? '',
    licenseTill: initial?.driver?.licenseTill ?? '',
    categories: initial?.driver?.categories ?? '',
  })
  // ——— проформа тягача (5 полей) ———
  const [t, setT] = useState({
    brand: initial?.truck?.brand ?? '',
    plate: initial?.truck?.plate ?? '',
    sts: initial?.truck?.sts ?? '',
    color: initial?.truck?.color ?? '',
    owner: initial?.truck?.owner ?? '',
  })
  // ——— проформа прицепа (5 полей) ———
  const [tr, setTr] = useState({
    type: initial?.trailer?.type ?? '',
    plate: initial?.trailer?.plate ?? '',
    sts: initial?.trailer?.sts ?? '',
    color: initial?.trailer?.color ?? '',
    owner: initial?.trailer?.owner ?? '',
  })
  const [trailerTypes, setTrailerTypes] = useState<string[]>(() => {
    const extra = initial?.trailer?.type && !(TRAILER_TYPES as readonly string[]).includes(initial.trailer.type)
      ? [initial.trailer.type] : []
    return [...TRAILER_TYPES, ...extra]
  })

  const [uploads, setUploads] = useState<Partial<Record<DocType, Upload>>>(EMPTY_UPLOADS)
  const [verdicts, setVerdicts] = useState<Partial<Record<DocType, IntakeResult['documents'][number]>>>(EMPTY_VERDICTS)
  const [crossChecks, setCrossChecks] = useState<IntakeResult['crossChecks']>([])
  const [conf, setConf] = useState<Record<string, number>>({})
  const [checking, setChecking] = useState(false)
  /** подсветка незаполненного включается только после первого нажатия «Проверить» (Task 44) */
  const [showErrors, setShowErrors] = useState(false)
  const [admitted, setAdmitted] = useState<null | { driver: string; truck?: string; trailer?: string }>(null)

  const setField = useCallback((k: keyof typeof d, v: string) => setD((cur) => ({ ...cur, [k]: v })), [])
  const setTField = useCallback((k: keyof typeof t, v: string) => setT((cur) => ({ ...cur, [k]: v })), [])
  const setTrField = useCallback((k: keyof typeof tr, v: string) => setTr((cur) => ({ ...cur, [k]: v })), [])

  const setUpload = useCallback(async (type: DocType, file: File) => {
    try {
      const dataUri = await fileToCompressedDataUri(file)
      setUploads((cur) => ({ ...cur, [type]: { fileName: file.name, dataUri } }))
      setVerdicts((cur) => { const n = { ...cur }; delete n[type]; return n })
    } catch {
      toast({ title: 'Ошибка', description: 'Не удалось прочитать файл', variant: 'destructive' })
    }
  }, [toast])

  /** обязательное поле подсвечено, если проверка уже запускалась и поле пустое */
  const miss = (v: string) => showErrors && v.trim() === ''

  const check = useCallback(async (quiet = false): Promise<boolean> => {
    if (admitted) return true
    if (checking) return false

    // ——— валидация «все поля обязательны»: подсветка появляется только здесь (Task 44) ———
    setShowErrors(true)
    const dKeys = Object.keys(DRIVER_LABELS) as (keyof typeof d)[]
    const tKeys = Object.keys(TRUCK_LABELS) as (keyof typeof t)[]
    const trKeys = Object.keys(TRAILER_LABELS) as (keyof typeof tr)[]
    const missingLabels = [
      ...dKeys.filter((k) => d[k].trim() === '').map((k) => DRIVER_LABELS[k]),
      ...tKeys.filter((k) => t[k].trim() === '').map((k) => TRUCK_LABELS[k]),
      ...trKeys.filter((k) => tr[k].trim() === '').map((k) => TRAILER_LABELS[k]),
    ]
    const missingPhotos = LINE_DOC_TYPES.filter((tp) => !uploads[tp])

    if (missingLabels.length > 0 || missingPhotos.length > 0) {
      if (!quiet) {
        const cap = (arr: string[]) => (arr.length > 6 ? `${arr.slice(0, 6).join(', ')} + ещё ${arr.length - 6}` : arr.join(', '))
        const parts = [
          missingLabels.length > 0 ? `Поля: ${cap(missingLabels)}` : null,
          missingPhotos.length > 0 ? `Фото: ${missingPhotos.map((tp) => DOC_TYPE_LABEL[tp]).join(', ')}` : null,
        ].filter(Boolean)
        toast({ title: 'Не все поля заполнены', description: parts.join(' · '), variant: 'destructive' })
      }
      return false
    }

    setChecking(true)
    try {
      // ——— нейросеть читает фото и заполняет ТОЛЬКО пустые поля.
      // Повторный прогон не нужен, пока все 4 документа имеют вердикты ———
      let effD = { ...d }
      let effT = { ...t }
      let latest: IntakeResult['documents'] = []
      const aiDone = LINE_DOC_TYPES.every((tp) => verdicts[tp])
      if (!aiDone) {
        const res = await api.intakeDriver(
          Object.fromEntries(Object.entries(uploads).filter(([, v]) => v)) as Partial<Record<string, Upload>>,
        )
        latest = res.documents
        setVerdicts(Object.fromEntries(res.documents.map((doc) => [doc.type, doc])))
        setCrossChecks(res.crossChecks)
        const pick = (cur: string, next: string | undefined) => cur || next || ''
        // заполняем ТОЛЬКО пустые поля — вручную введённое не затирается
        effD = {
          ...d,
          fullName: pick(d.fullName, res.driver.fullName),
          birthDate: pick(d.birthDate, res.driver.birthDate),
          passport: pick(d.passport, res.driver.passport),
          license: pick(d.license, res.driver.license),
          licenseTill: pick(d.licenseTill, res.driver.licenseTill),
          categories: pick(d.categories, res.driver.categories),
          citizenship: pick(d.citizenship, (res.driver as unknown as { citizenship?: string }).citizenship),
          birthPlace: pick(d.birthPlace, (res.driver as unknown as { birthPlace?: string }).birthPlace),
        }
        setD(effD)
        setConf(res.driver.confidence ?? {})
        if (res.truck) {
          effT = {
            ...t,
            brand: pick(t.brand, res.truck?.brand),
            plate: pick(t.plate, res.truck?.plate),
            sts: pick(t.sts, res.truck?.sts),
            owner: pick(t.owner, res.truck?.owner),
          }
          setT(effT)
        }
      } else {
        latest = LINE_DOC_TYPES.flatMap((tp) => (verdicts[tp] ? [verdicts[tp]] : []))
      }

      const bad = latest.filter((x) => x.status === 'REUPLOAD' || x.status === 'REJECTED')
      if (bad.length > 0) {
        toast({
          title: 'Часть документов не прошла проверку',
          description: `${bad.map((x) => DOC_TYPE_LABEL[x.type] ?? x.type).join(', ')} — замените фото или введите данные вручную`,
          variant: 'destructive',
        })
        return false
      }

      // ——— после нейросети проверяем ещё раз: не заполненными остались только то, что ИИ не смог прочитать ———
      const stillMiss = [
        ...dKeys.filter((k) => effD[k].trim() === '').map((k) => DRIVER_LABELS[k]),
        ...tKeys.filter((k) => effT[k].trim() === '').map((k) => TRUCK_LABELS[k]),
        ...trKeys.filter((k) => tr[k].trim() === '').map((k) => TRAILER_LABELS[k]),
      ]
      if (stillMiss.length > 0) {
        toast({
          title: 'После проверки не заполнены поля',
          description: `${stillMiss.join(', ')} — нейросеть не смогла прочитать, заполните вручную`,
          variant: 'destructive',
        })
        return false
      }

      // ——— допуск: карточки водителя, тягача и прицепа (все обязательны) ———
      const driverRes = await api.createDirectory('driver', {
        carrierId,
        fullName: effD.fullName.trim(),
        birthDate: effD.birthDate.trim(),
        citizenship: effD.citizenship.trim(),
        phone: effD.phone.trim(),
        birthPlace: effD.birthPlace.trim(),
        passport: effD.passport.trim(),
        passportIssuedBy: effD.passportIssuedBy.trim(),
        passportIssuedDate: effD.passportIssuedDate.trim(),
        position: effD.position.trim(),
        license: effD.license.trim(),
        licenseTill: effD.licenseTill.trim(),
        categories: effD.categories.trim(),
      })
      const admittedInfo: { driver: string; truck?: string; trailer?: string } = {
        driver: driverRes.driver?.fullName ?? effD.fullName.trim(),
      }
      const truckRes = await api.createDirectory('truck', {
        carrierId,
        brand: effT.brand.trim(),
        plate: effT.plate.trim(),
        sts: effT.sts.trim(),
        color: effT.color.trim(),
        owner: effT.owner.trim(),
      })
      admittedInfo.truck = truckRes.truck ? `${truckRes.truck.brand} ${truckRes.truck.plate}` : effT.plate.trim()
      const trailerRes = await api.createDirectory('trailer', {
        carrierId,
        type: tr.type || TRAILER_TYPES[0],
        plate: tr.plate.trim(),
        sts: tr.sts.trim(),
        color: tr.color.trim(),
        owner: tr.owner.trim(),
      })
      admittedInfo.trailer = trailerRes.trailer ? `${trailerRes.trailer.type} ${trailerRes.trailer.plate}` : tr.plate.trim()
      setAdmitted(admittedInfo)
      onAdmitted()
      toast({
        title: 'Водитель допущен в базу',
        description: [admittedInfo.driver, admittedInfo.truck, admittedInfo.trailer].filter(Boolean).join(' · '),
      })
      return true
    } catch (e) {
      toast({
        title: 'Проверка не удалась',
        description: e instanceof Error ? e.message : 'Неизвестная ошибка',
        variant: 'destructive',
      })
      return false
    } finally {
      setChecking(false)
    }
  }, [admitted, checking, uploads, verdicts, d, t, tr, carrierId, onAdmitted, toast])

  // регистрация функции проверки для «Проверить все» (актуальная версия через ref-эффект)
  const checkRef = useRef(check)
  useEffect(() => {
    checkRef.current = check
  })
  useEffect(() => {
    registerCheck(id, (quiet) => checkRef.current(quiet))
    return () => registerCheck(id, null)
  }, [id, registerCheck])

  const removeUpload = (type: DocType) => {
    setUploads((cur) => { const n = { ...cur }; delete n[type]; return n })
  }

  const lock = admitted !== null || checking

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4"
      aria-label={`Линия водителя ${index + 1}`}
    >
      {/* ——— шапка линии ——— */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-900 text-xs font-bold text-white" aria-hidden>
          {index + 1}
        </span>
        <span className="text-sm font-semibold text-slate-900">{d.fullName.trim() || 'Новый водитель'}</span>
        {initial?.driver || initial?.truck || initial?.trailer ? (
          <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-px text-[10px] font-semibold text-sky-700">
            Строка {index + 1} · Excel
          </span>
        ) : null}
        {admitted && (
          <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700">
            <BadgeCheck className="h-3 w-3" aria-hidden />
            допущен в базу
          </span>
        )}
        <span className="flex-1" />
        {!admitted && (
          <Button
            size="sm"
            onClick={() => void check()}
            disabled={checking}
            className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
          >
            <ScanLine className="h-4 w-4" aria-hidden />
            {checking ? 'Проверяем…' : 'Проверить'}
          </Button>
        )}
        <Button size="icon" variant="ghost" onClick={() => onRemove(id)} aria-label={`Удалить линию ${index + 1}`} className="h-8 w-8 text-slate-400 hover:text-red-600">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {/* ——— плашка допуска ——— */}
      {admitted && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden />
          <span className="font-semibold">Водитель допущен в базу</span>
          {admitted.truck && <span>· тягач {admitted.truck}</span>}
          {admitted.trailer && <span>· прицеп {admitted.trailer}</span>}
          <span className="flex-1" />
          <Button size="sm" variant="outline" className="h-7 gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-100" onClick={() => onRemove(id)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Убрать линию
          </Button>
        </div>
      )}

      {/* ——— проформы: [Водитель | Тягач | Прицеп] в одну строку ——— */}
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1.45fr_1fr_1fr] lg:items-stretch">
        {/* Водитель */}
        <div className={`rounded-lg border p-3 ${admitted ? 'border-slate-200 bg-slate-50/60' : 'border-blue-200 bg-blue-50/30'}`}>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-800">
            <IdCard className="h-3.5 w-3.5" aria-hidden />
            Новый водитель
          </div>
          <div className={admitted ? 'pointer-events-none opacity-70' : ''}>
            <div className="grid grid-cols-1 gap-2">
              <FieldInput id={`${id}-fio`} label="ФИО" placeholder="Петров Пётр Сергеевич" value={d.fullName} conf={conf.fullName} invalid={miss(d.fullName)} disabled={lock} onChange={(v) => setField('fullName', v)} />
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="space-y-2">
                <FieldInput id={`${id}-bd`} label="Дата рождения" placeholder="14.02.1995" value={d.birthDate} conf={conf.birthDate} invalid={miss(d.birthDate)} disabled={lock} onChange={(v) => setField('birthDate', v)} />
                <FieldInput id={`${id}-cit`} label="Гражданство" placeholder="РФ" value={d.citizenship} invalid={miss(d.citizenship)} disabled={lock} onChange={(v) => setField('citizenship', v)} />
                <FieldInput id={`${id}-tel`} label="Телефон" placeholder="+7 900 000-00-00" value={d.phone} mono invalid={miss(d.phone)} disabled={lock} onChange={(v) => setField('phone', v)} />
              </div>
              <div className="space-y-2">
                <FieldInput id={`${id}-adr`} label="Адрес регистрации" placeholder="г. Краснодар, ул. Красная, д. 5" value={d.birthPlace} invalid={miss(d.birthPlace)} disabled={lock} onChange={(v) => setField('birthPlace', v)} />
                <FieldInput id={`${id}-pass`} label="Паспорт" placeholder="52 10 884610" value={d.passport} conf={conf.passport} mono invalid={miss(d.passport)} disabled={lock} onChange={(v) => setField('passport', v)} />
                <FieldInput id={`${id}-pby`} label="Кем выдан" placeholder="ОВМ УМВД…" value={d.passportIssuedBy} invalid={miss(d.passportIssuedBy)} disabled={lock} onChange={(v) => setField('passportIssuedBy', v)} />
              </div>
              <div className="space-y-2">
                <FieldInput id={`${id}-pdate`} label="Дата выдачи" placeholder="10.06.2015" value={d.passportIssuedDate} invalid={miss(d.passportIssuedDate)} disabled={lock} onChange={(v) => setField('passportIssuedDate', v)} />
                <FieldInput id={`${id}-pos`} label="Должность" placeholder="Водитель-экспедитор" value={d.position} invalid={miss(d.position)} disabled={lock} onChange={(v) => setField('position', v)} />
                <FieldInput id={`${id}-lic`} label="ВУ номер" placeholder="52 16 121212" value={d.license} conf={conf.license} mono invalid={miss(d.license)} disabled={lock} onChange={(v) => setField('license', v)} />
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <FieldInput id={`${id}-ltill`} label="ВУ действует до" placeholder="10.06.2035" value={d.licenseTill} conf={conf.licenseTill} invalid={miss(d.licenseTill)} disabled={lock} onChange={(v) => setField('licenseTill', v)} />
              <FieldInput id={`${id}-cat`} label="Категории" placeholder="C, CE" value={d.categories} conf={conf.categories} mono invalid={miss(d.categories)} disabled={lock} onChange={(v) => setField('categories', v)} />
            </div>
          </div>
        </div>

        {/* Тягач */}
        <div className={`rounded-lg border p-3 ${admitted ? 'border-slate-200 bg-slate-50/60' : 'border-slate-200 bg-white'}`}>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-700">
            <Truck className="h-3.5 w-3.5" aria-hidden />
            Новый тягач
          </div>
          <div className={`space-y-2 ${admitted ? 'pointer-events-none opacity-70' : ''}`}>
            <FieldInput id={`${id}-tb`} label="Марка, модель" placeholder="КАМАЗ 54901-CA" value={t.brand} invalid={miss(t.brand)} disabled={lock} onChange={(v) => setTField('brand', v)} />
            <FieldInput id={`${id}-tp`} label="Госномер" placeholder="У783АХ152" value={t.plate} mono invalid={miss(t.plate)} disabled={lock} onChange={(v) => setTField('plate', v)} />
            <FieldInput id={`${id}-ts`} label="СТС" placeholder="99 17 454545" value={t.sts} mono invalid={miss(t.sts)} disabled={lock} onChange={(v) => setTField('sts', v)} />
            <FieldInput id={`${id}-tc`} label="Цвет" placeholder="зелёный" value={t.color} invalid={miss(t.color)} disabled={lock} onChange={(v) => setTField('color', v)} />
            <FieldInput id={`${id}-to`} label="Собственник" placeholder="ООО «Перевозчик Б»" value={t.owner} invalid={miss(t.owner)} disabled={lock} onChange={(v) => setTField('owner', v)} />
          </div>
        </div>

        {/* Прицеп */}
        <div className={`rounded-lg border p-3 ${admitted ? 'border-slate-200 bg-slate-50/60' : 'border-slate-200 bg-white'}`}>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-700">
            <CarFront className="h-3.5 w-3.5" aria-hidden />
            Новый прицеп
          </div>
          <div className={`space-y-2 ${admitted ? 'pointer-events-none opacity-70' : ''}`}>
            <div className="min-w-0">
              <Label htmlFor={`${id}-trt`} className={`text-xs ${miss(tr.type) ? 'font-semibold text-red-600' : 'text-muted-foreground'}`}>
                Тип
                {miss(tr.type) && <span aria-hidden> — выберите</span>}
              </Label>
              <Select value={tr.type} onValueChange={(v) => setTrField('type', v)} disabled={lock}>
                <SelectTrigger id={`${id}-trt`} aria-label="Тип прицепа" className={`mt-1 h-8 text-sm ${miss(tr.type) ? 'border-red-400 bg-red-50/40 focus:ring-red-300' : ''}`}>
                  <SelectValue placeholder="Выберите тип" />
                </SelectTrigger>
                <SelectContent>
                  {trailerTypes.map((tt) => (
                    <SelectItem key={tt} value={tt}>{tt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FieldInput id={`${id}-trp`} label="Госномер" placeholder="АТ5546152" value={tr.plate} mono invalid={miss(tr.plate)} disabled={lock} onChange={(v) => setTrField('plate', v)} />
            <FieldInput id={`${id}-trs`} label="СТС" placeholder="52 19 777777" value={tr.sts} mono invalid={miss(tr.sts)} disabled={lock} onChange={(v) => setTrField('sts', v)} />
            <FieldInput id={`${id}-trc`} label="Цвет" placeholder="серый" value={tr.color} invalid={miss(tr.color)} disabled={lock} onChange={(v) => setTrField('color', v)} />
            <FieldInput id={`${id}-tro`} label="Собственник прицепа" placeholder="ООО «Перевозчик Б»" value={tr.owner} invalid={miss(tr.owner)} disabled={lock} onChange={(v) => setTrField('owner', v)} />
          </div>
        </div>
      </div>

      {/* ——— фотографии документов ——— */}
      <div className="mt-3">
        <div className="mb-1.5 text-xs font-semibold text-muted-foreground">Фотографии документов</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {LINE_DOC_TYPES.map((type) => {
            const up = uploads[type]
            const v = verdicts[type]
            const photoMiss = showErrors && !up
            return (
              <div key={type} className={`rounded-lg border p-2 ${v ? (v.status === 'PASSED' ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40') : photoMiss ? 'border-dashed border-red-400 bg-red-50/40' : 'border-dashed border-slate-300 bg-slate-50/40'}`}>
                <div className="flex items-center justify-between gap-1">
                  <span className={`truncate text-[11px] font-semibold ${photoMiss ? 'text-red-600' : 'text-slate-700'}`}>
                    {DOC_TYPE_LABEL[type]}
                    {photoMiss && <span aria-hidden> — добавьте фото</span>}
                  </span>
                  {v && <DocStatusBadge status={v.status} />}
                </div>
                {up ? (
                  <>
                    <img src={up.dataUri} alt={`Фото: ${DOC_TYPE_LABEL[type]}`} className="mt-1.5 h-16 w-full rounded border border-slate-200 bg-white object-contain" />
                    <div className="mt-1 flex items-center justify-between gap-1">
                      <span className="truncate text-[10px] text-muted-foreground" title={up.fileName}>{up.fileName}</span>
                      {!admitted && (
                        <>
                          <label className="cursor-pointer text-[10px] font-medium text-blue-700 hover:underline">
                            Заменить
                            <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void setUpload(type, f) }} />
                          </label>
                          <button type="button" className="text-[10px] text-slate-400 hover:text-red-600" aria-label={`Убрать ${DOC_TYPE_LABEL[type]}`} onClick={() => removeUpload(type)}>
                            <X className="h-3 w-3" aria-hidden />
                          </button>
                        </>
                      )}
                    </div>
                    {v && (
                      <div className="mt-1 space-y-0.5">
                        {v.quality != null && (
                          <div className={`text-[10px] font-medium ${v.quality >= 0.5 ? 'text-emerald-700' : 'text-amber-700'}`}>
                            Качество изображения {Math.round(v.quality * 100)}%
                          </div>
                        )}
                        {v.issues.map((issue) => (
                          <div key={issue} className="flex items-start gap-1 text-[10px] leading-snug text-red-700">
                            <CircleAlert className="mt-px h-2.5 w-2.5 shrink-0" aria-hidden />
                            {issue}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <label className={`mt-1 flex h-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded border border-dashed bg-white/60 text-center ${photoMiss ? 'border-red-300 hover:border-red-400' : 'border-slate-300 hover:border-blue-400'}`}>
                    <span className={`text-[10px] font-medium ${photoMiss ? 'text-red-600' : 'text-blue-700'}`}>Загрузить фото</span>
                    <span className="px-1 text-[9px] leading-tight text-muted-foreground">JPG/PNG — нейросеть прочитает</span>
                    <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void setUpload(type, f) }} />
                  </label>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ——— перекрёстные сверки ——— */}
      {crossChecks.length > 0 && !admitted && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Перекрёстные сверки</div>
          <ul className="space-y-0.5">
            {crossChecks.map((c) => (
              <li key={c.label} className={`flex items-start gap-1.5 text-xs ${c.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                {c.ok ? <BadgeCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> : <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />}
                <span><span className="font-semibold">{c.label}</span> — {c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
