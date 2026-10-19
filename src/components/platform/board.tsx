'use client'

/** Раздел «Площадка заявок» — перевозчик выбирает заявку и делает ставку; логист публикует и контролирует */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Gavel,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  ModeBadge,
  SectionHeader,
  StatusBadge,
  type TabProps,
} from '@/components/platform/common'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { fmtDateTime, money, timeLeft } from '@/lib/status'
import type { BidDTO, RequestDTO, RequestMode } from '@/lib/types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300'

type ModeFilter = 'ALL' | RequestMode

const MODE_FILTERS: { value: ModeFilter; label: string }[] = [
  { value: 'ALL', label: 'Все режимы' },
  { value: 'AUCTION', label: 'Торги' },
  { value: 'CLOSED', label: 'Закрытые ставки' },
]

/** Ставка в таблице: текущая лучшая и стартовая */
function RateCell({ request }: { request: RequestDTO }) {
  if (request.mode === 'CLOSED') {
    return (
      <div>
        <div className="flex items-center gap-1 font-semibold text-slate-900">
          <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          Скрыта
        </div>
        <div className="text-xs text-muted-foreground">старт {money(request.startRate)}</div>
      </div>
    )
  }
  if (request.bestRate == null) {
    return (
      <div>
        <div className="text-sm font-medium text-slate-500">Ставок нет</div>
        <div className="text-xs text-muted-foreground">старт {money(request.startRate)}</div>
      </div>
    )
  }
  return (
    <div>
      <div className="font-semibold text-slate-900">{money(request.bestRate)}</div>
      <div className="text-xs text-muted-foreground">старт {money(request.startRate)}</div>
    </div>
  )
}

/** Обратный отсчёт до окончания приёма ставок (без hydration mismatch) */
function DeadlineCell({ request, now }: { request: RequestDTO; now: number | null }) {
  if (!request.deadline) return <span className="text-slate-400">—</span>
  if (now === null) return <span className="text-slate-400">—</span>
  const tl = timeLeft(request.deadline)
  if (!tl) return <span className="text-slate-400">—</span>
  return (
    <span className={`tabular-nums ${tl.urgent ? 'font-semibold text-red-600' : 'text-slate-700'}`}>
      {tl.text}
    </span>
  )
}

