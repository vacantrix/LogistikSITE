'use client'

/** «Реестр рейсов» — одна запись = один рейс: заявки, ставки, документы, затраты */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, ScrollText } from 'lucide-react'
import {
  EmptyState, ErrorBlock, LoadingBlock, SectionHeader, StatusBadge, type TabProps,
} from '@/components/platform/common'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import {
  REGISTRY_STEPS, fmtDateTime, money, num, registryStepIndex,
} from '@/lib/status'
import type { DriverDTO, RequestDTO, TrailerDTO, TruckDTO } from '@/lib/types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full'

/** Пайплайн из 8 статусов записи реестра */
function Pipeline({ status, passPackage, etrnStatus }: { status: string; passPackage: boolean; etrnStatus: string }) {
  const cur = registryStepIndex(status, passPackage, etrnStatus)
  return (
    <div className="flex flex-wrap items-center gap-1" role="list" aria-label="Этапы рейса">
      {REGISTRY_STEPS.map((step, i) => (
        <Fragment key={step}>
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />}
          <span
            role="listitem"
            aria-current={i === cur ? 'step' : undefined}
            className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              i < cur
                ? 'border-blue-600 bg-blue-600 text-white'
                : i === cur
                  ? 'border-blue-400 bg-blue-100 text-blue-800'
                  : 'border-slate-200 bg-slate-100 text-slate-500'
            }`}
          >
            {step}
          </span>
        </Fragment>
      ))}
    </div>
  )
}

function DocBadges({ r }: { r: RequestDTO }) {
  return (
    <div className="flex flex-wrap gap-1">
      {r.passPackage && (
        <Badge variant="outline" className="whitespace-nowrap border-emerald-300 bg-emerald-50 text-emerald-700">
          Пропуск ✓
        </Badge>
      )}
      {r.etrnStatus === 'SENT' && (
        <Badge variant="outline" className="whitespace-nowrap border-blue-200 bg-blue-50 text-blue-700">
          ЭТрН отправлена
        </Badge>
      )}
      {r.etrnStatus === 'SIGNED' && (
        <Badge variant="outline" className="whitespace-nowrap border-emerald-300 bg-emerald-50 text-emerald-700">
          ЭТрН подписана
        </Badge>
      )}
      {r.etrnStatus !== 'SENT' && r.etrnStatus !== 'SIGNED' && (
        <span className="text-xs text-slate-400">ЭТрН —</span>
      )}
    </div>
  )
}

export default function RegistryTab({ activeCarrierId: _activeCarrierId, onNavigate: _onNavigate }: TabProps) {
  const { toast } = useToast()
  const [requests, setRequests] = useState<RequestDTO[] | null>(null)
  const [drivers, setDrivers] = useState<Map<string, DriverDTO>>(new Map())
  const [trucks, setTrucks] = useState<Map<string, TruckDTO>>(new Map())
  const [trailers, setTrailers] = useState<Map<string, TrailerDTO>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [detail, setDetail] = useState<RequestDTO | null>(null)
  const [closeTarget, setCloseTarget] = useState<RequestDTO | null>(null)

  const load = useCallback(async () => {
    try {
      const [rq, dir] = await Promise.all([api.listRequests(), api.directory()])
      setRequests(rq.requests)
      const dm = new Map<string, DriverDTO>()
      const tm = new Map<string, TruckDTO>()
      const zm = new Map<string, TrailerDTO>()
      for (const c of dir.carriers) {
        for (const d of c.drivers) dm.set(d.id, d)
        for (const t of c.trucks) tm.set(t.id, t)
        for (const z of c.trailers) zm.set(z.id, z)
      }
      setDrivers(dm)
      setTrucks(tm)
      setTrailers(zm)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const rows = useMemo(
    () => (requests ?? [])
      .filter((r) => r.status === 'CONFIRMED' || r.status === 'CLOSED')
      .sort((a, b) => b.number.localeCompare(a.number)),
    [requests],
  )

  const closeTrip = async () => {
    if (!closeTarget) return
    setBusy(closeTarget.id)
    try {
      await api.action(closeTarget.id, 'close')
      toast({
        title: 'Рейс закрыт',
        description: `№${closeTarget.number}: данные в реестре, ЭТрН подписана, отчёты сходятся с бухгалтерией`,
      })
      setCloseTarget(null)
      setDetail(null)
      await load()
    } catch (e) {
      toast({
        title: 'Не удалось закрыть рейс',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setBusy(null)
    }
  }

  if (requests === null && !error) return <LoadingBlock label="Загрузка реестра рейсов…" />
  if (error) return <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />

  return (
    <div>
      <SectionHeader
        title="Реестр рейсов"
      >
        <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
          Записей: {rows.length}
        </Badge>
      </SectionHeader>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-10 w-10" aria-hidden />}
          title="Реестр пуст"
          hint="Подтвердите заявку на сверке — запись рейса появится здесь"
        />
      ) : (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-0">
            <div className={`max-h-96 overflow-y-auto overflow-x-auto ${THIN_SCROLL}`}>
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead>№</TableHead>
                    <TableHead>Погрузка</TableHead>
                    <TableHead>Направление</TableHead>
                    <TableHead>Груз</TableHead>
                    <TableHead>Перевозчик</TableHead>
                    <TableHead>Водитель</TableHead>
                    <TableHead>ТС</TableHead>
                    <TableHead>Ставка</TableHead>
                    <TableHead>Экономия</TableHead>
                    <TableHead>Документы</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Действие</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const driver = r.driverId ? drivers.get(r.driverId) : undefined
                    const truck = r.truckId ? trucks.get(r.truckId) : undefined
                    const trailer = r.trailerId ? trailers.get(r.trailerId) : undefined
                    return (
                      <TableRow
                        key={r.id}
                        onClick={() => setDetail(r)}
                        className="cursor-pointer hover:bg-slate-50"
                      >
                        <TableCell className="whitespace-nowrap font-bold text-blue-700">№{r.number}</TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600">{r.loadDate}</TableCell>
                        <TableCell className="whitespace-nowrap text-slate-700">{r.fromPoint} → {r.toPoint}</TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600">{r.cargo}, {num(r.tonnage)} т</TableCell>
                        <TableCell className="whitespace-nowrap font-medium text-slate-800">{r.winnerName ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600">{driver?.fullName ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600">
                          {truck ? `${truck.brand} · ${truck.plate}` : '—'}
                          {trailer && <span className="text-slate-500"> + {trailer.plate}</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600">
                          {money(r.startRate)} → <span className="font-semibold text-slate-900">{money(r.bestRate)}</span>
                        </TableCell>
                        <TableCell className={`whitespace-nowrap font-semibold ${(r.savings ?? 0) > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                          {money(r.savings)}
                        </TableCell>
                        <TableCell><DocBadges r={r} /></TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                        <TableCell
                          className="text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.status === 'CONFIRMED' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy === r.id}
                              onClick={() => setCloseTarget(r)}
                              aria-label={`Закрыть рейс №${r.number}`}
                            >
                              Закрыть рейс
                            </Button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="border-t border-slate-100 px-4 py-2 text-xs text-muted-foreground">
              Нажмите на строку, чтобы открыть карточку рейса с этапами и журналом событий.
            </div>
          </CardContent>
        </Card>
      )}

      {/* карточка рейса */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Карточка рейса №{detail?.number}
              {detail && <StatusBadge status={detail.status} />}
            </DialogTitle>
            <DialogDescription>
              {detail && <>Этапы рейса и журнал событий — данные синхронизированы с 1C:ERP</>}
            </DialogDescription>
          </DialogHeader>

          {detail && (
            <div className="space-y-4">
              <Pipeline status={detail.status} passPackage={detail.passPackage} etrnStatus={detail.etrnStatus} />

              <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Направление</div>
                  <div className="text-sm font-medium text-slate-800">{detail.fromPoint} → {detail.toPoint}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Груз</div>
                  <div className="text-sm font-medium text-slate-800">{detail.cargo}, {num(detail.tonnage)} т · {detail.truckType}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Погрузка</div>
                  <div className="text-sm font-medium text-slate-800">{detail.loadDate} · {detail.loadWindow}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Перевозчик</div>
                  <div className="text-sm font-medium text-slate-800">{detail.winnerName ?? '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Водитель</div>
                  <div className="text-sm font-medium text-slate-800">
                    {detail.driverId ? drivers.get(detail.driverId)?.fullName ?? '—' : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">ТС</div>
                  <div className="text-sm font-medium text-slate-800">
                    {detail.truckId ? (() => {
                      const t = trucks.get(detail.truckId)
                      return t ? `${t.brand} · ${t.plate}` : '—'
                    })() : '—'}
                    {detail.trailerId && trailers.get(detail.trailerId) && (
                      <span className="text-slate-500"> + {trailers.get(detail.trailerId)?.plate}</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Ставка</div>
                  <div className="text-sm font-medium text-slate-800">{money(detail.startRate)} → {money(detail.bestRate)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Экономия</div>
                  <div className={`text-sm font-semibold ${(detail.savings ?? 0) > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                    {money(detail.savings)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Документы</div>
                  <div className="mt-0.5"><DocBadges r={detail} /></div>
                </div>
              </div>

              {/* журнал событий */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Журнал событий</div>
                <div className={`max-h-60 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3 ${THIN_SCROLL}`}>
                  {[...detail.events]
                    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                    .map((ev) => (
                      <div key={ev.id} className="flex items-start gap-3 text-sm">
                        <span className="shrink-0 font-mono text-xs text-slate-500">{fmtDateTime(ev.createdAt)}</span>
                        <span className="text-slate-700">{ev.message}</span>
                      </div>
                    ))}
                  {detail.events.length === 0 && (
                    <div className="text-sm text-slate-400">Событий пока нет</div>
                  )}
                </div>
              </div>

              {detail.status === 'CONFIRMED' && (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
                  <Button
                    size="sm"
                    disabled={busy === detail.id}
                    onClick={() => setCloseTarget(detail)}
                  >
                    Закрыть рейс
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* подтверждение закрытия рейса */}
      <AlertDialog open={!!closeTarget} onOpenChange={(o) => { if (!o) setCloseTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Закрыть рейс?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {closeTarget && (
                  <>
                    Запись №{closeTarget.number} · {closeTarget.fromPoint} → {closeTarget.toPoint} ·{' '}
                    {closeTarget.winnerName ?? '—'} — {money(closeTarget.bestRate)}. Рейс будет помечен закрытым
                    в реестре, ЭТрН — подписанной. Отчёты для бухгалтерии пересчитаются автоматически.
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(e) => { e.preventDefault(); void closeTrip() }}
            >
              Закрыть рейс
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
