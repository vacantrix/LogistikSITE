'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/kontur/ui/card'
import { Button } from '@/components/kontur/ui/button'
import { Checkbox } from '@/components/kontur/ui/checkbox'
import { Label } from '@/components/kontur/ui/label'
import { useToast } from '@/hooks/use-toast'
import type { StateResponse } from '@/lib/kontur/client-types'
import { STATUS_LABELS } from '@/lib/kontur/constants'
import { StatusChip, EventFlags } from './bits'
import { fmtDateTime } from '@/lib/kontur/client-types'
import { ClipboardCheck, ListChecks } from 'lucide-react'
import { apiFetch as fetch } from '@/lib/kontur/base-path'

// B5.8.4: пакетный разбор needs_review — чекбоксы + «Применить все» / «Отклонить все»
export function NeedsReviewPanel({ state, onChanged }: { state: StateResponse; onChanged: () => void }) {
  const { toast } = useToast()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  // Порядок применения: (device_id, seq_no), затем server_ts — B5.8.4
  const events = useMemo(() => {
    return [...state.needsReview].sort((a, b) => {
      if ((a.deviceId || '') !== (b.deviceId || '')) return (a.deviceId || '') < (b.deviceId || '') ? -1 : 1
      const sa = a.seqNo ?? Number.MAX_SAFE_INTEGER
      const sb = b.seqNo ?? Number.MAX_SAFE_INTEGER
      if (sa !== sb) return sa - sb
      return a.serverTs.localeCompare(b.serverTs)
    })
  }, [state.needsReview])

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function run(mode: 'apply' | 'reject', ids: string[]) {
    if (ids.length === 0) {
      toast({ title: 'Нечего разбирать', description: 'Сначала выберите события или дождитесь, пока они появятся', variant: 'destructive' })
      return
    }
    setBusy(true)
    const res = await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, eventIds: ids }),
    })
    setBusy(false)
    const data = await res.json()
    if (!res.ok) {
      toast({ title: 'Разбор не выполнен', description: data.error?.message, variant: 'destructive' })
      return
    }
    const applied = data.results.filter((r: { outcome: string }) => r.outcome === 'applied').length
    const skipped = data.results.filter((r: { outcome: string }) => r.outcome === 'skipped_conflict').length
    const rejected = data.results.filter((r: { outcome: string }) => r.outcome === 'rejected').length
    toast({
      title: mode === 'apply' ? 'Пакет применён' : 'Пакет отклонён',
      description: `Применено: ${applied}, пропущено (конфликт): ${skipped}, отклонено: ${rejected}. Актёр остаётся водителем, в аудите — логист-аппрувер.`,
    })
    setSelected(new Set())
    onChanged()
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
        <ClipboardCheck className="mb-3 h-10 w-10 text-slate-400" aria-hidden />
        <div className="font-medium text-slate-700">Очередь разбора пуста</div>
        <div className="mt-1 max-w-lg text-sm leading-relaxed text-slate-500">
          Сюда попадают события с needs_review: конфликты с корректировкой,
          clock_skew без systematic_skew, события прежнего водителя после замены состава.
        </div>
      </div>
    )
  }

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-5 w-5 text-amber-600" />
            Разбор needs_review · {events.length}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => run('apply', events.map((e) => e.id))}>
              Применить все
            </Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => run('reject', events.map((e) => e.id))}>
              Отклонить все
            </Button>
            <Button size="sm" variant="outline" disabled={busy || selected.size === 0} onClick={() => run('apply', [...selected])}>
              Применить выбранные ({selected.size})
            </Button>
          </div>
        </div>
        <div className="text-xs text-slate-500">
          Порядок применения: (устройство, seq_no), затем server_ts. Применяется только допустимый переход,
          конфликтующее пропускается с меткой skipped_conflict. Файлы принимаются независимо от разбора.
        </div>
      </CardHeader>
      <CardContent className="space-y-2 max-h-[70vh] overflow-y-auto">
        {events.map((ev, idx) => (
          <div key={ev.id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50">
            <Checkbox checked={selected.has(ev.id)} onCheckedChange={() => toggle(ev.id)} className="mt-1" aria-label={`Выбрать событие ${ev.id}`} />
            <div className="flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-400 font-mono text-xs">#{idx + 1}</span>
                <StatusChip status={ev.status} />
                <span className="text-xs text-slate-500">
                  {ev.leg ? `${ev.leg.loadPoint} → ${ev.leg.unloadPoint} (плечо ${ev.leg.seq})` : 'плечо удалено'}
                </span>
                <span className="text-xs text-slate-400">{fmtDateTime(ev.serverTs)}</span>
                {ev.seqNo != null && <span className="text-[11px] text-slate-400">seq {ev.seqNo}</span>}
                {ev.deviceId && <span className="text-[11px] text-slate-400">{ev.deviceId}</span>}
              </div>
              <EventFlags ev={ev} />
              {ev.comment && <div className="text-xs text-slate-500">«{ev.comment}»</div>}
              {ev.leg && (
                <div className="text-[11px] text-slate-400">
                  Текущий статус плеча: {STATUS_LABELS[ev.leg.status] || ev.leg.status}
                  {' → переход '}
                  {isValidNext(ev.leg.status, ev.status) ? 'допустим (будет применён)' : 'недопустим (будет пропущен с меткой)'}
                </div>
              )}
            </div>
          </div>
        ))}
        <Label className="text-xs text-slate-400">
          Подсказка: чтобы событие попало сюда — скорректируйте статус в карточке рейса и отправьте
          драйверское событие с client_ts раньше корректировки из симулятора водителя.
        </Label>
      </CardContent>
    </Card>
  )
}

function isValidNext(current: string, target: string): boolean {
  const ladder = ['assigned', 'en_route_to_loading', 'at_loading', 'loaded', 'en_route', 'at_unloading', 'unloaded', 'completed']
  const transitions: Record<string, string[]> = {
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
  void ladder
  return (transitions[current] || []).includes(target)
}
