'use client'

/** Общие строительные блоки разделов платформы */
import { useState, type ComponentType, type ReactNode } from 'react'
import {
  AlertTriangle, Clock, FileWarning, Info, RefreshCw, ServerCrash, WifiOff,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AGENT_STATUS_LABEL, DOC_STATUS_META, MODE_META, REQUEST_STATUS_META } from '@/lib/status'
import { expiryInfo } from '@/lib/expiry'
import type { DocStatus, RequestMode, RequestStatus } from '@/lib/types'

export type TabKey = 'board' | 'drafts' | 'apply' | 'my' | 'crew' | 'verify' | 'registry' | 'requests' | 'directory' | 'reports' | 'journal' | 'edo'

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

/**
 * Пояснение по наведению: на экране только значок «i», текст — во всплывающей
 * подсказке. Постоянных информационных надписей в интерфейсе нет.
 */
export function InfoTip({ children, label = 'Подробнее', className = '' }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* вне порядка табуляции: окна ставят фокус в первое поле, а не на значок,
            и подсказка не всплывает сама при открытии окна */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={label}
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full align-middle text-slate-400 transition-colors hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${className}`}
        >
          <Info className="h-4 w-4" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-sm text-left text-xs font-normal normal-case leading-snug tracking-normal">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

/** Подсказка по наведению на любой элемент (кнопку, бейдж) — вместо поясняющей надписи рядом */
export function WithTip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-left text-xs font-normal leading-snug">{tip}</TooltipContent>
    </Tooltip>
  )
}

export function SectionHeader({ eyebrow, title, desc, children }: { eyebrow?: string; title: string; desc?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <div className="text-xs font-semibold uppercase tracking-widest text-blue-700">{eyebrow}</div>}
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
          {title}
          {/* описание раздела — только по наведению на «i» */}
          {desc && <InfoTip label={`О разделе «${title}»`}>{desc}</InfoTip>}
        </h2>
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
        <div className="mt-0.5 flex items-center gap-1 text-sm font-medium text-slate-700">
          {label}
          {hint && <InfoTip label={label}>{hint}</InfoTip>}
        </div>
      </CardContent>
    </Card>
  )
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-400">{icon}</div>}
      <div className="flex items-center gap-1.5 font-medium text-slate-700">
        {title}
        {hint && <InfoTip label="Подсказка">{hint}</InfoTip>}
      </div>
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

/* ── Экран ошибки загрузки данных (Task 70) ─────────────────────────────────
 * Единый красивый экран для всех разделов: тип ошибки (сеть/сервер/общая)
 * подбирается по тексту — у каждого свой значок, понятный заголовок и
 * подсказка «что делать». Технический текст остаётся в компактном чипе
 * (пригодится при разборе), действие — заметная кнопка «Повторить».
 */
type ErrorKind = 'network' | 'server' | 'generic'

const ERROR_META: Record<ErrorKind, { Icon: ComponentType<{ className?: string }>; title: string; hint: string }> = {
  network: {
    Icon: WifiOff,
    title: 'Нет связи с сервером',
    hint: 'Проверьте интернет-соединение. Когда связь восстановится, нажмите «Повторить» — данные загрузятся заново.',
  },
  server: {
    Icon: ServerCrash,
    title: 'Сервер временно недоступен',
    hint: 'На стороне платформы произошла неполадка. Обычно она быстро устраняется — попробуйте повторить запрос через минуту.',
  },
  generic: {
    Icon: FileWarning,
    title: 'Не удалось загрузить данные',
    hint: 'Возникла непредвиденная ошибка. Повторите попытку — если ошибка повторится, сообщите администратору платформы.',
  },
}

function errorKindOf(message: string): ErrorKind {
  if (/failed to fetch|fetch failed|load failed|network ?error|socket|соединен/i.test(message)) return 'network'
  if (/\(5\d\d\)|internal server|сервис недоступен/i.test(message)) return 'server'
  return 'generic'
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { Icon, title, hint } = ERROR_META[errorKindOf(message)]
  // краткая «пульсация» кнопки после клика: пользователь видит, что запрос пошёл
  const [retrying, setRetrying] = useState(false)

  return (
    <div
      role="alert"
      className="relative overflow-hidden rounded-2xl border border-red-100 bg-white px-6 py-10 text-center shadow-sm"
    >
      {/* мягкое красное свечение сверху — глубина без «тревожной» заливки всей плашки */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-20 mx-auto h-40 w-72 rounded-full bg-red-100/70 blur-3xl" />

      <div className="relative mx-auto flex max-w-md flex-col items-center">
        <div className="relative mb-4">
          {/* дышащее кольцо вокруг значка — экран «живой», но не кричит */}
          <span aria-hidden className="absolute inset-0 animate-pulse rounded-2xl bg-red-100" />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-red-200 bg-gradient-to-b from-white to-red-50 shadow-sm">
            <Icon className="h-7 w-7 text-red-500" aria-hidden />
          </div>
        </div>

        <div className="text-base font-semibold text-slate-900">{title}</div>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">{hint}</p>

        {/* техническая подробность — приглушённым чипом, пригодится в обращении к поддержке */}
        {message && (
          <div className="mt-3 flex max-w-full items-start gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs leading-relaxed text-slate-600">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
            <span className="break-words">{message}</span>
          </div>
        )}

        {onRetry && (
          <button
            type="button"
            onClick={() => {
              if (retrying) return
              setRetrying(true)
              onRetry()
              window.setTimeout(() => setRetrying(false), 1200)
            }}
            className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-red-700 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 active:scale-[0.98]"
          >
            <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden />
            Повторить
          </button>
        )}
      </div>
    </div>
  )
}
