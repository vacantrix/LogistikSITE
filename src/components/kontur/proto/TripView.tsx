'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/kontur/ui/card'
import { Button } from '@/components/kontur/ui/button'
import { Input } from '@/components/kontur/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/kontur/ui/dialog'
import { Label } from '@/components/kontur/ui/label'
import { Textarea } from '@/components/kontur/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/kontur/ui/select'
import { useToast } from '@/hooks/use-toast'
import { LADDER, STATUS_LABELS, TRIP_STATUS_LABELS, ACK_LABELS } from '@/lib/kontur/constants'
import type { StateResponse, TripDetail } from '@/lib/kontur/client-types'
import { fmtDateTime } from '@/lib/kontur/client-types'
import { StatusChip, TimelineItem, DotWord, Pill } from './bits'
import { CallButton } from './CallButton'
import { Camera, CameraOff, CheckCircle2, FileWarning, TriangleAlert, Undo2, ArrowLeftRight, ArrowLeft, Wrench, ExternalLink, Loader2, MapPinned, Trash2, Route } from 'lucide-react'
import { apiFetch as fetch } from '@/lib/kontur/base-path'

export function TripView({
  tripId, state, onChanged, onBack,
}: {
  tripId: string
  state: StateResponse
  onChanged: () => void
  onBack?: () => void
}) {
  const { toast } = useToast()
  const [detail, setDetail] = useState<TripDetail | null>(null)
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [compositionOpen, setCompositionOpen] = useState(false)
  const [targetLegId, setTargetLegId] = useState<string>('')
  const [corrStatus, setCorrStatus] = useState('')
  const [corrComment, setCorrComment] = useState('')
  const [compDriver, setCompDriver] = useState('')
  const [compVehicle, setCompVehicle] = useState('')
  const [compTrailer, setCompTrailer] = useState('')
  const [compReason, setCompReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/trip/${tripId}`)
    if (res.ok) setDetail(await res.json())
  }, [tripId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- асинхронная загрузка, setState после await
    load()
  }, [load])

  if (!detail) {
    return <div className="p-8 text-center text-slate-500">Загрузка карточки рейса…</div>
  }

  const { trip, legs, statusEvents, tripEvents, files, audit, driver, vehicle, trailer } = detail
  const eventsByLeg = new Map(legs.map((l) => [l.id, statusEvents.filter((e) => e.legId === l.id)]))

  async function applyCorrection() {
    if (!corrStatus || !corrComment.trim()) {
      toast({ title: 'Заполните статус и причину', description: 'Причина корректировки обязательна (B8.4)', variant: 'destructive' })
      return
    }
    setBusy(true)
    const res = await fetch('/api/logist/correction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'apply', legId: targetLegId, status: corrStatus, comment: corrComment }),
    })
    setBusy(false)
    const data = await res.json()
    if (!res.ok) {
      toast({ title: 'Корректировка не применена', description: data.error?.message, variant: 'destructive' })
      return
    }
    toast({ title: 'Корректировка применена', description: `${data.was} → ${data.became}. Поставлен барьер (B5.6).` })
    setCorrectionOpen(false)
    setCorrComment('')
    load()
    onChanged()
  }

  async function cancelCorrection(legId: string) {
    setBusy(true)
    const res = await fetch('/api/logist/correction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'cancel', legId }),
    })
    setBusy(false)
    const data = await res.json()
    if (!res.ok) {
      toast({ title: 'Отмена не выполнена', description: data.error?.message, variant: 'destructive' })
      return
    }
    toast({ title: 'Корректировка отменена', description: `${data.comment}. Статус восстановлен: ${STATUS_LABELS[data.restoreStatus] || data.restoreStatus}. Superseded-события не воскрешены (B5.7).` })
    load()
    onChanged()
  }

  async function applyComposition() {
    if (!compReason.trim() || (!compDriver && !compVehicle && !compTrailer)) {
      toast({ title: 'Укажите замену и причину', description: 'Замена ресурса и причина обязательны (B8.4)', variant: 'destructive' })
      return
    }
    setBusy(true)
    const res = await fetch('/api/logist/composition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tripId: trip.id,
        driverId: compDriver || undefined,
        vehicleId: compVehicle || undefined,
        trailerId: compTrailer || undefined,
        reason: compReason,
      }),
    })
    setBusy(false)
    const data = await res.json()
    if (!res.ok) {
      toast({ title: 'Замена состава не выполнена', description: data.error?.message, variant: 'destructive' })
      return
    }
    toast({
      title: 'Состав изменён (B5.8.1)',
      description: 'Прежний водитель: события от него пойдут в разбор needs_review, файлы принимаются всегда.',
    })
    setCompositionOpen(false)
    setCompReason('')
    load()
    onChanged()
  }

  async function fileAction(action: 'confirm' | 'lost', clientIds?: string[], clientId?: string) {
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, clientIds, clientId }),
    })
    if (res.ok) {
      toast({ title: action === 'confirm' ? 'Доставка файлов подтверждена' : 'Файл отмечен утраченным', description: action === 'lost' ? 'docs_lost — немедленный красный бейдж (B5.4)' : undefined })
      load()
      onChanged()
    }
  }

  const uploadedFiles = files.filter((f) => f.state === 'uploaded')

  return (
    <div className="space-y-4">
      {/* Возврат к реестру заявок (раздел «Заявки», drill-down) */}
      {onBack && (
        <div>
          <Button size="sm" variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />К заявкам
          </Button>
        </div>
      )}
      {/* Шапка карточки */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-lg">Рейс {trip.id.slice(0, 8)}</CardTitle>
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span>
                  {driver?.fullName} · {vehicle?.brand} ({vehicle?.plate}){trailer ? ` · прицеп ${trailer.plate}` : ''}
                </span>
                {driver?.phone && (
                  <CallButton
                    phone={driver.phone}
                    name={driver.fullName}
                    driverId={driver.id}
                    orderId={legs.find((l) => l.orderId)?.orderId ?? undefined}
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <DotWord
                  dot={trip.status === 'active' ? 'bg-emerald-500' : trip.status === 'completed' ? 'bg-emerald-600' : trip.status === 'cancelled' ? 'bg-red-500' : 'bg-slate-400'}
                  tone={trip.status === 'cancelled' ? 'danger' : undefined}
                >
                  {TRIP_STATUS_LABELS[trip.status]}
                </DotWord>
                <DotWord dot={trip.ackStatus === 'pending' ? 'bg-amber-500' : 'bg-emerald-500'} tone={trip.ackStatus === 'pending' ? 'warning' : undefined}>
                  {ACK_LABELS[trip.ackStatus]}
                </DotWord>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button size="sm" variant="outline" onClick={() => { setTargetLegId(legs[0]?.id || ''); setCorrectionOpen(true) }}>
                <Wrench className="h-4 w-4 mr-1" />Корректировать статус
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => legs[0] && cancelCorrection(legs[0].id)}>
                <Undo2 className="h-4 w-4 mr-1" />Отменить последнюю корректировку
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCompositionOpen(true)}>
                <ArrowLeftRight className="h-4 w-4 mr-1" />Заменить состав
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Плечи */}
      {legs.map((leg) => {
        const legFiles = files.filter((f) => f.ownerId === leg.id)
        return (
          <Card key={leg.id} className="border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  Плечо {leg.seq} · {leg.type === 'main' ? 'Основное' : leg.type === 'return' ? 'Обратное' : 'Порожний возврат'}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip status={leg.status} />
                  {leg.statusSource === 'logist' && (
                    <Pill className="bg-slate-100 text-slate-600">статус установлен логистом (барьер)</Pill>
                  )}
                  {leg.docsPending && (
                    <Pill className="bg-slate-100 text-slate-600"><Camera className="h-3 w-3 text-amber-600" />документы не доставлены</Pill>
                  )}
                  {leg.docsLost && (
                    <Pill className="bg-slate-100 text-slate-600"><CameraOff className="h-3 w-3 text-red-600" />документ утрачен</Pill>
                  )}
                </div>
              </div>
              <div className="text-sm text-slate-600">
                {leg.loadPoint} → {leg.unloadPoint}
                {leg.cargoDesc ? ` · ${leg.cargoDesc}` : ''}
                {leg.kmPlan ? ` · план ${leg.kmPlan} км` : ''}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <RouteEditor
                key={`${leg.id}-${leg.routeLink ?? ''}-${leg.routeWaypoints ?? ''}`}
                tripId={trip.id}
                leg={leg}
                onSaved={() => { load(); onChanged() }}
              />
              <div className="text-xs font-medium text-slate-500 uppercase">Таймлайн событий (status_events + метки B5)</div>
              <div className="max-h-96 overflow-y-auto pr-2">
                {(eventsByLeg.get(leg.id) || []).slice().reverse().map((ev) => (
                  <TimelineItem key={ev.id} ev={ev} drivers={state.drivers} />
                ))}
              </div>
              {legFiles.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-500 uppercase">Документы</div>
                  {legFiles.map((f) => (
                    <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 transition-colors hover:bg-slate-50">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {f.state === 'confirmed' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : f.state === 'lost' ? <FileWarning className="h-4 w-4 text-red-600" /> : <Camera className="h-4 w-4 text-amber-600" />}
                        <span className="font-mono text-xs">{f.kind}:{f.clientId.slice(0, 14)}…</span>
                        <Pill className={f.state === 'confirmed' ? 'bg-slate-100 text-slate-600' : f.state === 'lost' ? 'bg-slate-100 text-slate-700' : 'bg-slate-100 text-slate-600'}>
                          {f.state === 'confirmed' ? 'доставлен' : f.state === 'lost' ? 'утрачен' : 'загружен, ждёт подтверждения'}
                        </Pill>
                        {f.lateArrival && <Pill className="bg-slate-100 text-slate-600">поздние данные</Pill>}
                      </div>
                      <div className="flex gap-2">
                        {f.state === 'uploaded' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => fileAction('confirm', [f.clientId])}>Подтвердить доставку</Button>
                            <Button size="sm" variant="destructive" onClick={() => fileAction('lost', undefined, f.clientId)}>Файл утерян</Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}

      {/* События рейса и аудит */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm">События рейса (trip_events)</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-72 overflow-y-auto">
            {tripEvents.length === 0 && <div className="text-sm text-slate-400">Пока нет событий</div>}
            {tripEvents.map((te) => (
              <div key={te.id} className="text-xs text-slate-600 border-b border-slate-100 pb-1.5">
                <span className="font-medium">{te.type}</span> · {fmtDateTime(te.at)}
                {te.payload && <div className="text-slate-400 font-mono text-[10px] truncate">{te.payload}</div>}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Аудит (последние записи)</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-72 overflow-y-auto">
            {audit.length === 0 && <div className="text-sm text-slate-400">Пока нет записей</div>}
            {audit.map((a) => (
              <div key={a.id} className="text-xs text-slate-600 border-b border-slate-100 pb-1.5">
                <span className="font-medium">{a.actorRole}</span> · {a.object} · {a.field || '—'}: {a.was || '∅'} → {a.became || '∅'}
                {a.comment && <div className="text-slate-400">«{a.comment}»</div>}
                <div className="text-slate-400">{fmtDateTime(a.at)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Диалог корректировки */}
      <Dialog open={correctionOpen} onOpenChange={setCorrectionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Корректировка статуса плеча (B5.7)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Плечо</Label>
              <Select value={targetLegId} onValueChange={setTargetLegId}>
                <SelectTrigger><SelectValue placeholder="Выберите плечо" /></SelectTrigger>
                <SelectContent>
                  {legs.map((l) => (
                    <SelectItem key={l.id} value={l.id}>Плечо {l.seq}: {l.loadPoint} → {l.unloadPoint}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Новый статус (любой из лестницы или cancelled)</Label>
              <Select value={corrStatus} onValueChange={setCorrStatus}>
                <SelectTrigger><SelectValue placeholder="Статус" /></SelectTrigger>
                <SelectContent>
                  {[...LADDER, 'cancelled'].map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Причина (обязательна)</Label>
              <Textarea value={corrComment} onChange={(e) => setCorrComment(e.target.value)} placeholder="Например: водитель сообщил по телефону, что уже погрузился" />
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              Корректировка ставит барьер: драйверские события, созданные до неё, получат superseded (B5.6).
              Отмена — только новой корректировкой; superseded-события не воскрешаются автоматически.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrectionOpen(false)}>Отмена</Button>
            <Button onClick={applyCorrection} disabled={busy}>Применить корректировку</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог замены состава */}
      <Dialog open={compositionOpen} onOpenChange={setCompositionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Замена состава (B5.8.1)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Новый водитель</Label>
              <Select value={compDriver} onValueChange={setCompDriver}>
                <SelectTrigger><SelectValue placeholder="Оставить текущего" /></SelectTrigger>
                <SelectContent>
                  {state.drivers.filter((d) => d.status === 'active').map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Новое ТС</Label>
              <Select value={compVehicle} onValueChange={setCompVehicle}>
                <SelectTrigger><SelectValue placeholder="Оставить текущее" /></SelectTrigger>
                <SelectContent>
                  {state.vehicles.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.brand} ({v.plate}){v.isRepair ? ' — в ремонте' : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Новый прицеп</Label>
              <Select value={compTrailer} onValueChange={setCompTrailer}>
                <SelectTrigger><SelectValue placeholder="Оставить текущий" /></SelectTrigger>
                <SelectContent>
                  {state.trailers.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.brand} ({t.plate})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Причина (обязательна)</Label>
              <Textarea value={compReason} onChange={(e) => setCompReason(e.target.value)} placeholder="Например: поломка ТС, замена водителя" />
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <TriangleAlert className="mr-1 inline h-3.5 w-3.5 text-amber-600" aria-hidden />
              Прежний водитель потеряет доступ (ACCESS_REVOKED), но его офлайн-очередь не теряется:
              файлы принимаются всегда, статусные события уходят в разбор needs_review без срока давности.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompositionOpen(false)}>Отмена</Button>
            <Button onClick={applyComposition} disabled={busy}>Заменить состав</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Маршрут рейса из Яндекс.Карт. Офис строит маршрут в Яндексе, копирует
 * ссылку «Поделиться» → «Ссылка» и вставляет сюда. Платформа сохраняет все
 * точки по порядку и дорожную линию; водитель получает готовый маршрут
 * автоматически — вручную точки в приложении не вводятся.
 */
function RouteEditor({
  tripId, leg, onSaved,
}: {
  tripId: string
  leg: TripDetail['legs'][number]
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [link, setLink] = useState(leg.routeLink ?? '')
  const [busy, setBusy] = useState(false)

  let points = 0
  try {
    const arr = JSON.parse(leg.routeWaypoints ?? '[]') as unknown
    if (Array.isArray(arr)) points = arr.length
  } catch {
    points = 0
  }
  const km = leg.routeDistanceM ? Math.round(leg.routeDistanceM / 1000) : leg.kmPlan
  const duration = leg.routeDurationS ? Math.round(leg.routeDurationS / 60) : 0

  async function save() {
    if (!link.trim()) {
      toast({ title: 'Вставьте ссылку на маршрут', description: 'Яндекс.Карты → «Поделиться» → «Ссылка»', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/trip/${tripId}/route-link`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legId: leg.id, link }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
      const bridge = data?.driverApp
      toast({
        title: 'Маршрут сохранён',
        description:
          `${data.route.points} точек · ${data.route.distanceM ? `${Math.round(data.route.distanceM / 1000)} км` : 'линия будет построена в приложении'}` +
          (data.route.source === 'yandex' ? ' · геометрия Яндекса' : data.route.source === 'osrm' ? ' · линия по точкам' : '') +
          (bridge?.sent ? ' · отправлен водителю' : ''),
      })
      onSaved()
    } catch (e) {
      toast({
        title: 'Маршрут не сохранён',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    setBusy(true)
    try {
      const res = await fetch(`/api/trip/${tripId}/route-link?legId=${encodeURIComponent(leg.id)}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
      setLink('')
      toast({ title: 'Маршрут удалён', description: 'Водитель останется на прежней геометрии до нового назначения' })
      onSaved()
    } catch (e) {
      toast({ title: 'Не удалось удалить маршрут', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <MapPinned className="h-4 w-4 text-blue-600" aria-hidden />
          Маршрут Яндекс.Карт
        </div>
        {points > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
            <Route className="h-3 w-3" aria-hidden />
            {points} точек{km ? ` · ${km} км` : ''}{duration ? ` · ${duration} мин` : ''}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Постройте маршрут в Яндекс.Картах → «Поделиться» → «Ссылка» и вставьте сюда.
        Приложение водителя проложит маршрут через все точки в том же порядке автоматически.
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://yandex.ru/maps/?rtext=…"
          className="h-9 flex-1 bg-white font-mono text-xs"
          aria-label="Ссылка на маршрут Яндекс.Карт"
        />
        <Button size="sm" className="h-9 shrink-0" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden />}
          Сохранить маршрут
        </Button>
      </div>
      {leg.routeLink && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2 text-xs">
          <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            Маршрут привязан к плечу
          </span>
          <a
            href={leg.routeLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-blue-700 underline-offset-2 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Открыть в Яндекс.Картах
          </a>
          {leg.routeGeometry ? (
            <span className="text-slate-500">
              {leg.routeSource === 'yandex'
                ? 'точная геометрия Яндекса'
                : 'линия по точкам (OSRM)'}
            </span>
          ) : (
            <span className="text-amber-700">линия не построена — приложение построит её по точкам</span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 px-2 text-xs text-red-700"
            onClick={clear}
            disabled={busy}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
            Удалить
          </Button>
        </div>
      )}
    </div>
  )
}
