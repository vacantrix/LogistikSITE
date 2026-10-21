'use client'

/**
 * Карточки пополнения базы для «Подать документов» (Task 29/30/32/33/35/48/51/53).
 *
 * DriverLine (по умолчанию) — карточка водителя: ТОЛЬКО данные водителя (Task 51,
 * по просьбе пользователя: при «Добавить водителя» открывается плашка именно с
 * данными водителя, без техники) — 12 полей + 2 фото (паспорт и регистрация;
 * Task 53 — фото ВУ убрано по просьбе пользователя).
 * TruckLine / TrailerLine — одиночные карточки «Добавить ТС» / «Добавить прицеп»
 * (Task 48): когда нужно пополнить базу только техникой — 5 полей + 2 фото
 * (сама техника и СТС; Task 53 — фото добавляются файлом или вставкой Ctrl+V);
 * принимают данные из Excel-строки (Task 51).
 *
 * При старте ничего не горит красным, кнопка «Проверить» чёрная и всегда активна;
 * если что-то не заполнено — после нажатия подсвечиваются все пропущенные поля
 * и слоты фото. Когда всё заполнено, кнопка карточки водителя запускает нейросеть:
 * она читает фото, заполняет ТОЛЬКО пустые поля, сверяет данные между документами
 * и сама допускает карточку в базу аккаунта (идемпотентно, по ФИО+ВУ)
 * или отклоняет. Одиночные карточки допускаются сразу после валидации полей и фото.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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

/** Черновики полей техники — общие для линии водителя и одиночных карточек (Task 48) */
export type TruckDraft = { brand: string; plate: string; sts: string; color: string; owner: string }
export type TrailerDraft = { type: string; plate: string; sts: string; color: string; owner: string }

type Upload = { fileName: string; dataUri: string }
/** Фото только водительских документов: паспорт и регистрация.
 * Task 53 — фото водительского удостоверения убрано из карточки по просьбе пользователя,
 * данные ВУ (номер, срок, категории) заполняются вручную */
const DRIVER_DOC_TYPES: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG']

const EMPTY_UPLOADS: Partial<Record<DocType, Upload>> = {}
const EMPTY_VERDICTS: Partial<Record<DocType, IntakeResult['documents'][number]>> = {}

/** Данные из Excel/демо — поля, уже известные до проверки. Водительская карточка
 * использует только driver; truck/trailer из строки становятся отдельными карточками (Task 51) */
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

/** Поля тягача — общий блок линии водителя и одиночной карточки «Добавить ТС» (Task 48) */
function TruckFields({
  prefix, value, miss, lock, onChange, className = 'space-y-2',
}: {
  prefix: string
  value: TruckDraft
  miss: (v: string) => boolean
  lock: boolean
  onChange: (k: keyof TruckDraft, v: string) => void
  className?: string
}) {
  return (
    <div className={className}>
      <FieldInput id={`${prefix}-tb`} label="Марка, модель" placeholder="КАМАЗ 54901-CA" value={value.brand} invalid={miss(value.brand)} disabled={lock} onChange={(v) => onChange('brand', v)} />
      <FieldInput id={`${prefix}-tp`} label="Госномер" placeholder="У783АХ152" value={value.plate} mono invalid={miss(value.plate)} disabled={lock} onChange={(v) => onChange('plate', v)} />
      <FieldInput id={`${prefix}-ts`} label="СТС" placeholder="99 17 454545" value={value.sts} mono invalid={miss(value.sts)} disabled={lock} onChange={(v) => onChange('sts', v)} />
      <FieldInput id={`${prefix}-tc`} label="Цвет" placeholder="зелёный" value={value.color} invalid={miss(value.color)} disabled={lock} onChange={(v) => onChange('color', v)} />
      <FieldInput id={`${prefix}-to`} label="Собственник" placeholder="ООО «Перевозчик Б»" value={value.owner} invalid={miss(value.owner)} disabled={lock} onChange={(v) => onChange('owner', v)} />
    </div>
  )
}

