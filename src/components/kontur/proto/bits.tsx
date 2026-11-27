'use client'

/**
 * Словарь статусов диспетчерского контура. Базовые кирпичи — точка-и-слово
 * (DotWord), пилюля (Pill) и подсказка «i» (InfoTip) — живут в общем слое
 * платформы (platform/common): один источник правды для обоих контуров.
 */
import { STATUS_LABELS, OUTCOME_LABELS } from '@/lib/kontur/constants'
import type { StatusEventDto } from '@/lib/kontur/client-types'
import { fmtDateTime } from '@/lib/kontur/client-types'
import { InfoTip, Pill, StatusDot } from '@/components/platform/common'

// Единый вид статусов платформы: DotWord = StatusDot общего слоя
export { InfoTip, Pill }
export { StatusDot as DotWord }

// Лестница статусов плеча (B5.1): точка и слово
const STATUS_META: Record<string, { dot: string; tone?: 'warning' | 'danger' }> = {
  assigned: { dot: 'bg-slate-400' },
  en_route_to_loading: { dot: 'bg-sky-500' },
  at_loading: { dot: 'bg-blue-500' },
  loaded: { dot: 'bg-blue-600' },
  en_route: { dot: 'bg-violet-500' },
  at_unloading: { dot: 'bg-cyan-500' },
  unloaded: { dot: 'bg-emerald-500' },
  completed: { dot: 'bg-emerald-600' },
  cancelled: { dot: 'bg-red-500', tone: 'danger' },
}

export function StatusChip({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { dot: 'bg-slate-400' }
  return (
    <StatusDot dot={meta.dot} tone={meta.tone}>
      {STATUS_LABELS[status] || status}
    </StatusDot>
  )
}

// Состояние outbox-события (B7.1)
const STATE_META: Record<string, { dot: string; label: string; tone?: 'warning' | 'danger' }> = {
  pending: { dot: 'bg-slate-400', label: 'в очереди' },
  stale: { dot: 'bg-amber-500', label: 'stale', tone: 'warning' },
  failed_delivery: { dot: 'bg-red-500', label: 'failed', tone: 'danger' },
  acked: { dot: 'bg-emerald-500', label: 'подтверждено' },
}

export function StateBadge({ state }: { state: string }) {
  const meta = STATE_META[state] ?? { dot: 'bg-slate-400', label: state }
  return (
    <StatusDot dot={meta.dot} tone={meta.tone}>
      {meta.label}
    </StatusDot>
  )
}

// Все метки события (B7.2.10: метки видны обеим сторонам) — пилюлями
export function EventFlags({ ev }: { ev: StatusEventDto }) {
  return (
    <span className="flex flex-wrap gap-1">
      {ev.type === 'correction' && <Pill className="bg-violet-100 text-violet-700">корректировка</Pill>}
      {ev.superseded && <Pill className="bg-slate-100 text-slate-600">Заменено корректировкой логиста</Pill>}
      {ev.needsReview && <Pill className="bg-amber-100 text-amber-700">требует разбора</Pill>}
      {ev.appliedByReview && <Pill className="bg-emerald-100 text-emerald-700">применено при разборе</Pill>}
      {ev.skippedConflict && <Pill className="bg-slate-100 text-slate-600">пропущено (конфликт)</Pill>}
      {ev.legacy && <Pill className="bg-orange-100 text-orange-700">legacy</Pill>}
      {ev.lateArrival && <Pill className="bg-fuchsia-100 text-fuchsia-700">поздние данные</Pill>}
      {ev.clockSkew && <Pill className="bg-rose-100 text-rose-700">clock_skew</Pill>}
      {ev.receivedOffline && <Pill className="bg-slate-100 text-slate-600">из офлайн-очереди</Pill>}
      {ev.reviewState === 'rejected' && <Pill className="bg-red-100 text-red-700">отклонено при разборе</Pill>}
      {ev.result === 'rejected' && ev.rejectReason && <Pill className="bg-red-100 text-red-700">Отклонено: {ev.rejectReason}</Pill>}
    </span>
  )
}

const OUTCOME_PILL: Record<string, string> = {
  applied: 'bg-emerald-100 text-emerald-700',
  superseded: 'bg-slate-200 text-slate-700',
  needs_review: 'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-700',
  skipped_conflict: 'bg-slate-100 text-slate-600',
  duplicate: 'bg-slate-100 text-slate-600',
}

export function OutcomeChip({ result, reason }: { result?: string | null; reason?: string | null }) {
  if (!result) return null
  return (
    <Pill className={`font-semibold ${OUTCOME_PILL[result] ?? 'bg-slate-100 text-slate-600'}`} title={reason ?? undefined}>
      {OUTCOME_LABELS[result] || result}
    </Pill>
  )
}

export function ActorLabel({ ev, drivers }: { ev: StatusEventDto; drivers?: { id: string; fullName: string }[] }) {
  const role: Record<string, string> = { driver: 'водитель', logist: 'логист', system: 'система' }
  const name = ev.actorId && drivers ? drivers.find((d) => d.id === ev.actorId)?.fullName : null
  return <span className="text-xs text-slate-500">{name ? `${role[ev.actorRole]} · ${name}` : role[ev.actorRole]}</span>
}

export function TimelineItem({ ev, drivers }: { ev: StatusEventDto; drivers?: { id: string; fullName: string }[] }) {
  const files = ev.requiredFiles ? (JSON.parse(ev.requiredFiles) as { clientId: string; kind: string }[]) : []
  return (
    <div className="relative flex gap-3 border-l-2 border-slate-200 pb-4 pl-4">
      <div className={`absolute -left-[7px] top-1 h-3 w-3 rounded-full border-2 ${ev.result === 'rejected' ? 'border-red-200 bg-red-500' : ev.superseded ? 'border-slate-200 bg-slate-400' : ev.needsReview ? 'border-amber-200 bg-amber-500' : ev.type === 'correction' ? 'border-violet-200 bg-violet-500' : 'border-emerald-200 bg-emerald-500'}`} />
      <div className="flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={ev.status} />
          <OutcomeChip result={ev.result} reason={ev.rejectReason} />
          <ActorLabel ev={ev} drivers={drivers} />
          <span className="text-xs text-slate-400">{fmtDateTime(ev.serverTs)}</span>
          {ev.seqNo != null && <span className="text-[11px] text-slate-400">seq {ev.seqNo}</span>}
          {ev.deviceId && <span className="text-[11px] text-slate-400">{ev.deviceId}</span>}
        </div>
        <EventFlags ev={ev} />
        {ev.comment && <div className="text-xs text-slate-600">«{ev.comment}»</div>}
        {files.length > 0 && (
          <div className="text-[11px] text-slate-500">
            Артефакты: {files.map((f) => `${f.kind}:${f.clientId.slice(0, 10)}…`).join(', ')}
          </div>
        )}
        {ev.parentCorrectionId && (
          <div className="text-[11px] text-violet-600">отмена корректировки {ev.parentCorrectionId.slice(0, 8)}</div>
        )}
      </div>
    </div>
  )
}
