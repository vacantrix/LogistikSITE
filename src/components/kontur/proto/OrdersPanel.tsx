'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/kontur/ui/card'
import { Button } from '@/components/kontur/ui/button'
import { Textarea } from '@/components/kontur/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/kontur/ui/dialog'
import { Label } from '@/components/kontur/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/kontur/ui/select'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/kontur/session-token'
import type { Order, StateResponse } from '@/lib/kontur/client-types'
import { fmtDateTime } from '@/lib/kontur/client-types'
import { AlertOctagon, Building2, FileInput, Inbox, MapPin, Truck } from 'lucide-react'
import { DotWord } from './bits'
import { apiFetch as fetch } from '@/lib/kontur/base-path'

// P1/B7.1.1: заявки — приём из 1С (partial-batch), карантин, ручной ввод
export function OrdersPanel({ state, onChanged }: { state: StateResponse; onChanged: () => void }) {
  const { toast } = useToast()
  const [json, setJson] = useState(JSON.stringify({
    orders: [
      {
        external_id: '1C-2026-0046', number: 'ЗК-1046', customer: 'ООО «Кубань Метиз»',
        product: 'Проволока ГОСТ 3282-74', load_point: 'Абинск (АЭМЗ)', unload_point: 'Краснодар, ул. Уральская, 100',
        load_date_plan: '2026-11-19', tariff: 1350, kp: 'КП-95',
      },
      {
        external_id: '1C-2026-0047', number: 'ЗК-1047', customer: 'ООО «Без выгрузки»',
        product: 'Балка 20Б1', load_point: 'Абинск (АЭМЗ)',
      },
      {
        external_id: '1C-2026-0041', number: 'ЗК-1041', customer: 'ООО «СтройДом»',
        product: 'Арматура А500С 14 мм', load_point: 'Абинск (АЭМЗ)', unload_point: 'Краснодар, ул. Тополиная, 8',
        tariff: 1500,
      },
    ],
  }, null, 2))
  const [busy, setBusy] = useState(false)
  // Планирование: назначение состава из собственного парка АЭМЗ
  const [planOrder, setPlanOrder] = useState<Order | null>(null)
  const [planVehicle, setPlanVehicle] = useState('')
  const [planTrailer, setPlanTrailer] = useState('')
  const [planDriver, setPlanDriver] = useState('')

  const busyVehicleIds = new Set(state.trips.filter((t) => t.status === 'active').map((t) => t.vehicleId))
  const busyDriverIds = new Set(state.trips.filter((t) => t.status === 'active').map((t) => t.driverId))
  const busyTrailerIds = new Set(state.trips.filter((t) => t.status === 'active' && t.trailerId).map((t) => t.trailerId as string))

  function openPlan(o: Order) {
    setPlanOrder(o)
    setPlanVehicle('')
    setPlanTrailer('')
    setPlanDriver('')
  }

  async function applyPlan() {
    if (!planOrder || !planVehicle || !planDriver) {
      toast({ title: 'Выберите ТС и водителя', description: 'Состав назначается из собственного парка АЭМЗ', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await authFetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'plan',
          orderId: planOrder.id,
          vehicleId: planVehicle,
          trailerId: planTrailer || undefined,
          driverId: planDriver,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ title: 'Назначение не выполнено', description: data?.error?.message, variant: 'destructive' })
        return
      }
      toast({
        title: 'Состав назначен из собственного парка',
        description: 'Рейс создан, водитель получит назначение в приложении (подтверждение — SLA 30 мин).',
      })
      setPlanOrder(null)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function sendTo1c() {
    setBusy(true)
    try {
      const payload = JSON.parse(json)
      const res = await fetch('/api/1c/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: '1С отклонил пакет', description: data.error?.message, variant: 'destructive' })
        return
      }
      toast({
        title: 'Пакет обработан (partial-batch)',
        description: `Принято: ${data.accepted.length}, карантин: ${data.quarantined.length}. Дубль external_id обновляет заявку, повтор безопасен.`,
      })
      onChanged()
    } catch {
      toast({ title: 'Некорректный JSON', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function markReady(orderId: string) {
    const res = await authFetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ready', orderId }),
    })
    if (res.ok) {
      toast({ title: 'Заявка готова к планированию' })
      onChanged()
    }
  }

  const quarantined = state.orders.filter((o) => o.status === 'quarantine')
  const activeOrders = state.orders.filter((o) => o.status !== 'quarantine')

  return (
    <div className="space-y-4">
      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileInput className="h-5 w-5 text-slate-500" />
            Приём заявок из 1С (POST /api/1c/orders)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={json} onChange={(e) => setJson(e.target.value)} className="font-mono text-xs min-h-52" />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={sendTo1c} disabled={busy}>Отправить пакет как 1С</Button>
            <span className="text-xs text-slate-500">
              В пакете: валидная заявка, невалидная (без пункта выгрузки — уйдёт в карантин) и дубль external_id
              1C-2026-0041 (обновит тариф существующей заявки).
            </span>
          </div>
        </CardContent>
      </Card>

      {quarantined.length > 0 && (
        <Card className="border-red-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-red-700">
              <AlertOctagon className="h-5 w-5" />Карантин ({quarantined.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {quarantined.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-2">
                <div className="text-sm">
                  <span className="font-medium">{o.externalId}</span> · {o.customer} · {o.product}
                  <div className="text-xs text-red-600">{o.quarantineReason}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => markReady(o.id)}>Исправлено — в план</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="h-5 w-5 text-slate-500" />Заявки ({activeOrders.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="pb-2 pr-2 font-medium">Код</th>
                  <th className="pb-2 pr-2 font-medium">Заказчик</th>
                  <th className="pb-2 pr-2 font-medium">Продукция</th>
                  <th className="pb-2 pr-2 font-medium">Маршрут</th>
                  <th className="pb-2 pr-2 font-medium">Погрузка</th>
                  <th className="pb-2 pr-2 font-medium">Тариф</th>
                  <th className="pb-2 pr-2 font-medium">КП</th>
                  <th className="pb-2 pr-2 font-medium">Статус</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {activeOrders.map((o) => (
                  <tr key={o.id} className="border-b border-slate-100 align-top">
                    <td className="py-2.5 pr-2 font-mono text-xs font-semibold text-slate-900">{o.externalId}</td>
                    <td className="py-2.5 pr-2">{o.customer}</td>
                    <td className="py-2.5 pr-2 text-xs">{o.product}</td>
                    <td className="py-2.5 pr-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-xs text-slate-700">
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-500" />{o.loadPoint}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-700">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-500" />{o.unloadPoint}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-2 text-xs">{o.loadDatePlan || '—'}</td>
                    <td className="py-2.5 pr-2">{o.tariff ? `${o.tariff.toLocaleString('ru-RU')} ₽` : '—'}</td>
                    <td className="py-2.5 pr-2">{o.kp || '—'}</td>
                    <td className="py-2.5 pr-2">
                      <DotWord dot={o.status === 'new' ? 'bg-sky-500' : o.status === 'ready_to_plan' ? 'bg-emerald-500' : 'bg-blue-500'}>
                        {o.status === 'new' ? 'новая' : o.status === 'ready_to_plan' ? 'к планированию' : o.status === 'planned' ? 'в рейсе' : o.status}
                      </DotWord>
                    </td>
                    <td className="py-2.5">
                      {o.status === 'new' && <Button size="sm" variant="ghost" onClick={() => markReady(o.id)}>В план</Button>}
                      {o.status === 'ready_to_plan' && (
                        <Button size="sm" variant="outline" onClick={() => openPlan(o)}>
                          <Truck className="h-3.5 w-3.5 mr-1" />Назначить состав
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            Последнее обновление: {fmtDateTime(state.orders[0]?.createdAt)} · источник: 1С/ручной ввод (до подключения 1С — CSV-импорт, блок 1.2)
          </div>
        </CardContent>
      </Card>

      {/* Диалог назначения состава из собственного парка (логистический контур) */}
      <Dialog open={!!planOrder} onOpenChange={(v) => !v && setPlanOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Назначение состава из собственного парка АЭМЗ</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {planOrder && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <span className="font-mono text-xs font-semibold">{planOrder.externalId}</span> · {planOrder.customer} · {planOrder.product}
                <div className="mt-1 text-xs text-slate-500">{planOrder.loadPoint} → {planOrder.unloadPoint || '—'}</div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Тягач (собственный парк, не в ремонте)</Label>
              <Select value={planVehicle} onValueChange={setPlanVehicle}>
                <SelectTrigger><SelectValue placeholder="Выберите ТС" /></SelectTrigger>
                <SelectContent>
                  {state.vehicles.filter((v) => v.ownership !== 'held').map((v) => {
                    const busy = busyVehicleIds.has(v.id) || v.isRepair
                    return (
                      <SelectItem key={v.id} value={v.id} disabled={busy}>
                        {v.brand} ({v.plate}){v.isRepair ? ' — в ремонте' : busy ? ' — в рейсе' : ''}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Прицеп (собственный парк, необязательно)</Label>
              <Select value={planTrailer} onValueChange={setPlanTrailer}>
                <SelectTrigger><SelectValue placeholder="Без прицепа" /></SelectTrigger>
                <SelectContent>
                  {state.trailers.map((t) => {
                    const busy = busyTrailerIds.has(t.id)
                    return (
                      <SelectItem key={t.id} value={t.id} disabled={busy}>
                        {t.brand} ({t.plate}) · {t.type}{busy ? ' — в рейсе' : ''}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Водитель (штатный состав)</Label>
              <Select value={planDriver} onValueChange={setPlanDriver}>
                <SelectTrigger><SelectValue placeholder="Выберите водителя" /></SelectTrigger>
                <SelectContent>
                  {state.drivers.filter((d) => d.status === 'active').map((d) => {
                    const busy = busyDriverIds.has(d.id)
                    return (
                      <SelectItem key={d.id} value={d.id} disabled={busy}>
                        {d.fullName}{busy ? ' — в рейсе' : ''}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
              Состав назначается только из собственного парка АЭМЗ — транспорт, прицепы и водители
              штатные. Привлечённый транспорт в контуре не используется (решение владельца).
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanOrder(null)}>Отмена</Button>
            <Button onClick={applyPlan} disabled={busy}>Назначить и создать рейс</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
