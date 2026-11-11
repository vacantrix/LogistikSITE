'use client'

/**
 * Вкладка «2ГИС» (сценарий 1 из обзора источников обстановки):
 *  - карта 2ГИС MapGL со слоем пробок (trafficOn: true) — данные обновляются
 *    у 2ГИС каждую минуту (dev.2gis.ru/api/routing, Q&A);
 *  - поверх — наш рейс Абинск → Новороссийск (А-146) и точки погрузки/выгрузки;
 *  - ключ MapGL берётся в рантайме с GET /api/2gis/mapkey (не запекается
 *    в бандл через NEXT_PUBLIC_* — иначе смена ключа требует пересборки);
 *  - панель «Проверить обстановку» вызывает серверный прокси
 *    POST /api/2gis/routing (Routing API 7.0.0, transport truck, traffic jam):
 *    в детальном ответе каждый сегмент имеет color fast/normal/slow —
 *    реальные проблемные участки подсвечиваются на карте цветом;
 *  - перемаршрутизация: если ETA нового запроса хуже базовой ≥ порога,
 *    показываем предупреждение и выигрыш альтернативы.
 *
 * Прод-версия (каркас АЗМЗ): те же вызовы из Spring Boot, ключ в Vault/env,
 * см. azmz-karkas README «Внешние поставщики дорожной обстановки».
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, MapPin, RefreshCw, Route, TriangleAlert } from 'lucide-react'
import { useAzmz } from '@/lib/store'
import { LOADING_POINT, UNLOADING_POINT, ROUTE_LNGLAT } from '@/lib/demo/route-data'

/** Крымск — промежуточный пункт на А-146: короткий тестовый маршрут (<50 км, лимит демо-ключа). */
const KRIMSK = { lat: 44.9312, lon: 37.9926, name: 'Крымск (А-146)' }

type MapglAny = { destroy?: () => void } & Record<string, unknown>
type MapglObj = { destroy?: () => void }

interface VariantInfo {
  id: string
  distanceM: number
  durationS: number
  algorithm: string
  slowSegs: number
  normalSegs: number
  fastSegs: number
}

interface RoutingResp {
  status?: string
  message?: string
  error?: string
  hint?: string
  meta?: { latencyMs?: number; cached?: boolean; upstreamStatus?: number }
  result?: Array<{
    id?: string
    algorithm?: string
    maneuvers?: Array<{ outcoming_path?: { distance?: number; duration?: number; geometry?: Array<{ selection?: string; color?: string; length?: number }> } }>
  }>
  query?: { result?: Array<{ total_distance?: number; total_duration?: number; wait_time?: number }> }
}

const COLORS: Record<string, string> = {
  fast: '#22C55E',
  normal: '#FACC15',
  slow: '#EF4444',
  ignore: '#94A3B8',
}

/** LINESTRING(37.76 44.72 30, ...) → [[lng,lat], ...] (третье значение — высота, отбрасываем). */
function parseWktLine(s: string): [number, number][] {
  const inner = s.replace(/^LINESTRING\s*\(/i, '').replace(/\)\s*$/, '').trim()
  return inner
    .split(',')
    .map((pair) => pair.trim().split(/\s+/).slice(0, 2).map(Number) as [number, number])
    .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]))
}

declare global {
  interface Window {
     
    mapgl?: any
  }
}

const SDK_URL = 'https://mapgl.2gis.com/api/js/v1'
let sdkPromise: Promise<void> | null = null

function loadMapglSdk(key: string): Promise<void> {
  if (window.mapgl) return Promise.resolve()
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `${SDK_URL}?key=${encodeURIComponent(key)}`
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('sdk_failed'))
    document.head.appendChild(s)
  })
  return sdkPromise
}

