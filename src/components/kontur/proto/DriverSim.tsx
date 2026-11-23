'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/kontur/ui/card'
import { Button } from '@/components/kontur/ui/button'
import { Label } from '@/components/kontur/ui/label'
import { Slider } from '@/components/kontur/ui/slider'
import { Switch } from '@/components/kontur/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/kontur/ui/select'
import { useToast } from '@/hooks/use-toast'
import type { StateResponse, Trip, Leg } from '@/lib/kontur/client-types'
import { STATUS_LABELS, UI_TEXTS, CONSTANTS } from '@/lib/kontur/constants'
import { OutcomeChip, StatusChip, Pill } from './bits'
import { CloudOff, RefreshCw, Send, Smartphone, Wifi, WifiOff } from 'lucide-react'
import { apiFetch as fetch } from '@/lib/kontur/base-path'

type QueueItem = {
  clientId: string
  legId: string
  legLabel: string
  status: string
  seqNo: number | null
  clientTs: string
  files: { clientId: string; kind: string }[] | null
  state: 'pending' | 'done'
  result?: { ok: boolean; result: string; reason?: string }
  clockSkew?: boolean
}

type SimSettings = {
  driverId: string
  deviceId: string
  legacy: boolean
  skewMin: number
  attachFile: boolean
  offline: boolean
}

const TRANSITIONS_CLIENT: Record<string, string[]> = {
  assigned: ['en_route_to_loading'],
  en_route_to_loading: ['at_loading'],
  at_loading: ['loaded'],
  loaded: ['en_route'],
  en_route: ['at_unloading'],
  at_unloading: ['unloaded'],
  unloaded: ['completed'],
  completed: [],
  cancelled: [],
}
const FILE_REQUIRED: Record<string, boolean> = { loaded: true, unloaded: true }

function uid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

