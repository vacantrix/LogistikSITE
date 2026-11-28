'use client'

/** Общие строительные блоки разделов платформы */
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import {
  AlertTriangle,
  CircleAlert,
  CircleCheck,
  FileWarning,
  Info,
  RefreshCw,
  ServerCrash,
  WifiOff,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AGENT_STATUS_LABEL, DOC_STATUS_META, MODE_META, REQUEST_STATUS_META } from '@/lib/status'
import { expiryInfo } from '@/lib/expiry'
import type { DocStatus, RequestMode, RequestStatus } from '@/lib/types'

export type TabKey = 'board' | 'drafts' | 'apply' | 'my' | 'crew' | 'verify' | 'registry' | 'requests' | 'directory' | 'reports' | 'journal' | 'logs' | 'edo' | 'support' | 'contacts' | 'nn' | 'llm' | 'settings' | 'admin-users' | 'admin-db' | 'arch'
  | 'own-requests' | 'own-atisu' | 'own-occupancy' | 'own-planning' | 'own-monitor' | 'own-directory' | 'own-audit' | 'ai'
  | 'favorites'
  | 'driver-app'

/** Роль пользователя: администрация, сотрудник АЭМЗ (логист) или перевозчик/экспедитор */
export type RoleKind = 'admin' | 'logist' | 'carrier'

export interface TabProps {
  /** какой перевозчик выбран в шапке (действия агента); для логиста — null */
  activeCarrierId: string | null
  /** вид платформы: внутренний контур АЭМЗ или кабинет перевозчика */
  role: RoleKind
  /** переход на другой раздел (например «Перейти к торгам»).
   *  opts.filters — раздел открывается с применёнными фильтрами/поиском
   *  (так нейросеть «выполняет работу» по платформе: переходит и настраивает) */
  onNavigate: (tab: TabKey, opts?: { filters?: Record<string, string> }) => void
  /** счётчик real-time обновлений (Task 49): растёт при каждом изменении на сервере —
   *  разделы догружают данные без кнопки «Обновить» и без ожидания автообновления */
  liveTick: number
  /** цель навигации от нейросети: раздел + фильтры (ts растёт при каждом переходе);
   *  разделы с поиском/фильтрами применяют его сами, остальные игнорируют */
  navFilters?: { tab: TabKey; filters: Record<string, string>; ts: number } | null
}

/**
 * Живое окно раздела: постоянное тихое автообновление поверх первичной загрузки
 * (первичный `load` раздел делает сам, при монтировании). Механика та же, что у
 * «привлечённого транспорта»: liveTick — мгновенные события шины WS и общий
 * «пульс» платформы (page.tsx), интервал — страховка, когда шина молчит.
 *
 * Плавность: вызовы идут через ref последнего load — смена фильтров не «дёргает»
 * эффект заново, данные обновляются на месте, без перезагрузки страницы. Пока
 * вкладка браузера скрыта — интервал на паузе: без пустых запросов.
 */
export function useLiveTab(load: () => unknown, liveTick: number, ms = 15_000) {
  // ref на свежий load: интервал и live-события всегда вызывают актуальную версию
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])
  // мгновенная догрузка: событие шины WS или общий «пульс» платформы
  useEffect(() => {
    if (liveTick > 0) void loadRef.current()
  }, [liveTick])
  // страховочный интервал: шина молчит, а окно должно оставаться свежим
  useEffect(() => {
    if (!ms) return
    const t = window.setInterval(() => {
      if (!document.hidden) void loadRef.current()
    }, ms)
    return () => window.clearInterval(t)
  }, [ms])
}

/** Раздел, доступный только определённой роли (защитная заглушка) */
export function RoleNotice({ role }: { role: RoleKind }) {
  return (
    <EmptyState
      title={role === 'admin' ? 'Раздел для логистов и перевозчиков' : role === 'logist' ? 'Раздел доступен только перевозчикам' : 'Раздел внутреннего контура АЭМЗ'}
      hint={role === 'logist'
        ? 'Переключите роль в шапке на перевозчика, чтобы работать с площадкой от его имени'
        : 'Этот раздел доступен сотрудникам отдела логистики. Переключите роль в шапке, чтобы вернуться в кабинет перевозчика.'}
    />
  )
}