export function Gis2Screen() {
  const setView = useAzmz((s) => s.setView)
  /** null = ещё грузим конфигурацию, '' = ключ не настроен, строка = готов к инициализации. */
  const [key, setKey] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapglAny | null>(null)
  const drawnRef = useRef<MapglObj[]>([])
  const baselineRef = useRef<number | null>(null)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<'sdk_failed' | null>(null)
  /** MapGL отверг ключ (сервис «MapGL JS API» не включён) — работаем в режиме без карты 2ГИС. */
  const [mapRejected, setMapRejected] = useState(false)
  /** Сегменты маршрута от Routing API — для рисования на MapGL и SVG-фолбэка. */
  const [segs, setSegs] = useState<Array<{ coords: [number, number][]; color: string }>>([])
  const [checking, setChecking] = useState(false)
  const [res, setRes] = useState<RoutingResp | null>(null)
  const [resMeta, setResMeta] = useState<{ latencyMs?: number; cached?: boolean } | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [shortRoute, setShortRoute] = useState(true)

  /** Нарисовать линию и зарегистрировать для очистки. */
  const drawLine = useCallback((map: MapglAny, coordinates: [number, number][], color: string, width: number) => {
     
    const line = (map as any).addLine({ coordinates, color, width, zIndex: 20 }) as MapglObj
    drawnRef.current.push(line)
  }, [])

  const clearRouteArt = useCallback(() => {
    for (const o of drawnRef.current) {
      try {
        o.destroy?.()
      } catch {
        /* объект уже снят */
      }
    }
    drawnRef.current = []
  }, [])

  /** Ключ MapGL — с сервера, в рантайме (один источник истины: 2GIS_API_KEY в .env). */
  useEffect(() => {
    let dead = false
    fetch('/api/2gis/mapkey')
      .then((r) => r.json())
      .then((d: { key?: string }) => {
        if (!dead) setKey(d.key || '')
      })
      .catch(() => {
        if (!dead) setKey('')
      })
    return () => {
      dead = true
    }
  }, [])

  /** Инициализация карты (один раз, после получения ключа). */
  useEffect(() => {
    if (!key || !containerRef.current || mapRef.current) return
    let dead = false
    loadMapglSdk(key)
      .then(() => {
        if (dead || !containerRef.current || !window.mapgl) return
         
        const map = new window.mapgl.Map(
          containerRef.current,
          key,
          {
            center: [37.768, 44.726], // Новороссийск, коридор рейса Z-1067
            zoom: 10.4,
            trafficOn: true, // слой пробок 2ГИС
            minZoom: 6,
            maxZoom: 18,
          },
        ) as MapglAny
        mapRef.current = map

        // Наш рейс: линия маршрута А-146 + точки погрузки/выгрузки.
        drawLine(map, ROUTE_LNGLAT as [number, number][], '#0F172A', 4)
         
        drawnRef.current.push(new window.mapgl.Marker(map, { coordinates: [LOADING_POINT.lon, LOADING_POINT.lat] }) as MapglObj)
         
        drawnRef.current.push(new window.mapgl.Marker(map, { coordinates: [UNLOADING_POINT.lon, UNLOADING_POINT.lat] }) as MapglObj)
        setReady(true)
        // MapGL при ключе без сервиса «MapGL JS API» не всегда бросает исключение —
        // он рисует заглушку в контейнере. Детектируем её и переходим в фолбэк.
        window.setTimeout(() => {
          if (!dead && (containerRef.current?.innerText ?? '').includes('MapGL key is invalid')) {
            setMapRejected(true)
          }
        }, 3500)
      })
      .catch(() => {
        if (!dead) setError('sdk_failed')
      })
    return () => {
      dead = true
      try {
        mapRef.current?.destroy?.()
      } catch {
        /* карта уже уничтожена */
      }
      mapRef.current = null
      drawnRef.current = []
      sdkPromise = null
    }
  }, [key, drawLine])

  /** Запрос обстановки: вариант A — полный рейс, B — Абинск → Крымск. */
  const checkSituation = useCallback(async () => {
    if (checking) return
    setChecking(true)
    setWarn(null)
    clearRouteArt()
    const pts =
      shortRoute
        ? [
            [LOADING_POINT.lon, LOADING_POINT.lat],
            [KRIMSK.lon, KRIMSK.lat],
          ]
        : [
            [LOADING_POINT.lon, LOADING_POINT.lat],
            [UNLOADING_POINT.lon, UNLOADING_POINT.lat],
          ]
    try {
      const r = await fetch('/api/2gis/routing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points: pts,
          transport: 'truck',
          traffic_mode: 'jam',
          output: 'detailed',
          alternative: 1,
          truck_params: { mass: 18000, height: 3.5, width: 2.55, length: 9 },
        }),
      })
      const data = (await r.json()) as RoutingResp
      // DEBUG: проверить, что реально считает работающий бандл
      console.log('[gis2-debug] status=', data.status, 'result=', (data.result ?? []).length, 'err=', data.error)
      setRes(data)
      setResMeta({ latencyMs: data.meta?.latencyMs, cached: data.meta?.cached })

      const variants = extractVariants(data)
      if (variants.length > 0) {
        const best = variants[0]
        // Перемаршрутизация: сравнение с базовой ETA первой проверки.
        if (baselineRef.current !== null) {
          const deltaMin = Math.round((best.durationS - baselineRef.current) / 60)
          if (deltaMin >= 5) {
            const altGain = variants.length > 1 ? Math.round((best.durationS - variants[1].durationS) / 60) : 0
            setWarn(
              `Обстановка изменилась: ETA +${deltaMin} мин к базовой.` +
                (altGain > 0 ? ` Альтернативный маршрут быстрее на ${altGain} мин.` : ' Альтернативы не дают выигрыша.'),
            )
          } else if (deltaMin <= -3) {
            setWarn(`Обстановка улучшилась: ETA ${Math.abs(deltaMin)} мин быстрее базовой.`)
          }
        } else {
          baselineRef.current = best.durationS
        }

        // Проблемные участки: собираем геометрию 2ГИС по цветам сегментов
        // (на MapGL — линиями, в фолбэке — SVG-схемой).
        const collected: Array<{ coords: [number, number][]; color: string }> = []
        for (const m of data.result?.[0]?.maneuvers ?? []) {
          for (const g of m.outcoming_path?.geometry ?? []) {
            if (!g.selection || !g.color) continue
            const coords = parseWktLine(g.selection)
            if (coords.length < 2) continue
            collected.push({ coords, color: g.color })
          }
        }
        setSegs(collected)
        const map = mapRef.current
        if (map && window.mapgl && !mapRejected) {
          for (const s of collected) {
            drawLine(map, s.coords, COLORS[s.color] ?? COLORS['ignore'], s.color === 'slow' ? 6 : 4)
          }
        }
      }
    } catch {
      setRes({ error: 'network', message: 'Не удалось связаться с сервером демо' })
    } finally {
      setChecking(false)
    }
  }, [checking, shortRoute, clearRouteArt, drawLine])

  const variants = res ? extractVariants(res) : []
  // DEBUG: что видит рендер
  console.log('[gis2-render] variants=', variants.length, 'segs=', segs.length, 'resStatus=', res?.status, 'resErr=', res?.error)

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      {/* карта 2ГИС */}
      <div ref={containerRef} className="absolute inset-0" aria-label="Карта 2ГИС со слоем пробок" />

      {/* шапка поверх карты */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-[#101E2E]/95 backdrop-blur px-4 pt-2 pb-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setView('map')} aria-label="Назад" className="text-white/70 hover:text-white">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <div className="flex-1">
            <div className="text-white font-bold text-[17px]">2ГИС · обстановка на дорогах</div>
            <div className="text-[11px] text-white/50">
              MapGL + пробки (обновление каждую минуту) · рейс Z-1067, А-146
            </div>
          </div>
          <MapPin className="h-5 w-5 text-[#F97316]" />
        </div>
      </div>

      {/* нижняя панель управления */}
      <div className="absolute bottom-3 left-3 right-3 z-10 space-y-2">
        {warn && (
          <div className="bg-[#451A03]/95 border border-[#F97316] text-[#FED7AA] rounded-2xl px-4 py-3 text-[13px] flex items-start gap-2 shadow-xl">
            <TriangleAlert className="h-5 w-5 text-[#F97316] shrink-0 mt-0.5" />
            <span>{warn}</span>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.35)] border border-[#E2E8F0] px-4 py-3 space-y-3 max-h-[46%] overflow-y-auto">
          {key === null ? (
            <div className="text-[13px] text-[#64748B]">Загружаем конфигурацию карты…</div>
          ) : key === '' ? (
            <div className="text-[13px] text-[#334155] space-y-1">
              <div className="font-semibold text-[#0F172A]">Нужен ключ 2ГИС</div>
              <div className="text-[#64748B]">
                Токен (демо-ключ Platform Manager с сервисами MapGL JS API и Routing API)
                записывается в <code className="bg-[#F1F5F9] px-1 rounded">.env</code> (в git не попадает)
                в переменную <code className="bg-[#F1F5F9] px-1 rounded">2GIS_API_KEY</code> — вкладка
                подхватит его без правок кода.
              </div>
            </div>
          ) : (
            <>
              {(error === 'sdk_failed' || mapRejected) && (
                <div className="text-[12px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-3 py-2 space-y-1">
                  <div className="font-semibold">Слой MapGL недоступен для этого ключа — включён режим без карты 2ГИС</div>
                  <div className="text-[#A16207]">
                    Routing API ключ принимает (серверные тесты OK), но сервис «MapGL JS API» для него
                    не включён в Platform Manager (или ключ привязан к другим доменам). Включите MapGL JS API
                    для ключа — вкладка оживёт сама, без правок кода. Ниже проверка обстановки работает:
                    схема участков строится по реальной геометрии Routing API.
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-[13px] text-[#334155] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={shortRoute}
                    onChange={(e) => setShortRoute(e.target.checked)}
                    className="accent-[#F97316] h-4 w-4"
                  />
                  Короткий тест: Абинск → Крымск (~15 км; лимит демо-ключа 50 км)
                </label>
              </div>

              <button
                onClick={checkSituation}
                disabled={checking || (!ready && !mapRejected && error === null)}
                className="w-full bg-[#F97316] disabled:bg-[#FDBA74] text-white font-semibold text-[14px] rounded-xl px-4 py-2.5 flex items-center justify-center gap-2"
              >
                {checking ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}
                {checking ? 'Запрашиваем Routing API…' : 'Проверить обстановку (truck, пробки)'}
              </button>

              {!ready && !error && <div className="text-[12px] text-[#64748B]">Инициализация карты 2ГИС…</div>}

              {res && !res.error && res.status !== 'OK' && (
                <div className="text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-xl px-3 py-2">
                  Routing API: status {res.status || '—'}
                  {res.message ? ` — ${res.message}` : ''}
                  {res.status === 'ROUTE_NOT_FOUND' ? '' : ' (для демо-ключа расстояние между точками ограничено 50 км)'}
                </div>
              )}

              {variants.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[12px] text-[#64748B]">
                    Вариантов: {variants.length} · отклик {resMeta?.latencyMs ?? '—'} мс
                    {resMeta?.cached ? ' · из кеша' : ''}
                  </div>
                  {variants.map((v, i) => (
                    <div
                      key={v.id}
                      className={`rounded-xl border px-3 py-2.5 text-[13px] ${
                        i === 0 ? 'border-[#F97316] bg-[#FFF7ED]' : 'border-[#E2E8F0] bg-white'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-[#0F172A]">
                          {i === 0 ? 'Основной' : 'Альтернатива'} · {Math.round(v.distanceM / 1000)} км
                        </span>
                        <span className="font-bold text-[#0F172A] tabular-nums">
                          {Math.floor(v.durationS / 60)} мин
                        </span>
                      </div>
                      <div className="text-[11px] text-[#64748B] mt-0.5">
                        {v.algorithm} · участки:{' '}
                        <span className="text-[#22C55E] font-semibold">{v.fastSegs} быстро</span>{' '}
                        <span className="text-[#CA8A04] font-semibold">{v.normalSegs} средне</span>{' '}
                        <span className="text-[#EF4444] font-semibold">{v.slowSegs} проблемных</span>
                      </div>
                    </div>
                  ))}
                  <div className="text-[11px] text-[#64748B] leading-relaxed">
                    Проблемные участки (slow) подсвечены красным по геометрии 2ГИС (на MapGL — линиями на карте,
                    в режиме без карты — схемой ниже). Повторный запрос — сравнение ETA с базой:
                    ≥ +5 мин → предупреждение о перемаршрутизации.
                  </div>
                </div>
              )}

              {segs.length > 0 && <RouteStrip segs={segs} />}

              {res?.error === 'no_key' && (
                <div className="text-[12px] text-[#B91C1C]">
                  Сервер не видит 2GIS_API_KEY — добавьте ключ в .env и перезапустите dev-сервер.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Извлечение вариантов из ответа 7.0.0 (detailed): сумма maneuvers + счётчик цветов. */
function extractVariants(data: RoutingResp): VariantInfo[] {
  const out: VariantInfo[] = []
  const results = data.result ?? []
  for (const r of results) {
    let distanceM = 0
    let durationS = 0
    let slow = 0
    let normal = 0
    let fast = 0
    for (const m of r.maneuvers ?? []) {
      distanceM += m.outcoming_path?.distance ?? 0
      durationS += m.outcoming_path?.duration ?? 0
      for (const g of m.outcoming_path?.geometry ?? []) {
        if (g.color === 'slow') slow++
        else if (g.color === 'normal') normal++
        else if (g.color === 'fast') fast++
      }
    }
    out.push({
      id: r.id ?? String(out.length),
      distanceM,
      durationS,
      algorithm: r.algorithm ?? '—',
      slowSegs: slow,
      normalSegs: normal,
      fastSegs: fast,
    })
  }
  out.sort((a, b) => a.durationS - b.durationS)
  return out
}

/**
 * SVG-схема маршрута по геометрии Routing API 2ГИС — фолбэк, когда слой MapGL
 * недоступен для ключа (сервис MapGL JS API не включён). Цвет линии = color
 * сегмента 2ГИС (fast/normal/slow), проблемные участки толще и красные.
 */
function RouteStrip({ segs }: { segs: Array<{ coords: [number, number][]; color: string }> }) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const s of segs) {
    for (const [lon, lat] of s.coords) {
      if (lon < minX) minX = lon
      if (lon > maxX) maxX = lon
      if (lat < minY) minY = lat
      if (lat > maxY) maxY = lat
    }
  }
  if (!Number.isFinite(minX) || maxX - minX < 1e-6 || maxY - minY < 1e-6) return null
  const W = 360
  const pad = 8
  const kx = (W - pad * 2) / (maxX - minX)
  const H = Math.max(90, Math.min(190, (maxY - minY) * kx + pad * 2))
  const ky = (H - pad * 2) / (maxY - minY)
  const px = (lon: number) => pad + (lon - minX) * kx
  const py = (lat: number) => H - pad - (lat - minY) * ky
  const slow = segs.filter((s) => s.color === 'slow').length
  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Схема маршрута по геометрии 2ГИС">
        {segs.map((s, i) => (
          <polyline
            key={i}
            points={s.coords.map(([lon, lat]) => `${px(lon).toFixed(1)},${py(lat).toFixed(1)}`).join(' ')}
            fill="none"
            stroke={COLORS[s.color] ?? COLORS['ignore']}
            strokeWidth={s.color === 'slow' ? 7 : 5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <div className="text-[11px] text-[#64748B] px-1 pt-1">
        Схема маршрута по геометрии Routing API 2ГИС · красным — проблемные участки ({slow})
      </div>
    </div>
  )
}
