'use client'

/**
 * Экран «Карта» (по мокапам 1, 2 и 4): карта — всегда первый экран,
 * баннер манёвра, знак лимита скорости, очередь связи, кнопка «Пометка»
 * (3-шаговый мастер), панель данных рейса внизу → открывает дашборд рейса.
 * Базовая карта: OSM/CARTO raster — без Yandex API (ограничение лицензии).
 */

import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GeoJSONSource, Map as MlMap, Marker as MlMarker } from 'maplibre-gl'
import {
  ArrowUp,
  ChevronRight,
  Construction,
  CornerUpLeft,
  CornerUpRight,
  Crosshair,
  Flag,
  Search,
  Shield,
  Ban,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
  Pin,
} from 'lucide-react'
import { useAzmz } from '@/lib/store'
import { ConnectionChip, OfflineHint } from '@/components/azmz/connection-chip'
import { MARK_CATEGORIES, TTL_OPTIONS } from '@/lib/rules'
import {
  CONGESTION,
  DEMO_STREETS,
  MANEUVERS,
  pointAtFraction,
  routeLengthM,
  sliceFraction,
} from '@/lib/demo/route-data'
import { fmtClock, fmtKm } from '@/lib/format'

const DARK_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark'

const FALLBACK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#15202E' } }],
}

type LatLng = { lng: number; lat: number }

