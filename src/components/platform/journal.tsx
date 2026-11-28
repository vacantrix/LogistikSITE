'use client'

/**
 * «Журнал событий» (Task 76, Task: функции-журналы) — единый журнал всей
 * платформы для логиста: каждое действие показывает, кто его сделал, что
 * произошло, когда и с каким объектом.
 *
 * Показывает:
 *  — действия всех пользователей обоих контуров: платформа (привлечённый
 *    транспорт) и диспетчерская (собственный транспорт) — с пометкой контура;
 *  — входы и попытки входа (неудачные — предупреждением);
 *  — заявки, ставки, документы, рейсы, справочники, контакты, ИИ, служебное;
 *  — предупреждения и логи ошибок сервера и интерфейса со стеком в подробностях.
 *
 * Строка: время · уровень · кто сделал · что произошло. Раскрывается в
 * подробности: тип, источник, пользователь, IP, устройство, объект, до/после.
 * Дни разделены заголовками — журнал читается как дневник платформы.
 *
 * Лента живая: автообновление каждые 15 секунд + догрузка по liveTick шины WS.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, ChevronDown, Info, KeyRound, TriangleAlert, TimerReset,
} from 'lucide-react'
import {
  EmptyState, ErrorBlock, LoadingBlock, SectionHeader, StatusDot, type TabProps,
} from '@/components/platform/common'
import {
  LEVEL_META, actorInitials, actorLabel, contourLabel, fmtLogTime, typeLabelOf,
} from '@/components/platform/log-meta'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { fmtDateTime } from '@/lib/status'
import type { PlatformLogDTO, PlatformLogLevel, PlatformLogEntryDTO } from '@/lib/types'

type LevelTab = 'ALL' | PlatformLogLevel

/** Заголовок дня: «Сегодня», «Вчера» или дата */
function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 24 * 3600_000)
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (same(d, today)) return 'Сегодня'
  if (same(d, yesterday)) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function JournalTab({ liveTick }: TabProps) {
  const [data, setData] = useState<PlatformLogDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState<LevelTab>('ALL')
  const [q, setQ] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // загрузка ленты (живой журнал: обновляется по liveTick шины WS и страховочным интервалом).
  // Цепочка промисов, как в колокольчике уведомлений — колбэк после ответа, без каскадных рендеров
  const load = useCallback(() => {
    return api.platformLog({ limit: 300 })
      .then((res) => { setData(res); setError(null) })
      .catch((e) => setError(e instanceof Error ? e.message : 'Неизвестная ошибка'))
  }, [])

  // первичная загрузка + догрузка по live-событиям шины и общему «пульсу» платформы
  // (page.tsx, каждые 15 с) — локальный интервал больше не нужен: один источник такта
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (liveTick > 0) void load() }, [liveTick, load])

  const entries = data?.entries ?? []

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return entries.filter((e) => {
      // таб уровня + поиск по всем полям записи
      if (level !== 'ALL' && e.level !== level) return false
      if (!needle) return true
      return [e.message, e.type, e.source, e.actorName, e.actorLogin, e.carrierName, e.requestNumber, e.ip, e.objectType]
        .some((v) => (v ?? '').toLowerCase().includes(needle))
    })
  }, [entries, q, level])

  const tabCounts = useMemo(() => {
    const counts: Record<LevelTab, number> = { ALL: entries.length, INFO: 0, WARN: 0, ERROR: 0 }
    for (const e of entries) counts[e.level] += 1
    return counts
  }, [entries])

  const stats = data?.stats

  // группировка по дням: заголовок дня перед первой записью этого дня
  const rowsWithDays = useMemo(() => {
    const out: { e: PlatformLogEntryDTO; day: string | null }[] = []
    let lastDay = ''
    for (const e of filtered) {
      const day = dayLabel(e.createdAt)
      out.push({ e, day: day !== lastDay ? day : null })
      lastDay = day
    }
    return out
  }, [filtered])

  return (
    <div>
      <SectionHeader
        eyebrow="Функции"
        tone="amber"
        title="Журнал событий"
        desc="Все действия на платформе в одном месте: кем сделано, что сделано и когда — заявки, рейсы, документы, справочники, ИИ, входы и попытки входа, действия диспетчерской, предупреждения и ошибки. Техническая работа кода — вызовы API и задержки — в разделе «Логи платформы». Лента обновляется сама."
      >
        <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
          Записей: {filtered.length}{filtered.length !== entries.length ? ` из ${entries.length}` : ''}
        </Badge>
      </SectionHeader>

      {data === null && !error && <LoadingBlock label="Загружаем журнал событий…" />}
      {error && <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />}

      {data !== null && !error && (
        <div className="space-y-4">
          {/* Сводка за сутки */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                  <Info className="h-5 w-5" aria-hidden />
                </div>
                <div className="text-2xl font-bold text-slate-900">{stats?.counts24h.INFO ?? 0}</div>
                <div className="text-sm font-medium text-slate-700">Событий за 24 часа</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <KeyRound className="h-5 w-5" aria-hidden />
                </div>
                <div className="text-2xl font-bold text-slate-900">{(stats?.logins24h.success ?? 0) + (stats?.logins24h.failed ?? 0)}</div>
                <div className="text-sm font-medium text-slate-700">Попыток входа за 24 часа</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Успешных: {stats?.logins24h.success ?? 0} · отклонённых: {stats?.logins24h.failed ?? 0}
                </div>
              </CardContent>
            </Card>
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                  <AlertCircle className="h-5 w-5" aria-hidden />
                </div>
                <div className="text-2xl font-bold text-slate-900">{stats?.counts24h.WARN ?? 0}</div>
                <div className="text-sm font-medium text-slate-700">Предупреждений за 24 часа</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                  <TimerReset className="h-5 w-5" aria-hidden />
                </div>
                <div className="truncate text-lg font-bold leading-tight text-slate-900">
                  {stats?.lastErrorAt ? fmtDateTime(stats.lastErrorAt) : 'Нет'}
                </div>
                <div className="text-sm font-medium text-slate-700">Последняя ошибка</div>
                {stats?.lastErrorMessage && (
                  <div className="mt-1 truncate text-xs text-muted-foreground" title={stats.lastErrorMessage}>{stats.lastErrorMessage}</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Табы уровней + поиск */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <Tabs value={level} onValueChange={(v) => setLevel(v as LevelTab)}>
                <TabsList className="h-auto flex-wrap justify-start gap-1 bg-slate-100 p-1">
                  <TabsTrigger value="ALL" className="gap-1.5 data-[state=active]:bg-white">
                    Все записи
                    <Badge variant="outline" className="h-5 border-slate-200 bg-white px-1.5 text-[10px] text-slate-500">{tabCounts.ALL}</Badge>
                  </TabsTrigger>
                  {(['INFO', 'WARN', 'ERROR'] as PlatformLogLevel[]).map((lv) => {
                    const meta = LEVEL_META[lv]
                    return (
                      <TabsTrigger key={lv} value={lv} className="gap-1.5 data-[state=active]:bg-white">
                        <span className="flex items-center gap-1.5">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
                          {lv === 'INFO' ? 'События' : lv === 'WARN' ? 'Предупреждения' : 'Ошибки'}
                        </span>
                        <Badge variant="outline" className="h-5 border-slate-200 bg-white px-1.5 text-[10px] text-slate-500">{tabCounts[lv]}</Badge>
                      </TabsTrigger>
                    )
                  })}
                </TabsList>
              </Tabs>
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск: текст события, заявка, пользователь, источник, IP…"
                aria-label="Поиск по журналу событий"
              />
            </CardContent>
          </Card>

          {/* Лента */}
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Info className="h-10 w-10" aria-hidden />}
              title={entries.length === 0 ? 'Журнал пуст' : 'Ничего не найдено'}
              hint={entries.length === 0
                ? 'Как только на платформе что-то произойдёт — событие появится здесь'
                : 'Измените уровень или условия поиска'}
            />
          ) : (
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-0">
                <ul className="divide-y divide-slate-100">
                  {rowsWithDays.map(({ e, day }) => (
                    <JournalRow
                      key={e.id}
                      e={e}
                      day={day}
                      expanded={expandedId === e.id}
                      onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)}
                    />
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

/** Строка журнала (с заголовком дня) + раскрывающиеся подробности */
function JournalRow({ e, day, expanded, onToggle }: {
  e: PlatformLogEntryDTO
  day: string | null
  expanded: boolean
  onToggle: () => void
}) {
  const meta = LEVEL_META[e.level]
  const actor = actorLabel(e)
  return (
    <li>
      {day && (
        <div className="sticky top-0 z-10 flex items-center gap-2 border-y border-slate-100 bg-slate-50/95 px-4 py-1.5 backdrop-blur">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{day}</span>
          <span className="h-px flex-1 bg-slate-200" aria-hidden />
        </div>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
      >
        {/* время */}
        <span className="w-[104px] shrink-0 font-mono text-[11px] leading-5 text-slate-500">{fmtLogTime(e.createdAt)}</span>
        {/* уровень */}
        <StatusDot dot={meta.dot} tone={meta.tone} className="w-[88px] shrink-0">{meta.label}</StatusDot>
        {/* кто сделал: кружок с инициалами и имя */}
        <span className="hidden w-[150px] shrink-0 items-center gap-1.5 text-sm text-slate-700 md:flex" title={`${actor}${e.actorLogin ? ` (${e.actorLogin})` : ''}`}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-500" aria-hidden>
            {actorInitials(e)}
          </span>
          <span className="truncate">{actor}</span>
        </span>
        {/* что произошло */}
        <span className="min-w-0 flex-1 break-words text-sm leading-snug text-slate-800">
          {e.message}
          {/* кто сделал — на узких экранах, где колонки нет */}
          <span className="md:hidden"> <span className="text-slate-400">— {actor}</span></span>
        </span>
        {/* контекст: заявка / перевозчик / контур */}
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          {e.requestNumber && (
            <Badge variant="outline" className="whitespace-nowrap border-slate-200 bg-white font-mono text-[11px] text-slate-700">
              {e.requestNumber}
            </Badge>
          )}
          {e.contour === 'dispatcher' && (
            <Badge variant="outline" className="whitespace-nowrap border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700" title="Действие диспетчерской — собственный транспорт">
              {contourLabel(e.contour)}
            </Badge>
          )}
          {e.carrierName && (
            <Badge variant="outline" className="max-w-[160px] truncate whitespace-nowrap border-slate-200 bg-white text-[10px] text-slate-600">
              {e.carrierName}
            </Badge>
          )}
        </span>
        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-xs">
          <div className="flex flex-wrap gap-2">
            <Chip label="Тип" value={typeLabelOf(e.type)} />
            <Chip label="Код" value={e.type} mono />
            <Chip label="Источник" value={e.source} mono />
            <Chip label="Пользователь" value={`${actor}${e.actorLogin ? ` (${e.actorLogin})` : ''}`} />
            {e.actorRole && <Chip label="Роль" value={e.actorRole} />}
            {e.carrierName && <Chip label="Перевозчик" value={e.carrierName} />}
            {e.requestNumber && <Chip label="Заявка" value={e.requestNumber} mono />}
            {(e.objectType || e.objectId) && (
              <Chip label="Объект" value={[e.objectType, e.objectId?.slice(0, 12)].filter(Boolean).join(' · ')} mono />
            )}
            <Chip label="Контур" value={contourLabel(e.contour)} />
            {e.ip && <Chip label="IP" value={e.ip} mono />}
          </div>
          {(e.before || e.after) && (
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
              {e.before && <span className="max-w-full truncate rounded bg-red-50 px-2 py-0.5 text-red-700" title={e.before}>было: {e.before}</span>}
              {e.after && <span className="max-w-full truncate rounded bg-emerald-50 px-2 py-0.5 text-emerald-700" title={e.after}>стало: {e.after}</span>}
            </div>
          )}
          {e.userAgent && (
            <div className="truncate font-mono text-[11px] text-slate-500" title={e.userAgent}>
              Устройство: {e.userAgent}
            </div>
          )}
          {e.meta && Object.keys(e.meta).length > 0 && (
            <div>
              <div className="mb-1 font-medium text-slate-500">Технические подробности</div>
              <pre className="max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-700 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
                {JSON.stringify(e.meta, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/** Контекстный чип подробностей: подпись + значение */
function Chip({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
      <span className="shrink-0 text-[11px] text-slate-400">{label}</span>
      <span className={`min-w-0 truncate ${mono ? 'font-mono' : ''} text-slate-700`}>{value}</span>
    </span>
  )
}
