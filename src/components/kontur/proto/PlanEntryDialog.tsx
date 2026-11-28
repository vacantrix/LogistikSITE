'use client'

/**
 * Диалог «Запланировать работу» — реальное планирование на любую дату.
 * Логист выбирает состав, календарный день (без ограничений — хоть через
 * месяц), опорное время и тип события: погрузка, выгрузка, возврат на базу
 * АЭМЗ или заметка. Запись сохраняется в БД (model PlanEntry) и сразу видна
 * в календаре «Планирования» отдельным стилем — рядом с расчётными событиями
 * рейсов и грузов ATI.SU. Открывается из шапки раздела (кнопка
 * «Запланировать»), из «+» в шапке дня графика и кликом по свободному месту
 * строки состава — день и состав подставляются сами.
 */
import { useEffect, useMemo, useState } from 'react'
import { CalendarPlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/kontur/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/kontur/ui/dialog'
import { Input } from '@/components/kontur/ui/input'
import { Label } from '@/components/kontur/ui/label'
import { Textarea } from '@/components/kontur/ui/textarea'
import { authFetch } from '@/lib/kontur/session-token'
import { useToast } from '@/hooks/use-toast'
import type { StateResponse } from '@/lib/kontur/client-types'

export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const KIND_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'load', label: 'Погрузка', hint: 'плановая загрузка состава в пункте' },
  { value: 'unload', label: 'Выгрузка', hint: 'плановая разгрузка в пункте назначения' },
  { value: 'return', label: 'Возврат на АЭМЗ', hint: 'возвращение состава на базу (Абинск)' },
  { value: 'note', label: 'Заметка', hint: 'план без пункта: ТО, отпуск, перевозка и т.п.' },
]

const SELECT_CLS =
  'h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

export function PlanEntryDialog({ open, initialDate, initialDriverId, state, onOpenChange, onDone }: {
  open: boolean
  initialDate: string // YYYY-MM-DD — день, из которого открыли диалог
  initialDriverId?: string // состав, по строке которого кликнули
  state: StateResponse
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const [driverId, setDriverId] = useState('')
  const [date, setDate] = useState(initialDate)
  const [time, setTime] = useState('')
  const [kind, setKind] = useState('load')
  const [point, setPoint] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // при каждом открытии — чистая форма с подставленным днём и составом
  useEffect(() => {
    if (open) {
      setDate(initialDate)
      setTime('')
      setKind('load')
      setPoint('')
      setNote('')
      setBusy(false)
      const presetOk =
        initialDriverId != null && state.drivers.some((d) => d.id === initialDriverId && d.status === 'active')
      if (presetOk) {
        setDriverId(initialDriverId!)
      } else if (!driverId) {
        const first = state.drivers.find((d) => d.status === 'active')
        setDriverId(first?.id ?? '')
      }
    }
  }, [open, initialDate, initialDriverId, state.drivers, driverId])

  // составы: активные водители с закреплённой машиной в подписи
  const driverOptions = useMemo(() => {
    const vehById = new Map(state.vehicles.map((v) => [v.id, v]))
    const bindByDriver = new Map(state.bindings.map((b) => [b.driverId, b]))
    return state.drivers
      .filter((d) => d.status === 'active')
      .map((d) => {
        const b = bindByDriver.get(d.id)
        const v = b ? vehById.get(b.vehicleId) : null
        return {
          id: d.id,
          fullName: d.fullName,
          sub: v ? `${v.brand} · ${v.plate}` : 'состав не закреплён',
          vehicleId: v?.id ?? null,
        }
      })
  }, [state.drivers, state.vehicles, state.bindings])

  const selDriver = driverOptions.find((d) => d.id === driverId) ?? null
  const needPoint = kind === 'load' || kind === 'unload'
  const canSubmit = !!driverId && !!date && (!needPoint || point.trim().length > 0) && !busy

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    try {
      const res = await authFetch('/api/plan-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverId,
          date,
          time: time || null,
          kind,
          point: needPoint ? point.trim() : null,
          note: note.trim() || null,
          vehicleId: selDriver?.vehicleId ?? null,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
      toast({ title: 'Запланировано', description: json?.message })
      onOpenChange(false)
      onDone()
    } catch (e) {
      toast({
        title: 'Не удалось запланировать',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarPlus className="h-4 w-4 text-slate-400" aria-hidden />
            Запланировать работу состава
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="pe-driver">Состав (водитель)</Label>
            <select id="pe-driver" value={driverId} onChange={(e) => setDriverId(e.target.value)} className={SELECT_CLS}>
              {driverOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName} — {d.sub}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pe-date">Дата (любая)</Label>
              <Input id="pe-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pe-time">Время</Label>
              <Input id="pe-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-9" />
            </div>
          </div>
          <p className="-mt-1.5 text-[11px] text-slate-400">Время не обязательно — запись останется «в течение дня».</p>

          <div className="grid gap-1.5">
            <Label htmlFor="pe-kind">Что запланировать</Label>
            <select id="pe-kind" value={kind} onChange={(e) => setKind(e.target.value)} className={SELECT_CLS}>
              {KIND_OPTIONS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label} — {k.hint}
                </option>
              ))}
            </select>
          </div>

          {kind === 'return' && (
            <div className="grid gap-1.5">
              <Label>Пункт</Label>
              <div className="flex h-9 items-center rounded-lg border border-slate-200 bg-slate-50 px-2 text-sm text-slate-600">
                Абинск (АЭМЗ) — база парка
              </div>
            </div>
          )}
          {needPoint && (
            <div className="grid gap-1.5">
              <Label htmlFor="pe-point">{kind === 'load' ? 'Пункт погрузки' : 'Пункт выгрузки'}</Label>
              <Input
                id="pe-point"
                value={point}
                onChange={(e) => setPoint(e.target.value)}
                placeholder="Например: Новороссийск"
                className="h-9"
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="pe-note">Примечание</Label>
            <Textarea
              id="pe-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Груз, заказчик, контакты, нюансы — что важно видеть в календаре"
              className="min-h-[64px] text-sm"
            />
          </div>
        </div>

        <div className="mt-1 flex justify-end gap-2">
          <Button variant="outline" size="sm" className="h-9" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <Button size="sm" className="h-9" onClick={submit} disabled={!canSubmit}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : <CalendarPlus className="mr-1 h-3.5 w-3.5" aria-hidden />}
            В календарь
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