export function MapScreen() {
  const trip = useAzmz((s) => s.trip)
  const points = useAzmz((s) => s.points)
  const marks = useAzmz((s) => s.marks)
  const pendingMarks = useAzmz((s) => s.pendingMarks)
  const simF = useAzmz((s) => s.simProgressF)
  const simRunning = useAzmz((s) => s.simRunning)
  const simSpeed = useAzmz((s) => s.simSpeedKmh)
  const wizard = useAzmz((s) => s.wizard)
  const setView = useAzmz((s) => s.setView)
  const updateWizard = useAzmz((s) => s.updateWizard)
  const setEventDialog = useAzmz((s) => s.setEventDialog)
  const showToast = useAzmz((s) => s.showToast)

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const mlRef = useRef<typeof import('maplibre-gl') | null>(null)
  const truckRef = useRef<MlMarker | null>(null)
  const truckInnerRef = useRef<HTMLDivElement | null>(null)
  const stopMarkersRef = useRef<MlMarker[]>([])
  const wizMarkersRef = useRef<MlMarker[]>([])
  const followRef = useRef(true)
  const simFRef = useRef(simF)
  simFRef.current = simF
  const [follow, setFollow] = useState(true)
  const [sound, setSound] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [ready, setReady] = useState(false)

  // --- инициализация карты (клиент-only) ------------------------------------
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ml = await import('maplibre-gl')
      // Turbopack ломает относительный URL воркера — берём из public/ (same-origin)
      try {
        ;(ml as { config?: { WORKER_URL?: string } }).config.WORKER_URL = '/maplibre-gl-worker.mjs'
      } catch {}
      if (cancelled || !containerRef.current || mapRef.current) return
      mlRef.current = ml
      const map = new ml.Map({
        container: containerRef.current,
        style: DARK_STYLE_URL,
        center: [37.768, 44.726],
        zoom: 13.2,
        pitch: 0,
        attributionControl: false,
        dragRotate: true,
        fadeDuration: 120,
      })
      map.on('error', (e: { error?: { message?: string } }) => {
        // базовая карта могла не загрузиться (сеть) — маршрут и пометки всё равно отрисуются на фоне
        const msg = e?.error?.message ?? ''
        if (msg.includes('style') && map.isStyleLoaded() === false) {
          map.setStyle(FALLBACK_STYLE)
        }
      })
      mapRef.current = map
      mapGlobalRef.current = map
      ;(window as unknown as { __azmzMap?: MlMap }).__azmzMap = map
      map.on('load', () => setReady(true))
      map.on('click', (e) => {
        const w = useAzmz.getState().wizard
        if (w.step === 1 || w.step === 2) useAzmz.getState().wizardTapPoint(e.lngLat.lng, e.lngLat.lat)
      })
    })()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      mapGlobalRef.current = null
      truckRef.current = null
    }
  }, [])

  // --- слои маршрута и пометок ------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    const ml = mlRef.current
    if (!ready || !map || !ml || !trip) return
    if (!map.getSource('route')) {
      map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: JSON.parse(trip.routeGeoJson ?? '{"type":"LineString","coordinates":[]}') } })
      map.addSource('congestion', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: sliceFraction(CONGESTION[0], CONGESTION[1]) } } })
      map.addSource('marks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#5A3608', 'line-width': 10 } })
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#F97316', 'line-width': 6 } })
      map.addLayer({ id: 'congestion-line', type: 'line', source: 'congestion', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#EF4444', 'line-width': 6 } })
      map.addLayer({
        id: 'mark-line',
        type: 'line',
        source: 'marks',
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 11, 'line-opacity': 0.72 },
      })
      map.addLayer({
        id: 'mark-dot',
        type: 'circle',
        source: 'marks',
        paint: { 'circle-radius': 6.5, 'circle-color': ['get', 'color'], 'circle-stroke-width': 2.5, 'circle-stroke-color': '#FFFFFF' },
      })
    }

    // камера стартует на грузовике (навигационный вид, как в мокапе 4)
    const p = pointAtFraction(simFRef.current)
    map.jumpTo({ center: [p.lng, p.lat], bearing: p.bearing, pitch: 55, zoom: 15.4 })
  }, [ready, trip])

  // грузовик и движение камеры
  useEffect(() => {
    const map = mapRef.current
    const ml = mlRef.current
    if (!ready || !map || !ml || truckRef.current) return
    const el = document.createElement('div')
    el.className = 'azmz-truck'
    el.innerHTML = `
      <div class="azmz-truck-inner">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18h-5"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>
      </div>`
    truckInnerRef.current = el.querySelector('.azmz-truck-inner')
    const p = pointAtFraction(simFRef.current)
    truckRef.current = new ml.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map)
  }, [ready])

  // движение камеры и грузовика
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !truckRef.current) return
    const p = pointAtFraction(simF)
    truckRef.current.setLngLat([p.lng, p.lat])
    if (truckInnerRef.current) truckInnerRef.current.style.transform = `rotate(${p.bearing}deg)`
    if (followRef.current) {
      map.easeTo({ center: [p.lng, p.lat], bearing: p.bearing, pitch: 55, zoom: 15.4, duration: 950, easing: (t) => t })
    }
  }, [simF, ready])

  // пометки → слой
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !map.getSource('marks')) return
    const all = [...pendingMarks, ...marks]
    const feats = all.map((m) => ({
      type: 'Feature' as const,
      properties: { color: MARK_CATEGORIES[m.category]?.hex ?? '#64748B', category: m.category },
      geometry: JSON.parse(m.geometry),
    }))
    ;(map.getSource('marks') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats })
  }, [marks, pendingMarks, ready])

  // точки рейса → DOM-маркеры
  useEffect(() => {
    const map = mapRef.current
    const ml = mlRef.current
    if (!ready || !map || !ml) return
    stopMarkersRef.current.forEach((m) => m.remove())
    stopMarkersRef.current = []
    for (const pt of points) {
      const el = document.createElement('div')
      const color = pt.kind === 'loading' ? '#3B82F6' : pt.kind === 'unloading' ? '#EF4444' : '#64748B'
      const label = pt.kind === 'loading' ? 'Погрузка' : pt.kind === 'unloading' ? 'Выгрузка' : 'Точка'
      el.className = 'azmz-stop'
      el.innerHTML = `
        <div class="azmz-stop-label" style="background:${color}">${label}</div>
        <div class="azmz-stop-pin" style="background:${color}"></div>`
      stopMarkersRef.current.push(new ml.Marker({ element: el }).setLngLat([pt.lon, pt.lat]).addTo(map))
    }
  }, [points, ready])

  // мастер пометок: маркеры A/B + предпросмотр участка
  useEffect(() => {
    const map = mapRef.current
    const ml = mlRef.current
    if (!ready || !map || !ml) return
    wizMarkersRef.current.forEach((m) => m.remove())
    wizMarkersRef.current = []
    if (map.getLayer('wiz-line')) map.removeLayer('wiz-line')
    if (map.getSource('wiz')) map.removeSource('wiz')

    if (wizard.step === 0 || !wizard.start) return
    const mkAt = (p: LatLng, letter: string) => {
      const el = document.createElement('div')
      el.className = 'azmz-wiz-pin'
      el.textContent = letter
      return new ml.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map)
    }
    wizMarkersRef.current.push(mkAt(wizard.start, 'A'))
    if (wizard.end) {
      wizMarkersRef.current.push(mkAt(wizard.end, 'B'))
      map.addSource('wiz', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [wizard.start.lng, wizard.start.lat],
              [wizard.end.lng, wizard.end.lat],
            ],
          },
        },
      })
      map.addLayer({
        id: 'wiz-line',
        type: 'line',
        source: 'wiz',
        paint: { 'line-color': '#FACC15', 'line-width': 7, 'line-opacity': 0.85, 'line-dasharray': [1.5, 1.2] },
      })
    }
  }, [wizard, ready])

  const totalM = useMemo(() => routeLengthM(), [])

  // следующий манёвр
  const nextManeuver = useMemo(() => {
    const m = MANEUVERS.find((mm) => mm.f > simF + 1e-9)
    return m ?? null
  }, [simF])
  const distToManeuver = nextManeuver ? (nextManeuver.f - simF) * totalM : 0
  const arrived = simF >= MANEUVERS[MANEUVERS.length - 1].f

  const remainingM = trip ? (trip.routeDistanceM ?? 200_000) * (1 - simF) : 123_000
  const etaClock = trip ? fmtClock(trip.plannedFinishAt) : '—'
  const tripCode = trip?.tripCode ?? 'Z-1067'

  const maneuverIcon = (type: string, cls: string) => {
    if (type === 'left') return <CornerUpLeft className={cls} />
    if (type === 'right') return <CornerUpRight className={cls} />
    if (type === 'arrive') return <Flag className={cls} />
    return <ArrowUp className={cls} />
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0E1826]">
      {/* maplibre вешает .maplibregl-map { position: relative } — поэтому размеры через w/h-full, не inset */}
      <div ref={containerRef} className="w-full h-full" />

      <style jsx global>{`
        .azmz-truck-inner {
          width: 38px;
          height: 38px;
          background: #f97316;
          border: 2.5px solid #ffffff;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.55);
        }
        .azmz-stop-label {
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 8px;
          white-space: nowrap;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        }
        .azmz-stop-pin {
          width: 14px;
          height: 14px;
          border: 2.5px solid #fff;
          border-radius: 999px;
          margin: 4px auto 0;
        }
        .azmz-wiz-pin {
          width: 26px;
          height: 26px;
          background: #facc15;
          color: #15202b;
          font-weight: 800;
          font-size: 13px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2.5px solid #fff;
          border-radius: 999px;
          box-shadow: 0 3px 10px rgba(0, 0, 0, 0.5);
        }
      `}</style>

      {/* --- верхние плашки ----------------------------------------------------- */}
      {!wizard.step || wizard.step === 3 ? (
        <div className="absolute top-3 left-3 right-3 z-20 flex flex-col gap-2 pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
            <ConnectionChip />
            <button
              onClick={() => setSearchOpen(true)}
              className="ml-auto h-8 w-8 rounded-full bg-[#101E2E]/90 border border-white/15 text-white flex items-center justify-center"
              aria-label="Поиск"
            >
              <Search className="h-4 w-4" />
            </button>
          </div>
          <OfflineHint />

          {/* баннер манёвра (мокап 1) */}
          {nextManeuver && !arrived && (
            <button onClick={() => setFollow((v) => !v)} className="pointer-events-auto text-left bg-[#2563EB] text-white rounded-2xl px-3 py-2.5 flex items-center gap-3 shadow-xl">
              {maneuverIcon(nextManeuver.type, 'h-7 w-7 shrink-0')}
              <div className="min-w-0">
                <div className="text-lg font-bold leading-tight tabular-nums">
                  {distToManeuver >= 950 ? `${(distToManeuver / 1000).toFixed(1).replace('.', ',')} км` : `${Math.max(0, Math.round(distToManeuver / 10) * 10)} м`}
                </div>
                <div className="text-[13px] leading-snug truncate">
                  {nextManeuver.type === 'left' && <>поверните налево на {nextManeuver.street}</>}
                  {nextManeuver.type === 'right' && <>поверните направо на {nextManeuver.street}</>}
                  {nextManeuver.type === 'straight' && <>продолжайте прямо, {nextManeuver.street}</>}
                  {nextManeuver.type === 'arrive' && <>финиш: {nextManeuver.street}</>}
                </div>
              </div>
            </button>
          )}

          {/* смарт-карточка прибытия (мокап 4) */}
          {arrived && (
            <div className="pointer-events-auto bg-white text-[#15202B] rounded-2xl px-3 py-2.5 flex items-center gap-3 shadow-xl border border-black/5">
              <div className="flex-1">
                <div className="text-[13px] font-semibold">Вы прибыли в точку выгрузки</div>
                <div className="text-[11px] text-[#64748B]">Событие можно отметить вручную</div>
              </div>
              <button onClick={() => setEventDialog(true, 'ARRIVAL_UNLOADING')} className="bg-[#F97316] text-white text-[13px] font-bold rounded-xl px-4 h-9">
                Отметить
              </button>
            </div>
          )}
        </div>
      ) : (
        /* подсказка мастера (мокап 2, «2 из 3») */
        <div className="absolute top-3 left-3 right-3 z-30 flex flex-col gap-2">
          <div className="bg-[#101E2E]/95 text-white rounded-2xl px-4 py-3 flex items-center gap-3 shadow-xl">
            <Pin className="h-5 w-5 text-[#FACC15] shrink-0" />
            <div className="flex-1">
              <div className="text-[13px] font-semibold">
                {wizard.step === 1 ? 'Укажите начало участка' : 'Укажите конец участка'}
              </div>
              <div className="text-[11px] text-white/60">{wizard.step} из 3 · коснитесь карты</div>
            </div>
            <button
              onClick={() => useAzmz.getState().cancelWizard()}
              className="text-white/70 hover:text-white"
              aria-label="Отмена"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* --- правые кнопки ------------------------------------------------------ */}
      {wizard.step === 0 && (
        <div className="absolute right-3 top-28 z-20 flex flex-col gap-2">
          <MapBtn label="Приблизить" onClick={() => mapRef.current?.zoomIn()}>
            <ZoomIn className="h-5 w-5" />
          </MapBtn>
          <MapBtn label="Отдалить" onClick={() => mapRef.current?.zoomOut()}>
            <ZoomOut className="h-5 w-5" />
          </MapBtn>
          <MapBtn
            label="Центрировать"
            active={follow}
            onClick={() => {
              setFollow((v) => {
                followRef.current = !v
                return !v
              })
            }}
          >
            <Crosshair className="h-5 w-5" />
          </MapBtn>
          <MapBtn
            label="Звук"
            active={sound}
            onClick={() => {
              setSound((v) => {
                showToast(!v ? 'Голосовые подсказки включены' : 'Голосовые подсказки выключены')
                return !v
              })
            }}
          >
            {sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </MapBtn>
          <button
            onClick={() => updateWizard({ step: 1, start: undefined, end: undefined })}
            className="h-11 bg-[#F97316] text-white rounded-xl shadow-lg flex items-center gap-1.5 px-3 text-[13px] font-bold"
          >
            <Pin className="h-4.5 w-4.5" />
            Пометка
          </button>
        </div>
      )}

      {/* --- знак лимита и скорость --------------------------------------------- */}
      <div className="absolute left-3 bottom-[104px] z-20 flex flex-col items-center gap-1.5">
        <div className="h-12 w-12 rounded-full bg-white border-[5px] border-[#DC2626] flex items-center justify-center shadow-lg">
          <span className="text-[#15202B] font-black text-lg leading-none">60</span>
        </div>
        <div className="bg-[#101E2E]/90 text-white text-[12px] font-bold rounded-lg px-2 py-0.5 tabular-nums shadow">
          {Math.round(simRunning ? simSpeed : 0)}
        </div>
      </div>

      {/* --- панель данных рейса (мокап 1) -------------------------------------- */}
      <button
        onClick={() => setView('trip')}
        className="absolute bottom-0 left-0 right-0 z-20 bg-[#101E2E] text-white px-4 py-3 flex items-end gap-4 text-left"
        aria-label="Открыть дашборд рейса"
      >
        <div>
          <div className="text-xl font-bold leading-none tabular-nums">{fmtKm(remainingM)}</div>
          <div className="text-[10px] text-white/50 mt-1">Осталось</div>
        </div>
        <div>
          <div className="text-xl font-bold leading-none tabular-nums">{etaClock}</div>
          <div className="text-[10px] text-white/50 mt-1">Прибытие</div>
        </div>
        <div>
          <div className="text-xl font-bold leading-none tabular-nums">2 ч 30 мин</div>
          <div className="text-[10px] text-white/50 mt-1">В пути</div>
        </div>
        <div className="ml-auto flex items-center gap-1 text-[#F97316] font-bold text-sm">
          {tripCode}
          <ChevronRight className="h-4 w-4" />
        </div>
      </button>

      {/* --- поиск (офлайн-справочник улиц) -------------------------------------- */}
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}

      {/* --- шаг 3 мастера: форма публикации (мокап 2) --------------------------- */}
      {wizard.step === 3 && <WizardSheet />}
    </div>
  )
}

