'use client'

/**
 * Карта доставки (Leaflet + OpenStreetMap) — точки, куда нужно доставить
 * груз по текущей выборке заявок, и пункт погрузки (АЭМЗ).
 *
 * Модуль подключается через next/dynamic с ssr:false: Leaflet работает
 * только в браузере и обращается к window при инициализации.
 */

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { formatKm } from '@/lib/geo'

export interface MapPointRequest {
  number: string
  cargo: string
  tonnage: number
  loadDate: string
}

export interface MapPoint {
  id: string
  lat: number
  lng: number
  /** Короткая подпись точки («Абинск», «Воронеж»…) */
  short: string
  name: string
  address: string
  /** Расстояние от пункта погрузки, км (null — не рассчитано) */
  distanceKm: number | null
  kind: 'loading' | 'delivery'
  requests: MapPointRequest[]
}

const COLOR_LOADING = '#d97706' // янтарный — завод
const COLOR_DELIVERY = '#2563eb' // синий — точки выгрузки

/** Экранирование HTML в подписях маркеров */
function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
}

/** Содержимое всплывающей подсказки маркера */
function popupHtml(p: MapPoint): string {
  const shown = p.requests.slice(0, 5)
  const rest = p.requests.length - shown.length
  const rows = shown
    .map(
      (r) =>
        `<li style="font-size:12px;color:#0f172a"><b>${esc(r.number)}</b> · ${esc(r.cargo)}, ${r.tonnage} т · ${esc(r.loadDate)}</li>`,
    )
    .join('')
  const more = rest > 0 ? `<li style="font-size:11px;color:#64748b">и ещё ${rest}…</li>` : ''
  const dist =
    p.distanceKm != null
      ? `<div style="margin-top:3px;font-size:11px;color:#64748b">≈ ${formatKm(p.distanceKm)} от погрузки</div>`
      : ''
  return (
    `<div style="min-width:200px">` +
    `<div style="font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#94a3b8">${p.kind === 'loading' ? 'Пункт погрузки' : 'Пункт выгрузки'}</div>` +
    `<div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:2px">${esc(p.short)} · заявок: ${p.requests.length}</div>` +
    `<div style="font-size:12px;color:#334155;margin-top:2px">${esc(p.name)}</div>` +
    `<div style="font-size:11px;color:#64748b">${esc(p.address)}</div>` +
    dist +
    (p.requests.length > 0
      ? `<ul style="list-style:none;display:flex;flex-direction:column;gap:3px;margin:6px 0 0;padding:6px 0 0;border-top:1px solid #e2e8f0">${rows}${more}</ul>`
      : '') +
    `</div>`
  )
}

export default function DeliveryMap({ points, focusId }: { points: MapPoint[]; focusId: string | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())

  // стабильная подпись набора точек: не перерисовываем маркеры и не
  // сбрасываем зум при фоновом обновлении данных без изменений
  const signature = points.map((p) => p.id).join('|')

  // инициализация карты — один раз на монтирование
  useEffect(() => {
    const el = containerRef.current
    if (!el || mapRef.current) return
    const map = L.map(el, { center: [48.5, 38.0], zoom: 4 })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    // контейнер может менять размер (анимация диалога, раскрытие списка) —
    // держим канвас карты в актуальном размере
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
      layerRef.current = null
      markersRef.current.clear()
    }
  }, [])

  // маркеры точек — перестраиваем, когда меняется состав точек
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    markersRef.current.clear()
    const bounds = L.latLngBounds([])
    for (const p of points) {
      const color = p.kind === 'loading' ? COLOR_LOADING : COLOR_DELIVERY
      const label = p.kind === 'loading' ? '🏭' : String(p.requests.length)
      const icon = L.divIcon({
        className: 'delivery-map-pin',
        html:
          `<span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;` +
          `border-radius:9999px;background:${color};color:#fff;font-size:${p.kind === 'loading' ? '15px' : '13px'};` +
          `font-weight:700;line-height:1;border:2px solid #fff;box-shadow:0 1px 4px rgba(15,23,42,.45)">${esc(label)}</span>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -16],
      })
      const marker = L.marker([p.lat, p.lng], { icon, title: p.short }).addTo(layer)
      marker.bindPopup(popupHtml(p), { maxWidth: 300 })
      markersRef.current.set(p.id, marker)
      bounds.extend([p.lat, p.lng])
    }
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.2), { maxZoom: 8 })
  }, [signature])

  // фокус на точке из бокового списка: перелёт + открытие подсказки
  useEffect(() => {
    const map = mapRef.current
    if (!map || !focusId) return
    const marker = markersRef.current.get(focusId)
    if (!marker) return
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 8), { duration: 0.6 })
    marker.openPopup()
  }, [focusId, signature])

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      role="application"
      aria-label="Карта точек доставки"
    />
  )
}
