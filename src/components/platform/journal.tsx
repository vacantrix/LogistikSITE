'use client'

/**
 * «Журнал событий» (Task 76) — единый журнал всей платформы для логиста.
 *
 * Показывает:
 *  — бизнес-события всех ролей (вход/выход, заявки, ставки, документы, ЭДО, 1С);
 *  — предупреждения (неудачный вход, замечания автопроверки);
 *  — логи ошибок: сбои сервера (включая необработанные — их ловит instrumentation),
 *    сбои интерфейса (репортит браузер) со стеком в раскрывающихся подробностях.
 *
 * Лента живая: автообновление каждые 15 секунд + догрузка по liveTick шины WS.
 * Фильтры — табы уровней со счётчиками и поиск по всем полям.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, ChevronDown, Info, TriangleAlert, TimerReset,
} from 'lucide-react'
import {
  EmptyState, ErrorBlock, LoadingBlock, SectionHeader, type TabProps,
} from '@/components/platform/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { fmtDateTime } from '@/lib/status'
import type { PlatformLogDTO, PlatformLogLevel } from '@/lib/types'

const REFRESH_MS = 15_000

/** Формат времени журнала: с секундами — события идут плотно */
const fmtLogTime = (iso: string): string =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Яркие пузыри уровней (стиль реестров, Task 73): белый текст на насыщенном фоне */
const LEVEL_META: Record<PlatformLogLevel, { label: string; badge: string; Icon: typeof Info }> = {
  INFO: { label: 'Событие', badge: 'bg-sky-500 text-white border-sky-600 shadow-sm', Icon: Info },
  WARN: { label: 'Внимание', badge: 'bg-amber-500 text-white border-amber-600 shadow-sm', Icon: AlertCircle },
  ERROR: { label: 'Ошибка', badge: 'bg-red-500 text-white border-red-600 shadow-sm', Icon: TriangleAlert },
}

/** Русские подписи типов событий — журнал читается без знания кодов */
const TYPE_LABEL: Record<string, string> = {
  LOGIN: 'Вход', LOGIN_FAILED: 'Неудачный вход', LOGIN_DENIED: 'Вход отклонён', LOGOUT: 'Выход',
  REQUEST_CREATED: 'Заявка опубликована', REQUEST_UPDATED: 'Заявка отредактирована', REQUEST_DELETED: 'Заявка удалена',
  BID_PLACED: 'Ставка', BID_WITHDRAWN: 'Отзыв ставки', DEADLINE_EXTENDED: 'Срок продлён',
  DIRECT_OFFER: 'Прямое назначение', RATE_RAISED: 'Ставка повышена',
  CREW_ASSIGNED: 'Экипаж', CREW_APPROVED: 'Экипаж утверждён',
  DOCS_VERIFIED: 'Проверка документов', OCR_FAILED: 'Сбой распознавания',
  TRIP_CONFIRMED: 'Сверка подтверждена', DOCS_RETURNED: 'Возврат на доработку',
  TRIP_CLOSED: 'Рейс закрыт', ETRN_1C: 'ЭТрН из 1С',
  EDO_PACK_CREATED: 'Комплект ЭДО', EDO_SIGNED: 'Подписано ЭДО',
  DIADOC_SENT: 'ЭТрН в Диадок', DIADOC_STATUS: 'Статус ЭТрН', DIADOC_ERROR: 'Ошибка Диадока',
  SERVER_ERROR: 'Сбой сервера', ACTION_FAILED: 'Сбой действия', FINALIZE_FAILED: 'Сбой итогов',
  CLIENT_ERROR: 'Ошибка интерфейса',
}

const typeLabelOf = (type: string): string => TYPE_LABEL[type] ?? type