function MapBtn({
  children,
  onClick,
  label,
  active,
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`h-10 w-10 rounded-xl border flex items-center justify-center shadow-lg transition-colors ${
        active ? 'bg-[#F97316] border-[#F97316] text-white' : 'bg-[#101E2E]/90 border-white/15 text-white'
      }`}
    >
      {children}
    </button>
  )
}

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const list = DEMO_STREETS.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="absolute inset-0 z-50 bg-[#0B1622]/96 backdrop-blur-sm flex flex-col">
      <div className="p-4 pb-2 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 bg-white rounded-xl px-3 h-11">
          <Search className="h-4.5 w-4.5 text-[#64748B]" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Улица, объект…"
            className="flex-1 outline-none text-[15px] bg-transparent"
          />
          <button onClick={onClose} aria-label="Закрыть поиск">
            <X className="h-5 w-5 text-[#64748B]" />
          </button>
        </div>
      </div>
      <div className="px-4 text-[11px] text-white/40 mb-1">Офлайн-справочник · PMTiles z14–z17</div>
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {list.map((s) => (
          <button
            key={s.name}
            onClick={() => {
              const map = mapGlobalRef.current
              map?.flyTo({ center: [s.lon, s.lat], zoom: 15.5, duration: 1200 })
              onClose()
            }}
            className="w-full text-left flex items-center gap-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-3 py-3 mb-2"
          >
            <Pin className="h-4 w-4 text-[#F97316]" />
            <span className="text-white text-[14px]">{s.name}</span>
          </button>
        ))}
        {list.length === 0 && <div className="text-white/50 text-sm py-6 text-center">Ничего не найдено</div>}
      </div>
    </div>
  )
}

