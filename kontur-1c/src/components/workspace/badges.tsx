'use client'

import { cn } from '@/lib/utils'

// Точка статуса в стиле 1С (цветной маркер вместо «бейджа»)
const STATUS_DOT: Record<string, string> = {
  NEW: '#8a8a8a',
  DISPATCH: '#e8a000',
  ASSIGNED: '#2f6db0',
  ACCEPTED: '#00a0b0',
  PRETRIP: '#7a4fb0',
  IN_PROGRESS: '#1c5a3a',
  DONE: '#2f8a2f',
  CANCELLED: '#c43e1c',
}

const SHORT_LABELS: Record<string, string> = {
  ASSIGNED: 'назначен',
  IN_PROGRESS: 'в пути',
}

export function StatusDot({ status, withLabel }: { status: string; withLabel?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: STATUS_DOT[status] ?? '#8a8a8a' }} />
      {withLabel && <span>{SHORT_LABELS[status] ?? status}</span>}
    </span>
  )
}

// Совместимость со старыми экранами (не используется в формах «Такси», но оставлено)
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12px]', className)}>
      <StatusDot status={status} withLabel />
    </span>
  )
}

export function LevelBadge({ level }: { level: string }) {
  const dot = level === 'error' ? '#c43e1c' : level === 'warning' ? '#e8a000' : '#8a8a8a'
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]">
      <span className="inline-block h-[8px] w-[8px] rounded-full" style={{ background: dot }} />
      {level}
    </span>
  )
}

export function ReadyBadge({ readiness }: { readiness: string }) {
  const dot = readiness === 'ready' ? '#2f8a2f' : readiness === 'repair' ? '#c43e1c' : '#e8a000'
  const text = readiness === 'ready' ? 'готов' : readiness === 'repair' ? 'ремонт' : 'обслуживание'
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]">
      <span className="inline-block h-[8px] w-[8px] rounded-full" style={{ background: dot }} />
      {text}
    </span>
  )
}