type LevelTab = 'ALL' | PlatformLogLevel

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

  // первичная загрузка + догрузка по live-событиям шины + страховочный интервал
  useEffect(() => { void load() }, [load])

  // живая лента: догрузка по шине WS + страховочный интервал
  useEffect(() => { if (liveTick > 0) void load() }, [liveTick, load])
  useEffect(() => {
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const entries = data?.entries ?? []

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return entries.filter((e) => {
      // таб уровня + поиск по всем полям записи
      if (level !== 'ALL' && e.level !== level) return false
      if (!needle) return true
      return [e.message, e.type, e.source, e.actorName, e.actorLogin, e.carrierName, e.requestNumber]
        .some((v) => (v ?? '').toLowerCase().includes(needle))
    })
  }, [entries, q, level])

  const tabCounts = useMemo(() => {
    const counts: Record<LevelTab, number> = { ALL: entries.length, INFO: 0, WARN: 0, ERROR: 0 }
    for (const e of entries) counts[e.level] += 1
    return counts
  }, [entries])

  const stats = data?.stats

  return (
    <div>
      <SectionHeader
        eyebrow="Внутренний контур АЭМЗ"
        title="Журнал событий"
        desc="Все события платформы в одном месте: действия пользователей, документы, ЭДО, интеграция с 1С — а также предупреждения и логи ошибок сервера и интерфейса. Лента обновляется сама."
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
                <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                  <AlertCircle className="h-5 w-5" aria-hidden />
                </div>
                <div className="text-2xl font-bold text-slate-900">{stats?.counts24h.WARN ?? 0}</div>
                <div className="text-sm font-medium text-slate-700">Предупреждений за 24 часа</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-600">
                  <TriangleAlert className="h-5 w-5" aria-hidden />
                </div>
                <div className={`text-2xl font-bold ${(stats?.counts24h.ERROR ?? 0) > 0 ? 'text-red-600' : 'text-slate-900'}`}>
                  {stats?.counts24h.ERROR ?? 0}
                </div>
                <div className="text-sm font-medium text-slate-700">Ошибок за 24 часа</div>
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
                          <span className={`h-2 w-2 shrink-0 rounded-full ${meta.badge.split(' ')[0]}`} aria-hidden />
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
                placeholder="Поиск: текст события, заявка, пользователь, источник…"
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
                  {filtered.map((e) => {
                    const meta = LEVEL_META[e.level]
                    const Icon = meta.Icon
                    const expanded = expandedId === e.id
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : e.id)}
                          aria-expanded={expanded}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                        >
                          {/* время */}
                          <span className="w-[104px] shrink-0 font-mono text-[11px] leading-5 text-slate-500">{fmtLogTime(e.createdAt)}</span>
                          {/* уровень */}
                          <Badge variant="outline" className={`${meta.badge} shrink-0 whitespace-nowrap`}>
                            <Icon className="mr-1 h-3 w-3" aria-hidden />
                            {meta.label}
                          </Badge>
                          {/* сообщение */}
                          <span className="min-w-0 flex-1 break-words text-sm leading-snug text-slate-800">{e.message}</span>
                          {/* контекст: заявка/перевозчик */}
                          {(e.requestNumber || e.carrierName) && (
                            <span className="hidden shrink-0 items-center gap-1 sm:flex">
                              {e.requestNumber && (
                                <Badge variant="outline" className="whitespace-nowrap border-slate-200 bg-white font-mono text-[10px] text-blue-700">
                                  {e.requestNumber}
                                </Badge>
                              )}
                              {e.carrierName && (
                                <Badge variant="outline" className="max-w-[160px] truncate whitespace-nowrap border-slate-200 bg-white text-[10px] text-slate-600">
                                  {e.carrierName}
                                </Badge>
                              )}
                            </span>
                          )}
                          <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
                        </button>
                        {expanded && (
                          <div className="space-y-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-xs">
                            <div className="flex flex-wrap gap-2">
                              <Chip label="Тип" value={typeLabelOf(e.type)} />
                              <Chip label="Источник" value={e.source} mono />
                              {e.actorName && <Chip label="Пользователь" value={`${e.actorName} (${e.actorLogin ?? '—'})`} />}
                              {e.carrierName && <Chip label="Перевозчик" value={e.carrierName} />}
                              {e.requestNumber && <Chip label="Заявка" value={e.requestNumber} mono />}
                            </div>
                            {e.meta && Object.keys(e.meta).length > 0 && (
                              <div>
                                <div className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Технические подробности</div>
                                <pre className="max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-700">
                                  {JSON.stringify(e.meta, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
                <div className="border-t border-slate-100 px-4 py-2 text-xs text-muted-foreground">
                  Лента обновляется автоматически каждые 15 секунд и при изменениях на платформе. Нажмите на запись, чтобы увидеть подробности и стек ошибки.
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

/** Контекстный чип подробностей: подпись + значение */
function Chip({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className={`min-w-0 truncate ${mono ? 'font-mono' : ''} text-slate-700`}>{value}</span>
    </span>
  )
}
