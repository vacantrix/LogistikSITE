'use client'

/**
 * ЭТрН через Диадок в разделе «Подписать ЭДО»:
 *  — EtrnSendDialog — окно «Отправить ЭТрН в Диадок»: данные титула Т1 собраны из заявки,
 *    экипажа и справочников, логист проверяет и дополняет (грузополучатель, индекс,
 *    грузоподъёмность…) и отправляет; ошибки проверки показываются списком;
 *  — EtrnStatus — полоска «Т1 → Т2 → Т3 → Т4», этап перевозки, УИД ГИС ЭПД и ошибки.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { etrnStageLabel, etrnTitlesDone } from '@/lib/diadoc/stages'
import type { EtrnT1Input, EtrnVehicle } from '@/lib/diadoc/waybill'
import { fmtDateTime } from '@/lib/status'
import type { DiadocInfoDTO, EdoDocDTO } from '@/lib/types'

/** ТипВлад по формату ФНС */
const OWNERSHIP: [string, string][] = [
  ['1', 'Собственность'], ['2', 'Совместная собственность супругов'], ['3', 'Аренда'], ['4', 'Лизинг'], ['5', 'Безвозмездное пользование'],
]

// ——— статус ЭТрН ———

export function EtrnStatus({ doc }: { doc: EdoDocDTO }) {
  const d = doc.diadoc
  if (!d) return <p className="mt-2 text-xs text-slate-500">Не отправлена в Диадок</p>
  const done = etrnTitlesDone(d.stage, doc.aemzSigned, doc.partySigned)
  const steps: [string, string, boolean][] = [
    ['Т1', 'АЭМЗ передал груз', done.t1],
    ['Т2', 'перевозчик принял', done.t2],
    ['Т3', 'грузополучатель принял', done.t3],
    ['Т4', 'перевозка завершена', done.t4],
  ]
  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-slate-200 bg-white p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {steps.map(([t, hint, ok]) => (
          <span
            key={t}
            title={hint}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ok ? 'border-emerald-600 bg-emerald-500 text-white' : 'border-slate-300 bg-slate-100 text-slate-500'}`}
          >
            {ok && <CheckCircle2 className="h-3 w-3" aria-hidden />}
            {t}
          </span>
        ))}
        <span className="text-xs font-medium text-slate-700">{etrnStageLabel(d.stage)}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
        <span>УИД ТрН: {d.uid ? <span className="font-mono text-slate-700">{d.uid}</span> : 'ещё не присвоен ГИС ЭПД'}</span>
        {d.gisStatus && <span>ГИС ЭПД: {d.gisStatus}</span>}
        {d.syncedAt && <span>сверено {fmtDateTime(d.syncedAt)}</span>}
      </div>
      {d.gisError && (
        <div className="flex items-start gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {d.gisError}
        </div>
      )}
    </div>
  )
}

// ——— окно отправки ———

/** Поле формы: подпись + ввод */
function F({ label, value, onChange, hint, mono, className, placeholder }: {
  label: string
  value: string
  onChange: (v: string) => void
  hint?: string
  mono?: boolean
  className?: string
  placeholder?: string
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ''}`}>
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      <Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`h-8 text-sm ${mono ? 'font-mono' : ''}`} />
      {hint && <span className="text-[10px] leading-tight text-slate-400">{hint}</span>}
    </label>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{children}</div>
    </fieldset>
  )
}

const EMPTY_TRAILER: EtrnVehicle = { number: '', ownership: '1', type: 'Полуприцеп', model: '', maxWeight: '', capacity: '', sts: '', vin: '' }

