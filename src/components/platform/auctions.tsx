'use client'

/** «Торги» — экран логиста: согласование победителя, продление, прямые предложения */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Clock, ClockPlus, EyeOff, Gavel, Handshake, Send, Timer, TrendingDown, TrendingUp, Trophy,
} from 'lucide-react'
import {
  EmptyState, ErrorBlock, LoadingBlock, ModeBadge, SectionHeader, StatusBadge, type TabProps,
} from '@/components/platform/common'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { fmtDateTime, rate, num, timeLeft } from '@/lib/status'
import type { BidDTO, CarrierDTO, RequestDTO } from '@/lib/types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full'

/** Countdown до окончания торгов — рендерится только на клиенте (now !== null) */
function Countdown({ deadline, now }: { deadline: string | null; now: number | null }) {
  if (!deadline) return <span className="text-sm text-slate-400">без срока</span>
  if (now === null) return <span className="font-mono text-sm text-slate-400">—:—:—</span>
  const tl = timeLeft(deadline)
  if (!tl) return null
  return (
    <span
      className={`font-mono text-sm ${tl.urgent ? 'font-semibold text-red-600' : 'font-semibold text-slate-700'}`}
      suppressHydrationWarning
    >
      {tl.text}
    </span>
  )
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'green' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 text-sm font-bold ${tone === 'green' ? 'text-emerald-600' : 'text-slate-900'}`}>{value}</div>
    </div>
  )
}

export default function AuctionsTab({ activeCarrierId: _activeCarrierId, onNavigate }: TabProps) {
  const { toast } = useToast()
  const [requests, setRequests] = useState<RequestDTO[] | null>(null)
  const [carriers, setCarriers] = useState<CarrierDTO[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [now, setNow] = useState<number | null>(null)

  // диалоги
  const [awardBid, setAwardBid] = useState<{ request: RequestDTO; bid: BidDTO } | null>(null)
  const [offerRequest, setOfferRequest] = useState<RequestDTO | null>(null)
  const [offerCarrierId, setOfferCarrierId] = useState<string>('')
  const [raiseRequest, setRaiseRequest] = useState<RequestDTO | null>(null)
  const [raiseAmount, setRaiseAmount] = useState<string>('')
  const [raiseError, setRaiseError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [rq, dir] = await Promise.all([api.listRequests(), api.directory()])
      setRequests(rq.requests)
      setCarriers(dir.carriers)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // автообновление каждые 15 секунд
  useEffect(() => {
    const t = setInterval(() => { void load() }, 15000)
    return () => clearInterval(t)
  }, [load])

  // часы для countdown (без hydration mismatch)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const live = useMemo(
    () => (requests ?? []).filter((r) => r.status === 'PUBLISHED' && (r.mode === 'AUCTION' || r.mode === 'CLOSED')),
    [requests],
  )
  const awarded = useMemo(() => (requests ?? []).filter((r) => r.status === 'AWARDED'), [requests])
  const takenMap = useMemo(() => new Map(carriers.map((c) => [c.id, c.takenCount])), [carriers])

  const runAction = useCallback(async (
    id: string, action: string, payload: Record<string, unknown>, okTitle: string, okDesc: string,
  ): Promise<boolean> => {
    setBusy(id)
    try {
      await api.action(id, action, payload)
      toast({ title: okTitle, description: okDesc })
      await load()
      return true
    } catch (e) {
      toast({
        title: 'Действие не выполнено',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
      return false
    } finally {
      setBusy(null)
    }
  }, [load, toast])

  const openOffer = (r: RequestDTO) => {
    setOfferCarrierId((cur) => (carriers.some((c) => c.id === cur) ? cur : carriers[0]?.id ?? ''))
    setOfferRequest(r)
  }

  const openRaise = (r: RequestDTO) => {
    setRaiseAmount('')
    setRaiseError(null)
    setRaiseRequest(r)
  }

  const submitRaise = async () => {
    if (!raiseRequest) return
    const amt = Number(raiseAmount)
    if (!raiseAmount || Number.isNaN(amt) || amt <= raiseRequest.startRate) {
      setRaiseError(`Новая ставка должна быть выше текущей (${rate(raiseRequest.startRate)})`)
      return
    }
    const ok = await runAction(
      raiseRequest.id, 'raise-rate', { amount: amt },
      'Стартовая ставка повышена', `№${raiseRequest.number}: новая стартовая ставка ${rate(amt)}`,
    )
    if (ok) setRaiseRequest(null)
  }

  const confirmAward = async () => {
    if (!awardBid) return
    const { request, bid } = awardBid
    const ok = await runAction(
      request.id, 'award', { bidId: bid.id },
      'Победитель согласован',
      `№${request.number}: ${bid.carrierName} — ${rate(bid.amount)}. Заявка ждёт документы от агента`,
    )
    if (ok) setAwardBid(null)
  }

  const confirmOffer = async () => {
    if (!offerRequest || !offerCarrierId) return
    const carrier = carriers.find((c) => c.id === offerCarrierId)
    const offerRate = offerRequest.bestRate ?? offerRequest.startRate
    const ok = await runAction(
      offerRequest.id, 'direct-offer', { carrierId: offerCarrierId },
      'Заявка предложена напрямую',
      `№${offerRequest.number}: ${carrier?.name ?? 'перевозчик'} — ${rate(offerRate)}`,
    )
    if (ok) setOfferRequest(null)
  }

  if (requests === null && !error) return <LoadingBlock label="Загрузка торгов…" />
  if (error) return <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />

  return (
    <div>
      <SectionHeader
        title="Торги"
      >
        <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
          <Clock className="mr-1 h-3.5 w-3.5" aria-hidden />
          Обновляется каждые 15 с
        </Badge>
      </SectionHeader>

      <Tabs defaultValue="live" className="gap-4">
        <TabsList>
          <TabsTrigger value="live">
            <Gavel className="h-4 w-4" aria-hidden />
            Идут торги
            <Badge variant="outline" className="ml-1 border-blue-200 bg-blue-50 px-1.5 text-xs text-blue-700">{live.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="awarded">
            <Trophy className="h-4 w-4" aria-hidden />
            Согласованные
            <Badge variant="outline" className="ml-1 border-violet-200 bg-violet-50 px-1.5 text-xs text-violet-700">{awarded.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* ---------------- Идут торги ---------------- */}
        <TabsContent value="live" className="space-y-4">
          {live.length === 0 && (
            <EmptyState
              icon={<Gavel className="h-10 w-10" aria-hidden />}
              title="Сейчас торгов нет"
              hint="Опубликуйте заявку на площадке — она появится здесь в статусах «Торги» или «Закрытые ставки»"
            />
          )}
          {live.map((r) => {
            const sortedBids = [...r.bids].sort((a, b) => a.amount - b.amount || a.createdAt.localeCompare(b.createdAt))
            const minBid = sortedBids[0] ?? null
            const minAmount = minBid?.amount ?? null
            const savings = r.bestRate != null && r.bestRate < r.startRate ? r.startRate - r.bestRate : null
            const urgentClock = now !== null && timeLeft(r.deadline)?.urgent === true
            return (
              <Card key={r.id} className="border-slate-200 shadow-sm">
                <CardContent className="space-y-4 p-4 sm:p-6">
                  {/* шапка торга */}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-bold text-blue-700">№{r.number}</span>
                        <ModeBadge mode={r.mode} />
                      </div>
                      <div className="text-sm text-slate-600">
                        {r.fromPoint} → {r.toPoint} · {r.cargo}, {num(r.tonnage)} т · окно погрузки {r.loadWindow}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">До окончания торгов</div>
                      <div className="mt-0.5 flex items-center justify-end gap-1.5">
                        <Timer className={`h-4 w-4 ${urgentClock ? 'text-red-600' : 'text-slate-500'}`} aria-hidden />
                        <Countdown deadline={r.deadline} now={now} />
                      </div>
                    </div>
                  </div>

                  {/* метрики */}
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Metric label="Стартовая ставка" value={rate(r.startRate)} />
                    <Metric label="Лучшая ставка" value={r.bestRate != null ? rate(r.bestRate) : 'Ставок нет'} />
                    <Metric label="Экономия" value={savings != null ? rate(savings) : '—'} tone={savings != null ? 'green' : 'default'} />
                    <Metric label="Ставок" value={String(r.bids.length)} />
                  </div>

                  {/* ставки: для AUCTION — таблица, для CLOSED — пояснение */}
                  {r.mode === 'CLOSED' ? (
                    <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                      Закрытые ставки: цены участников скрыты до подведения итогов. Согласуйте победителя — итоговая сумма раскроется в подтверждении.
                    </div>
                  ) : sortedBids.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                      Ставок пока нет — перевозчики видят заявку на площадке.
                    </div>
                  ) : (
                    <div className={`max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200 ${THIN_SCROLL}`}>
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead>Перевозчик</TableHead>
                            <TableHead>Ставка</TableHead>
                            <TableHead>Время ставки</TableHead>
                            <TableHead>Взято заявок</TableHead>
                            <TableHead />
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sortedBids.map((b) => {
                            const isBest = minAmount != null && b.amount === minAmount
                            return (
                              <TableRow key={b.id} className={isBest ? 'bg-emerald-50/60' : undefined}>
                                <TableCell className="font-medium text-slate-800">{b.carrierName}</TableCell>
                                <TableCell className="whitespace-nowrap font-semibold text-slate-900">{rate(b.amount)}</TableCell>
                                <TableCell className="whitespace-nowrap text-slate-600">{fmtDateTime(b.createdAt)}</TableCell>
                                <TableCell className="whitespace-nowrap text-slate-600">{takenMap.get(b.carrierId) ?? '—'}</TableCell>
                                <TableCell>
                                  {isBest && (
                                    <Badge variant="outline" className="whitespace-nowrap border-emerald-300 bg-emerald-50 text-emerald-700">
                                      <TrendingDown className="mr-1 h-3 w-3" aria-hidden />
                                      Лучшая ставка
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy === r.id}
                                    onClick={() => setAwardBid({ request: r, bid: b })}
                                    aria-label={`Выбрать ставку ${b.carrierName} на ${rate(b.amount)}`}
                                  >
                                    Выбрать
                                  </Button>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {/* действия над торгом */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    {minBid ? (
                      <Button size="sm" disabled={busy === r.id} onClick={() => setAwardBid({ request: r, bid: minBid })}>
                        <Trophy className="h-4 w-4" aria-hidden />
                        Согласовать победителя
                      </Button>
                    ) : (
                      <Button size="sm" disabled={busy === r.id} onClick={() => openRaise(r)}>
                        <TrendingUp className="h-4 w-4" aria-hidden />
                        Поднять стартовую ставку
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === r.id}
                      onClick={() => void runAction(r.id, 'extend', {}, 'Торги продлены', `№${r.number}: срок увеличен на 2 часа`)}
                    >
                      <ClockPlus className="h-4 w-4" aria-hidden />
                      Продлить торги на 2 часа
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => openOffer(r)}>
                      <Send className="h-4 w-4" aria-hidden />
                      Предложить напрямую
                    </Button>
                    {busy === r.id && <span className="text-xs text-slate-400">Выполняется…</span>}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </TabsContent>

        {/* ---------------- Согласованные ---------------- */}
        <TabsContent value="awarded" className="space-y-3">
          {awarded.length === 0 && (
            <EmptyState
              icon={<Trophy className="h-10 w-10" aria-hidden />}
              title="Согласованных заявок нет"
              hint="Согласуйте победителя на вкладке «Идут торги»"
            />
          )}
          {awarded.map((r) => (
            <Card key={r.id} className="border-slate-200 shadow-sm">
              <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
                <span className="text-base font-bold text-blue-700">№{r.number}</span>
                <div className="text-sm text-slate-600">
                  {r.fromPoint} → {r.toPoint} · {r.cargo}, {num(r.tonnage)} т
                </div>
                <div className="text-sm">
                  <span className="text-slate-500">Победитель: </span>
                  <span className="font-semibold text-slate-900">{r.winnerName ?? '—'}</span>
                </div>
                <div className="text-sm font-semibold text-slate-900">{rate(r.bestRate)}</div>
                <StatusBadge status={r.status} />
                <div className="ml-auto flex items-center gap-3">
                  {r.status === 'AWARDED' && <span className="text-xs text-amber-600">Ожидает документы от агента</span>}
                  <Button size="sm" variant="outline" onClick={() => onNavigate('verify')}>
                    Перейти к сверке
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* подтверждение согласования победителя */}
      <AlertDialog open={!!awardBid} onOpenChange={(o) => { if (!o) setAwardBid(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Согласовать победителя торгов?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {awardBid && (
                  <>
                    Заявка №{awardBid.request.number} · {awardBid.request.fromPoint} → {awardBid.request.toPoint}.
                    Перевозчик <span className="font-semibold text-slate-900">{awardBid.bid.carrierName}</span> — ставка{' '}
                    <span className="font-semibold text-emerald-700">{rate(awardBid.bid.amount)}</span>
                    {awardBid.request.startRate > awardBid.bid.amount && (
                      <> · экономия {rate(awardBid.request.startRate - awardBid.bid.amount)}</>
                    )}
                    . После согласования агент получит заявку для загрузки документов.
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(e) => { e.preventDefault(); void confirmAward() }}
            >
              Согласовать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* прямое предложение перевозчику */}
      <Dialog open={!!offerRequest} onOpenChange={(o) => { if (!o) setOfferRequest(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Предложить заявку напрямую</DialogTitle>
            <DialogDescription>
              {offerRequest && (
                <>№{offerRequest.number} · {offerRequest.fromPoint} → {offerRequest.toPoint} · ставка {rate(offerRequest.bestRate ?? offerRequest.startRate)}</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="offer-carrier">Перевозчик</Label>
            <Select value={offerCarrierId} onValueChange={setOfferCarrierId}>
              <SelectTrigger id="offer-carrier" aria-label="Выбор перевозчика для прямого предложения">
                <SelectValue placeholder="Выберите перевозчика" />
              </SelectTrigger>
              <SelectContent>
                {carriers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · взято {c.takenCount}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOfferRequest(null)}>Отмена</Button>
            <Button disabled={!offerCarrierId || busy !== null} onClick={() => void confirmOffer()}>
              <Handshake className="h-4 w-4" aria-hidden />
              Предложить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* поднятие стартовой ставки */}
      <Dialog open={!!raiseRequest} onOpenChange={(o) => { if (!o) setRaiseRequest(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Поднять стартовую ставку</DialogTitle>
            <DialogDescription>
              {raiseRequest && (
                <>№{raiseRequest.number}: ставок нет. Повысьте стартовую ставку, чтобы привлечь перевозчиков.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="raise-amount">Новая стартовая ставка, ₽/т</Label>
            <Input
              id="raise-amount"
              type="number"
              inputMode="numeric"
              min={2500}
              step={100}
              placeholder={raiseRequest ? `больше ${raiseRequest.startRate}` : ''}
              value={raiseAmount}
              onChange={(e) => { setRaiseAmount(e.target.value); setRaiseError(null) }}
              aria-label="Новая стартовая ставка в рублях за тонну"
            />
            {raiseRequest && <div className="text-xs text-slate-500">Текущая стартовая ставка: {rate(raiseRequest.startRate)}</div>}
            {raiseError && <div className="text-xs font-medium text-red-600">{raiseError}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRaiseRequest(null)}>Отмена</Button>
            <Button disabled={busy !== null} onClick={() => void submitRaise()}>Поднять ставку</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