// ссылка на карту для оверлеев (избегаем прокидки props через всё дерево)
export const mapGlobalRef: { current: MlMap | null } = { current: null }

function WizardSheet() {
  const wizard = useAzmz((s) => s.wizard)
  const updateWizard = useAzmz((s) => s.updateWizard)
  const publishMarkFromWizard = useAzmz((s) => s.publishMarkFromWizard)
  const cancelWizard = useAzmz((s) => s.cancelWizard)
  const offlineMode = useAzmz((s) => s.offlineMode)

  const catIcon = (c: string, cls: string) => {
    if (c === 'POTHOLE') return <TriangleAlert className={cls} />
    if (c === 'ROADWORKS') return <Construction className={cls} />
    if (c === 'POLICE') return <Shield className={cls} />
    if (c === 'ACCIDENT') return <TriangleAlert className={cls} />
    return <Ban className={cls} />
  }

  const lengthHint = wizard.start && wizard.end ? `${Math.round(routeLengthM() * 0 + distM(wizard.start, wizard.end))} м` : ''

  return (
    <div className="absolute bottom-0 left-0 right-0 z-40 bg-white rounded-t-3xl shadow-2xl px-4 pt-3 pb-5">
      <div className="w-10 h-1 bg-[#CBD5E1] rounded-full mx-auto mb-3" />
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[17px] font-bold text-[#15202B]">Новая пометка</div>
        <div className="text-[11px] text-[#64748B]">
          Участок {lengthHint} · 3 из 3
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-3">
        {Object.entries(MARK_CATEGORIES).map(([code, meta]) => {
          const sel = wizard.category === code
          return (
            <button
              key={code}
              onClick={() => updateWizard({ category: code })}
              className={`flex items-center gap-1.5 rounded-full px-3 h-9 text-[13px] font-semibold border transition-colors ${
                sel ? 'bg-[#15202B] text-white border-[#15202B]' : 'bg-white text-[#15202B] border-[#E2E8F0]'
              }`}
              style={sel ? { background: '#15202B' } : undefined}
            >
              {catIcon(code, 'h-4 w-4')}
              {meta.title}
            </button>
          )
        })}
      </div>

      <div className="text-[12px] text-[#64748B] mb-1.5">На сколько</div>
      <div className="flex gap-1.5 mb-3">
        {TTL_OPTIONS.map((t) => {
          const sel = wizard.ttlHours === t.hours
          return (
            <button
              key={t.hours}
              onClick={() => updateWizard({ ttlHours: t.hours })}
              className={`rounded-full px-3.5 h-8 text-[13px] font-semibold border ${
                sel ? 'bg-[#F97316] text-white border-[#F97316]' : 'bg-white text-[#15202B] border-[#E2E8F0]'
              }`}
            >
              {t.title}
            </button>
          )
        })}
      </div>

      <input
        value={wizard.comment}
        onChange={(e) => updateWizard({ comment: e.target.value })}
        placeholder="Комментарий (необязательно)"
        className="w-full h-11 rounded-xl border border-[#E2E8F0] px-3 text-[14px] outline-none focus:border-[#F97316] mb-4"
      />

      <button
        onClick={publishMarkFromWizard}
        className="w-full h-12 rounded-xl bg-[#15202B] text-white font-bold text-[15px] mb-2 active:scale-[0.99] transition-transform"
      >
        Опубликовать
      </button>
      <div className="flex items-center justify-between">
        <button onClick={cancelWizard} className="text-[14px] text-[#64748B] font-medium py-1">
          Отмена
        </button>
        <div className="text-[11px] text-[#94A3B8] max-w-[220px] text-right">
          {offlineMode ? 'Уйдёт в очередь — уйдёт при появлении сети' : 'Сохраняется локально, отправка в фоне'}
        </div>
      </div>
    </div>
  )
}

function distM(a: LatLng, b: LatLng): number {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}
