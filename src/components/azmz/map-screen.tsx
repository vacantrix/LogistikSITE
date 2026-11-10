'use client'

/**
 * Экран «Карта» (по мокапам 1, 2 и 4): карта — всегда первый экран,
 * баннер манёвра, знак лимита скорости, очередь связи, кнопка «Пометка»
 * (3-шаговый мастер), панель данных рейса внизу → открывает дашборд рейса.
 * Базовая карта: светлый OSM-стиль Positron (OpenFreeMap) — без Yandex API
 * (ограничение лицензии). Линия маршрута и сегменты пробок идут по дорогам.
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
  Layers,
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
import { MARK_CATEGORIES, TRAFFIC_LEVELS, trafficScoreColor, TTL_OPTIONS } from '@/lib/rules'
import {
  DEMO_STREETS,
  MANEUVERS,
  pointAtFraction,
  routeLengthM,
} from '@/lib/demo/route-data'
import { fmtClock, fmtKm } from '@/lib/format'

/**
 * Стиль идёт через НАШ сервер (/api/mapstyle → /api/maptiles/…): браузер не
 * обращается к внешним tile-хостам напрямую — в закрытых/мобильных сетях
 * это было причиной «карта не отображается».
 */
const LIGHT_STYLE_URL = '/api/mapstyle'

const FALLBACK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#DCE5EE' } }],
}

type LatLng = { lng: number; lat: number }

