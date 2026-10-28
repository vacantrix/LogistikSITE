'use client'

/**
 * Общие элементы раздела «Профили и доступы»: контуры, метки риска, чипы должности
 * и исключений, расчёт итогового права на клиенте (для предпросмотра до сохранения —
 * то же правило, что на сервере в src/lib/permissions.ts) и список изменений «было → стало».
 */
import type { RoleKind } from '@/components/platform/common'
import { RISK_LABELS, permLabel, permRisk, type PermKey } from '@/lib/perm-catalog'
import type { AccessExceptionDTO } from '@/lib/types'

export const CONTOUR_META: Record<RoleKind, { label: string; short: string; dot: string }> = {
  logist: { label: 'Логист АЭМЗ', short: 'Логисты', dot: 'bg-blue-500' },
  carrier: { label: 'Перевозчик', short: 'Перевозчики', dot: 'bg-emerald-500' },
  admin: { label: 'Администрация', short: 'Администрация', dot: 'bg-violet-500' },
}

export const CONTOUR_ORDER: RoleKind[] = ['logist', 'carrier', 'admin']

const pad = (n: number) => String(n).padStart(2, '0')
/** Сегодня в формате ГГГГ-ММ-ДД (местное время) */
export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const ruDate = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '')
export const ruShort = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '')

export type ExceptionDraft = Pick<AccessExceptionDTO, 'key' | 'effect' | 'reason' | 'expiresAt'>

/** Действует ли исключение (срок «до» включает весь последний день) */
export const exActive = (e: { expiresAt: string | null }, today = todayIso()) => !e.expiresAt || e.expiresAt >= today

/** Итоговое право: действующее исключение важнее должности */
export function effectiveOf(
  tplPerms: ReadonlySet<string>, exceptions: ExceptionDraft[], key: string, today = todayIso(),
): { on: boolean; source: 'template' | 'exception'; ex?: ExceptionDraft } {
  const ex = exceptions.find((e) => e.key === key && exActive(e, today))
  if (ex) return { on: ex.effect === 'allow', source: 'exception', ex }
  return { on: tplPerms.has(key), source: 'template' }
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export function RiskBadge({ perm }: { perm: string }) {
  const risk = permRisk(perm as PermKey)
  if (risk === 'normal') return null
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-px text-[11px] font-semibold ${
        risk === 'critical'
          ? 'border border-red-200 bg-red-50 text-red-700'
          : 'border border-amber-200 bg-amber-50 text-amber-800'
      }`}
    >
      {RISK_LABELS[risk]}
    </span>
  )
}

export function TemplateChip({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-full items-center truncate rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-800">
      {name}
    </span>
  )
}

export function ExceptionChip({ ex, contour }: { ex: ExceptionDraft; contour: RoleKind }) {
  const allow = ex.effect === 'allow'
  return (
    <span
      title={ex.reason}
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        allow ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'
      }`}
    >
      {allow ? '+' : '−'} {permLabel(ex.key as PermKey, contour)}
      {ex.expiresAt && <span className="font-normal">· до {ruShort(ex.expiresAt)}</span>}
    </span>
  )
}

export interface DiffLine {
  sign: '+' | '−' | '•'
  text: string
}

/** Список изменений для окна подтверждения */
export function DiffList({ lines }: { lines: DiffLine[] }) {
  return (
    <ul className="grid gap-1.5">
      {lines.map((l, i) => (
        <li key={i} className="grid grid-cols-[16px_1fr] gap-2 text-sm">
          <span
            className={`font-mono font-bold ${l.sign === '+' ? 'text-emerald-700' : l.sign === '−' ? 'text-red-600' : 'text-slate-400'}`}
            aria-hidden
          >
            {l.sign}
          </span>
          <span className="text-slate-800">
            <span className="sr-only">{l.sign === '+' ? 'Появится: ' : l.sign === '−' ? 'Уберётся: ' : ''}</span>
            {l.text}
          </span>
        </li>
      ))}
    </ul>
  )
}