export function EtrnSendDialog({ open, onOpenChange, target, diadoc, onSent }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: { requestId: string; requestNumber: string; doc: EdoDocDTO } | null
  diadoc: DiadocInfoDTO
  onSent: () => void
}) {
  const { toast } = useToast()
  const [v, setV] = useState<EtrnT1Input | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [sending, setSending] = useState(false)

  // при открытии — черновик из данных рейса (или сохранённый ввод)
  useEffect(() => {
    if (!open || !target) return
    let alive = true
    api.etrnDraft(target.requestId, target.doc.id)
      .then((r) => { if (alive) { setV(r.draft); setLoadError(null); setErrors([]) } })
      .catch((e: unknown) => { if (alive) setLoadError(e instanceof Error ? e.message : 'Не удалось подготовить ЭТрН') })
    return () => { alive = false }
  }, [open, target])

  // изменение поля по пути «cargo.name», «vehicle.maxWeight»…
  const set = (path: string) => (value: string) => setV((cur) => {
    if (!cur) return cur
    const next = structuredClone(cur) as unknown as Record<string, unknown>
    const keys = path.split('.')
    let obj = next
    for (const k of keys.slice(0, -1)) obj = obj[k] as Record<string, unknown>
    obj[keys[keys.length - 1]] = value
    return next as unknown as EtrnT1Input
  })

  const send = async () => {
    if (!v || !target) return
    setSending(true)
    setErrors([])
    try {
      const r = await api.etrnSend(target.requestId, target.doc.id, v)
      toast({ title: `${/^ЭТрН/i.test(target.doc.number) ? target.doc.number : `ЭТрН №${target.doc.number}`} отправлена в Диадок`, description: r.message })
      onOpenChange(false)
      onSent()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось отправить ЭТрН'
      setErrors(msg.replace(/^Проверьте данные ЭТрН:\s*/, '').split('; ').filter(Boolean))
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Отправить ЭТрН в Диадок · №{target?.requestNumber}</DialogTitle>
          <DialogDescription>
            Титул грузоотправителя Т1 — {diadoc.stand}.{' '}
            {diadoc.signMode === 'test'
              ? 'Подпись тестовая: подходит только для тестовых ящиков.'
              : 'Т1 появится в исходящих Диадока — подпишите его своей КЭП в веб-интерфейсе Диадока.'}
            {' '}Реквизиты организаций Диадок подставит сам по ИНН.
          </DialogDescription>
        </DialogHeader>

        {loadError && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
        {!v && !loadError && (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Собираем данные рейса…</div>
        )}

        {v && (
          <div className="space-y-3">
            <Section title="Накладная">
              <F label="Номер ЭТрН" value={v.number} onChange={set('number')} />
              <F label="Дата" value={v.date} onChange={set('date')} placeholder="ДД.ММ.ГГГГ" />
              <F label="Заявка №" value={v.orderNumber} onChange={set('orderNumber')} />
              <F label="Дата заявки" value={v.orderDate} onChange={set('orderDate')} placeholder="ДД.ММ.ГГГГ" />
            </Section>

            <Section title="Грузополучатель">
              <F label="ИНН" value={v.consignee.inn} onChange={set('consignee.inn')} mono hint="по ИНН найдём ящик в Диадоке" />
              <F label="КПП" value={v.consignee.kpp} onChange={set('consignee.kpp')} mono hint="если у ИНН несколько ящиков" />
              <F label="Наименование" value={v.consignee.name} onChange={set('consignee.name')} hint="для себя: в накладную идёт из Диадока" />
              <F label="Телефон" value={v.consignee.phone} onChange={set('consignee.phone')} />
              <F label="Индекс" value={v.delivery.zip} onChange={set('delivery.zip')} mono />
              <F label="Код региона" value={v.delivery.region} onChange={set('delivery.region')} mono hint="23 — Краснодарский край" />
              <F label="Город" value={v.delivery.city} onChange={set('delivery.city')} />
              <F label="Улица" value={v.delivery.street} onChange={set('delivery.street')} />
              <F label="Дом" value={v.delivery.building} onChange={set('delivery.building')} />
            </Section>

            <Section title="Груз">
              <F label="Наименование" value={v.cargo.name} onChange={set('cargo.name')} className="col-span-2" />
              <F label="Состояние" value={v.cargo.condition} onChange={set('cargo.condition')} />
              <F label="Упаковка" value={v.cargo.packageMethod} onChange={set('cargo.packageMethod')} />
              <F label="Вид тары (код)" value={v.cargo.containerType} onChange={set('cargo.containerType')} mono />
              <F label="Мест" value={v.cargo.places} onChange={set('cargo.places')} mono />
              <F label="Масса брутто, кг" value={v.cargo.grossWeightKg} onChange={set('cargo.grossWeightKg')} mono />
              <F label="Маркировка" value={v.cargo.marks} onChange={set('cargo.marks')} placeholder="Отсутствует" />
            </Section>

            <Section title="Перевозчик и водитель">
              <F label="Телефон перевозчика" value={v.carrierPhone} onChange={set('carrierPhone')} />
              <F label="Фамилия" value={v.driver.lastName} onChange={set('driver.lastName')} />
              <F label="Имя" value={v.driver.firstName} onChange={set('driver.firstName')} />
              <F label="Отчество" value={v.driver.middleName} onChange={set('driver.middleName')} />
              <F label="Серия ВУ" value={v.driver.licenseSeries} onChange={set('driver.licenseSeries')} mono />
              <F label="Номер ВУ" value={v.driver.licenseNumber} onChange={set('driver.licenseNumber')} mono />
              <F label="Телефон водителя" value={v.driver.phone} onChange={set('driver.phone')} />
            </Section>

            <Section title="Тягач">
              <F label="Госномер" value={v.vehicle.number} onChange={set('vehicle.number')} mono />
              <Select label="Тип владения" value={v.vehicle.ownership} onChange={set('vehicle.ownership')} options={OWNERSHIP} />
              <F label="Тип ТС" value={v.vehicle.type} onChange={set('vehicle.type')} />
              <F label="Марка" value={v.vehicle.model} onChange={set('vehicle.model')} />
              <F label="Грузоподъёмность, т" value={v.vehicle.maxWeight} onChange={set('vehicle.maxWeight')} mono />
              <F label="Вместимость, м³" value={v.vehicle.capacity} onChange={set('vehicle.capacity')} mono />
              <F label="СТС" value={v.vehicle.sts} onChange={set('vehicle.sts')} mono />
              <F label="VIN" value={v.vehicle.vin} onChange={set('vehicle.vin')} mono />
            </Section>

            <fieldset className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500">Прицеп</legend>
              <div className="mb-2 flex items-center gap-2">
                <Checkbox
                  id="etrn-trailer"
                  checked={v.trailer !== null}
                  onCheckedChange={(c) => setV((cur) => (cur ? { ...cur, trailer: c ? cur.trailer ?? { ...EMPTY_TRAILER } : null } : cur))}
                />
                <Label htmlFor="etrn-trailer" className="text-sm">С прицепом</Label>
              </div>
              {v.trailer && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <F label="Госномер" value={v.trailer.number} onChange={set('trailer.number')} mono />
                  <Select label="Тип владения" value={v.trailer.ownership} onChange={set('trailer.ownership')} options={OWNERSHIP} />
                  <F label="Тип" value={v.trailer.type} onChange={set('trailer.type')} />
                  <F label="Марка" value={v.trailer.model} onChange={set('trailer.model')} />
                  <F label="Грузоподъёмность, т" value={v.trailer.maxWeight} onChange={set('trailer.maxWeight')} mono />
                  <F label="Вместимость, м³" value={v.trailer.capacity} onChange={set('trailer.capacity')} mono />
                  <F label="СТС" value={v.trailer.sts} onChange={set('trailer.sts')} mono />
                </div>
              )}
            </fieldset>

            <Section title="Погрузка (склад АЭМЗ)">
              <F label="Заявленная подача" value={v.loading.statedArrival} onChange={set('loading.statedArrival')} mono hint="ДД.ММ.ГГГГTчч:мм:сс+03:00" />
              <F label="Фактическое прибытие" value={v.loading.actualArrival} onChange={set('loading.actualArrival')} mono />
              <F label="Фактическое убытие" value={v.loading.actualDeparture} onChange={set('loading.actualDeparture')} mono />
              <Select label="Метод определения массы (код)" value={v.loading.weighingMethod} onChange={set('loading.weighingMethod')} options={[['01', '01'], ['02', '02'], ['03', '03']]} />
            </Section>

            {errors.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <div className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" aria-hidden />Диадок не принял накладную</div>
                <ul className="ml-5 list-disc space-y-0.5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Badge variant="outline" className="self-center border-slate-200 text-slate-600">{diadoc.stand}</Badge>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button disabled={!v || sending} onClick={() => void send()}>
              {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-1.5 h-4 w-4" aria-hidden />}
              {diadoc.signMode === 'test' ? 'Подписать тестовой подписью и отправить' : 'Создать Т1 в Диадоке'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
