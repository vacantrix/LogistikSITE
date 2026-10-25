'use client'

/**
 * Карточки пополнения базы для «Подать документов» (Task 29/30/32/33/35/48/51/53).
 *
 * DriverLine (по умолчанию) — карточка водителя: ТОЛЬКО данные водителя (Task 51,
 * по просьбе пользователя: при «Добавить водителя» открывается плашка именно с
 * данными водителя, без техники) — поля карточки + 2 фото (паспорт и регистрация;
 * водительское удостоверение платформа не запрашивает).
 * TruckLine / TrailerLine — одиночные карточки «Добавить ТС» / «Добавить прицеп»
 * (Task 48): когда нужно пополнить базу только техникой — 5 полей + 2 фото
 * (сама техника и СТС; Task 53 — фото добавляются файлом или вставкой Ctrl+V);
 * принимают данные из Excel-строки (Task 51).
 *
 * При старте ничего не горит красным, кнопка «Проверить» чёрная и всегда активна;
 * если что-то не заполнено — после нажатия подсвечиваются все пропущенные поля
 * и слоты фото. Когда всё заполнено, кнопка карточки водителя запускает нейросеть:
 * она читает фото, заполняет ТОЛЬКО пустые поля, сверяет данные между документами
 * и сама допускает карточку в базу аккаунта (идемпотентно, по паспорту)
 * или отклоняет. Одиночные карточки допускаются сразу после валидации полей и фото.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  BadgeCheck, CarFront, CircleAlert, IdCard, ScanLine, Sparkles, Truck, Trash2, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DocStatusBadge, InfoTip } from '@/components/platform/common'
import {
  DateField, FieldLabel, GeoField, IssuedByField, PositionField, fieldCls,
} from '@/components/platform/proforma-fields'
import ScanOverlay from '@/components/platform/scan-overlay'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { DOC_TYPE_LABEL } from '@/lib/status'
import { PhotoSteps, useStepUploads, type StepFile, type StepLoading } from '@/components/platform/photo-steps'
import { validatePortField, type PortFieldKind } from '@/lib/port-fields'
import type { DocType, IntakeResult, VehicleIntakeResult } from '@/lib/types'
import type { Suggestion } from '@/lib/suggest'

/** Ровно два типа прицепа (утверждено пользователем, Task 32) */
export const TRAILER_TYPES = ['Полуприцеп-штора', 'Полуприцепы-контейнеровозы'] as const

