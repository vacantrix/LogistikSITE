'use client'

/**
 * «Логи платформы» (Task: функции-журналы) — ТЕХНИЧЕСКАЯ консоль платформы:
 * журнал работы кода, а не действий людей (те — в «Журнале событий»).
 *
 * Каждая строка короткая, как серверный лог:
 *   12:34:56  API  GET /api/state  200  84 мс
 * и сбои одной строкой:
 *   12:34:56  СРВ  [SERVER_ERROR] Серверная ошибка: …
 *
 * Источник — перехватчик window.fetch (src/lib/tech-log-client.ts): каждый
 * вызов /api/* из любой открытой вкладки уходит в кольцевой буфер сервера
 * (src/lib/tech-log.ts) и возвращается сюда. Плюс зеркала предупреждений и
 * ошибок сервера из lib/platform-log и системные события (старт сервера).
 *
 * Лента живая: автообновление каждые 5 секунд (переключатель «Онлайн»)
 * плюс догрузка по liveTick шины WS. Буфер в памяти процесса — как
 * `docker logs`: перезапуск сервера очищает ленту.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, Hourglass, Radio, Terminal, Timer, TriangleAlert,
} from 'lucide-react'
import {
  EmptyState, ErrorBlock, LoadingBlock, SectionHeader, type TabProps,
} from '@/components/platform/common'
import { TECH_KIND_META, fmtLogClock } from '@/components/platform/log-meta'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import type { TechLogDTO, TechLogEntryDTO, TechLogKind } from '@/lib/types'

const REFRESH_MS = 5_000
const PAGE_LIMIT = 500

type KindTab = 'all' | TechLogKind

const KIND_TAB: Record<KindTab, string> = {
  all: 'Все строки',
  api: 'Вызовы API',
  server: 'Сервер',
  client: 'Клиент',
  system: 'Система',
}

/** Цвет чипа вида строки в тёмной консоли */
const KIND_CHIP: Record<TechLogKind, string> = {
  api: 'bg-sky-400/10 text-sky-300',
  server: 'bg-violet-400/10 text-violet-300',
  client: 'bg-fuchsia-400/10 text-fuchsia-300',
  system: 'bg-slate-400/10 text-slate-300',
}

/** Цвет уровня события (для строк сервера/клиента/системы) */
const LEVEL_TEXT: Record<string, string> = {
  INFO: 'text-slate-100',
  WARN: 'text-amber-300',
  ERROR: 'text-red-400',
}

/** Код ответа цветом: 2xx — зелёный, 3xx — синий, 4xx — янтарь, 5xx/сбой — красный */
function statusCls(status: number | null): string {
  if (status === null || status >= 500) return 'text-red-400 font-semibold'
  if (status >= 400) return 'text-amber-300 font-semibold'
  if (status >= 300) return 'text-sky-300'
  return 'text-emerald-300'
}