// Симулятор приложения водителя: локальная валидация, офлайн-очередь, сценарии (а)–(и) из B10 1.4
export function DriverSim({ state, onChanged }: { state: StateResponse; onChanged: () => void }) {
  const { toast } = useToast()
  const [settings, setSettings] = useState<SimSettings>({
    driverId: '', deviceId: '', legacy: false, skewMin: 0, attachFile: true, offline: true,
  })
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [seqCounters, setSeqCounters] = useState<Record<string, number>>({})
  const [driverTrips, setDriverTrips] = useState<Trip[]>([])
  const [selectedLegId, setSelectedLegId] = useState('')
  const [upgradeRequired, setUpgradeRequired] = useState(false)
  const [skewDetected, setSkewDetected] = useState(false)
  const [busy, setBusy] = useState(false)

  // Восстановление состояния из localStorage (аналог Room на устройстве)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('driver-sim')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed.settings) setSettings((s) => ({ ...s, ...parsed.settings }))
        if (parsed.queue) setQueue(parsed.queue)
        if (parsed.seq) setSeqCounters(parsed.seq)
      }
    } catch { /* пустое устройство */ }
  }, [])

  useEffect(() => {
    localStorage.setItem('driver-sim', JSON.stringify({ settings, queue, seq: seqCounters }))
  }, [settings, queue, seqCounters])

  const driver = state.drivers.find((d) => d.id === settings.driverId) || null
  // Устройство водителя из справочника либо новое
  const myDevice = state.devices.find((d) => d.driverId === settings.driverId)

  const loadDriverTrips = useCallback(async () => {
    if (!settings.driverId) return
    const res = await fetch(`/api/driver/trips?driverId=${settings.driverId}`)
    const data = await res.json()
    setDriverTrips(data.trips || [])
    const legs = (data.trips || []).flatMap((t: Trip) => t.legs)
    if (legs.length > 0 && !legs.some((l: Leg) => l.id === selectedLegId)) {
      setSelectedLegId(legs[0].id)
    }
  }, [settings.driverId, selectedLegId])

  useEffect(() => {
    loadDriverTrips()
  }, [loadDriverTrips, state.trips.length])

  // Автовыбор устройства при смене водителя
  useEffect(() => {
    if (driver) {
      const dev = state.devices.find((d) => d.driverId === driver.id)
      setSettings((s) => ({ ...s, deviceId: dev?.id || `DEV-NEW-${driver.id.slice(0, 4)}` }))
    }
  }, [settings.driverId, state.devices, driver])

  const allLegs = driverTrips.flatMap((t) => t.legs.map((l) => ({ ...l, trip: t })))
  const selectedLeg = allLegs.find((l) => l.id === selectedLegId) || null
  // B5.8.2: рейс передан другому — ACCESS_REVOKED
  const revokedTrip = useMemo(() => {
    return state.trips.find(
      (t) => t.status === 'active' && t.driverId !== settings.driverId &&
        t.legs.some((l) => l.id === selectedLegId),
    )
  }, [state.trips, settings.driverId, selectedLegId])

  const nextStatuses = selectedLeg ? (TRANSITIONS_CLIENT[selectedLeg.status] || []) : []
  const pendingItems = queue.filter((q) => q.state === 'pending')
  const pendingPhotos = pendingItems.reduce((n, q) => n + (q.files?.length || 0), 0)

  function nextSeq(legId: string): number {
    const key = `${settings.deviceId}:${legId}`
    const next = (seqCounters[key] || 100) + 1
    setSeqCounters((s) => ({ ...s, [key]: next }))
    return next
  }

  function clientNow(): string {
    const skewed = Date.now() + settings.skewMin * 60000
    return new Date(skewed).toISOString()
  }

  function addEvent(status: string) {
    if (!selectedLeg) return
    // Локальная валидация (B7.0: на клиенте и сервере независимы)
    if (FILE_REQUIRED[status] && !settings.attachFile && !settings.legacy) {
      toast({ title: UI_TEXTS.attachTttn, description: 'Переход заблокирован локально — работает и в офлайне (B5.3)', variant: 'destructive' })
      return
    }
    if (FILE_REQUIRED[status] && !settings.attachFile && settings.legacy) {
      toast({ title: 'Legacy-приложение', description: 'Переход без файла применяется с legacy=true, документы не отслеживаются', variant: 'destructive' })
    }
    const legacy = settings.legacy
    const item: QueueItem = {
      clientId: uid(),
      legId: selectedLeg.id,
      legLabel: `плечо ${selectedLeg.seq}: ${selectedLeg.loadPoint} → ${selectedLeg.unloadPoint}`,
      status,
      seqNo: legacy ? null : nextSeq(selectedLeg.id),
      clientTs: clientNow(),
      files: legacy ? null : (FILE_REQUIRED[status] && settings.attachFile ? [{ clientId: uid(), kind: 'tttn' }] : []),
      state: 'pending',
    }
    setQueue((q) => [...q, item])
  }

  async function syncOnce(items: QueueItem[]): Promise<{ results: Record<string, QueueItem['result']>; upgrade: boolean }> {
    const events = items.map((q) => ({
      clientId: q.clientId,
      legId: q.legId,
      status: q.status,
      deviceId: settings.deviceId,
      driverId: settings.driverId,
      seqNo: q.seqNo,
      clientTs: q.clientTs,
      requiredFiles: q.files,
      receivedOffline: true,
    }))
    const res = await fetch('/api/driver/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    })
    const data = await res.json()
    const byId: Record<string, QueueItem['result']> = {}
    for (const r of data.results || []) {
      byId[r.clientId] = { ok: r.ok, result: r.result, reason: r.reason }
    }
    return { results: byId, upgrade: !!data.upgrade_required }
  }

  async function markDone(byId: Record<string, QueueItem['result']>, upgrade: boolean, ids: string[]) {
    setQueue((q) => q.map((item) =>
      ids.includes(item.clientId) && byId[item.clientId]
        ? { ...item, state: 'done', result: byId[item.clientId] }
        : item,
    ))
    if (upgrade) setUpgradeRequired(true)
    const anySkew = Object.values(byId).some((r) => r?.result === 'needs_review' && r?.reason?.includes('Время'))
    if (anySkew) setSkewDetected(true)
    onChanged()
    loadDriverTrips()
  }

  async function syncAll() {
    const items = queue.filter((q) => q.state === 'pending')
    if (items.length === 0) {
      toast({ title: 'Очередь пуста' })
      return
    }
    if (settings.offline) {
      toast({ title: 'Нет сети (офлайн-режим)', description: 'События копятся в очереди. Выключите офлайн, чтобы отправить.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const { results, upgrade } = await syncOnce(items)
      await markDone(results, upgrade, items.map((i) => i.clientId))
      const counts: Record<string, number> = {}
      for (const r of Object.values(results)) counts[r?.result || ''] = (counts[r?.result || ''] || 0) + 1
      toast({
        title: `Синхронизация: ${items.length} событий`,
        description: Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ') || '—',
      })
    } finally {
      setBusy(false)
    }
  }

  // Сценарий (е): seq вне порядка — отправляем по одному в обратном порядке
  async function syncReversed() {
    const items = queue.filter((q) => q.state === 'pending')
    if (items.length < 2) {
      toast({ title: 'Нужно минимум 2 события в очереди', variant: 'destructive' })
      return
    }
    if (settings.offline) {
      toast({ title: 'Выключите офлайн-режим', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      for (const item of [...items].reverse()) {
        const { results, upgrade } = await syncOnce([item])
        await markDone(results, upgrade, [item.clientId])
      }
      toast({ title: 'Отправлено в обратном порядке', description: 'Первый sync применяет «будущий» статус, второй получает недопустимый переход → rejected (409), событие остаётся в очереди водителя' })
    } finally {
      setBusy(false)
    }
  }

  // Сценарий (д): дубль client_id — идемпотентность
  function queueDuplicate() {
    const done = [...queue].reverse().find((q) => q.state === 'done')
    if (!done) {
      toast({ title: 'Нет отправленных событий для дубля', variant: 'destructive' })
      return
    }
    setQueue((q) => [...q, { ...done, state: 'pending', result: undefined }])
    toast({ title: 'Дубль client_id добавлен в очередь', description: 'Повтор безопасен — сервер вернёт duplicate' })
  }

  async function confirmFiles() {
    const fileIds = queue
      .filter((q) => q.state === 'done' && q.files && q.result?.result !== 'rejected' && q.result?.result !== 'duplicate')
      .flatMap((q) => q.files!.map((f) => f.clientId))
    if (fileIds.length === 0) {
      toast({ title: 'Нет доставленных файлов для подтверждения' })
      return
    }
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm', clientIds: fileIds }),
    })
    if (res.ok) {
      toast({ title: `Подтверждено файлов: ${fileIds.length}`, description: 'docs_pending пересчитан (B5.4)' })
      onChanged()
    }
  }

  async function loseFile() {
    const done = queue.find((q) => q.state === 'done' && q.files && q.files.length > 0 && q.result?.result !== 'rejected')
    if (!done) {
      toast({ title: 'Нет файлов для потери' })
      return
    }
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'lost', clientId: done.files![0].clientId }),
    })
    if (res.ok) {
      toast({ title: 'Файл утрачен', description: 'docs_lost — немедленный красный бейдж (B5.4)', variant: 'destructive' })
      onChanged()
    }
  }

  function resetSim() {
    setQueue([])
    setSeqCounters({})
    setUpgradeRequired(false)
    setSkewDetected(false)
    localStorage.removeItem('driver-sim')
    toast({ title: 'Локальные данные симулятора очищены' })
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-5 w-5 text-slate-500" />
            Симулятор приложения водителя
          </CardTitle>
          <div className="text-xs text-slate-500">
            Сценарии B10 1.4: лестница с required_files, офлайн-очередь и пакетная отправка, clock_skew,
            дубль client_id, seq вне порядка, события после замены состава, legacy-события.
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Настройки устройства */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Водитель</Label>
              <Select value={settings.driverId} onValueChange={(v) => setSettings((s) => ({ ...s, driverId: v }))}>
                <SelectTrigger><SelectValue placeholder="Выберите водителя" /></SelectTrigger>
                <SelectContent>
                  {state.drivers.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-slate-500">
                Устройство: <span className="font-mono">{settings.deviceId || '—'}</span>
                {myDevice?.isLegacy && <Pill className="ml-2 bg-orange-100 text-orange-700">legacy на сервере</Pill>}
                {myDevice?.systematicSkew && <Pill className="ml-1 bg-red-100 text-red-700">systematic_skew</Pill>}
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="sim-offline">Офлайн (нет сети)</Label>
                <Switch id="sim-offline" checked={settings.offline} onCheckedChange={(v) => setSettings((s) => ({ ...s, offline: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="sim-legacy">Legacy-приложение (без seq/files)</Label>
                <Switch id="sim-legacy" checked={settings.legacy} onCheckedChange={(v) => setSettings((s) => ({ ...s, legacy: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="sim-file">Прикреплять фото ТТН</Label>
                <Switch id="sim-file" checked={settings.attachFile} onCheckedChange={(v) => setSettings((s) => ({ ...s, attachFile: v }))} />
              </div>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Сдвиг часов устройства: {settings.skewMin > 0 ? '+' : ''}{settings.skewMin} мин</Label>
              <Slider
                value={[settings.skewMin]}
                min={-180} max={180} step={15}
                onValueChange={([v]) => setSettings((s) => ({ ...s, skewMin: v }))}
              />
              <div className="text-[11px] text-slate-400">
                Порог флага clock_skew — {CONSTANTS.CLOCK_SKEW_FLAG_MIN} мин. После {CONSTANTS.CLOCK_SKEW_ALERT_COUNT} событий
                устройство помечается systematic_skew (ARC-011).
              </div>
            </div>
          </div>

          {/* Баннеры B8.5 */}
          <div className="space-y-2">
            {upgradeRequired && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
                {UI_TEXTS.upgradeRequired} — но создание и отправка событий не блокируются (ARC-006)
              </div>
            )}
            {skewDetected && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {UI_TEXTS.clockInaccurate}
              </div>
            )}
            {revokedTrip && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {UI_TEXTS.notAssigned} (ACCESS_REVOKED, B5.8.2). Очередь не удаляется: файлы будут приняты,
                статусные события уйдут в разбор.
              </div>
            )}
            <div className={`rounded-lg border px-3 py-2 text-sm ${settings.offline ? 'border-slate-300 bg-slate-50 text-slate-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
              {settings.offline
                ? <span className="flex items-center gap-2"><WifiOff className="h-4 w-4" />Нет сети — события копятся в очереди</span>
                : <span className="flex items-center gap-2"><Wifi className="h-4 w-4" />Сеть доступна</span>}
              <span className="ml-4 font-medium">
                {UI_TEXTS.notSent.replace('N', String(pendingItems.length)).replace('M', String(pendingPhotos))}
              </span>
            </div>
          </div>

          {/* Рейсы и переходы */}
          {allLegs.length > 0 ? (
            <div className="space-y-2">
              <Label>Плечо (только свои рейсы — row-level B2.4)</Label>
              <Select value={selectedLegId} onValueChange={setSelectedLegId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {allLegs.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      Рейс {l.tripId.slice(0, 8)} · плечо {l.seq}: {l.loadPoint} → {l.unloadPoint}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedLeg && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 p-3">
                  <StatusChip status={selectedLeg.status} />
                  <span className="text-xs text-slate-500">→</span>
                  {nextStatuses.length === 0 && <span className="text-xs text-slate-400">Лестница пройдена</span>}
                  {nextStatuses.map((s) => (
                    <Button key={s} size="sm" variant="outline" onClick={() => addEvent(s)}>
                      {STATUS_LABELS[s]}
                      {FILE_REQUIRED[s] && ' + фото ТТН'}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
              {settings.driverId
                ? 'У этого водителя нет назначенных рейсов'
                : 'Выберите водителя, чтобы увидеть его рейсы'}
            </div>
          )}

          {/* Действия */}
          <div className="flex flex-wrap gap-2">
            <Button onClick={syncAll} disabled={busy || settings.offline}>
              <Send className="h-4 w-4 mr-1" />Синхронизировать ({pendingItems.length})
            </Button>
            <Button variant="outline" onClick={syncReversed} disabled={busy || settings.offline}>
              <CloudOff className="h-4 w-4 mr-1" />Отправить в обратном порядке
            </Button>
            <Button variant="outline" onClick={queueDuplicate} disabled={busy}>Дубль client_id</Button>
            <Button variant="outline" onClick={confirmFiles} disabled={busy}>Подтвердить доставку файлов</Button>
            <Button variant="destructive" onClick={loseFile} disabled={busy}>Файл утерян</Button>
            <Button variant="ghost" onClick={resetSim} disabled={busy}>
              <RefreshCw className="h-4 w-4 mr-1" />Сбросить симулятор
            </Button>
          </div>

          {/* Очередь */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-500 uppercase">Очередь устройства (аналог Room)</div>
            {queue.length === 0 && <div className="text-sm text-slate-400">Очередь пуста</div>}
            {queue.slice().reverse().map((q) => (
              <div key={q.clientId} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 p-2 text-sm">
                <StatusChip status={q.status} />
                {q.state === 'pending' ? (
                  <Pill className="bg-slate-100 text-slate-600">в очереди</Pill>
                ) : (
                  <OutcomeChip result={q.result?.result} reason={q.result?.reason} />
                )}
                <span className="text-[11px] text-slate-500 font-mono">
                  {q.clientId.slice(0, 8)}… {q.seqNo != null ? `seq ${q.seqNo}` : 'без seq (legacy)'}
                  {q.files && q.files.length > 0 ? ` · фото ${q.files.map((f) => f.clientId.slice(0, 6))}…` : ''}
                </span>
                <span className="text-[11px] text-slate-400">{new Date(q.clientTs).toLocaleString('ru-RU')}</span>
                {q.result?.reason && <span className="text-[11px] text-slate-500">{q.result.reason}</span>}
              </div>
            ))}
          </div>

          <div className="text-[11px] text-slate-400">
            Подсказки: (1) офлайн + «Погружен» без переключателя фото → локальный блок «Прикрепите фото ТТН»;
            (2) сдвиг часов ±90 мин → clock_skew и needs_review; (3) legacy-переключатель — события без seq/файлов
            применяются автоматически (B7.2.12); (4) замените состав в карточке рейса и синхронизируйте очередь
            прежнего водителя — файлы дойдут, статусы уйдут в разбор.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
