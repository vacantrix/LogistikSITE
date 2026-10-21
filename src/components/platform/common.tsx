'use client'

/** Общие строительные блоки разделов платформы */
import type { ReactNode } from 'react'
import { AlertTriangle, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { AGENT_STATUS_LABEL, DOC_STATUS_META, MODE_META, REQUEST_STATUS_META } from '@/lib/status'
import { expiryInfo } from '@/lib/expiry'
import type { DocStatus, RequestMode, RequestStatus } from '@/lib/types'

export type TabKey = 'board' | 'apply' | 'my' | 'crew' | 'verify' | 'registry' | 'directory' | 'reports'

/** Роль пользователя: сотрудник АЭМЗ (логист) или перевозчик */
export type RoleKind = 'logist' | 'carrier'

export interface TabProps {
  /** какой перевозчик выбран в шапке (действия агента); для логиста — null */
  activeCarrierId: string | null
  /** вид платформы: внутренний контур АЭМЗ или кабинет перевозчика */
  role: RoleKind
  /** переход на другой раздел (например «Перейти к торгам») */
  onNavigate: (tab: TabKey) => void
  /** счётчик real-time обновлений (Task 49): растёт при каждом изменении на сервере —
   *  разделы догружают данные без кнопки «Обновить» и без ожидания автообновления */
  liveTick: number
}

/** Раздел, доступный только определённой роли (защитная заглушка) */
export function RoleNotice({ role }: { role: RoleKind }) {
  return (
    <EmptyState
      title={role === 'logist' ? 'Раздел доступен только перевозчикам' : 'Раздел внутреннего контура АЭМЗ'}
      hint={role === 'logist'
        ? 'Переключите роль в шапке на перевозчика, чтобы работать с площадкой от его имени'
        : 'Этот раздел доступен сотрудникам отдела логистики. Переключите роль в шапке, чтобы вернуться в кабинет перевозчика.'}
    />
  )
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  const meta = REQUEST_STATUS_META[status] ?? { label: status, badge: 'bg-slate-100 text-slate-700 border-slate-200' }
  return <Badge variant="outline" className={`${meta.badge} whitespace-nowrap`}>{meta.label}</Badge>
}

/** Статус заявки глазами агента-перевозчика: что происходит с его рейсом прямо сейчас */
export function AgentStatusBadge({ status }: { status: string }) {
  const label = AGENT_STATUS_LABEL[status] ?? REQUEST_STATUS_META[status as RequestStatus]?.label ?? status
  return <Badge variant="outline" className="whitespace-nowrap border-slate-300 bg-slate-100 text-slate-700">{label}</Badge>
}

/** Режим приёма ставок без пузыря (Task 49): только иконка с цветом режима и
 *  подсказкой при наведении — ↘ торги на понижение, ⊘ закрытые ставки. */
export function ModeBadge({ mode }: { mode: RequestMode }) {
  const meta = MODE_META[mode]
  const Icon = meta.Icon
  return (
    <span
      className="inline-flex h-8 w-8 items-center justify-center rounded-md"
      title={`${meta.label} — ${meta.sub}`}
      aria-label={`${meta.label}: ${meta.sub}`}
    >
      <Icon className={`h-5 w-5 ${meta.iconCls}`} aria-hidden />
    </span>
  )
}

export function DocStatusBadge({ status }: { status: DocStatus }) {
  const meta = DOC_STATUS_META[status]
  return <Badge variant="outline" className={`${meta.badge} whitespace-nowrap`}>{meta.label}</Badge>
}

/** Бейдж срока действия документа: красный «истёк», янтарный «истекает», нейтральный «скоро», обычная дата */
export function ExpiryBadge({ date, className = '' }: { date?: string | null; className?: string }) {
  const info = expiryInfo(date)
  if (info.state === 'none') return <span className={`text-sm text-slate-400 ${className}`}>—</span>
  if (info.state === 'ok') return <span className={`whitespace-nowrap text-sm text-slate-600 ${className}`}>{info.date}</span>
  if (info.state === 'soon') return <Badge variant="outline" className={`whitespace-nowrap ${info.badgeCls} ${className}`}>{info.label}</Badge>
  return (
    <Badge variant="outline" className={`whitespace-nowrap gap-1 ${info.badgeCls} ${className}`}>
      {info.state === 'expired' ? <AlertTriangle className="h-3 w-3" aria-hidden /> : <Clock className="h-3 w-3" aria-hidden />}
      {info.label}
    </Badge>
  )
}

export function SectionHeader({ eyebrow, title, desc, children }: { eyebrow?: string; title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <div className="text-xs font-semibold uppercase tracking-widest text-blue-700">{eyebrow}</div>}
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h2>
        {desc && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </div>
  )
}

export function KpiCard({ icon, label, value, hint, tone = 'blue' }: { icon: ReactNode; label: string; value: ReactNode; hint?: string; tone?: 'blue' | 'green' | 'amber' | 'navy' | 'violet' }) {
  const tones: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    navy: 'bg-slate-900 text-blue-300',
    violet: 'bg-violet-50 text-violet-700',
  }
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="p-4">
        <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full ${tones[tone]}`} aria-hidden>
          {icon}
        </div>
        <div className="text-2xl font-bold leading-tight text-slate-900">{value}</div>
        <div className="mt-0.5 text-sm font-medium text-slate-700">{label}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  )
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-400">{icon}</div>}
      <div className="font-medium text-slate-700">{title}</div>
      {hint && <div className="mt-1 text-sm text-muted-foreground">{hint}</div>}
    </div>
  )
}

export function LoadingBlock({ label = 'Загрузка данных…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-10 text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" aria-hidden />
      {label}
    </div>
  )
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center">
      <div className="font-medium text-red-800">Не удалось загрузить данные</div>
      <div className="mt-1 text-sm text-red-600">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100">
          Повторить
        </button>
      )}
    </div>
  )
}
