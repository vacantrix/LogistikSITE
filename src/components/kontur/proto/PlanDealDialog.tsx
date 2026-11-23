'use client'

/**
 * Диалог «В план» — сквозная связка ATI.SU ↔ Заявки ↔ Занятость ↔ Планирование.
 * Согласованный груз (заявка в силе) назначается составу:
 *   • «свободным составом» — создаётся рейс-черновик (статус «назначен»),
 *     который сразу виден на доске «Занятость» и в графике «Планирования»;
 *   • «плечом к рейсу» — груз встраивается в текущий рейс (обратка без порожняка).
 * Один и тот же диалог открывается из «ATI.SU», «Занятости» и «Планирования» —
 * кандидаты считает общий движок (src/lib/planner.ts), поэтому предложение
 * везде одинаковое.
 */
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarClock, Loader2, Plus, Route, Truck } from 'lucide-react'
import { Button } from '@/components/kontur/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/kontur/ui/dialog'
import { CallButton } from '@/components/kontur/proto/CallButton'
import { Pill } from '@/components/kontur/proto/bits'
import { dealCandidates, fmtWhen, type DealCandidate } from '@/lib/kontur/planner'
import { authFetch } from '@/lib/kontur/session-token'
import { useToast } from '@/hooks/use-toast'
import type { AtiDealDto, StateResponse } from '@/lib/kontur/client-types'

function shortName(full: string): string {
  const [fam, im, ot] = full.split(' ')
  return ot ? `${fam} ${im?.[0] ?? ''}.${ot[0]}.` : im ? `${fam} ${im[0]}.` : fam
}

export function PlanDealDialog({ deal, state, nowTick, onOpenChange, onDone }: {
  deal: AtiDealDto | null
  state: StateResponse
  nowTick: number
  onOpenChange: (open: boolean) => void
  /** после успешного назначения: обновить состояние раздела */
  onDone: (tripId: string) => void
}) {
  const { toast } = useToast()
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const open = !!deal
  useEffect(() => {
    if (!deal) setBusyKey(null)
  }, [deal])

  const candidates = useMemo<DealCandidate[]>(
    () => (deal ? dealCandidates(deal, state, nowTick) : []),
    [deal, state, nowTick],
  )
  const comps = candidates.filter((c) => c.kind === 'composition')
  const trips = candidates.filter((c) => c.kind === 'trip')

  async function plan(c: DealCandidate) {
    if (!deal) return
    setBusyKey(`${c.kind}-${c.driverId}`)
    try {
      const res = await authFetch('/api/atisu/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'plan',
          dealId: deal.id,
          mode: c.kind === 'composition' ? 'new' : 'append',
          driverId: c.driverId,
          vehicleId: c.vehicleId,
          tripId: c.tripId ?? undefined,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
      toast({ title: 'Груз в плане', description: json?.message })
      onOpenChange(false)
      onDone(json?.tripId ?? '')
    } catch (e) {
      toast({
        title: 'Не удалось взять груз в план',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setBusyKey(null)
    }
  }

  if (!deal) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base font-bold">
            <CalendarClock className="h-4 w-4 text-violet-600" aria-hidden />
            Взять груз в план
            <span className="flex items-center gap-1 font-bold text-slate-900">
              {deal.from}
              <ArrowRight className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              {deal.to}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Условия груза */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-800">{deal.cargo}</span>
          {deal.weightT != null && <span>{deal.weightT} т</span>}
          {deal.km != null && <span>~{deal.km} км</span>}
          {deal.rate != null && <span className="font-semibold text-slate-800">{deal.rate.toLocaleString('ru-RU')} ₽</span>}
          <span>погрузка {deal.loadDateFrom ?? '—'}{deal.loadDateTo ? `–${deal.loadDateTo}` : ''}</span>
          <span className="text-slate-400">· заявка в силе (документы обменяны)</span>
        </div>

        {/* Кандидаты */}
        {comps.length === 0 && trips.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
            Подходящего состава нет: свободных водителей и техники под вес груза не осталось,
            а рейсы в работе не успевают к окну погрузки.
          </div>
        ) : (
          <div className="space-y-4">
            {comps.length > 0 && (
              <section aria-label="Свободный состав">
                <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <Truck className="h-3.5 w-3.5" aria-hidden />
                  Свободный состав · новый рейс
                </div>
                <div className="space-y-1.5">
                  {comps.map((c) => (
                    <CandRow key={`c-${c.driverId}`} c={c} nowTick={nowTick} busyKey={busyKey} onPlan={() => void plan(c)} />
                  ))}
                </div>
              </section>
            )}
            {trips.length > 0 && (
              <section aria-label="Рейсы в работе">
                <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <Route className="h-3.5 w-3.5" aria-hidden />
                  Рейсы в работе · груз плечом (обратка)
                </div>
                <div className="space-y-1.5">
                  {trips.map((c) => (
                    <CandRow key={`t-${c.tripId}`} c={c} nowTick={nowTick} busyKey={busyKey} onPlan={() => void plan(c)} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-slate-400">
          Назначенный груз сразу виден во всех разделах одной картиной: карточка рейса в «Заявках»,
          строка «Назначены» на доске «Занятость» и график работ в «Планировании» (погрузка,
          ход, выгрузка и возврат на базу АЭМЗ). Момент «освободится» считается общей формулой
          с умным подбором — разделы не расходятся.
        </p>
      </DialogContent>
    </Dialog>
  )
}

function CandRow({ c, nowTick, busyKey, onPlan }: {
  c: DealCandidate
  nowTick: number
  busyKey: string | null
  onPlan: () => void
}) {
  const busy = busyKey === `${c.kind}-${c.driverId}`
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2 transition-colors hover:border-slate-300">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">{c.driverName}</span>
            {c.phone && <CallButton phone={c.phone} name={c.driverName} driverId={c.driverId} withLabel={false} className="h-6 w-6 p-0" />}
          </div>
          <div className="truncate text-xs text-slate-500">
            {c.vehicleLabel}
            {c.trailerPlate ? ` + ${c.trailerPlate}` : ''}
          </div>
        </div>
        <div className="min-w-0 flex-1 basis-56 text-xs text-slate-600">
          {c.kind === 'trip' ? (
            <>
              <div className="truncate">
                <CalendarClock className="mr-1 inline h-3 w-3 text-emerald-600" aria-hidden />
                освободится {fmtWhen(c.freesAt, nowTick)}
              </div>
              <div className="truncate text-[11px] text-slate-400">
                {c.freesPoint ?? '—'} → погрузка груза{c.deadheadKm != null ? ` · ${c.deadheadKm} км порожняка` : ''}
              </div>
            </>
          ) : (
            <div className="truncate text-[11px] text-slate-500">
              {c.deadheadKm != null ? `с базы АЭМЗ · ${c.deadheadKm} км до погрузки` : 'выезд с базы АЭМЗ'}
            </div>
          )}
        </div>
        <Button
          size="sm"
          className="h-8 shrink-0 bg-[#0E1B2C] text-white hover:bg-[#16304f]"
          disabled={!!busyKey}
          onClick={onPlan}
          title={c.kind === 'composition' ? 'Создать рейс под груз: статус «назначен», выезд по плану' : 'Добавить груз следующим плечом к текущему рейсу'}
        >
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />}
          {c.kind === 'composition' ? 'Назначить' : 'Плечом к рейсу'}
        </Button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {c.reasons.map((r, i) => (
          <Pill key={i} className={r.kind === 'plus' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>
            {r.text}
          </Pill>
        ))}
      </div>
    </div>
  )
}