/** Время с секундами из epoch ms */
const fmtClock = (ts: number): string =>
  new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export default function LogsTab({ liveTick }: TabProps) {
  const [data, setData] = useState<TechLogDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<KindTab>('all')
  const [q, setQ] = useState('')
  const [live, setLive] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  // загрузка ленты: фильтры вида и поиск применяем локально — переключение
  // вкладок мгновенное, счётчики видов не требуют нового запроса
  const load = useCallback(() => {
    return api.techLog({ limit: PAGE_LIMIT })
      .then((res) => { setData(res); setError(null); setUpdatedAt(new Date().toISOString()) })
      .catch((e) => setError(e instanceof Error ? e.message : 'Неизвестная ошибка'))
  }, [])

  useEffect(() => { void load() }, [load])
  // пауза «live» останавливает всё: и общий «пульс» платформы, и локальный такт
  useEffect(() => { if (liveTick > 0 && live) void load() }, [liveTick, live, load])
  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load, live])

  const entries = data?.entries ?? []

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return entries.filter((e) => {
      if (kind !== 'all' && e.kind !== kind) return false
      if (!needle) return true
      return [e.message, e.path, e.method, e.origin, e.status !== null ? String(e.status) : '']
        .some((v) => (v ?? '').toLowerCase().includes(needle))
    })
  }, [entries, q, kind])

  const kindCounts = useMemo(() => {
    const counts: Record<KindTab, number> = { all: entries.length, api: 0, server: 0, client: 0, system: 0 }
    for (const e of entries) counts[e.kind] += 1
    return counts
  }, [entries])

  const stats = data?.stats

  return (
    <div>
      <SectionHeader
        eyebrow="Функции"
        tone="amber"
        title="Логи платформы"
        desc="Техническая консоль платформы: каждый вызов API — метод, путь, код ответа и сколько он шёл, плюс сбои сервера и интерфейса и системные события. Строки короткие, лента живая. Кто и что делал — в «Журнале событий»."
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500" role="status">
            <Radio className={`h-3.5 w-3.5 ${live ? 'animate-pulse text-emerald-500' : 'text-slate-300'}`} aria-hidden />
            {live ? 'Онлайн · обновление каждые 5 с' : 'Обновление выключено'}
          </span>
          <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
            Строк: {filtered.length}{filtered.length !== entries.length ? ` из ${entries.length}` : ''}
          </Badge>
        </div>
      </SectionHeader>

      {data === null && !error && <LoadingBlock label="Подключаемся к технической консоли…" />}
      {error && <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />}

      {data !== null && !error && (
        <div className="space-y-4">
          {/* Сводка за окно статистики */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                  <Activity className="h-5 w-5" aria-hidden />
                </div>
                <div className="text-2xl font-bold text-slate-900">{stats?.calls ?? 0}</div>
                <div className="text-sm font-medium text-slate-700">Вызовов API за {stats?.windowMin ?? 5} минут</div>
                <div className="mt-1 text-xs text-muted-foreground">Активных сессий: {stats?.sessions ?? 0}</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <Timer className="h-5 w-5" aria-hidden />
                </div>
                <div className="text-2xl font-bold text-slate-900">{stats?.avgMs !== null && stats?.avgMs !== undefined ? `${stats.avgMs} мс` : '—'}</div>
                <div className="text-sm font-medium text-slate-700">Средний отклик</div>
                <div className="mt-1 text-xs text-muted-foreground">По вызовам за окно статистики</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                  <TriangleAlert className="h-5 w-5" aria-hidden />
                </div>
                <div className={`text-2xl font-bold ${(stats?.errors ?? 0) > 0 ? 'text-red-600' : 'text-slate-900'}`}>
                  {stats?.errors ?? 0}
                </div>
                <div className="text-sm font-medium text-slate-700">Сбои за {stats?.windowMin ?? 5} минут</div>
                <div className="mt-1 text-xs text-muted-foreground">HTTP 4xx/5xx, сетевые и серверные</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-violet-50 text-violet-600">
                  <Hourglass className="h-5 w-5" aria-hidden />
                </div>
                <div className="text-2xl font-bold text-slate-900">{stats?.slowest ? `${stats.slowest.ms} мс` : '—'}</div>
                <div className="text-sm font-medium text-slate-700">Самый медленный вызов</div>
                {stats?.slowest && (
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground" title={stats.slowest.path}>
                    {stats.slowest.path}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Панель управления: вид строки, поиск, живой режим */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <Tabs value={kind} onValueChange={(v) => setKind(v as KindTab)}>
                  <TabsList className="h-auto flex-wrap justify-start gap-1 bg-slate-100 p-1" aria-label="Вид строк">
                    {(['all', 'api', 'server', 'client', 'system'] as KindTab[]).map((k) => (
                      <TabsTrigger key={k} value={k} className="gap-1.5 data-[state=active]:bg-white">
                        {KIND_TAB[k]}
                        <Badge variant="outline" className="h-5 border-slate-200 bg-white px-1.5 text-[10px] text-slate-500">{kindCounts[k]}</Badge>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                  <Switch checked={live} onCheckedChange={setLive} aria-label="Живое обновление консоли" />
                  Онлайн
                </label>
              </div>
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск: путь, метод, код, сообщение, сессия…"
                aria-label="Поиск по технической консоли"
              />
            </CardContent>
          </Card>

          {/* Консоль */}
          <Card className="overflow-hidden border-slate-800 bg-slate-950 shadow-sm">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
              <Terminal className="h-4 w-4 text-amber-300" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Техническая консоль</span>
              <span className="ml-auto font-mono text-[11px] text-slate-500">
                {updatedAt ? `обновлено ${fmtLogClock(updatedAt)}` : '—'}
              </span>
            </div>
            {filtered.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={<Terminal className="h-10 w-10" aria-hidden />}
                  title={entries.length === 0 ? 'Консоль пуста' : 'Ничего не найдено'}
                  hint={entries.length === 0
                    ? 'Вызовы API и события сервера появятся здесь, как только платформа начнёт работать'
                    : 'Измените вид строки или условия поиска'}
                />
              </div>
            ) : (
              <div
                className="max-h-[70vh] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-track]:bg-transparent"
                role="log"
                aria-label="Лента технической консоли"
              >
                <ul className="divide-y divide-white/5">
                  {filtered.map((e) => (
                    <li key={e.id}>
                      <ConsoleRow e={e} />
                    </li>
                  ))}
                </ul>
                {entries.length >= PAGE_LIMIT && (
                  <div className="px-4 py-2.5 text-center font-mono text-[11px] text-slate-500">
                    показаны последние {PAGE_LIMIT} строк — лента живёт в памяти сервера, перезапуск очищает её
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

/** Строка консоли: время · вид · суть. Коротко — как серверный лог */
function ConsoleRow({ e }: { e: TechLogEntryDTO }) {
  const meta = TECH_KIND_META[e.kind]
  const title =
    e.kind === 'api'
      ? `${e.method} ${e.path} → ${e.status ?? 'сбой сети'}${e.ms !== null ? ` · ${e.ms} мс` : ''}${e.origin ? ` · ${e.origin}` : ''}`
      : `${e.message}${e.path ? ` (${e.path})` : ''}${e.origin ? ` · ${e.origin}` : ''}`
  return (
    <div
      className="flex w-full items-center gap-3 px-4 py-1.5 font-mono text-[12px] leading-relaxed hover:bg-white/5"
      title={title}
    >
      {/* время */}
      <span className="w-[64px] shrink-0 text-slate-500">{fmtClock(e.ts)}</span>
      {/* вид строки */}
      <span
        className={`w-[44px] shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold ${KIND_CHIP[e.kind]}`}
        title={meta.hint}
      >
        {meta.label}
      </span>
      {e.kind === 'api' ? (
        <>
          <span className="w-[42px] shrink-0 font-semibold text-slate-200">{e.method}</span>
          <span className={`w-[46px] shrink-0 text-right ${statusCls(e.status)}`}>{e.status ?? 'СБОЙ'}</span>
          <span className="min-w-0 flex-1 truncate text-slate-300">{e.path}</span>
          <span className={`shrink-0 text-slate-500 ${e.ms !== null && e.ms > 2000 ? 'text-amber-300' : ''}`}>
            {e.ms !== null ? `${e.ms} мс` : ''}
          </span>
        </>
      ) : (
        <span className={`min-w-0 flex-1 truncate ${LEVEL_TEXT[e.level] ?? 'text-slate-100'}`}>{e.message}</span>
      )}
    </div>
  )
}