export default function BoardTab({ activeCarrierId, role, onNavigate }: TabProps) {
  const { toast } = useToast()
  const [requests, setRequests] = useState<RequestDTO[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<ModeFilter>('ALL')
  const [now, setNow] = useState<number | null>(null)
  const isLogist = role === 'logist'

  // диалоги: держим только id, свежие данные берём из списка
  const [detailId, setDetailId] = useState<string | null>(null)
  const [bidId, setBidId] = useState<string | null>(null)
  const [bidAmount, setBidAmount] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  // создание заявки — только логист
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    fromPoint: '', toPoint: '', cargo: '', tonnage: '20', truckType: 'Тент',
    mode: 'AUCTION' as RequestMode, startRate: '', loadDate: '', loadWindow: '08:00–12:00', deadlineHours: '4',
  })

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const d = await api.listRequests()
      setRequests(d.requests)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setLoading(false)
      if (!silent) setRefreshing(false)
    }
  }, [])

  // первичная загрузка + автообновление каждые 15 секунд
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(true), 15_000)
    return () => clearInterval(t)
  }, [load])

  // таймер для обратного отсчёта — только после монтирования
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

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

  const filtered = useMemo(() => {
    const list = requests ?? []
    const needle = q.trim().toLowerCase()
    return list.filter((r) => {
      if (mode !== 'ALL' && r.mode !== mode) return false
      if (!needle) return true
      return [r.number, r.cargo, r.fromPoint, r.toPoint].some((v) => v.toLowerCase().includes(needle))
    })
  }, [requests, q, mode])

  const openCount = (requests ?? []).filter((r) => r.status === 'PUBLISHED').length

  const detailReq = (requests ?? []).find((r) => r.id === detailId) ?? null
  const bidReq = (requests ?? []).find((r) => r.id === bidId) ?? null

  const closeBid = () => {
    setBidId(null)
    setBidAmount('')
  }

  const doBid = async () => {
    if (!bidReq || !activeCarrierId) return
    const amount = Math.round(Number(bidAmount.replace(/\s/g, '').replace(',', '.')))
    if (!amount || amount <= 0) {
      toast({ title: 'Ошибка', description: 'Укажите ставку в рублях', variant: 'destructive' })
      return
    }
    if (bidReq.mode === 'AUCTION') {
      const floor = bidReq.bestRate ?? bidReq.startRate
      if (amount >= floor) {
        toast({ title: 'Ошибка', description: `Ставка должна быть ниже текущей лучшей (${money(floor)})`, variant: 'destructive' })
        return
      }
    }
    setBusyId(bidReq.id)
    try {
      const { request } = await api.action(bidReq.id, 'bid', { carrierId: activeCarrierId, amount })
      applyRequest(request)
      toast({ title: 'Ставка принята', description: `${request.number} — ${money(amount)}${request.mode === 'CLOSED' ? ' · закрытая ставка' : ''}` })
      closeBid()
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : 'Не удалось подать ставку', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const sortedBids = (bids: BidDTO[]) => [...bids].sort((a, b) => a.amount - b.amount)
  const bestBid = (bids: BidDTO[]) => (bids.length > 0 ? Math.min(...bids.map((b) => b.amount)) : null)

  // ——— публикация заявки (только логист) ———
  const doCreate = async () => {
    if (!form.fromPoint.trim() || !form.toPoint.trim() || !form.cargo.trim() || !form.startRate.trim()) {
      toast({ title: 'Ошибка', description: 'Заполните направление, груз и стартовую ставку', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const { request } = await api.createRequest({
        fromPoint: form.fromPoint.trim(),
        toPoint: form.toPoint.trim(),
        cargo: form.cargo.trim(),
        tonnage: Number(form.tonnage) || 20,
        truckType: form.truckType,
        mode: form.mode,
        startRate: Number(form.startRate.replace(/\s/g, '')),
        loadDate: form.loadDate.trim() || '—',
        loadWindow: form.loadWindow.trim() || '08:00–12:00',
        deadline: new Date(Date.now() + Number(form.deadlineHours || 4) * 3600_000).toISOString(),
      })
      setRequests((prev) => [request, ...(prev ?? [])])
      setCreateOpen(false)
      setForm((f) => ({ ...f, fromPoint: '', toPoint: '', cargo: '', startRate: '' }))
      toast({ title: 'Заявка опубликована', description: `${request.number}: ${request.fromPoint} → ${request.toPoint}` })
    } catch (e) {
      toast({ title: 'Не удалось опубликовать заявку', description: e instanceof Error ? e.message : 'Неизвестная ошибка', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <section aria-label="Площадка заявок">
      <SectionHeader title="Площадка заявок">
        <div className="flex items-center gap-3">
          {isLogist && (
            <Button onClick={() => setCreateOpen(true)} className="gap-1.5" aria-label="Создать и опубликовать заявку">
              <Plus className="h-4 w-4" aria-hidden />
              Создать заявку
            </Button>
          )}
          <div className="text-sm font-medium text-slate-700" aria-live="polite">
            Открыто <span className="text-lg font-bold text-blue-700">{openCount}</span> заявок
          </div>
        </div>
      </SectionHeader>

      {!isLogist && !activeCarrierId && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          Выберите перевозчика в шапке, чтобы действовать от его имени
        </div>
      )}

      {loading && <LoadingBlock label="Загружаем заявки…" />}
      {!loading && error && <ErrorBlock message={error} onRetry={() => void load()} />}

      {!loading && !error && requests && (
        <div className="space-y-4">
          {/* Фильтры */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Поиск: номер, груз, маршрут…"
                  className="pl-9"
                  aria-label="Поиск по номеру, грузу или маршруту"
                />
              </div>
              <Select value={mode} onValueChange={(v) => setMode(v as ModeFilter)}>
                <SelectTrigger className="w-[200px]" aria-label="Фильтр по режиму заявки">
                  <SelectValue placeholder="Все режимы" />
                </SelectTrigger>
                <SelectContent>
                  {MODE_FILTERS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => void load()} disabled={refreshing} className="gap-2" aria-label="Обновить список заявок">
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
                Обновить
              </Button>
              <span className="ml-auto hidden text-xs text-muted-foreground sm:block">автообновление каждые 15 секунд</span>
            </CardContent>
          </Card>

          {/* Таблица заявок */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              {filtered.length === 0 ? (
                <EmptyState
                  title="Заявок не найдено"
                  hint="Измените параметры поиска или фильтр режима"
                />
              ) : (
                <div className="-mx-2 overflow-x-auto px-2">
                  <table className="w-full min-w-[980px] border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                        <th scope="col" className="border-b border-slate-200 pb-2.5 pr-3 font-semibold">№ заявки</th>
                        <th scope="col" className="border-b border-slate-200 pb-2.5 pr-3 font-semibold">Маршрут</th>
                        <th scope="col" className="border-b border-slate-200 pb-2.5 pr-3 font-semibold">Груз</th>
                        <th scope="col" className="border-b border-slate-200 pb-2.5 pr-3 font-semibold">Погрузка</th>
                        <th scope="col" className="border-b border-slate-200 pb-2.5 pr-3 font-semibold">Тип ТС</th>
                        <th scope="col" className="border-b border-slate-200 pb-2.5 pr-3 font-semibold">Режим</th>
                        <th scope="col" className="border-b border-slate-200 pb-2.5 pr-3 font-semibold">Ставка</th>
                        <th scope="col" className="border-b border-slate-200 pb-2.5 pr-3 font-semibold">До окончания</th>
                        <th scope="col" className="border-b border-slate-200 pb-2.5 font-semibold">Действие</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr
                          key={r.id}
                          onClick={() => setDetailId(r.id)}
                          className="cursor-pointer align-middle transition-colors hover:bg-blue-50/40"
                        >
                          <td className="border-b border-slate-100 py-3 pr-3">
                            <span className="font-semibold text-blue-700">{r.number}</span>
                          </td>
                          <td className="border-b border-slate-100 py-3 pr-3">
                            <span className="flex items-center gap-1.5 font-medium text-slate-800">
                              {r.fromPoint}
                              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                              {r.toPoint}
                            </span>
                          </td>
                          <td className="border-b border-slate-100 py-3 pr-3 text-slate-700">
                            {r.cargo}
                            <span className="ml-1 whitespace-nowrap text-muted-foreground">{r.tonnage} т</span>
                          </td>
                          <td className="border-b border-slate-100 py-3 pr-3 text-slate-700">
                            <div>{r.loadDate}</div>
                            <div className="text-xs text-muted-foreground">{r.loadWindow}</div>
                          </td>
                          <td className="border-b border-slate-100 py-3 pr-3 text-slate-700">{r.truckType}</td>
                          <td className="border-b border-slate-100 py-3 pr-3"><ModeBadge mode={r.mode} /></td>
                          <td className="border-b border-slate-100 py-3 pr-3"><RateCell request={r} /></td>
                          <td className="border-b border-slate-100 py-3 pr-3"><DeadlineCell request={r} now={now} /></td>
                          <td className="border-b border-slate-100 py-3" onClick={(e) => e.stopPropagation()}>
                            {isLogist ? (
                              // логист: не участвует в ставках — переходит в торги или смотрит статус
                              <>
                                {r.status === 'PUBLISHED' && r.mode === 'AUCTION' && (
                                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onNavigate('auctions')} aria-label={`Перейти к торгам по заявке ${r.number}`}>
                                    <Gavel className="h-4 w-4" aria-hidden />
                                    К торгам
                                  </Button>
                                )}
                                {r.status === 'PUBLISHED' && r.mode !== 'AUCTION' && (
                                  <span className="text-xs text-muted-foreground">ожидание перевозчика</span>
                                )}
                                {r.status !== 'PUBLISHED' && <StatusBadge status={r.status} />}
                              </>
                            ) : (
                              <>
                                {r.status === 'PUBLISHED' && r.mode === 'AUCTION' && (
                                  <Button
                                    size="sm"
                                    disabled={!activeCarrierId || busyId !== null}
                                    onClick={() => { setBidId(r.id); setBidAmount('') }}
                                    aria-label={`Сделать ставку по заявке ${r.number}`}
                                  >
                                    <Gavel className="h-4 w-4" aria-hidden />
                                    Сделать ставку
                                  </Button>
                                )}
                                {r.status === 'PUBLISHED' && r.mode === 'CLOSED' && (
                                  <Button
                                    size="sm"
                                    disabled={!activeCarrierId || busyId !== null}
                                    onClick={() => { setBidId(r.id); setBidAmount('') }}
                                    aria-label={`Подать закрытую ставку по заявке ${r.number}`}
                                  >
                                    <Lock className="h-4 w-4" aria-hidden />
                                    Подать закрытую ставку
                                  </Button>
                                )}
                                {r.status !== 'PUBLISHED' && <StatusBadge status={r.status} />}
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Диалог создания заявки — только логист */}
      {isLogist && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Новая заявка на перевозку</DialogTitle>
              <DialogDescription>
                Заявка будет опубликована на площадке с присвоением сквозного номера Z-XXXX.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cr-from">Пункт погрузки</Label>
                <Input id="cr-from" placeholder="Абинск, АЭМЗ" value={form.fromPoint} onChange={(e) => setForm((f) => ({ ...f, fromPoint: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr-to">Пункт выгрузки</Label>
                <Input id="cr-to" placeholder="Порт НМТП" value={form.toPoint} onChange={(e) => setForm((f) => ({ ...f, toPoint: e.target.value }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cr-cargo">Груз</Label>
                <Input id="cr-cargo" placeholder="Оборудование" value={form.cargo} onChange={(e) => setForm((f) => ({ ...f, cargo: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr-tonnage">Тоннаж, т</Label>
                <Input id="cr-tonnage" type="number" min={1} value={form.tonnage} onChange={(e) => setForm((f) => ({ ...f, tonnage: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr-truck">Тип ТС</Label>
                <Select value={form.truckType} onValueChange={(v) => setForm((f) => ({ ...f, truckType: v }))}>
                  <SelectTrigger id="cr-truck"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['Тент', 'Реф', 'Изотерм', 'Борт'].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr-mode">Режим отбора</Label>
                <Select value={form.mode} onValueChange={(v) => setForm((f) => ({ ...f, mode: v as RequestMode }))}>
                  <SelectTrigger id="cr-mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUCTION">Торги (аукцион на понижение)</SelectItem>
                    <SelectItem value="CLOSED">Закрытые ставки</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr-rate">Стартовая ставка, ₽</Label>
                <Input id="cr-rate" type="number" min={1000} step={500} placeholder="95000" value={form.startRate} onChange={(e) => setForm((f) => ({ ...f, startRate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr-date">Дата погрузки</Label>
                <Input id="cr-date" placeholder="25.10.2026" value={form.loadDate} onChange={(e) => setForm((f) => ({ ...f, loadDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr-window">Окно погрузки</Label>
                <Input id="cr-window" placeholder="09:00–13:00" value={form.loadWindow} onChange={(e) => setForm((f) => ({ ...f, loadWindow: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr-deadline">Приём ставок ещё</Label>
                <Select value={form.deadlineHours} onValueChange={(v) => setForm((f) => ({ ...f, deadlineHours: v }))}>
                  <SelectTrigger id="cr-deadline"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[['2', '2 часа'], ['4', '4 часа'], ['8', '8 часов'], ['24', '24 часа']].map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
              <Button onClick={() => void doCreate()} disabled={creating}>
                {creating ? 'Публикуем…' : 'Опубликовать заявку'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Диалог ставки (торги / закрытые ставки) */}
      <Dialog open={bidReq !== null} onOpenChange={(o) => { if (!o) closeBid() }}>
        <DialogContent className="sm:max-w-md">
          {bidReq && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {bidReq.mode === 'CLOSED' ? 'Закрытая ставка' : 'Ставка'} · заявка {bidReq.number}
                </DialogTitle>
                <DialogDescription>
                  {bidReq.fromPoint} → {bidReq.toPoint}, {bidReq.cargo}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {bidReq.mode === 'AUCTION' && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    Текущая лучшая: <span className="font-semibold text-slate-900">{money(bidReq.bestRate ?? bidReq.startRate)}</span>
                    {bidReq.bestRate == null && <span className="ml-1 text-muted-foreground">— ставок ещё нет</span>}
                  </div>
                )}
                {bidReq.mode === 'CLOSED' && (
                  <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                    Участники не видят цены друг друга — защита от сговора. Победителя определит логист по итогам.
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="bid-amount">Ваша ставка, ₽</Label>
                  <Input
                    id="bid-amount"
                    type="number"
                    min={1}
                    step={100}
                    inputMode="numeric"
                    placeholder="Например, 85000"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void doBid() }}
                  />
                  <p className="text-xs text-muted-foreground">
                    {bidReq.mode === 'CLOSED' ? 'Ставку увидит только логист при подведении итогов' : 'Должна быть ниже лучшей'}
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeBid}>Отмена</Button>
                <Button onClick={() => void doBid()} disabled={busyId !== null || !bidAmount.trim()}>
                  {busyId === bidReq.id ? 'Отправляем…' : 'Подтвердить ставку'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Детали заявки */}
      <Dialog open={detailReq !== null} onOpenChange={(o) => { if (!o) setDetailId(null) }}>
        <DialogContent className={`max-h-[90vh] overflow-y-auto sm:max-w-2xl ${THIN_SCROLL}`}>
          {detailReq && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  Заявка <span className="text-blue-700">{detailReq.number}</span>
                  <StatusBadge status={detailReq.status} />
                  <ModeBadge mode={detailReq.mode} />
                </DialogTitle>
                <DialogDescription className="flex items-center gap-1.5">
                  {detailReq.fromPoint} <ArrowRight className="h-3.5 w-3.5" aria-hidden /> {detailReq.toPoint}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { label: 'Груз', value: `${detailReq.cargo}, ${detailReq.tonnage} т` },
                  { label: 'Тип ТС', value: detailReq.truckType },
                  { label: 'Погрузка', value: `${detailReq.loadDate}, ${detailReq.loadWindow}` },
                  { label: 'Стартовая ставка', value: money(detailReq.startRate) },
                  { label: 'Текущая лучшая', value: detailReq.bestRate != null ? money(detailReq.bestRate) : '—' },
                  { label: detailReq.winnerName ? 'Перевозчик' : 'Окончание ставок', value: detailReq.winnerName ?? '—' },
                ].map((f) => (
                  <div key={f.label} className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{f.label}</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-900">{f.value}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-blue-900">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  Требования к документам
                </div>
                <p className="mt-1 text-sm text-blue-800">
                  Пропуск в порт: паспорт, ВУ, СТС. Нейросеть сверит фото с данными водителя и автомобиля —
                  комплект загружается в эту же заявку.
                </p>
              </div>

              {detailReq.mode === 'AUCTION' && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    <Gavel className="h-4 w-4 text-blue-600" aria-hidden />
                    Ставки ({detailReq.bids.length})
                  </h4>
                  {detailReq.bids.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-muted-foreground">
                      Ставок пока нет — будьте первым.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Перевозчик</TableHead>
                            <TableHead>Ставка</TableHead>
                            <TableHead>Время</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sortedBids(detailReq.bids).map((b) => {
                            const isBest = bestBid(detailReq.bids) === b.amount
                            return (
                              <TableRow key={b.id} className={isBest ? 'bg-emerald-50' : undefined}>
                                <TableCell className="font-medium">
                                  <span className="flex items-center gap-2">
                                    {b.carrierName}
                                    {isBest && <Badge className="border-emerald-200 bg-emerald-100 text-[10px] text-emerald-800" variant="outline">лучшая</Badge>}
                                  </span>
                                </TableCell>
                                <TableCell className={isBest ? 'font-semibold text-emerald-700' : 'text-slate-700'}>
                                  {money(b.amount)}
                                </TableCell>
                                <TableCell className="text-muted-foreground">{fmtDateTime(b.createdAt)}</TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}

              {detailReq.mode === 'CLOSED' && (
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  <Lock className="h-4 w-4 shrink-0" aria-hidden />
                  Ставки скрыты до подведения итогов — участники не видят цены друг друга.
                </div>
              )}

              {detailReq.status !== 'PUBLISHED' && detailReq.mode === 'AUCTION' && detailReq.bids.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Торги завершены — победитель согласован логистом.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