/**
 * Статус «точкой и словом»: цвет несёт маленькая точка, слово — обычным текстом без плашки,
 * рамки и капса. Цветной текст — только у того, что требует действия (warning) или означает
 * отказ и ошибку (danger). Единый вид статусов во всех разделах.
 */
export function StatusDot({ dot, children, tone, className = '' }: {
  dot: string
  children: ReactNode
  tone?: 'warning' | 'danger'
  className?: string
}) {
  const text = tone === 'danger' ? 'text-red-700' : tone === 'warning' ? 'text-amber-700' : 'text-slate-700'
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm ${text} ${className}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      {children}
    </span>
  )
}

/** Тон строки-уведомления: цвет несёт только иконка, текст обычный */
export type NoticeTone = 'danger' | 'warning' | 'success' | 'info' | 'neutral'

const NOTICE_ICON: Record<NoticeTone, { Icon: ComponentType<{ className?: string }>; cls: string }> = {
  danger: { Icon: CircleAlert, cls: 'text-red-600' },
  warning: { Icon: AlertTriangle, cls: 'text-amber-600' },
  success: { Icon: CircleCheck, cls: 'text-emerald-600' },
  info: { Icon: Info, cls: 'text-slate-400' },
  neutral: { Icon: Info, cls: 'text-slate-400' },
}

/**
 * Уведомление строкой: иконка тона и обычный текст между тонкими линиями — вместо
 * цветных плашек с заливкой и рамкой. Единый вид предупреждений во всех разделах.
 */
