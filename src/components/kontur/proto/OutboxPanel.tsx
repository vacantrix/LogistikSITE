'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/kontur/ui/card'
import { Button } from '@/components/kontur/ui/button'
import { useToast } from '@/hooks/use-toast'
import type { StateResponse, OutboxItem } from '@/lib/kontur/client-types'
import { fmtDateTime } from '@/lib/kontur/client-types'
import { CONSTANTS } from '@/lib/kontur/constants'
import { StateBadge } from './bits'
import { ArrowDownToLine, CheckCheck, Hourglass, RotateCcw } from 'lucide-react'
import { apiFetch as fetch } from '@/lib/kontur/base-path'

type FetchedEvent = {
  cursor_id: number
  event_type: string
  payload: Record<string, unknown>
  created_at: string
  state: string
  attempts: number
}

// B7.1: симулятор 1С (pull-модель) + админ-вкладка Failed outbox (ARC-005)
export function OutboxPanel({ state, onChanged }: { state: StateResponse; onChanged: () => void }) {
  const { toast } = useToast()
  const [cursor, setCursor] = useState(0)
  const [fetched, setFetched] = useState<FetchedEvent[]>([])
  const [simLog, setSimLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  function log(line: string) {
    setSimLog((prev) => [`${new Date().toLocaleTimeString('ru-RU')} — ${line}`, ...prev].slice(0, 12))
  }

  async function fetchEvents() {
    setBusy(true)
    const res = await fetch(`/api/1c/events?since=${cursor}&limit=500`)
    setBusy(false)
    const data = await res.json()
    const events: FetchedEvent[] = data.events || []
    setFetched(events)
    setCursor(data.next_cursor_raw ?? cursor)
    log(`GET /1c/events?since=${cursor} → получено ${events.length}, курсор ${data.next_cursor_raw}`)
    if (events.length === 0) log('Новых событий нет (выдача пуста)')
    onChanged()
  }

  async function ackAll() {
    if (fetched.length === 0) {
      toast({ title: 'Сначала заберите события' })
      return
    }
    setBusy(true)
    const res = await fetch('/api/1c/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cursor_ids: fetched.map((e) => e.cursor_id) }),
    })
    setBusy(false)
    const data = await res.json()
    log(`POST /1c/events/ack → подтверждено ${data.acked}`)
    toast({ title: `1С подтвердил ${data.acked} событий` })
    setFetched([])
    onChanged()
  }

  async function age(hours: number) {
    const pendingIds = state.outbox.filter((o) => o.state === 'pending').map((o) => o.id)
    if (pendingIds.length === 0) {
      toast({ title: 'Нет событий в pending' })
      return
    }
    setBusy(true)
    await fetch('/api/outbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'age', hours, ids: pendingIds }),
    })
    setBusy(false)
    log(`Демо-состаривание: first_seen сдвинут на ${hours} ч назад (${pendingIds.length} шт.)`)
    onChanged()
  }

  async function returnFailed(id: number) {
    setBusy(true)
    const res = await fetch('/api/outbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'return', id }),
    })
    setBusy(false)
    const data = await res.json()
    if (data.returned) {
      toast({ title: 'Событие возвращено в очередь (pending)' })
      onChanged()
    }
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Симулятор 1С — pull-модель (B7.1.2)</CardTitle>
          <div className="text-xs text-slate-500">
            1С раз в 5 минут: POST orders → GET events (курсор) → POST ack. Сервер ничего не пушит.
            Попытки считаются по факту выдачи. Stale &gt; {CONSTANTS.OUTBOX_STALE_HOURS} ч без ack,
            failed &gt; {CONSTANTS.OUTBOX_FAILED_HOURS} ч — исключается из выдачи, но не удаляется.
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={fetchEvents} disabled={busy}>
              <ArrowDownToLine className="h-4 w-4 mr-1" />Забрать события (GET)
            </Button>
            <Button size="sm" variant="outline" onClick={ackAll} disabled={busy || fetched.length === 0}>
              <CheckCheck className="h-4 w-4 mr-1" />Подтвердить все (ack)
            </Button>
            <Button size="sm" variant="outline" onClick={() => age(25)} disabled={busy}>
              <Hourglass className="h-4 w-4 mr-1" />Демо: состарить на 25 ч
            </Button>
            <Button size="sm" variant="outline" onClick={() => age(73)} disabled={busy}>
              <Hourglass className="h-4 w-4 mr-1" />Демо: состарить на 73 ч
            </Button>
            <span className="self-center text-xs text-slate-500">курсор 1С: {cursor}</span>
          </div>

          {fetched.length > 0 && (
            <div className="rounded-md border border-slate-200 p-2 space-y-1 max-h-56 overflow-y-auto">
              {fetched.map((e) => (
                <div key={e.cursor_id} className="text-xs font-mono text-slate-700">
                  #{e.cursor_id} {e.event_type} · {JSON.stringify(e.payload).slice(0, 90)}
                </div>
              ))}
            </div>
          )}
          {simLog.length > 0 && (
            <div className="rounded-md bg-slate-50 border border-slate-200 p-2 space-y-0.5">
              {simLog.map((l, i) => (
                <div key={i} className="text-[11px] text-slate-500 font-mono">{l}</div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Outbox → 1С ({state.outbox.length})</CardTitle>
          <div className="flex gap-3 text-xs">
            <span>в очереди: <b>{state.outboxStats.pending}</b></span>
            <span>stale: <b className="text-amber-700">{state.outboxStats.stale}</b></span>
            <span>failed: <b className="text-red-700">{state.outboxStats.failed}</b></span>
            <span>подтверждено: <b className="text-emerald-700">{state.outboxStats.acked}</b></span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="pb-2 pr-2">#</th>
                  <th className="pb-2 pr-2">Тип</th>
                  <th className="pb-2 pr-2">Payload</th>
                  <th className="pb-2 pr-2">Первое появление</th>
                  <th className="pb-2 pr-2">Выдач</th>
                  <th className="pb-2 pr-2">Состояние</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {[...state.outbox].reverse().map((o: OutboxItem) => (
                  <tr key={o.id} className="border-b border-slate-100">
                    <td className="py-1.5 pr-2 font-mono text-xs">{o.id}</td>
                    <td className="py-1.5 pr-2 font-mono text-xs">{o.eventType}</td>
                    <td className="py-1.5 pr-2 font-mono text-[11px] text-slate-500 max-w-60 truncate">{o.payload}</td>
                    <td className="py-1.5 pr-2 text-xs">{fmtDateTime(o.firstSeenAt)}</td>
                    <td className="py-1.5 pr-2">{o.attempts}</td>
                    <td className="py-1.5 pr-2"><StateBadge state={o.state} /></td>
                    <td className="py-1.5">
                      {o.state === 'failed_delivery' && (
                        <Button size="sm" variant="ghost" onClick={() => returnFailed(o.id)}>
                          <RotateCcw className="h-3 w-3 mr-1" />Вернуть в очередь
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            Ничего не удаляется автоматически: acked хранится {CONSTANTS.OUTBOX_ACKED_RETENTION_DAYS} дней,
            stale/failed — бессрочно до ручного решения (ARC-005).
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
