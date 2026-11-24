'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/kontur/ui/card'
import { Button } from '@/components/kontur/ui/button'
import { InfoTip, Pill } from './bits'
import type { StateResponse, Trip } from '@/lib/kontur/client-types'
import { AtiSuMarketPanel, type MarketMode } from './AtiSuMarketPanel'
import { AtiAiSearchDialog } from './AtiAiSearchDialog'
import {
  BadgeCheck, Calculator, FileCheck2, History, Loader2, MapPin, RefreshCw, Repeat2, Route,
  Save, Search, Star, Truck,
} from 'lucide-react'
import { apiFetch as fetch } from '@/lib/kontur/base-path'

// ---------------------------------------------------------------------------
// Раздел «ATI.SU» — биржа грузов для логиста: поиск грузов, заявки по
// договорённостям, обратные рейсы и вспомогательные списки. Навигация плоская
// (один уровень), интерфейс рабочий — без технических подробностей интеграции.
// ---------------------------------------------------------------------------

type AtiStatus = {
  configured: boolean
  token: { expiresAt: string | null; daysLeft: number | null; clientId: string | null }
  balance: number | null
  trucksCount: {
    firm_trucks_count: number
    unpublished_firm_trucks_count: number
  } | null
  live: { ok: boolean; error: string | null }
  trucksError?: string | null
}

type Sub = MarketMode | 'backhaul'