export function MapScreen() {
  const trip = useAzmz((s) => s.trip)
  const points = useAzmz((s) => s.points)
  const marks = useAzmz((s) => s.marks)
  const pendingMarks = useAzmz((s) => s.pendingMarks)
  const traffic = useAzmz((s) => s.traffic)
  const view = useAzmz((s) => s.view)
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
  const retryedRef = useRef(false)
  const simFRef = useRef(simF)
  simFRef.current = simF
  const [follow, setFollow] = useState(true)
  const [sound, setSound] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  /** Эпоха экземпляра карты: инкремент на 'load' — все слои/маркеры пересоздаются вместе с картой (устойчиво к hot-reload и StrictMode). */
  const [mapEpoch, setMapEpoch] = useState(0)

  /** Переключение режима сопровождения: ref и state меняются синхронно. */
  const setFollowMode = (v: boolean) => {
    followRef.current = v
    setFollow(v)
  }

  // --- инициализация карты (клиент-only) ------------------------------------
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ml = await import('maplibre-gl')
      // Turbopack ломает относительный URL воркера — берём из public/ (same-origin)
      try {
        const cfg = (ml as { config?: { WORKER_URL?: string } }).config
        if (cfg) cfg.WORKER_URL = '/maplibre-gl-worker.mjs'
      } catch {}
      if (cancelled || !containerRef.current || mapRef.current) return
      mlRef.current = ml
      const map = new ml.Map({
        container: containerRef.current,
        style: LIGHT_STYLE_URL,
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
        if (map.isStyleLoaded() === false) {
          map.setStyle(FALLBACK_STYLE)
          // одна повторная попытка через 6 с: прокси/сеть могли моргнуть
          if (!retryedRef.current) {
            retryedRef.current = true
            setTimeout(() => {
              try {
                map.setStyle(LIGHT_STYLE_URL)
              } catch {}
            }, 6_000)
          }
        }
        if (msg) console.warn('[azmz-map]', msg)
      })
      mapRef.current = map
      mapGlobalRef.current = map
      ;(window as unknown as { __azmzMap?: MlMap }).__azmzMap = map
      map.on('load', () => setMapEpoch((v) => v + 1))
      map.on('click', (e) => {
        const w = useAzmz.getState().wizard
        if (w.step === 1 || w.step === 2) useAzmz.getState().wizardTapPoint(e.lngLat.lng, e.lngLat.lat)
      })
      // свободное перетягивание выключает сопровождение — вернуться по прицелу
      map.on('dragstart', () => setFollowMode(false))
    })()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      mapGlobalRef.current = null
      truckRef.current = null
    }
  }, [])

  // --- слои маршрута, трафика и пометок ----------------------------------------
  useEffect(() => {
    const map = mapRef.current
    const ml = mlRef.current
    if (!mapEpoch || !map || !ml || !trip) return
    if (!map.getSource('route')) {
      map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: JSON.parse(trip.routeGeoJson ?? '{"type":"LineString","coordinates":[]}') } })
      map.addSource('traffic', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('marks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': 10 } })
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#F97316', 'line-width': 6 } })
      // трафик (канал 3): цвет по уровню, толщина — маршрут/боковые улицы
      map.addLayer({
        id: 'traffic-casing',
        type: 'line',
        source: 'traffic',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#FFFFFF', 'line-width': 9, 'line-opacity': 0.95 },
      })
      map.addLayer({
        id: 'traffic-line',
        type: 'line',
        source: 'traffic',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] },
      })
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
  }, [mapEpoch, trip])

  // грузовик и движение камеры
  useEffect(() => {
    const map = mapRef.current
    const ml = mlRef.current
    if (!mapEpoch || !map || !ml || truckRef.current) return
    const el = document.createElement('div')
    el.className = 'azmz-truck'
    el.innerHTML = `
      <div class="azmz-truck-inner">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18h-5"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>
      </div>`
    truckInnerRef.current = el.querySelector('.azmz-truck-inner')
    const p = pointAtFraction(simFRef.current)
    truckRef.current = new ml.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map)
  }, [mapEpoch])

  // движение камеры и грузовика
  useEffect(() => {
    const map = mapRef.current
    if (!mapEpoch || !map || !truckRef.current) return
    const p = pointAtFraction(simF)
    truckRef.current.setLngLat([p.lng, p.lat])
    if (truckInnerRef.current) truckInnerRef.current.style.transform = `rotate(${p.bearing}deg)`
    if (followRef.current) {
      map.easeTo({ center: [p.lng, p.lat], bearing: p.bearing, pitch: 55, zoom: 15.4, duration: 950, easing: (t) => t })
    }
  }, [simF, mapEpoch])

  // пометки → слой
  useEffect(() => {
    const map = mapRef.current
    if (!mapEpoch || !map || !map.getSource('marks')) return
    const all = [...pendingMarks, ...marks]
    const feats = all.map((m) => ({
      type: 'Feature' as const,
      properties: { color: MARK_CATEGORIES[m.category]?.hex ?? '#64748B', category: m.category },
      geometry: JSON.parse(m.geometry),
    }))
    ;(map.getSource('marks') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats })
  }, [marks, pendingMarks, mapEpoch])

  // трафик → слой (канал 3): цвет по уровню, маршрут толще боковых улиц
  useEffect(() => {
    const map = mapRef.current
    if (!mapEpoch || !map || !map.getSource('traffic')) return
    const feats = (traffic?.segments ?? []).map((seg) => ({
      type: 'Feature' as const,
      properties: { color: TRAFFIC_LEVELS[seg.level]?.hex ?? '#22C55E', width: seg.onRoute ? 6.5 : 4.5 },
      geometry: JSON.parse(seg.geometry),
    }))
    ;(map.getSource('traffic') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats })
  }, [traffic, mapEpoch])

  // камера: шторка открыта → обзор маршрута; закрыта → навигация за грузовиком
  useEffect(() => {
    const map = mapRef.current
    if (!mapEpoch || !map || !trip) return
    if (view === 'map') {
      setFollowMode(true)
      const p = pointAtFraction(simFRef.current)
      map.easeTo({ center: [p.lng, p.lat], bearing: p.bearing, pitch: 55, zoom: 15.4, duration: 750 })
    } else {
      setFollowMode(false)
      const coords = (JSON.parse(trip.routeGeoJson ?? '{"type":"LineString","coordinates":[]}') as {
        coordinates: [number, number][]
      }).coordinates
      const lons = coords.map((c) => c[0])
      const lats = coords.map((c) => c[1])
      const bottomFrac = view === 'traffic' ? 0.62 : view === 'marks' ? 0.72 : view === 'settings' ? 0.86 : 0.8
      const h = map.getContainer().clientHeight
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: { top: 55, bottom: Math.round(h * bottomFrac), left: 26, right: 26 }, pitch: 0, bearing: 0, duration: 700 },
      )
    }
  }, [view, mapEpoch, trip])

  // точки рейса → DOM-маркеры
  useEffect(() => {
    const map = mapRef.current
    const ml = mlRef.current
    if (!mapEpoch || !map || !ml) return
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
  }, [points, mapEpoch])

  // мастер пометок: маркеры A/B + предпросмотр участка
  useEffect(() => {
    const map = mapRef.current
    const ml = mlRef.current
    if (!mapEpoch || !map || !ml) return
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
  }, [wizard, mapEpoch])

  const totalM = useMemo(() => routeLengthM(), [])

  const delayMin = traffic?.routeDelayMin ?? 0
  const etaMs = (trip?.plannedFinishAt ?? Date.now()) + delayMin * 60_000

  // следующий манёвр
  const nextManeuver = useMemo(() => {
    const m = MANEUVERS.find((mm) => mm.f > simF + 1e-9)
    return m ?? null
  }, [simF])
  const distToManeuver = nextManeuver ? (nextManeuver.f - simF) * totalM : 0
  const arrived = simF >= MANEUVERS[MANEUVERS.length - 1].f

  const remainingM = trip ? (trip.routeDistanceM ?? 200_000) * (1 - simF) : 123_000
  const etaClock = trip ? fmtClock(etaMs) : '—'
  const tripCode = trip?.tripCode ?? 'Z-1067'

  const maneuverIcon = (type: string, cls: string) => {
    if (type === 'left') return <CornerUpLeft className={cls} />
    if (type === 'right') return <CornerUpRight className={cls} />
    if (type === 'arrive') return <Flag className={cls} />
    return <ArrowUp className={cls} />
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#DCE5EE]">
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
        .azmz-legend-enter {
          animation: azmz-legend-in 0.18s ease-out;
        }
        @keyframes azmz-legend-in {
          from {
            opacity: 0;
            transform: translateX(8px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
      `}</style>

      {/* --- верхние плашки ----------------------------------------------------- */}
      {!wizard.step || wizard.step === 3 ? (
        <div className="absolute top-3 left-3 right-3 z-20 flex flex-col gap-2 pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto flex-wrap">
            <ConnectionChip />
            {traffic && (
              <button
                onClick={() => setView('traffic')}
                className="inline-flex items-center gap-1.5 bg-[#101E2E]/90 border border-white/15 text-white text-[11px] font-semibold rounded-full pl-2 pr-2.5 h-7 shadow"
                aria-label="Пробки"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: trafficScoreColor(traffic.score) }} />
                Пробки {traffic.score}
              </button>
            )}
            <button
              onClick={() => setSearchOpen(true)}
              className="ml-auto h-8 w-8 rounded-full bg-[#101E2E]/90 border border-white/15 text-white flex items-center justify-center"
              aria-label="Поиск"
            >
              <Search className="h-4 w-4" />
            </button>
          </div>
          <OfflineHint />

          {/* баннер манёвра (мокап 1); тап — пауза/возобновление сопровождения */}
          {nextManeuver && !arrived && (
            <button
              onClick={() => setFollowMode(!followRef.current)}
              className="pointer-events-auto text-left bg-[#2563EB] text-white rounded-2xl px-3 py-2.5 flex items-center gap-3 shadow-xl"
            >
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
            label="Вернуться к грузовику"
            active={follow}
            onClick={() => {
              setFollowMode(true)
              const p = pointAtFraction(simFRef.current)
              mapRef.current?.easeTo({ center: [p.lng, p.lat], bearing: p.bearing, pitch: 55, zoom: 15.4, duration: 750 })
            }}
          >
            <Crosshair className="h-5 w-5" />
          </MapBtn>
          <MapBtn label="Легенда карты" active={legendOpen} onClick={() => setLegendOpen((v) => !v)}>
            <Layers className="h-5 w-5" />
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
      {view === 'map' && (
        <div className="absolute left-3 bottom-[104px] z-20 flex flex-col items-center gap-1.5">
          <div className="h-12 w-12 rounded-full bg-white border-[5px] border-[#DC2626] flex items-center justify-center shadow-lg">
            <span className="text-[#15202B] font-black text-lg leading-none">60</span>
          </div>
          <div className="bg-[#101E2E]/90 text-white text-[12px] font-bold rounded-lg px-2 py-0.5 tabular-nums shadow">
            {Math.round(simRunning ? simSpeed : 0)}
          </div>
        </div>
      )}

      {/* --- панель данных рейса (мокап 1) — только когда карта «чистая» --------- */}
      {view === 'map' && (
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
            <div className="text-xl font-bold leading-none tabular-nums flex items-center gap-1.5">
              {etaClock}
              {delayMin > 0 && (
                <span className="text-[11px] font-semibold text-[#FACC15] leading-none">+{delayMin}</span>
              )}
            </div>
            <div className="text-[10px] text-white/50 mt-1">Прибытие{delayMin > 0 ? ' · пробки' : ''}</div>
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
      )}

      {/* --- поиск (офлайн-справочник улиц) -------------------------------------- */}
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}

      {/* --- легенда карты -------------------------------------------------------- */}
      {legendOpen && <MapLegend onClose={() => setLegendOpen(false)} />}

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
      title={label}
      className={`h-10 w-10 rounded-xl border flex items-center justify-center shadow-lg transition-colors ${
        active ? 'bg-[#F97316] border-[#F97316] text-white' : 'bg-[#101E2E]/90 border-white/15 text-white'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * Легенда карты (открывается кнопкой «Слои»): маршрут, точки рейса,
 * уровни пробок, категории пометок и назначение кнопок управления.
 */
function MapLegend({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute right-14 top-28 z-30 w-[254px] max-h-[58%] overflow-y-auto rounded-2xl bg-white border border-black/10 shadow-2xl p-3.5 pointer-events-auto azmz-legend-enter">
      <div className="flex items-center justify-between mb-2.5">
        <div className="text-[14px] font-bold text-[#15202B]">Легенда карты</div>
        <button onClick={onClose} aria-label="Закрыть легенду">
          <X className="h-4 w-4 text-[#64748B]" />
        </button>
      </div>

      <LegendBlock title="Маршрут рейса">
        <LegendLine swatch={<span className="h-[3px] w-6 rounded-full bg-[#F97316] inline-block" />} text="Маршрут Z-1067 (по дорогам)" />
        <LegendLine swatch={<span className="h-3.5 w-3.5 rounded-md bg-[#F97316] border-2 border-white inline-block" />} text="Ваш грузовик" />
        <LegendLine swatch={<span className="h-3 w-3 rounded-full bg-[#3B82F6] border-2 border-white inline-block" />} text="Погрузка" />
        <LegendLine swatch={<span className="h-3 w-3 rounded-full bg-[#EF4444] border-2 border-white inline-block" />} text="Выгрузка" />
        <LegendLine swatch={<span className="w-6 border-t-[3px] border-dashed border-[#FACC15] inline-block" />} text="Выбранный участок (пометка)" />
      </LegendBlock>

      <LegendBlock title="Пробки · обновление раз в минуту">
        {TRAFFIC_LEVELS.map((l) => (
          <LegendLine key={l.title} swatch={<span className="h-3 w-3 rounded-full inline-block" style={{ background: l.hex }} />} text={l.title} hint={l.speedHint} />
        ))}
      </LegendBlock>

      <LegendBlock title="Пометки водителей">
        {Object.entries(MARK_CATEGORIES).map(([code, meta]) => (
          <LegendLine key={code} swatch={<span className="h-3 w-3 rounded-full inline-block" style={{ background: meta.hex }} />} text={meta.title} />
        ))}
      </LegendBlock>

      <LegendBlock title="Кнопки карты">
        <LegendLine swatch={<Crosshair className="h-3.5 w-3.5 text-[#F97316]" />} text="Вернуться к грузовику" hint="карта снова следует за машиной" />
        <LegendLine swatch={<Pin className="h-3.5 w-3.5 text-[#F97316]" />} text="Новая пометка" hint="отметить участок дороги" />
        <LegendLine swatch={<Layers className="h-3.5 w-3.5 text-[#F97316]" />} text="Эта легенда" />
      </LegendBlock>

      <div className="text-[10px] text-[#94A3B8] leading-snug pt-1">
        Чтобы осмотреть карту свободно — перетяните её; прицел вернёт камеру к грузовику.
      </div>
    </div>
  )
}

function LegendBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-1">
      <div className="text-[10px] font-bold uppercase tracking-wide text-[#94A3B8] mb-1.5">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function LegendLine({ swatch, text, hint }: { swatch: React.ReactNode; text: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex items-center justify-center w-5 shrink-0">{swatch}</span>
      <span className="flex-1 text-[12.5px] text-[#15202B] font-medium leading-tight">{text}</span>
      {hint && <span className="text-[10px] text-[#94A3B8] text-right leading-tight max-w-[84px]">{hint}</span>}
    </div>
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