/** Человекочитаемые имена обязательных полей — для подсветки и текста ошибок (Task 44) */
export const DRIVER_LABELS: Record<string, string> = {
  fullName: 'ФИО', birthDate: 'Дата рождения', citizenship: 'Гражданство', phone: 'Телефон',
  address: 'Адрес регистрации', passport: 'Паспорт', passportIssuedBy: 'Кем выдан',
  passportIssuedDate: 'Дата выдачи', position: 'Должность',
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

/** Чем карточка занята: нейросеть заполняет (fast), проверяет (accurate) или тихо — из «Проверить все» (Task 83) */
type CardBusy = 'fill' | 'check' | 'check-quiet' | null

type Upload = StepFile
/** Фото документов водителя: паспорт и регистрация (водительское удостоверение не запрашивается) */
const DRIVER_DOC_TYPES: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG']

const EMPTY_VERDICTS: Partial<Record<DocType, IntakeResult['documents'][number]>> = {}

/** Данные из Excel/демо — поля, уже известные до проверки. Водительская карточка
 * использует только driver; truck/trailer из строки становятся отдельными карточками (Task 51) */
export interface DriverLineInitial {
  driver?: Partial<Record<'fullName' | 'birthDate' | 'citizenship' | 'phone' | 'birthPlace' | 'address' | 'passport' | 'passportIssuedBy' | 'passportIssuedDate' | 'position', string>>
  truck?: Partial<Record<'brand' | 'plate' | 'sts' | 'color' | 'owner', string>>
  trailer?: Partial<Record<'type' | 'plate' | 'sts' | 'color' | 'owner', string>>
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
      <FieldLabel htmlFor={id} label={label} invalid={invalid} conf={conf} />
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={`mt-1 ${fieldCls(invalid, mono)}`}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

/** Поля тягача — общий блок линии водителя и одиночной карточки «Добавить ТС» (Task 48).
 * conf — уверенность нейросети (Task 83); bad — поля, не прошедшие форматные правила (Task 80/83) */
function TruckFields({
  prefix, value, miss, lock, conf, bad, onChange, className = 'space-y-2',
}: {
  prefix: string
  value: TruckDraft
  miss: (v: string) => boolean
  lock: boolean
  onChange: (k: keyof TruckDraft, v: string) => void
  /** уверенность нейросети по полям (Task 83) */
  conf?: Record<string, number>
  /** поля, не прошедшие форматные правила «Авто в порт»: ключ → сообщение (Task 80/83) */
  bad?: Record<string, string>
  className?: string
}) {
  const badF = (k: string) => Boolean(bad?.[k])
  return (
    <div className={className}>
      <FieldInput id={`${prefix}-tb`} label="Марка, модель" placeholder="КАМАЗ 54901-CA" value={value.brand} conf={conf?.brand} invalid={miss(value.brand) || badF('brand')} disabled={lock} onChange={(v) => onChange('brand', v)} />
      <FieldInput id={`${prefix}-tp`} label="Госномер" placeholder="У783АХ152" value={value.plate} mono conf={conf?.plate} invalid={miss(value.plate) || badF('plate')} disabled={lock} onChange={(v) => onChange('plate', v)} />
      <FieldInput id={`${prefix}-ts`} label="СТС" placeholder="99 17 454545" value={value.sts} mono conf={conf?.sts} invalid={miss(value.sts) || badF('sts')} disabled={lock} onChange={(v) => onChange('sts', v)} />
      <FieldInput id={`${prefix}-tc`} label="Цвет" placeholder="зелёный" value={value.color} conf={conf?.color} invalid={miss(value.color) || badF('color')} disabled={lock} onChange={(v) => onChange('color', v)} />
      <FieldInput id={`${prefix}-to`} label="Собственник" placeholder="ООО «Перевозчик Б»" value={value.owner} conf={conf?.owner} invalid={miss(value.owner) || badF('owner')} disabled={lock} onChange={(v) => onChange('owner', v)} />
    </div>
  )
}

/** Поля прицепа — общий блок линии водителя и одиночной карточки «Добавить прицеп» (Task 48).
 * conf — уверенность нейросети (Task 83); bad — поля, не прошедшие форматные правила (Task 80/83) */
function TrailerFields({
  prefix, value, types, miss, lock, conf, bad, onChange, className = 'space-y-2',
}: {
  prefix: string
  value: TrailerDraft
  types: readonly string[]
  miss: (v: string) => boolean
  lock: boolean
  onChange: (k: keyof TrailerDraft, v: string) => void
  /** уверенность нейросети по полям (Task 83) */
  conf?: Record<string, number>
  /** поля, не прошедшие форматные правила «Авто в порт»: ключ → сообщение (Task 80/83) */
  bad?: Record<string, string>
  className?: string
}) {
  const badF = (k: string) => Boolean(bad?.[k])
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
      <FieldInput id={`${prefix}-trp`} label="Госномер" placeholder="АТ5546152" value={value.plate} mono conf={conf?.plate} invalid={miss(value.plate) || badF('plate')} disabled={lock} onChange={(v) => onChange('plate', v)} />
      <FieldInput id={`${prefix}-trs`} label="СТС" placeholder="52 19 777777" value={value.sts} mono conf={conf?.sts} invalid={miss(value.sts) || badF('sts')} disabled={lock} onChange={(v) => onChange('sts', v)} />
      <FieldInput id={`${prefix}-trc`} label="Цвет" placeholder="серый" value={value.color} conf={conf?.color} invalid={miss(value.color) || badF('color')} disabled={lock} onChange={(v) => onChange('color', v)} />
      <FieldInput id={`${prefix}-tro`} label="Собственник прицепа" placeholder="ООО «Перевозчик Б»" value={value.owner} conf={conf?.owner} invalid={miss(value.owner) || badF('owner')} disabled={lock} onChange={(v) => onChange('owner', v)} />
    </div>
  )
}

/**
 * Поля, заполненные нейросетью, и шаг-фото, с которого они прочитаны. Когда в шаг загружают
 * другое фото, такие поля — если их не правили вручную — очищаются: иначе карточка осталась бы
 * с данными старого снимка, а «Автозаполнение» заполняет только пустые поля.
 */
function useAiFields<F extends string, S extends string>() {
  const ref = useRef<Partial<Record<F, { value: string; source: S }>>>({})

  /** запомнить поля, которые нейросеть заполнила (были пустыми — стали заполненными) */
  const note = useCallback((before: Record<F, string>, after: Record<F, string>, sourceOf: (f: F) => S) => {
    for (const f of Object.keys(after) as F[]) {
      if (!before[f]?.trim() && after[f]?.trim()) ref.current[f] = { value: after[f], source: sourceOf(f) }
    }
  }, [])

  /** поля шага source, всё ещё равные прочитанному нейросетью; больше не отслеживаются */
  const takeStale = useCallback((source: S, current: Record<F, string>): F[] => {
    const stale = (Object.keys(ref.current) as F[]).filter((f) => ref.current[f]?.source === source && current[f] === ref.current[f]?.value)
    for (const f of stale) delete ref.current[f]
    return stale
  }, [])

  return { note, takeStale }
}

/** копия объекта без перечисленных ключей */
function omit<T extends Record<string, unknown>>(obj: T, keys: string[]): T {
  const next = { ...obj }
  for (const k of keys) delete next[k]
  return next
}

/** С какой страницы паспорта нейросеть читает поле карточки водителя */
const DRIVER_FIELD_SOURCE = (f: string): DocType => (f === 'address' ? 'PASSPORT_REG' : 'PASSPORT_PHOTO')

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

  // ——— данные водителя (13 полей) — ТОЛЬКО они в карточке «Добавить водителя» (Task 51) ———
  const [d, setD] = useState({
    fullName: initial?.driver?.fullName ?? '',
    birthDate: initial?.driver?.birthDate ?? '',
    citizenship: initial?.driver?.citizenship ?? '',
    phone: initial?.driver?.phone ?? '',
    birthPlace: initial?.driver?.birthPlace ?? '', // место рождения (необязательное: для пропуска в порт)
    address: initial?.driver?.address ?? '', // адрес регистрации (Task 33; раньше хранился в birthPlace)
    passport: initial?.driver?.passport ?? '',
    passportIssuedBy: initial?.driver?.passportIssuedBy ?? '',
    passportIssuedDate: initial?.driver?.passportIssuedDate ?? '',
    position: initial?.driver?.position || 'Водитель', // встроенный вариант должности
  })
  /** регион и район выбранного из карты адреса — по ним подсказывается «Кем выдан» */
  const [addrGeo, setAddrGeo] = useState<Pick<Suggestion, 'region' | 'county'>>({})
  const readError = useCallback(() => toast({ title: 'Ошибка', description: 'Не удалось прочитать файл', variant: 'destructive' }), [toast])
  // фото по шагам: 1 — страница с фото, 2 — регистрация; пока файл читается — кружок с процентами
  const { files: uploads, setFiles: setUploads, loading: uploading, load: loadUpload, remove: removeUpload } = useStepUploads<DocType>(readError)
  const [verdicts, setVerdicts] = useState<Partial<Record<DocType, IntakeResult['documents'][number]>>>(EMPTY_VERDICTS)
  const [crossChecks, setCrossChecks] = useState<IntakeResult['crossChecks']>([])
  const [conf, setConf] = useState<Record<string, number>>({})
  /** чем занята карточка (Task 83): fill — «Автозаполнение» (лёгкая модель), check — «Проверить» (точная) */
  const [busy, setBusy] = useState<CardBusy>(null)
  /** подсветка незаполненного включается только после первого нажатия «Проверить» (Task 44) */
  const [showErrors, setShowErrors] = useState(false)
  const [admitted, setAdmitted] = useState<string | null>(null)

  const setField = useCallback((k: keyof typeof d, v: string) => setD((cur) => ({ ...cur, [k]: v })), [])
  const dRef = useRef(d)
  useEffect(() => {
    dRef.current = d
  })
  const ai = useAiFields<keyof typeof d, DocType>()

  const setUpload = useCallback(async (type: DocType, file: File) => {
    if (!(await loadUpload(type, file))) return
    // новое фото — прежний вердикт по этому шагу больше не действует,
    // а поля, прочитанные со старого фото, нейросеть прочитает заново
    setVerdicts((cur) => omit(cur, [type]))
    const stale = ai.takeStale(type, dRef.current)
    if (stale.length > 0) {
      setD((cur) => ({ ...cur, ...Object.fromEntries(stale.map((k) => [k, ''])) }))
      setConf((cur) => omit(cur, stale))
    }
  }, [loadUpload, ai])

  /** обязательное поле подсвечено, если проверка уже запускалась и поле пустое */
  const miss = (v: string) => showErrors && v.trim() === ''

  /** Нейросеть читает фото и возвращает обновлённые поля (заполняются ТОЛЬКО пустые).
   * mode — какая нейросеть: fast (лёгкая, «Автозаполнение») / accurate (точная, «Проверить») */
  const runOcr = useCallback(async (mode: 'fast' | 'accurate') => {
    const res = await api.intakeDriver(
      Object.fromEntries(Object.entries(uploads).filter(([, v]) => v)) as Partial<Record<string, Upload>>,
      mode,
    )
    setVerdicts(Object.fromEntries(res.documents.map((doc) => [doc.type, doc])))
    setCrossChecks(res.crossChecks)
    // страницы паспорта были в чужих слотах — нейросеть узнала их, перекладываем фото туда, где им место
    const moved = res.documents.filter((doc) => doc.movedFrom)
    let files = uploads
    if (moved.length > 0) {
      files = { ...uploads }
      for (const doc of moved) delete files[doc.movedFrom!]
      for (const doc of moved) files[doc.type] = uploads[doc.movedFrom!]
      setUploads(files)
    }
    const movedNote = moved.length > 0 ? 'Страницы паспорта были перепутаны местами — фото переложены в свои слоты.' : ''
    const pick = (cur: string, next: string | undefined) => cur || next || ''
    // заполняем ТОЛЬКО пустые поля — вручную введённое не затирается
    const eff = {
      ...d,
      fullName: pick(d.fullName, res.driver.fullName),
      birthDate: pick(d.birthDate, res.driver.birthDate),
      passport: pick(d.passport, res.driver.passport),
      passportIssuedDate: pick(d.passportIssuedDate, res.driver.passportIssuedDate),
      citizenship: pick(d.citizenship, res.driver.citizenship),
      passportIssuedBy: pick(d.passportIssuedBy, res.driver.passportIssuedBy),
      birthPlace: pick(d.birthPlace, res.driver.birthPlace),
      address: pick(d.address, res.driver.address),
    }
    ai.note(d, eff, DRIVER_FIELD_SOURCE)
    setD(eff)
    setConf(res.driver.confidence ?? {})
    return { effD: eff, latest: res.documents, files, movedNote }
  }, [uploads, d, ai])

  const check = useCallback(async (quiet = false): Promise<boolean> => {
    if (admitted) return true
    if (busy) return false

    // ——— валидация «все поля обязательны»: подсветка появляется только здесь (Task 44) ———
    setShowErrors(true)
    const dKeys = Object.keys(DRIVER_LABELS) as (keyof typeof d)[]
    const missingLabels = dKeys.filter((k) => d[k].trim() === '').map((k) => DRIVER_LABELS[k])
    const missingPhotos = DRIVER_DOC_TYPES.filter((tp) => !uploads[tp])

    if (missingLabels.length > 0 || missingPhotos.length > 0) {
      if (!quiet) {
        const cap = (arr: string[]) => (arr.length > 6 ? `${arr.slice(0, 6).join(', ')} + ещё ${arr.length - 6}` : arr.join(', '))
        if (missingLabels.length === 0) {
          // заполнено всё, кроме фотографий — тот самый случай из «проформы перевозчика» (Task 83)
          toast({
            title: 'Требуется загрузить фото',
            description: `Добавьте: ${missingPhotos.map((tp) => DOC_TYPE_LABEL[tp]).join(', ')}`,
            variant: 'destructive',
          })
        } else {
          const parts = [
            `Поля: ${cap(missingLabels)}`,
            missingPhotos.length > 0 ? `Фото: ${missingPhotos.map((tp) => DOC_TYPE_LABEL[tp]).join(', ')}` : null,
          ].filter(Boolean)
          toast({ title: 'Не все поля заполнены', description: parts.join(' · '), variant: 'destructive' })
        }
      }
      return false
    }

    setBusy(quiet ? 'check-quiet' : 'check')
    try {
      // ——— «Проверить» — реальная нейропроверка: точная нейросеть (PP-OCRv5 server) читает фото
      // перед попаданием карточки в базу (Task 83); лёгкая модель оставлена «Автозаполнению» ———
      const { effD, latest, files, movedNote } = await runOcr('accurate')

      const bad = latest.filter((x) => x.status === 'REUPLOAD' || x.status === 'REJECTED')
      if (bad.length > 0) {
        toast({
          title: 'Часть документов не прошла проверку',
          description: `${movedNote ? `${movedNote} ` : ''}${bad.map((x) => DOC_TYPE_LABEL[x.type] ?? x.type).join(', ')} — замените фото или введите данные вручную`,
          variant: 'destructive',
        })
        return false
      }

      // ——— после нейросети проверяем ещё раз: не заполненными остались только то, что ИИ не смог прочитать ———
      const stillMiss = dKeys.filter((k) => effD[k].trim() === '').map((k) => DRIVER_LABELS[k])
      if (stillMiss.length > 0) {
        toast({
          title: 'После проверки не заполнены поля',
          description: `${movedNote ? `${movedNote} ` : ''}${stillMiss.join(', ')} — нейросеть не смогла прочитать, заполните вручную`,
          variant: 'destructive',
        })
        return false
      }

      // ——— допуск: в базу записывается только водитель (Task 51); фото документов
      // сохраняются вместе с записью — для предосмотра в «Справочниках» (Task 54) ———
      const driverPhotos = DRIVER_DOC_TYPES
        .filter((tp) => files[tp])
        .map((tp) => ({ label: DOC_TYPE_LABEL[tp], fileName: files[tp]!.fileName, dataUri: files[tp]!.dataUri }))
      const driverRes = await api.createDirectory('driver', {
        carrierId,
        fullName: effD.fullName.trim(),
        birthDate: effD.birthDate.trim(),
        citizenship: effD.citizenship.trim(),
        phone: effD.phone.trim(),
        birthPlace: effD.birthPlace.trim(),
        address: effD.address.trim(),
        passport: effD.passport.trim(),
        passportIssuedBy: effD.passportIssuedBy.trim(),
        passportIssuedDate: effD.passportIssuedDate.trim(),
        position: effD.position.trim(),
      }, driverPhotos)
      const name = driverRes.driver?.fullName ?? effD.fullName.trim()
      setAdmitted(name)
      onAdmitted?.()
      toast({
        title: 'Водитель допущен в базу',
        description: movedNote ? `${name}. ${movedNote}` : name,
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
      setBusy(null)
    }
  }, [admitted, busy, uploads, d, carrierId, runOcr, onAdmitted, toast])


  /** «Автозаполнение» (Task 83): лёгкая нейросеть (PP-OCRv5 mobile) читает фото и заполняет
   * пустые поля; в базу ничего не пишется — допуск только через «Проверить». Без фото —
   * красные слоты и тост «Требуется загрузить фото». */
  const autofill = useCallback(async (): Promise<boolean> => {
    if (admitted || busy) return false
    setShowErrors(true)
    const missingPhotos = DRIVER_DOC_TYPES.filter((tp) => !uploads[tp])
    if (missingPhotos.length > 0) {
      toast({
        title: 'Требуется загрузить фото',
        description: `Добавьте: ${missingPhotos.map((tp) => DOC_TYPE_LABEL[tp]).join(', ')} — нейросеть заполнит карточку по ним`,
        variant: 'destructive',
      })
      return false
    }
    setBusy('fill')
    try {
      const { effD, movedNote } = await runOcr('fast')
      const dKeys = Object.keys(DRIVER_LABELS) as (keyof typeof d)[]
      const stillEmpty = dKeys.filter((k) => effD[k].trim() === '').map((k) => DRIVER_LABELS[k])
      const what = stillEmpty.length === 0
        ? 'Лёгкая нейросеть прочитала фото — сверьте поля и нажмите «Проверить» для допуска в базу'
        : `Не прочитано: ${stillEmpty.join(', ')} — заполните вручную и нажмите «Проверить»`
      toast({
        title: stillEmpty.length === 0 ? 'Карточка заполнена нейросетью' : 'Карточка заполнена частично',
        description: movedNote ? `${movedNote} ${what}` : what,
      })
      return true
    } catch (e) {
      toast({
        title: 'Автозаполнение не удалось',
        description: e instanceof Error ? e.message : 'Неизвестная ошибка',
        variant: 'destructive',
      })
      return false
    } finally {
      setBusy(null)
    }
  }, [admitted, busy, uploads, runOcr, toast])

  // регистрация функции проверки для «Проверить все» (актуальная версия через ref-эффект)
  const checkRef = useRef(check)
  useEffect(() => {
    checkRef.current = check
  })
  useEffect(() => {
    registerCheck(id, (quiet) => checkRef.current(quiet))
    return () => registerCheck(id, null)
  }, [id, registerCheck])

  const lock = admitted !== null || busy !== null

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
            variant="outline"
            onClick={() => void autofill()}
            disabled={busy !== null || uploading !== null}
            className="gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {busy === 'fill' ? 'Заполняем…' : 'Автозаполнение'}
          </Button>
        )}
        {!admitted && (
          <Button
            size="sm"
            onClick={() => void check()}
            disabled={busy !== null || uploading !== null}
            className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
          >
            <ScanLine className="h-4 w-4" aria-hidden />
            {busy === 'check' ? 'Проверяем…' : 'Проверить'}
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
            <DateField id={`${id}-bd`} label="Дата рождения" value={d.birthDate} conf={conf.birthDate} invalid={miss(d.birthDate)} disabled={lock} defaultYear={1985} onChange={(v) => setField('birthDate', v)} />
            <FieldInput id={`${id}-cit`} label="Гражданство" placeholder="РФ" value={d.citizenship} invalid={miss(d.citizenship)} disabled={lock} onChange={(v) => setField('citizenship', v)} />
            <FieldInput id={`${id}-tel`} label="Телефон" placeholder="+7 900 000-00-00" value={d.phone} mono invalid={miss(d.phone)} disabled={lock} onChange={(v) => setField('phone', v)} />
            <GeoField
              id={`${id}-adr`} kind="address" label="Адрес регистрации" placeholder="Начните вводить: Абинск, Интернациональная"
              className="sm:col-span-2" value={d.address} conf={conf.address} invalid={miss(d.address)} disabled={lock}
              onChange={(v) => setField('address', v)} onPickGeo={(s) => setAddrGeo({ region: s.region, county: s.county })}
            />
            <GeoField id={`${id}-bpl`} kind="place" label="Место рождения" placeholder="Краснодар" value={d.birthPlace} conf={conf.birthPlace} disabled={lock} onChange={(v) => setField('birthPlace', v)} />
            <FieldInput id={`${id}-pass`} label="Паспорт" placeholder="52 10 884610" value={d.passport} conf={conf.passport} mono invalid={miss(d.passport)} disabled={lock} onChange={(v) => setField('passport', v)} />
            <IssuedByField
              id={`${id}-pby`} label="Кем выдан" placeholder="ГУ МВД России по …" className="sm:col-span-2"
              value={d.passportIssuedBy} conf={conf.passportIssuedBy} invalid={miss(d.passportIssuedBy)} disabled={lock}
              region={addrGeo.region} county={addrGeo.county} address={d.address}
              onChange={(v) => setField('passportIssuedBy', v)}
            />
            <DateField id={`${id}-pdate`} label="Дата выдачи" value={d.passportIssuedDate} conf={conf.passportIssuedDate} invalid={miss(d.passportIssuedDate)} disabled={lock} fromYear={1997} onChange={(v) => setField('passportIssuedDate', v)} />
            <PositionField id={`${id}-pos`} label="Должность" value={d.position} invalid={miss(d.position)} disabled={lock} onChange={(v) => setField('position', v)} />
          </div>
        </div>
      </div>

      {/* ——— фотографии водительских документов: паспорт и регистрация (Task 51/53) ——— */}
      <div className="mt-3">
        <div className="mb-1.5 text-xs font-semibold text-muted-foreground">Фотографии документов</div>
        <PhotoSteps
          steps={DRIVER_DOC_TYPES.map((type) => ({ key: type, label: DOC_TYPE_LABEL[type] }))}
          files={uploads}
          loading={uploading}
          lock={lock}
          showMiss={showErrors}
          onPick={(type, f) => void setUpload(type, f)}
          onRemove={removeUpload}
          tone={(type) => (verdicts[type] ? (verdicts[type]!.status === 'PASSED' ? 'ok' : 'bad') : null)}
          badge={(type) => (verdicts[type] ? <DocStatusBadge status={verdicts[type]!.status} /> : null)}
          extra={(type) => {
            const v = verdicts[type]
            if (!v) return null
            return (
              <div className="mt-1 space-y-0.5">
                {/* качество приходит по шкале 0–100; 0 — распознавание не выполнялось */}
                {v.quality > 0 && (
                  <div className={`text-[10px] font-medium ${v.quality >= 60 ? 'text-emerald-700' : 'text-amber-700'}`}>
                    Качество изображения {Math.round(v.quality)}%
                  </div>
                )}
                {v.issues.map((issue) => (
                  <div key={issue} className="flex items-start gap-1 text-[10px] leading-snug text-red-700">
                    <CircleAlert className="mt-px h-2.5 w-2.5 shrink-0" aria-hidden />
                    {issue}
                  </div>
                ))}
              </div>
            )
          }}
        />
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

      {/* ——— «замыливание» экрана с лупой, пока нейросеть работает над карточкой (Task 83) ——— */}
      <ScanOverlay
        open={busy === 'fill' || busy === 'check'}
        title={busy === 'fill' ? 'Автозаполнение' : 'Проверка карточки'}
        steps={busy === 'fill'
          ? ['Читаем фото документов…', 'Распознаём поля…', 'Заполняем карточку…']
          : undefined}
      />
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

/** Шапка одиночной карточки: иконка, заголовок, метка, кнопки «Автозаполнение»/«Проверить» и удаления */
function SoloHeader({
  icon, title, index, kind, tag, busy, admitted, onAutofill, uploading = false, onCheck, onRemove,
}: {
  icon: ReactNode
  title: string
  index: number
  kind: string
  /** метка источника данных, например «Из Excel» (Task 51) */
  tag?: string
  busy: CardBusy
  admitted: boolean
  /** если задана — в шапке появляется кнопка «Автозаполнение» (Task 83) */
  onAutofill?: () => void
  /** фото ещё загружается — кнопки нейросети ждут */
  uploading?: boolean
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
      {!admitted && onAutofill && (
        <Button
          size="sm"
          variant="outline"
          onClick={onAutofill}
          disabled={busy !== null || uploading}
          className="gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          {busy === 'fill' ? 'Заполняем…' : 'Автозаполнение'}
        </Button>
      )}
      {!admitted && (
        <Button
          size="sm"
          onClick={onCheck}
          disabled={busy !== null || uploading}
          className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
        >
          <ScanLine className="h-4 w-4" aria-hidden />
          {busy === 'check' ? 'Проверяем…' : 'Проверить'}
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
type SoloPhoto = StepFile
type SoloPhotoState = Partial<Record<SoloPhotoKey, SoloPhoto>>

const TRUCK_PHOTO_LABELS: Record<SoloPhotoKey, string> = { vehicle: 'Фото тягача', sts: 'Фото СТС тягача' }
const TRAILER_PHOTO_LABELS: Record<SoloPhotoKey, string> = { vehicle: 'Фото прицепа', sts: 'Фото СТС прицепа' }

/** Состояние фото одиночной карточки (по шагам, с кружком прогресса) + вставка скриншота
 * из буфера обмена (общее для ТС и прицепа) */
function useSoloPhotos(
  labels: Record<SoloPhotoKey, string>,
  admitted: boolean,
  toast: ReturnType<typeof useToast>['toast'],
) {
  const readError = useCallback(() => toast({ title: 'Ошибка', description: 'Не удалось прочитать файл', variant: 'destructive' }), [toast])
  const { files: photos, loading, load, remove } = useStepUploads<SoloPhotoKey>(readError)
  const photosRef = useRef(photos)
  useEffect(() => {
    photosRef.current = photos
  })

  /** выбор файла в шаге (клик по плашке или «Заменить») */
  const pick = useCallback((k: SoloPhotoKey, file: File) => load(k, file), [load])

  // вставка изображения из буфера обмена (Ctrl+V): картинка занимает первый незагруженный шаг
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
          const up = await load(key, file)
          if (!up) return // файл не прочитан или идёт другая загрузка
          photosRef.current = { ...photosRef.current, [key]: up }
          toast({ title: 'Фото вставлено из буфера', description: labels[key] })
        }
      })()
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [admitted, labels, load, toast])

  return { photos, loading, pick, remove }
}

/** Фото одиночной карточки по шагам: 1 — машина, 2 — СТС */
function SoloPhotos({
  photos, loading, labels, showMiss, lock, onPick, onRemove,
}: {
  photos: SoloPhotoState
  loading: StepLoading<SoloPhotoKey>
  labels: Record<SoloPhotoKey, string>
  /** подсветка незаполненного — включается только после «Проверить» */
  showMiss: boolean
  lock: boolean
  onPick: (k: SoloPhotoKey, file: File) => void
  onRemove: (k: SoloPhotoKey) => void
}) {
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        Фотографии
        <InfoTip label="Как добавить фото">Загрузите файлом (JPG/PNG) или вставьте скриншот через Ctrl+V — по порядку шагов.</InfoTip>
      </div>
      <PhotoSteps
        steps={SOLO_PHOTO_KEYS.map((k) => ({ key: k, label: labels[k] }))}
        files={photos}
        loading={loading}
        lock={lock}
        showMiss={showMiss}
        onPick={onPick}
        onRemove={onRemove}
      />
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
  const [admitted, setAdmitted] = useState<string | null>(null)
  /** чем занята карточка (Task 83): fill — «Автозаполнение» (лёгкая модель), check — «Проверить» (точная) */
  const [busy, setBusy] = useState<CardBusy>(null)
  /** уверенность нейросети по полям (Task 83) */
  const [conf, setConf] = useState<Record<string, number>>({})
  /** поля, не прошедшие форматные правила «Авто в порт» (Task 80/83): ключ → сообщение */
  const [formatBad, setFormatBad] = useState<Record<string, string>>({})
  // фото ТС (Task 53): файл или Ctrl+V — оба слота обязательны
  const { photos, loading: photoLoading, pick: pickPhoto, remove: removePhoto } = useSoloPhotos(TRUCK_PHOTO_LABELS, admitted !== null, toast)

  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })
  const ai = useAiFields<keyof TruckDraft, SoloPhotoKey>()
  /** новое фото в шаге: поля, прочитанные нейросетью со старого СТС, очищаются */
  const pickAndReset = useCallback(async (k: SoloPhotoKey, file: File) => {
    if (!(await pickPhoto(k, file))) return
    const stale = ai.takeStale(k, tRef.current)
    if (stale.length === 0) return
    setT((cur) => ({ ...cur, ...Object.fromEntries(stale.map((f) => [f, ''])) }))
    setConf((cur) => omit(cur, stale))
    setFormatBad((cur) => omit(cur, stale))
  }, [pickPhoto, ai])

  const setField = useCallback((k: keyof TruckDraft, v: string) => {
    setT((cur) => ({ ...cur, [k]: v }))
    setFormatBad((cur) => {
      if (!(k in cur)) return cur // правка поля гасит подсветку формата
      const n = { ...cur }; delete n[k]; return n
    })
  }, [])
  /** обязательное поле подсвечено, если проверка уже запускалась и поле пустое */
  const miss = useCallback((v: string) => showErrors && v.trim() === '', [showErrors])
  const lock = admitted !== null || busy !== null

  /** Правила «Авто в порт» по полям карточки тягача (Task 80/83) */
  const fieldKinds: Record<keyof TruckDraft, PortFieldKind> = { brand: 'text', plate: 'plate', sts: 'sts', color: 'color', owner: 'text' }

  /** Слить результат нейросети с ручным вводом: заполняются только пустые поля;
   * вернуть слитые значения и подсветить поля, нарушающие формат (Task 83) */
  const mergeVehicle = useCallback((res: VehicleIntakeResult) => {
    const pick = (cur: string, next: string | undefined) => cur.trim() || next || ''
    const merged: TruckDraft = {
      brand: pick(t.brand, res.fields.brand),
      plate: pick(t.plate, res.fields.plate),
      sts: pick(t.sts, res.fields.sts),
      color: t.color,
      owner: pick(t.owner, res.fields.owner),
    }
    ai.note(t, merged, () => 'sts')
    setT(merged)
    setConf(res.confidence as Record<string, number>)
    const bad: Record<string, string> = {}
    for (const k of Object.keys(fieldKinds) as (keyof TruckDraft)[]) {
      const val = merged[k]
      if (!val.trim()) continue // пустое — не нарушение: заполнит человек
      const r = validatePortField(fieldKinds[k], val)
      if (!r.ok && r.message) bad[k] = r.message
    }
    setFormatBad(bad)
    return { merged, bad }
  }, [t, ai])

  /** «Автозаполнение» (Task 83): лёгкая нейросеть (PP-OCRv5 mobile) читает СТС и заполняет
   * пустые поля; в базу ничего не пишется. Без фото СТС — красный слот и тост. */
  const autofill = useCallback(async (): Promise<boolean> => {
    if (admitted || busy) return false
    setShowErrors(true)
    if (!photos.sts) {
      toast({
        title: 'Требуется загрузить фото',
        description: 'Добавьте фото: СТС тягача — нейросеть заполнит карточку по нему',
        variant: 'destructive',
      })
      return false
    }
    setBusy('fill')
    try {
      const res = await api.intakeVehicle({ kind: 'truck', sts: photos.sts, mode: 'fast' })
      if (res.status === 'REUPLOAD' || res.status === 'REJECTED') {
        toast({ title: 'СТС не распознано', description: res.message, variant: 'destructive' })
        return false
      }
      const { merged, bad } = mergeVehicle(res)
      const filled = (['brand', 'plate', 'sts', 'owner'] as const).filter((k) => !t[k].trim() && merged[k].trim())
      const badList = Object.values(bad)
      toast({
        title: filled.length === 0
          ? 'Нового прочитать не удалось'
          : badList.length > 0 ? 'Заполнено, но есть нарушения формата' : 'Карточка заполнена нейросетью',
        description: [
          filled.length > 0 ? `Заполнено: ${filled.map((k) => TRUCK_LABELS[k]).join(', ')} — проверьте и нажмите «Проверить»` : 'Поля уже заполнены — лёгкая модель ничего не добавила',
          badList.length > 0 ? badList.join(' · ') : null,
        ].filter(Boolean).join(' · '),
        ...(badList.length > 0 ? { variant: 'destructive' as const } : {}),
      })
      return true
    } catch (e) {
      toast({ title: 'Автозаполнение не удалось', description: e instanceof Error ? e.message : 'Неизвестная ошибка', variant: 'destructive' })
      return false
    } finally {
      setBusy(null)
    }
  }, [admitted, busy, photos.sts, mergeVehicle, t, toast])

  const check = useCallback(async (quiet = false): Promise<boolean> => {
    if (admitted) return true
    if (busy) return false

    // ——— валидация «все поля и фото обязательны»: подсветка появляется только здесь ———
    setShowErrors(true)
    const missing = (Object.keys(TRUCK_LABELS) as (keyof TruckDraft)[]).filter((k) => t[k].trim() === '')
    const missingPhotos = SOLO_PHOTO_KEYS.filter((k) => !photos[k])
    if (missing.length > 0 || missingPhotos.length > 0) {
      if (!quiet) {
        if (missing.length === 0 && missingPhotos.length > 0) {
          // заполнено всё, кроме фото — тот самый случай из «проформы перевозчика» (Task 83)
          toast({
            title: 'Требуется загрузить фото',
            description: `Добавьте: ${missingPhotos.map((k) => TRUCK_PHOTO_LABELS[k]).join(', ')}`,
            variant: 'destructive',
          })
        } else {
          const parts = [
            missing.length > 0 ? `Поля: ${missing.map((k) => TRUCK_LABELS[k]).join(', ')}` : null,
            missingPhotos.length > 0 ? `Фото: ${missingPhotos.map((k) => TRUCK_PHOTO_LABELS[k]).join(', ')}` : null,
          ].filter(Boolean)
          toast({ title: 'Не все поля заполнены', description: parts.join(' · '), variant: 'destructive' })
        }
      }
      return false
    }

    setBusy(quiet ? 'check-quiet' : 'check')
    try {
      // ——— «Проверить» — реальная нейропроверка: точная нейросеть (PP-OCRv5 server) читает СТС
      // перед попаданием карточки в базу (Task 83); лёгкая модель оставлена «Автозаполнению» ———
      const res = await api.intakeVehicle({ kind: 'truck', sts: photos.sts!, mode: 'accurate' })
      const { merged, bad } = mergeVehicle(res)

      if (res.status === 'REUPLOAD' || res.status === 'REJECTED') {
        if (!quiet) {
          toast({ title: 'СТС не прошло проверку', description: `${res.message} — замените фото или введите данные вручную`, variant: 'destructive' })
        }
        return false
      }

      // ——— форматные правила «Авто в порт»: мусор вида «22о2/гвкгк» не попадает в базу (Task 80/83) ———
      const badList = Object.values(bad)
      if (badList.length > 0) {
        if (!quiet) {
          toast({ title: 'Формат полей не прошёл правила «Авто в порт»', description: badList.join(' · '), variant: 'destructive' })
        }
        return false
      }

      // фото ТС сохраняются вместе с записью — предосмотр в «Справочниках» (Task 54)
      const truckPhotos = SOLO_PHOTO_KEYS
        .filter((k) => photos[k])
        .map((k) => ({ label: TRUCK_PHOTO_LABELS[k], fileName: photos[k]!.fileName, dataUri: photos[k]!.dataUri }))
      const post = await api.createDirectory('truck', {
        carrierId,
        brand: merged.brand.trim(),
        plate: merged.plate.trim(),
        sts: merged.sts.trim(),
        color: merged.color.trim(),
        owner: merged.owner.trim(),
      }, truckPhotos)
      const label = post.truck ? `${post.truck.brand} ${post.truck.plate}` : `${merged.brand.trim()} ${merged.plate.trim()}`
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
      setBusy(null)
    }
  }, [admitted, busy, t, photos, carrierId, mergeVehicle, toast])

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
        busy={busy}
        uploading={photoLoading !== null}
        admitted={admitted !== null}
        onAutofill={() => void autofill()}
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
            conf={conf}
            bad={formatBad}
            onChange={setField}
            className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5"
          />
          {/* фото ТС и СТС — загрузка файлом или вставка Ctrl+V (Task 53) */}
          <SoloPhotos
            photos={photos}
            loading={photoLoading}
            labels={TRUCK_PHOTO_LABELS}
            showMiss={showErrors}
            lock={lock}
            onPick={(k, f) => void pickAndReset(k, f)}
            onRemove={removePhoto}
          />
        </div>
      )}
      {/* ——— «замыливание» экрана с лупой, пока нейросеть работает над карточкой (Task 83) ——— */}
      <ScanOverlay
        open={busy === 'fill' || busy === 'check'}
        title={busy === 'fill' ? 'Автозаполнение' : 'Проверка карточки'}
        steps={busy === 'fill'
          ? ['Читаем СТС…', 'Распознаём поля…', 'Заполняем карточку…']
          : undefined}
      />
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
  const [admitted, setAdmitted] = useState<string | null>(null)
  /** чем занята карточка (Task 83): fill — «Автозаполнение» (лёгкая модель), check — «Проверить» (точная) */
  const [busy, setBusy] = useState<CardBusy>(null)
  /** уверенность нейросети по полям (Task 83) */
  const [conf, setConf] = useState<Record<string, number>>({})
  /** поля, не прошедшие форматные правила «Авто в порт» (Task 80/83): ключ → сообщение */
  const [formatBad, setFormatBad] = useState<Record<string, string>>({})
  // фото прицепа (Task 53): файл или Ctrl+V — оба слота обязательны
  const { photos, loading: photoLoading, pick: pickPhoto, remove: removePhoto } = useSoloPhotos(TRAILER_PHOTO_LABELS, admitted !== null, toast)

  const trRef = useRef(tr)
  useEffect(() => {
    trRef.current = tr
  })
  const ai = useAiFields<keyof TrailerDraft, SoloPhotoKey>()
  /** новое фото в шаге: поля, прочитанные нейросетью со старого СТС, очищаются */
  const pickAndReset = useCallback(async (k: SoloPhotoKey, file: File) => {
    if (!(await pickPhoto(k, file))) return
    const stale = ai.takeStale(k, trRef.current)
    if (stale.length === 0) return
    setTr((cur) => ({ ...cur, ...Object.fromEntries(stale.map((f) => [f, ''])) }))
    setConf((cur) => omit(cur, stale))
    setFormatBad((cur) => omit(cur, stale))
  }, [pickPhoto, ai])

  const setField = useCallback((k: keyof TrailerDraft, v: string) => {
    setTr((cur) => ({ ...cur, [k]: v }))
    setFormatBad((cur) => {
      if (!(k in cur)) return cur // правка поля гасит подсветку формата
      const n = { ...cur }; delete n[k]; return n
    })
  }, [])
  /** обязательное поле подсвечено, если проверка уже запускалась и поле пустое */
  const miss = useCallback((v: string) => showErrors && v.trim() === '', [showErrors])
  const lock = admitted !== null || busy !== null

  /** Правила «Авто в порт» по полям карточки прицепа: госномер — по шаблону прицепа (Task 80/83) */
  const fieldKinds: Record<keyof TrailerDraft, PortFieldKind> = { type: 'text', plate: 'plateTrailer', sts: 'sts', color: 'color', owner: 'text' }

  /** Слить результат нейросети с ручным вводом: заполняются только пустые поля;
   * вернуть слитые значения и подсветить поля, нарушающие формат (Task 83) */
  const mergeVehicle = useCallback((res: VehicleIntakeResult) => {
    const pick = (cur: string, next: string | undefined) => cur.trim() || next || ''
    const merged: TrailerDraft = {
      type: tr.type,
      plate: pick(tr.plate, res.fields.plate),
      sts: pick(tr.sts, res.fields.sts),
      color: tr.color,
      owner: pick(tr.owner, res.fields.owner),
    }
    ai.note(tr, merged, () => 'sts')
    setTr(merged)
    setConf(res.confidence as Record<string, number>)
    const bad: Record<string, string> = {}
    for (const k of Object.keys(fieldKinds) as (keyof TrailerDraft)[]) {
      const val = merged[k]
      if (!val.trim()) continue // пустое — не нарушение: заполнит человек
      const r = validatePortField(fieldKinds[k], val)
      if (!r.ok && r.message) bad[k] = r.message
    }
    setFormatBad(bad)
    return { merged, bad }
  }, [tr, ai])

  /** «Автозаполнение» (Task 83): лёгкая нейросеть (PP-OCRv5 mobile) читает СТС и заполняет
   * пустые поля; в базу ничего не пишется. Без фото СТС — красный слот и тост. */
  const autofill = useCallback(async (): Promise<boolean> => {
    if (admitted || busy) return false
    setShowErrors(true)
    if (!photos.sts) {
      toast({
        title: 'Требуется загрузить фото',
        description: 'Добавьте фото: СТС прицепа — нейросеть заполнит карточку по нему',
        variant: 'destructive',
      })
      return false
    }
    setBusy('fill')
    try {
      const res = await api.intakeVehicle({ kind: 'trailer', sts: photos.sts, mode: 'fast' })
      if (res.status === 'REUPLOAD' || res.status === 'REJECTED') {
        toast({ title: 'СТС не распознано', description: res.message, variant: 'destructive' })
        return false
      }
      const { merged, bad } = mergeVehicle(res)
      const filled = (['plate', 'sts', 'owner'] as const).filter((k) => !tr[k].trim() && merged[k].trim())
      const badList = Object.values(bad)
      toast({
        title: filled.length === 0
          ? 'Нового прочитать не удалось'
          : badList.length > 0 ? 'Заполнено, но есть нарушения формата' : 'Карточка заполнена нейросетью',
        description: [
          filled.length > 0 ? `Заполнено: ${filled.map((k) => TRAILER_LABELS[k]).join(', ')} — проверьте и нажмите «Проверить»` : 'Поля уже заполнены — лёгкая модель ничего не добавила',
          badList.length > 0 ? badList.join(' · ') : null,
        ].filter(Boolean).join(' · '),
        ...(badList.length > 0 ? { variant: 'destructive' as const } : {}),
      })
      return true
    } catch (e) {
      toast({ title: 'Автозаполнение не удалось', description: e instanceof Error ? e.message : 'Неизвестная ошибка', variant: 'destructive' })
      return false
    } finally {
      setBusy(null)
    }
  }, [admitted, busy, photos.sts, mergeVehicle, tr, toast])

  const check = useCallback(async (quiet = false): Promise<boolean> => {
    if (admitted) return true
    if (busy) return false

    // ——— валидация «все поля и фото обязательны»: подсветка появляется только здесь ———
    setShowErrors(true)
    const missing = (Object.keys(TRAILER_LABELS) as (keyof TrailerDraft)[]).filter((k) => tr[k].trim() === '')
    const missingPhotos = SOLO_PHOTO_KEYS.filter((k) => !photos[k])
    if (missing.length > 0 || missingPhotos.length > 0) {
      if (!quiet) {
        if (missing.length === 0 && missingPhotos.length > 0) {
          // заполнено всё, кроме фото — тот самый случай из «проформы перевозчика» (Task 83)
          toast({
            title: 'Требуется загрузить фото',
            description: `Добавьте: ${missingPhotos.map((k) => TRAILER_PHOTO_LABELS[k]).join(', ')}`,
            variant: 'destructive',
          })
        } else {
          const parts = [
            missing.length > 0 ? `Поля: ${missing.map((k) => TRAILER_LABELS[k]).join(', ')}` : null,
            missingPhotos.length > 0 ? `Фото: ${missingPhotos.map((k) => TRAILER_PHOTO_LABELS[k]).join(', ')}` : null,
          ].filter(Boolean)
          toast({ title: 'Не все поля заполнены', description: parts.join(' · '), variant: 'destructive' })
        }
      }
      return false
    }

    setBusy(quiet ? 'check-quiet' : 'check')
    try {
      // ——— «Проверить» — реальная нейропроверка: точная нейросеть (PP-OCRv5 server) читает СТС
      // перед попаданием карточки в базу (Task 83); лёгкая модель оставлена «Автозаполнению» ———
      const res = await api.intakeVehicle({ kind: 'trailer', sts: photos.sts!, mode: 'accurate' })
      const { merged, bad } = mergeVehicle(res)

      if (res.status === 'REUPLOAD' || res.status === 'REJECTED') {
        if (!quiet) {
          toast({ title: 'СТС не прошло проверку', description: `${res.message} — замените фото или введите данные вручную`, variant: 'destructive' })
        }
        return false
      }

      // ——— форматные правила «Авто в порт»: мусор не попадает в базу (Task 80/83) ———
      const badList = Object.values(bad)
      if (badList.length > 0) {
        if (!quiet) {
          toast({ title: 'Формат полей не прошёл правила «Авто в порт»', description: badList.join(' · '), variant: 'destructive' })
        }
        return false
      }

      // фото прицепа сохраняются вместе с записью — предосмотр в «Справочниках» (Task 54)
      const trailerPhotos = SOLO_PHOTO_KEYS
        .filter((k) => photos[k])
        .map((k) => ({ label: TRAILER_PHOTO_LABELS[k], fileName: photos[k]!.fileName, dataUri: photos[k]!.dataUri }))
      const post = await api.createDirectory('trailer', {
        carrierId,
        type: merged.type || TRAILER_TYPES[0],
        plate: merged.plate.trim(),
        sts: merged.sts.trim(),
        color: merged.color.trim(),
        owner: merged.owner.trim(),
      }, trailerPhotos)
      const label = post.trailer ? `${post.trailer.type} ${post.trailer.plate}` : `${merged.type} ${merged.plate.trim()}`
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
      setBusy(null)
    }
  }, [admitted, busy, tr, photos, carrierId, mergeVehicle, toast])

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
        busy={busy}
        uploading={photoLoading !== null}
        admitted={admitted !== null}
        onAutofill={() => void autofill()}
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
            conf={conf}
            bad={formatBad}
            onChange={setField}
            className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5"
          />
          {/* фото прицепа и СТС — загрузка файлом или вставка Ctrl+V (Task 53) */}
          <SoloPhotos
            photos={photos}
            loading={photoLoading}
            labels={TRAILER_PHOTO_LABELS}
            showMiss={showErrors}
            lock={lock}
            onPick={(k, f) => void pickAndReset(k, f)}
            onRemove={removePhoto}
          />
        </div>
      )}
      {/* ——— «замыливание» экрана с лупой, пока нейросеть работает над карточкой (Task 83) ——— */}
      <ScanOverlay
        open={busy === 'fill' || busy === 'check'}
        title={busy === 'fill' ? 'Автозаполнение' : 'Проверка карточки'}
        steps={busy === 'fill'
          ? ['Читаем СТС…', 'Распознаём поля…', 'Заполняем карточку…']
          : undefined}
      />
    </section>
  )
}