/** «21.11» из ISO-даты; null, если даты нет */
function fmtDay(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

export function AtiSuPanel({ state, initialSub = 'search', onChanged, onOpenTrip, onOpenAi }: {
  state: StateResponse
  /** стартовый подраздел: 'deals' — когда ведём пользователя к сделке из других разделов */
  initialSub?: 'search' | 'deals'
  /** обновление состояния после планирования груза (связка с «Занятостью» и «Планированием») */
  onChanged?: () => void
  /** переход к карточке рейса запланированного груза в «Заявках» */
  onOpenTrip?: (tripId: string) => void
  /** переход к разделу «ИИ-помощник» (список нейросети) из окна поиска */
  onOpenAi?: () => void
}) {
  const [sub, setSub] = useState<Sub>(initialSub)
  const [status, setStatus] = useState<AtiStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [dealsCount, setDealsCount] = useState(0)

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      const res = await fetch('/api/atisu/status')
      setStatus(await res.json())
    } catch {
      setStatus(null)
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const connected = !!status?.configured && status.live.ok
  const lostLink = !!status?.configured && !status.live.ok

  return (
    <div className="space-y-4">
      {/* Состояние биржи: одна компактная строка */}
      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3.5">
          <div className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Truck className="h-4 w-4 text-slate-400" aria-hidden />
            Биржа ATI.SU
            {connected ? (
              <Pill className="bg-slate-100 text-slate-700"><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />Подключено</Pill>
            ) : lostLink ? (
              <Pill className="bg-slate-100 text-slate-700"><span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />Нет связи</Pill>
            ) : (
              <Pill className="bg-slate-100 text-slate-600" title="Показываем примерные данные биржи">Демо-данные</Pill>
            )}
          </div>

          {status?.configured && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              {status.balance != null && (
                <span>баланс: <b className="text-slate-900">{status.balance.toLocaleString('ru-RU')} ₽</b></span>
              )}
              {fmtDay(status.token.expiresAt) && (
                <span className={(status.token.daysLeft ?? 99) <= 3 ? 'font-semibold text-amber-700' : ''}>
                  ключ до {fmtDay(status.token.expiresAt)}
                  {status.token.daysLeft != null ? ` · осталось ${status.token.daysLeft} дн.` : ''}
                </span>
              )}
              {status.trucksCount != null && (
                <span>машин на бирже: <b className="text-slate-900">{status.trucksCount.firm_trucks_count}</b></span>
              )}
            </div>
          )}

          {/* ИИ-поиск + связь: справа в ряд; окно «что найти» открывает нейросеть,
              которая видит и грузы, и поиск машин */}
          <div className="ml-auto flex items-center gap-2">
            <AtiAiSearchDialog onOpenAi={onOpenAi} />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => void loadStatus()}
              disabled={statusLoading}
            >
              {statusLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
              Проверить связь
            </Button>
          </div>

          {lostLink && (
            <div className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" aria-hidden />
              Связь с ATI.SU не отвечает — показатели могли обновиться не полностью. Попробуйте «Проверить связь» ещё раз.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Плоская навигация: три основных раздела + служебные списки */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {([
            ['search', 'Поиск грузов', Search],
            ['deals', 'Мои заявки', FileCheck2],
            ['backhaul', 'Обратные рейсы', Repeat2],
          ] as const).map(([id, title, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSub(id)}
              aria-current={sub === id ? 'true' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 font-medium transition-colors ${
                sub === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {title}
              {id === 'deals' && dealsCount > 0 && (
                <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-bold text-slate-700">{dealsCount}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1 px-1 text-xs">
          {([
            ['saved', 'Сохранённые фильтры', Save],
            ['history', 'История поиска', History],
            ['transport', 'По транспорту', Truck],
            ['tracked', 'Отслеживаемые', Star],
          ] as const).map(([id, title, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSub(id)}
              aria-current={sub === id ? 'true' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors ${
                sub === id ? 'font-semibold text-slate-900' : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              <Icon className="h-3 w-3" aria-hidden />
              {title}
            </button>
          ))}
        </div>
      </div>

      {sub === 'backhaul' ? (
        <BackhaulDemo state={state} />
      ) : (
        <AtiSuMarketPanel state={state} mode={sub} onModeChange={setSub} onDealsCount={setDealsCount} onChanged={onChanged} onOpenTrip={onOpenTrip} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Подбор обратной загрузки для рейса: грузы биржи по направлению, ориентиры
// по ставке и расстоянию, карточка машины для публикации.
// ---------------------------------------------------------------------------

type BackhaulResponse = {
  trip: { id: string; status: string; waitingReturn: boolean; driver: string | null; vehicle: string | null; trailer: string | null }
  direction: { from: string; to: string }
  real: {
    ok: boolean
    error?: string
    total: number
    boards: string[]
    matches: { cargo_number: string; from: string; to: string; cargo: string | null; weight_t: number | null; first_date: string | null; rate: number | null; distance_km: number | null }[]
    latest: { cargo_number: string; from: string; to: string; cargo: string | null; weight_t: number | null; first_date: string | null; rate: number | null; distance_km: number | null }[]
    citiesResolved: Record<string, number | undefined>
  }
  stubs: {
    rates: { data: { direction: string; avg_rate: number; min_rate: number; max_rate: number; per_km: number; samples: number; updated: string } }
    distance: { data: { distance_km: number; duration_hours: number } }
    nearestCities: { data: { city: string; distance_km: number }[] }
  }
  truckDraft: { endpoint: string; dryRun: true; note: string; payload: Record<string, unknown> }
}

function BackhaulDemo({ state }: { state: StateResponse }) {
  const candidates = useMemo<Trip[]>(() => {
    const order: Record<string, number> = { active: 0, draft: 1, completed: 2, cancelled: 3 }
    return [...state.trips].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
  }, [state.trips])

  const [tripId, setTripId] = useState(candidates[0]?.id ?? '')
  const [data, setData] = useState<BackhaulResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (id: string) => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/atisu/backhaul?tripId=${encodeURIComponent(id)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
      setData(json as BackhaulResponse)
    } catch (e) {
      setError(String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tripId) void run(tripId)
  }, [tripId, run])

  const trip = candidates.find((t) => t.id === tripId)
  const draftNote = data ? (data.truckDraft.payload as { note?: string }).note : null

  return (
    <div className="space-y-4">
      {/* Выбор рейса */}
      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Repeat2 className="h-4 w-4 text-slate-500" />
            Обратная загрузка для рейса
            <InfoTip>
              Подбираем грузы на обратный путь машины: выбираете рейс — показываем подходящие грузы биржи,
              ожидаемую ставку и расстояние.
            </InfoTip>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={tripId}
              onChange={(e) => setTripId(e.target.value)}
              className="h-9 min-w-72 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              {candidates.map((t) => (
                <option key={t.id} value={t.id}>
                  Рейс {t.id.slice(0, 8)} · {t.driver?.fullName ?? '—'} · {t.vehicle?.plate ?? '—'}
                  {t.legs.some((l) => l.type === 'return') ? ' · есть обратное плечо' : t.waitingReturn ? ' · ждёт обратку' : ''}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" className="h-9" onClick={() => void run(tripId)} disabled={loading}>
              {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
              Обновить
            </Button>
          </div>
          {trip && (
            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              <span>{data?.trip.driver ?? trip.driver?.fullName}</span>
              <span className="text-slate-300">·</span>
              <span>{data?.trip.vehicle ?? trip.vehicle?.brand}</span>
              {data?.direction.from && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="font-semibold text-slate-800">обратка: {data.direction.from} → {data.direction.to}</span>
                </>
              )}
            </div>
          )}
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        </CardContent>
      </Card>

      {data && (
        <>
          {/* Грузы биржи по направлению обратки */}
          <Card className="rounded-xl border-slate-200 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
                <Search className="h-4 w-4 text-slate-500" />
                Грузы биржи по направлению
                {data.direction.from && (
                  <span className="font-bold">{data.direction.from} → {data.direction.to}</span>
                )}
                <span className="text-xs font-normal text-slate-500">
                  всего доступно: {data.real.total} · площадок: {data.real.boards.length}
                </span>
              </div>
              {data.real.ok ? (
                data.real.matches.length > 0 ? (
                  <LoadTable rows={data.real.matches} />
                ) : (
                  <>
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      Подходящих грузов по этому направлению сейчас нет. Свежие грузы биржи для обзора:
                    </div>
                    <LoadTable rows={data.real.latest} />
                  </>
                )
              ) : (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" aria-hidden />
                  Грузы биржи сейчас не загрузились — попробуйте обновить ещё раз.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ориентиры по обратке */}
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            Ориентиры по обратке
            <InfoTip>Ставки и расстояния — примерные, чтобы быстро оценить выгоду обратного плеча.</InfoTip>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <InfoCard
              icon={Calculator}
              title="Средняя ставка"
              hint={`${data.stubs.rates.data.direction} · ${data.stubs.rates.data.samples} предложений`}
              rows={[
                ['средняя', `${data.stubs.rates.data.avg_rate.toLocaleString('ru-RU')} ₽`],
                ['мин / макс', `${data.stubs.rates.data.min_rate.toLocaleString('ru-RU')} / ${data.stubs.rates.data.max_rate.toLocaleString('ru-RU')} ₽`],
                ['за км', `${data.stubs.rates.data.per_km} ₽`],
              ]}
            />
            <InfoCard
              icon={Route}
              title="Расстояние обратки"
              hint="маршрут и время в пути"
              rows={[
                ['расстояние', `${data.stubs.distance.data.distance_km} км`],
                ['в пути', `${data.stubs.distance.data.duration_hours} ч`],
              ]}
            />
            <InfoCard
              icon={MapPin}
              title="Города рядом"
              hint="куда расширить поиск обратки"
              rows={data.stubs.nearestCities.data.slice(0, 4).map((c) => [c.city, `${c.distance_km} км`])}
            />
          </div>

          {/* Машина для публикации на бирже */}
          <Card className="rounded-xl border-slate-200 shadow-sm">
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
                <Truck className="h-4 w-4 text-slate-500" />
                Машина на бирже
                <Pill className="bg-slate-100 text-slate-600">черновик</Pill>
                <InfoTip>
                  Карточка машины для биржи собирается автоматически по рейсу. Публикация включается после
                  подключения к ATI.SU.
                </InfoTip>
              </div>
              {draftNote && <div className="text-xs leading-relaxed text-slate-600">{draftNote}</div>}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function LoadTable({ rows }: {
  rows: { cargo_number: string; from: string; to: string; cargo: string | null; weight_t: number | null; first_date: string | null; rate: number | null; distance_km: number | null }[]
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
            <th className="px-2.5 py-2 font-medium">Номер</th>
            <th className="px-2.5 py-2 font-medium">Направление</th>
            <th className="px-2.5 py-2 font-medium">Груз</th>
            <th className="px-2.5 py-2 font-medium">Вес, т</th>
            <th className="px-2.5 py-2 font-medium">Погрузка</th>
            <th className="px-2.5 py-2 font-medium">Ставка, ₽</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.cargo_number + i} className="border-b border-slate-100 last:border-0">
              <td className="px-2.5 py-1.5 font-mono text-slate-500">{r.cargo_number}</td>
              <td className="px-2.5 py-1.5 font-medium text-slate-800">{r.from} → {r.to}</td>
              <td className="max-w-40 truncate px-2.5 py-1.5 text-slate-600">{r.cargo ?? '—'}</td>
              <td className="px-2.5 py-1.5 text-slate-600">{r.weight_t ?? '—'}</td>
              <td className="px-2.5 py-1.5 text-slate-600">{r.first_date ?? '—'}</td>
              <td className="px-2.5 py-1.5 text-slate-700">{r.rate != null ? r.rate.toLocaleString('ru-RU') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function InfoCard({ icon: Icon, title, hint, rows }: {
  icon: typeof Calculator
  title: string
  hint: string
  rows: [string, string][]
}) {
  return (
    <Card className="rounded-xl border-slate-200 shadow-sm">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Icon className="h-4 w-4 text-slate-500" aria-hidden />
          {title}
        </div>
        <div className="text-[11px] text-slate-500">{hint}</div>
        <div className="space-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-slate-500">{k}</span>
              <span className="font-semibold text-slate-800">{v}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