export function NoticeLine({ tone = 'info', children, className = '' }: {
  tone?: NoticeTone
  children: ReactNode
  className?: string
}) {
  const { Icon, cls } = NOTICE_ICON[tone]
  return (
    <div className={`flex items-start gap-2 border-y border-slate-200 py-2.5 text-sm text-slate-700 ${className}`} role="status">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cls}`} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  const meta = REQUEST_STATUS_META[status] ?? { label: status, dot: 'bg-slate-400' }
  return <StatusDot dot={meta.dot} tone={status === 'DELETED' ? 'danger' : undefined}>{meta.label}</StatusDot>
}

/** Статус заявки глазами агента-перевозчика: что происходит с его рейсом прямо сейчас */
export function AgentStatusBadge({ status }: { status: string }) {
  const meta = REQUEST_STATUS_META[status as RequestStatus]
  const label = AGENT_STATUS_LABEL[status] ?? meta?.label ?? status
  return <StatusDot dot={meta?.dot ?? 'bg-slate-400'}>{label}</StatusDot>
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
  return <StatusDot dot={meta.dot} tone={meta.tone}>{meta.label}</StatusDot>
}

/** Срок действия документа точкой и словом: красная — истёк, янтарная — истекает, серая — скоро; иначе дата */
export function ExpiryBadge({ date, className = '' }: { date?: string | null; className?: string }) {
  const info = expiryInfo(date)
  if (info.state === 'none') return <span className={`text-sm text-slate-400 ${className}`}>—</span>
  if (info.state === 'ok') return <span className={`whitespace-nowrap text-sm text-slate-600 ${className}`}>{info.date}</span>
  if (info.state === 'expired') return <StatusDot dot="bg-red-500" tone="danger" className={className}>{info.label}</StatusDot>
  if (info.state === 'warn') return <StatusDot dot="bg-amber-500" tone="warning" className={className}>{info.label}</StatusDot>
  return <StatusDot dot="bg-slate-400" className={className}>{info.label}</StatusDot>
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

/** Цвет надзаголовка раздела — код контура, как в рядах навигации шапки:
 *  синий привлечённый транспорт, янтарный ИИ, зелёный собственный, серый — управление. */
export type SectionTone = 'blue' | 'amber' | 'emerald' | 'slate'

const EYEBROW_TONE: Record<SectionTone, string> = {
  blue: 'text-blue-700',
  amber: 'text-amber-700',
  emerald: 'text-emerald-700',
  slate: 'text-slate-500',
}

export function SectionHeader({ eyebrow, tone = 'slate', title, desc, children }: {
  eyebrow?: string
  tone?: SectionTone
  title: string
  desc?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <div className={`text-[11px] font-semibold uppercase tracking-wide ${EYEBROW_TONE[tone]}`}>{eyebrow}</div>}
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
          {title}
          {/* описание раздела — только по наведению на «i» */}
          {desc && <InfoTip label={`О разделе «${title}»`}>{desc}</InfoTip>}
        </h2>
      </div>
      {/* children — действия шапки: «Обновить», счётчики, главная кнопка раздела */}
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
        <div className="text-2xl font-bold leading-tight tabular-nums text-slate-900">{value}</div>
        <div className="mt-0.5 flex items-center gap-1 text-sm font-medium text-slate-700">
          {label}
          {hint && <InfoTip label={label}>{hint}</InfoTip>}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Компактная KPI-плитка-счётчик: число с точкой-индикатором (или значком) и подпись,
 * без круга-иконки. Клик работает фильтром, active — плитка выбрана. Единая
 * анатомия плиток обоих контуров: сводка «Заявок 1С», KPI «Мониторинга», «Занятость».
 */
export function KpiTile({ value, label, dot, icon, hint, active = false, onClick }: {
  value: ReactNode
  label: string
  /** класс точки-индикатора цвета показателя (bg-emerald-500 и т.п.) */
  dot?: string
  /** значок вместо точки (правый верхний угол плитки) */
  icon?: ReactNode
  hint?: string
  active?: boolean
  onClick?: () => void
}) {
  const body = (
    <>
      <span className="flex w-full items-center justify-between gap-1">
        <span className="text-xl font-bold tabular-nums text-slate-900">{value}</span>
        {icon ?? (dot ? <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden /> : null)}
      </span>
      <span className="text-[11px] font-medium leading-tight text-slate-500">{label}</span>
    </>
  )
  const cls = `flex flex-col gap-0.5 rounded-xl border bg-white px-3 py-2.5 text-left shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
    active ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200'
  } ${onClick ? 'hover:shadow' : ''}`
  if (!onClick) return <div className={cls} title={hint}>{body}</div>
  return (
    <button type="button" onClick={onClick} title={hint ?? (active ? 'Сбросить фильтр' : undefined)} aria-pressed={active} className={cls}>
      {body}
    </button>
  )
}

/**
 * Чип-переход из ленты «Требует внимания»: рамка, значок, текст и жирный счётчик;
 * клик ведёт к проблеме. Единый вид лент внимания обоих контуров — «Площадка
 * заявок» и «Собственный транспорт».
 */
export function AttentionChip({ icon, label, count, trailing, onClick, title }: {
  icon?: ReactNode
  label: ReactNode
  /** счётчик после текста: «новые заявки — 3» (жирный) */
  count?: ReactNode
  /** значок справа (например, стрелка перехода) */
  trailing?: ReactNode
  onClick?: () => void
  title?: string
}) {
  const cls = 'inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50'
  const inner = (
    <>
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      {count != null && (
        <>
          {'\u2009'}—{'\u2009'}
          <b className="shrink-0 font-bold tabular-nums">{count}</b>
        </>
      )}
      {trailing}
    </>
  )
  if (!onClick) return <span className={cls} title={title}>{inner}</span>
  return <button type="button" onClick={onClick} title={title} className={cls}>{inner}</button>
}

/** Пилюля-метка события/флага: мягкая заливка без рамки — как бейджи уведомлений.
 *  Единая пилюля статусов и меток обоих контуров (px-2 py-0.5 text-[11px]). */
export function Pill({ className = '', children, title }: { className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {children}
    </span>
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

/** Фирменный знак «1С»: оранжево-красная плашка с белой надписью — помечает
 *  артефакты интеграции 1С (пункт меню симулятора, бейдж «из 1С» на черновиках).
 *  Размер задаётся классом, надпись масштабируется через em от размера контейнера. */
export function OneCMark({ className = 'h-4 w-4 text-[9px]' }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-[4px] bg-gradient-to-br from-[#F7941D] to-[#EE3124] font-bold leading-none tracking-tight text-white shadow-sm ${className}`}
      aria-hidden
    >
      1С
    </span>
  )
}