/** Поля прицепа — общий блок линии водителя и одиночной карточки «Добавить прицеп» (Task 48) */
function TrailerFields({
  prefix, value, types, miss, lock, onChange, className = 'space-y-2',
}: {
  prefix: string
  value: TrailerDraft
  types: readonly string[]
  miss: (v: string) => boolean
  lock: boolean
  onChange: (k: keyof TrailerDraft, v: string) => void
  className?: string
}) {
  return (
    <div className={className}>
      <div className="min-w-0">
        <Label htmlFor={`${prefix}-trt`} className={`text-xs ${miss(value.type) ? 'font-semibold text-red-600' : 'text-muted-foreground'}`}>
          Тип
          {miss(value.type) && <span aria-hidden> — выберите</span>}
        </Label>
        <Select value={value.type} onValueChange={(v) => onChange('type', v)} disabled={lock}>
          <SelectTrigger id={`${prefix}-trt`} aria-label="Тип прицепа" className={`mt-1 h-8 text-sm ${miss(value.type) ? 'border-red-400 bg-red-50/40 focus:ring-red-300' : ''}`}>
            <SelectValue placeholder="Выберите тип" />
          </SelectTrigger>
          <SelectContent>
            {types.map((tt) => (
              <SelectItem key={tt} value={tt}>{tt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <FieldInput id={`${prefix}-trp`} label="Госномер" placeholder="АТ5546152" value={value.plate} mono invalid={miss(value.plate)} disabled={lock} onChange={(v) => onChange('plate', v)} />
      <FieldInput id={`${prefix}-trs`} label="СТС" placeholder="52 19 777777" value={value.sts} mono invalid={miss(value.sts)} disabled={lock} onChange={(v) => onChange('sts', v)} />
      <FieldInput id={`${prefix}-trc`} label="Цвет" placeholder="серый" value={value.color} invalid={miss(value.color)} disabled={lock} onChange={(v) => onChange('color', v)} />
      <FieldInput id={`${prefix}-tro`} label="Собственник прицепа" placeholder="ООО «Перевозчик Б»" value={value.owner} invalid={miss(value.owner)} disabled={lock} onChange={(v) => onChange('owner', v)} />
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
  /** уведомление о допуске карточек в базу (если подписчику нужно реагировать) */
  onAdmitted?: () => void
}

export default function DriverLine({
  id, index, carrierId, initial, registerCheck, onRemove, onAdmitted,
}: DriverLineProps) {
  const { toast } = useToast()

  // ——— данные водителя (12 полей) — ТОЛЬКО они в карточке «Добавить водителя» (Task 51) ———
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
  const [uploads, setUploads] = useState<Partial<Record<DocType, Upload>>>(EMPTY_UPLOADS)
  const [verdicts, setVerdicts] = useState<Partial<Record<DocType, IntakeResult['documents'][number]>>>(EMPTY_VERDICTS)
  const [crossChecks, setCrossChecks] = useState<IntakeResult['crossChecks']>([])
  const [conf, setConf] = useState<Record<string, number>>({})
  const [checking, setChecking] = useState(false)
  /** подсветка незаполненного включается только после первого нажатия «Проверить» (Task 44) */
  const [showErrors, setShowErrors] = useState(false)
  const [admitted, setAdmitted] = useState<string | null>(null)

  const setField = useCallback((k: keyof typeof d, v: string) => setD((cur) => ({ ...cur, [k]: v })), [])

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
    const missingLabels = dKeys.filter((k) => d[k].trim() === '').map((k) => DRIVER_LABELS[k])
    const missingPhotos = DRIVER_DOC_TYPES.filter((tp) => !uploads[tp])

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
      // Повторный прогон не нужен, пока все 3 документа имеют вердикты ———
      let effD = { ...d }
      let latest: IntakeResult['documents'] = []
      const aiDone = DRIVER_DOC_TYPES.every((tp) => verdicts[tp])
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
      } else {
        latest = DRIVER_DOC_TYPES.flatMap((tp) => (verdicts[tp] ? [verdicts[tp]] : []))
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
      const stillMiss = dKeys.filter((k) => effD[k].trim() === '').map((k) => DRIVER_LABELS[k])
      if (stillMiss.length > 0) {
        toast({
          title: 'После проверки не заполнены поля',
          description: `${stillMiss.join(', ')} — нейросеть не смогла прочитать, заполните вручную`,
          variant: 'destructive',
        })
        return false
      }

      // ——— допуск: в базу записывается только водитель (Task 51) ———
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
      const name = driverRes.driver?.fullName ?? effD.fullName.trim()
      setAdmitted(name)
      onAdmitted?.()
      toast({
        title: 'Водитель допущен в базу',
        description: name,
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
  }, [admitted, checking, uploads, verdicts, d, carrierId, onAdmitted, toast])

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
      aria-label={`Карточка водителя ${index + 1}`}
    >
      {/* ——— шапка карточки ——— */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-900 text-xs font-bold text-white" aria-hidden>
          {index + 1}
        </span>
        <span className="text-sm font-semibold text-slate-900">{d.fullName.trim() || 'Новый водитель'}</span>
        {initial?.driver ? (
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
        <Button size="icon" variant="ghost" onClick={() => onRemove(id)} aria-label={`Убрать карточку водителя ${index + 1}`} className="h-8 w-8 text-slate-400 hover:text-red-600">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {/* ——— плашка допуска ——— */}
      {admitted && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden />
          <span className="font-semibold">Водитель допущен в базу</span>
          <span>· {admitted}</span>
          <span className="flex-1" />
          <Button size="sm" variant="outline" className="h-7 gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-100" onClick={() => onRemove(id)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Убрать карточку
          </Button>
        </div>
      )}

      {/* ——— ТОЛЬКО данные водителя (Task 51): техника добавляется отдельными карточками ——— */}
      <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/30 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-800">
          <IdCard className="h-3.5 w-3.5" aria-hidden />
          Данные водителя
        </div>
        <div className={admitted ? 'pointer-events-none opacity-70' : ''}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <FieldInput id={`${id}-fio`} label="ФИО" placeholder="Петров Пётр Сергеевич" value={d.fullName} conf={conf.fullName} invalid={miss(d.fullName)} disabled={lock} onChange={(v) => setField('fullName', v)} />
            <FieldInput id={`${id}-bd`} label="Дата рождения" placeholder="14.02.1995" value={d.birthDate} conf={conf.birthDate} invalid={miss(d.birthDate)} disabled={lock} onChange={(v) => setField('birthDate', v)} />
            <FieldInput id={`${id}-cit`} label="Гражданство" placeholder="РФ" value={d.citizenship} invalid={miss(d.citizenship)} disabled={lock} onChange={(v) => setField('citizenship', v)} />
            <FieldInput id={`${id}-tel`} label="Телефон" placeholder="+7 900 000-00-00" value={d.phone} mono invalid={miss(d.phone)} disabled={lock} onChange={(v) => setField('phone', v)} />
            <FieldInput id={`${id}-adr`} label="Адрес регистрации" placeholder="г. Краснодар, ул. Красная, д. 5" value={d.birthPlace} invalid={miss(d.birthPlace)} disabled={lock} onChange={(v) => setField('birthPlace', v)} />
            <FieldInput id={`${id}-pass`} label="Паспорт" placeholder="52 10 884610" value={d.passport} conf={conf.passport} mono invalid={miss(d.passport)} disabled={lock} onChange={(v) => setField('passport', v)} />
            <FieldInput id={`${id}-pby`} label="Кем выдан" placeholder="ОВМ УМВД…" value={d.passportIssuedBy} invalid={miss(d.passportIssuedBy)} disabled={lock} onChange={(v) => setField('passportIssuedBy', v)} />
            <FieldInput id={`${id}-pdate`} label="Дата выдачи" placeholder="10.06.2015" value={d.passportIssuedDate} invalid={miss(d.passportIssuedDate)} disabled={lock} onChange={(v) => setField('passportIssuedDate', v)} />
            <FieldInput id={`${id}-pos`} label="Должность" placeholder="Водитель-экспедитор" value={d.position} invalid={miss(d.position)} disabled={lock} onChange={(v) => setField('position', v)} />
            <FieldInput id={`${id}-lic`} label="ВУ номер" placeholder="52 16 121212" value={d.license} conf={conf.license} mono invalid={miss(d.license)} disabled={lock} onChange={(v) => setField('license', v)} />
            <FieldInput id={`${id}-ltill`} label="ВУ действует до" placeholder="10.06.2035" value={d.licenseTill} conf={conf.licenseTill} invalid={miss(d.licenseTill)} disabled={lock} onChange={(v) => setField('licenseTill', v)} />
            <FieldInput id={`${id}-cat`} label="Категории" placeholder="C, CE" value={d.categories} conf={conf.categories} mono invalid={miss(d.categories)} disabled={lock} onChange={(v) => setField('categories', v)} />
          </div>
        </div>
      </div>

      {/* ——— фотографии водительских документов: паспорт и регистрация (Task 51/53) ——— */}
      <div className="mt-3">
        <div className="mb-1.5 text-xs font-semibold text-muted-foreground">Фотографии документов</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {DRIVER_DOC_TYPES.map((type) => {
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

// ——————————————————————————————————————————————————————————————————————————————
// Одиночные карточки «Добавить ТС» / «Добавить прицеп» (Task 48): пополнение базы
// только техникой — без водителя и фотографий. 5 обязательных полей, подсветка
// незаполненного только после «Проверить», допуск сразу после валидации
// (идемпотентно по госномеру). Участвуют в «Проверить все» через registerCheck.
// ——————————————————————————————————————————————————————————————————————————————

export interface SoloLineProps {
  id: string
  index: number
  carrierId: string
  /** данные, подставленные из Excel-строки (Task 51) — конкретный тип задаёт каждая карточка */
  initial?: Partial<TruckDraft> | Partial<TrailerDraft>
  /** регистрация функции проверки карточки для кнопки «Проверить все» */
  registerCheck: (id: string, fn: ((quiet?: boolean) => Promise<boolean>) | null) => void
  onRemove: (id: string) => void
}

/** Шапка одиночной карточки: иконка, заголовок, метка, кнопка проверки и удаления */
function SoloHeader({
  icon, title, index, kind, tag, checking, admitted, onCheck, onRemove,
}: {
  icon: ReactNode
  title: string
  index: number
  kind: string
  /** метка источника данных, например «Из Excel» (Task 51) */
  tag?: string
  checking: boolean
  admitted: boolean
  onCheck: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-slate-600" aria-hidden>
        {icon}
      </span>
      <span className="text-sm font-semibold text-slate-900">{title}</span>
      {tag && (
        <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-px text-[10px] font-semibold text-sky-700">
          {tag}
        </span>
      )}
      {admitted && (
        <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700">
          <BadgeCheck className="h-3 w-3" aria-hidden />
          допущено в базу
        </span>
      )}
      <span className="flex-1" />
      {!admitted && (
        <Button
          size="sm"
          onClick={onCheck}
          disabled={checking}
          className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
        >
          <ScanLine className="h-4 w-4" aria-hidden />
          {checking ? 'Проверяем…' : 'Проверить'}
        </Button>
      )}
      <Button size="icon" variant="ghost" onClick={onRemove} aria-label={`Убрать карточку ${kind} ${index + 1}`} className="h-8 w-8 text-slate-400 hover:text-red-600">
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  )
}

/** Зелёная плашка допуска одиночной карточки */
function SoloAdmitted({ title, label, kind, onRemove }: { title: string; label: string; kind: string; onRemove: () => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden />
      <span className="font-semibold">{title}</span>
      <span>· {label}</span>
      <span className="flex-1" />
      <Button size="sm" variant="outline" className="h-7 gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-100" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        Убрать карточку
      </Button>
      <span className="sr-only">{kind} записан в справочник аккаунта</span>
    </div>
  )
}

// ——— Фотографии одиночных карточек «ТС»/«Прицеп» (Task 53): загрузка файлом
// или вставка из буфера обмена (Ctrl+V). Слоты обязательны и подсвечиваются
// только после «Проверить» — ровно как поля. ———

const SOLO_PHOTO_KEYS = ['vehicle', 'sts'] as const
type SoloPhotoKey = (typeof SOLO_PHOTO_KEYS)[number]
type SoloPhoto = { fileName: string; dataUri: string }
type SoloPhotoState = Record<SoloPhotoKey, SoloPhoto | null>
const EMPTY_SOLO_PHOTOS: SoloPhotoState = { vehicle: null, sts: null }

const TRUCK_PHOTO_LABELS: Record<SoloPhotoKey, string> = { vehicle: 'Фото тягача', sts: 'Фото СТС тягача' }
const TRAILER_PHOTO_LABELS: Record<SoloPhotoKey, string> = { vehicle: 'Фото прицепа', sts: 'Фото СТС прицепа' }

/** Состояние фото одиночной карточки + вставка скриншота из буфера обмена (общее для ТС и прицепа) */
function useSoloPhotos(
  labels: Record<SoloPhotoKey, string>,
  admitted: boolean,
  toast: ReturnType<typeof useToast>['toast'],
) {
  const [photos, setPhotos] = useState<SoloPhotoState>(EMPTY_SOLO_PHOTOS)
  const photosRef = useRef(photos)
  useEffect(() => {
    photosRef.current = photos
  })

  /** выбор файла в слоте (клик по плашке или «Заменить») */
  const pick = useCallback(async (k: SoloPhotoKey, file: File) => {
    try {
      const dataUri = await fileToCompressedDataUri(file)
      setPhotos((cur) => ({ ...cur, [k]: { fileName: file.name, dataUri } }))
    } catch {
      toast({ title: 'Ошибка', description: 'Не удалось прочитать файл', variant: 'destructive' })
    }
  }, [toast])

  const remove = useCallback((k: SoloPhotoKey) => {
    setPhotos((cur) => ({ ...cur, [k]: null }))
  }, [])

  // вставка изображения из буфера обмена (Ctrl+V): картинка занимает первый свободный слот
  useEffect(() => {
    if (admitted) return
    const onPaste = (e: ClipboardEvent) => {
      const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
      if (imgs.length === 0) return
      e.preventDefault()
      void (async () => {
        for (const file of imgs) {
          const key = SOLO_PHOTO_KEYS.find((k) => !photosRef.current[k])
          if (!key) {
            toast({ title: 'Все слоты фото уже заняты', description: 'Замените или уберите фото, чтобы вставить новое' })
            return
          }
          try {
            const dataUri = await fileToCompressedDataUri(file)
            if (photosRef.current[key]) continue // слот заняли, пока изображение сжималось
            const up = { fileName: file.name || 'Вставленное фото', dataUri }
            photosRef.current = { ...photosRef.current, [key]: up }
            setPhotos(photosRef.current)
            toast({ title: 'Фото вставлено из буфера', description: labels[key] })
          } catch {
            toast({ title: 'Ошибка', description: 'Не удалось прочитать изображение из буфера обмена', variant: 'destructive' })
          }
        }
      })()
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [admitted, labels, toast])

  return { photos, pick, remove }
}

/** Слоты фото одиночной карточки: до загрузки — пунктирная плашка, после — превью */
function SoloPhotos({
  photos, labels, showMiss, lock, onPick, onRemove,
}: {
  photos: SoloPhotoState
  labels: Record<SoloPhotoKey, string>
  /** подсветка незаполненного — включается только после «Проверить» */
  showMiss: boolean
  lock: boolean
  onPick: (k: SoloPhotoKey, file: File) => void
  onRemove: (k: SoloPhotoKey) => void
}) {
  return (
    <div className="mt-3">
      <div className="mb-1.5 text-xs font-semibold text-muted-foreground">
        Фотографии — загрузите файлом или вставьте скриншот (Ctrl+V)
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SOLO_PHOTO_KEYS.map((k) => {
          const up = photos[k]
          const photoMiss = showMiss && !up
          return (
            <div key={k} className={`rounded-lg border p-2 ${up ? 'border-slate-200 bg-slate-50/40' : photoMiss ? 'border-dashed border-red-400 bg-red-50/40' : 'border-dashed border-slate-300 bg-slate-50/40'}`}>
              <div className="flex items-center justify-between gap-1">
                <span className={`truncate text-[11px] font-semibold ${photoMiss ? 'text-red-600' : 'text-slate-700'}`}>
                  {labels[k]}
                  {photoMiss && <span aria-hidden> — добавьте фото</span>}
                </span>
              </div>
              {up ? (
                <>
                  <img src={up.dataUri} alt={`Фото: ${labels[k]}`} className="mt-1.5 h-16 w-full rounded border border-slate-200 bg-white object-contain" />
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <span className="truncate text-[10px] text-muted-foreground" title={up.fileName}>{up.fileName}</span>
                    {!lock && (
                      <>
                        <label className="cursor-pointer text-[10px] font-medium text-blue-700 hover:underline">
                          Заменить
                          <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(k, f) }} />
                        </label>
                        <button type="button" className="text-[10px] text-slate-400 hover:text-red-600" aria-label={`Убрать ${labels[k]}`} onClick={() => onRemove(k)}>
                          <X className="h-3 w-3" aria-hidden />
                        </button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <label className={`mt-1 flex h-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded border border-dashed bg-white/60 text-center ${photoMiss ? 'border-red-300 hover:border-red-400' : 'border-slate-300 hover:border-blue-400'}`}>
                  <span className={`text-[10px] font-medium ${photoMiss ? 'text-red-600' : 'text-blue-700'}`}>Загрузить фото</span>
                  <span className="px-1 text-[9px] leading-tight text-muted-foreground">JPG/PNG или вставить Ctrl+V</span>
                  <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(k, f) }} />
                </label>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Одиночная карточка «Добавить ТС» — пополняет базу одним тягачом, без водителя
 * и прицепа. Все 5 полей и 2 фото (Task 53 — загрузка файлом или вставка Ctrl+V)
 * обязательны: подсветка незаполненного появляется только после «Проверить»
 * и гаснет при заполнении. Допуск после валидации (идемпотентно по госномеру).
 * Может принимать данные из Excel-строки (initial, Task 51).
 */
export function TruckLine({ id, index, carrierId, initial, registerCheck, onRemove }: Omit<SoloLineProps, 'initial'> & { initial?: Partial<TruckDraft> }) {
  const { toast } = useToast()

  const [t, setT] = useState<TruckDraft>({
    brand: initial?.brand ?? '',
    plate: initial?.plate ?? '',
    sts: initial?.sts ?? '',
    color: initial?.color ?? '',
    owner: initial?.owner ?? '',
  })
  const [showErrors, setShowErrors] = useState(false)
  const [checking, setChecking] = useState(false)
  const [admitted, setAdmitted] = useState<string | null>(null)
  // фото ТС (Task 53): файл или Ctrl+V — оба слота обязательны
  const { photos, pick: pickPhoto, remove: removePhoto } = useSoloPhotos(TRUCK_PHOTO_LABELS, admitted !== null, toast)

  const setField = useCallback((k: keyof TruckDraft, v: string) => setT((cur) => ({ ...cur, [k]: v })), [])
  /** обязательное поле подсвечено, если проверка уже запускалась и поле пустое */
  const miss = useCallback((v: string) => showErrors && v.trim() === '', [showErrors])
  const lock = admitted !== null || checking

  const check = useCallback(async (quiet = false): Promise<boolean> => {
    if (admitted) return true
    if (checking) return false

    // ——— валидация «все поля и фото обязательны»: подсветка появляется только здесь ———
    setShowErrors(true)
    const missing = (Object.keys(TRUCK_LABELS) as (keyof TruckDraft)[]).filter((k) => t[k].trim() === '')
    const missingPhotos = SOLO_PHOTO_KEYS.filter((k) => !photos[k])
    if (missing.length > 0 || missingPhotos.length > 0) {
      if (!quiet) {
        const parts = [
          missing.length > 0 ? `Поля: ${missing.map((k) => TRUCK_LABELS[k]).join(', ')}` : null,
          missingPhotos.length > 0 ? `Фото: ${missingPhotos.map((k) => TRUCK_PHOTO_LABELS[k]).join(', ')}` : null,
        ].filter(Boolean)
        toast({ title: 'Не все поля заполнены', description: parts.join(' · '), variant: 'destructive' })
      }
      return false
    }

    setChecking(true)
    try {
      const res = await api.createDirectory('truck', {
        carrierId,
        brand: t.brand.trim(),
        plate: t.plate.trim(),
        sts: t.sts.trim(),
        color: t.color.trim(),
        owner: t.owner.trim(),
      })
      const label = res.truck ? `${res.truck.brand} ${res.truck.plate}` : `${t.brand.trim()} ${t.plate.trim()}`
      setAdmitted(label)
      toast({ title: 'ТС допущено в базу', description: label })
      return true
    } catch (e) {
      toast({
        title: 'Не удалось сохранить ТС',
        description: e instanceof Error ? e.message : 'Неизвестная ошибка',
        variant: 'destructive',
      })
      return false
    } finally {
      setChecking(false)
    }
  }, [admitted, checking, t, photos, carrierId, toast])

  // регистрация функции проверки для «Проверить все» (актуальная версия через ref-эффект)
  const checkRef = useRef(check)
  useEffect(() => {
    checkRef.current = check
  })
  useEffect(() => {
    registerCheck(id, (quiet) => checkRef.current(quiet))
    return () => registerCheck(id, null)
  }, [id, registerCheck])

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4"
      aria-label={`Карточка ТС ${index + 1}`}
    >
      <SoloHeader
        icon={<Truck className="h-3.5 w-3.5" />}
        title="Новое ТС (тягач)"
        index={index}
        kind="ТС"
        tag={initial ? 'Из Excel' : undefined}
        checking={checking}
        admitted={admitted !== null}
        onCheck={() => void check()}
        onRemove={() => onRemove(id)}
      />
      {admitted !== null ? (
        <SoloAdmitted title="ТС допущено в базу" label={admitted} kind="ТС" onRemove={() => onRemove(id)} />
      ) : (
        <div className="mt-3">
          <TruckFields
            prefix={id}
            value={t}
            miss={miss}
            lock={lock}
            onChange={setField}
            className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5"
          />
          {/* фото ТС и СТС — загрузка файлом или вставка Ctrl+V (Task 53) */}
          <SoloPhotos
            photos={photos}
            labels={TRUCK_PHOTO_LABELS}
            showMiss={showErrors}
            lock={lock}
            onPick={(k, f) => void pickPhoto(k, f)}
            onRemove={removePhoto}
          />
        </div>
      )}
    </section>
  )
}

/**
 * Одиночная карточка «Добавить прицеп» — пополняет базу одним прицепом, без
 * водителя и тягача. Все 5 полей (тип — Select) и 2 фото (Task 53 — загрузка
 * файлом или вставка Ctrl+V) обязательны: подсветка только после «Проверить».
 * Допуск после валидации. Может принимать данные из Excel-строки (initial, Task 51).
 */
export function TrailerLine({ id, index, carrierId, initial, registerCheck, onRemove }: Omit<SoloLineProps, 'initial'> & { initial?: Partial<TrailerDraft> }) {
  const { toast } = useToast()

  const [tr, setTr] = useState<TrailerDraft>({
    type: initial?.type ?? '',
    plate: initial?.plate ?? '',
    sts: initial?.sts ?? '',
    color: initial?.color ?? '',
    owner: initial?.owner ?? '',
  })
  const [showErrors, setShowErrors] = useState(false)
  const [checking, setChecking] = useState(false)
  const [admitted, setAdmitted] = useState<string | null>(null)
  // фото прицепа (Task 53): файл или Ctrl+V — оба слота обязательны
  const { photos, pick: pickPhoto, remove: removePhoto } = useSoloPhotos(TRAILER_PHOTO_LABELS, admitted !== null, toast)

  const setField = useCallback((k: keyof TrailerDraft, v: string) => setTr((cur) => ({ ...cur, [k]: v })), [])
  /** обязательное поле подсвечено, если проверка уже запускалась и поле пустое */
  const miss = useCallback((v: string) => showErrors && v.trim() === '', [showErrors])
  const lock = admitted !== null || checking

  const check = useCallback(async (quiet = false): Promise<boolean> => {
    if (admitted) return true
    if (checking) return false

    // ——— валидация «все поля и фото обязательны»: подсветка появляется только здесь ———
    setShowErrors(true)
    const missing = (Object.keys(TRAILER_LABELS) as (keyof TrailerDraft)[]).filter((k) => tr[k].trim() === '')
    const missingPhotos = SOLO_PHOTO_KEYS.filter((k) => !photos[k])
    if (missing.length > 0 || missingPhotos.length > 0) {
      if (!quiet) {
        const parts = [
          missing.length > 0 ? `Поля: ${missing.map((k) => TRAILER_LABELS[k]).join(', ')}` : null,
          missingPhotos.length > 0 ? `Фото: ${missingPhotos.map((k) => TRAILER_PHOTO_LABELS[k]).join(', ')}` : null,
        ].filter(Boolean)
        toast({ title: 'Не все поля заполнены', description: parts.join(' · '), variant: 'destructive' })
      }
      return false
    }

    setChecking(true)
    try {
      const res = await api.createDirectory('trailer', {
        carrierId,
        type: tr.type || TRAILER_TYPES[0],
        plate: tr.plate.trim(),
        sts: tr.sts.trim(),
        color: tr.color.trim(),
        owner: tr.owner.trim(),
      })
      const label = res.trailer ? `${res.trailer.type} ${res.trailer.plate}` : `${tr.type} ${tr.plate.trim()}`
      setAdmitted(label)
      toast({ title: 'Прицеп допущен в базу', description: label })
      return true
    } catch (e) {
      toast({
        title: 'Не удалось сохранить прицеп',
        description: e instanceof Error ? e.message : 'Неизвестная ошибка',
        variant: 'destructive',
      })
      return false
    } finally {
      setChecking(false)
    }
  }, [admitted, checking, tr, photos, carrierId, toast])

  // регистрация функции проверки для «Проверить все» (актуальная версия через ref-эффект)
  const checkRef = useRef(check)
  useEffect(() => {
    checkRef.current = check
  })
  useEffect(() => {
    registerCheck(id, (quiet) => checkRef.current(quiet))
    return () => registerCheck(id, null)
  }, [id, registerCheck])

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4"
      aria-label={`Карточка прицепа ${index + 1}`}
    >
      <SoloHeader
        icon={<CarFront className="h-3.5 w-3.5" />}
        title="Новый прицеп"
        index={index}
        kind="прицепа"
        tag={initial ? 'Из Excel' : undefined}
        checking={checking}
        admitted={admitted !== null}
        onCheck={() => void check()}
        onRemove={() => onRemove(id)}
      />
      {admitted !== null ? (
        <SoloAdmitted title="Прицеп допущен в базу" label={admitted} kind="Прицеп" onRemove={() => onRemove(id)} />
      ) : (
        <div className="mt-3">
          <TrailerFields
            prefix={id}
            value={tr}
            types={TRAILER_TYPES}
            miss={miss}
            lock={lock}
            onChange={setField}
            className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5"
          />
          {/* фото прицепа и СТС — загрузка файлом или вставка Ctrl+V (Task 53) */}
          <SoloPhotos
            photos={photos}
            labels={TRAILER_PHOTO_LABELS}
            showMiss={showErrors}
            lock={lock}
            onPick={(k, f) => void pickPhoto(k, f)}
            onRemove={removePhoto}
          />
        </div>
      )}
    </section>
  )
}
