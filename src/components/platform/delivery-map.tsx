'use client'

/**
 * Карта доставки (Leaflet + OpenStreetMap) — точки, куда нужно доставить
 * груз по текущей выборке заявок, и пункт погрузки (АЭМЗ).
 *
 * Модуль подключается через next/dynamic с ssr:false: Leaflet работает
 * только в браузере и обращается к window при инициализации.
 * На карте нет подписей: вместо строки «Leaflet | © OpenStreetMap» — маленький
 * значок «©», полный текст по наведению (лицензия OpenStreetMap требует указания источника).
 */

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { formatKm } from '@/lib/geo'

export interface MapPointRequest {
  id: string
  number: string
  cargo: string
  tonnage: number
  loadDate: string
  /** перевозчик может откликнуться прямо с карты (заявка на торгах, отклика ещё нет) */
  canBid: boolean
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

/** Кнопка «Откликнуться» в карточке точки: обработчик вешается при открытии карточки */
const BID_BUTTON_STYLE =
  'margin-top:4px;align-self:flex-start;border:0;border-radius:8px;background:#0f172a;color:#fff;' +
  'font-size:12px;font-weight:600;padding:5px 12px;cursor:pointer'

/** Содержимое всплывающей карточки маркера */
function popupHtml(p: MapPoint, withBid: boolean): string {
  const shown = p.requests.slice(0, 5)
  const rest = p.requests.length - shown.length
  const rows = shown
    .map(
      (r) =>
        `<li style="display:flex;flex-direction:column;font-size:12px;color:#0f172a">` +
        `<span><b>${esc(r.number)}</b> · ${esc(r.cargo)}, ${r.tonnage} т · ${esc(r.loadDate)}</span>` +
        (withBid && r.canBid ? `<button type="button" data-bid="${esc(r.id)}" style="${BID_BUTTON_STYLE}">Откликнуться</button>` : '') +
        `</li>`,
    )
    .join('')
  const more = rest > 0 ? `<li style="font-size:11px;color:#64748b">и ещё ${rest}…</li>` : ''
  const dist =
    p.distanceKm != null
      ? `<div style="margin-top:3px;font-size:11px;color:#64748b">≈ ${formatKm(p.distanceKm)} от погрузки</div>`
      : ''
  return (
    `<div style="min-width:200px">` +
    `<div style="font-size:11px;font-weight:500;color:#64748b">${p.kind === 'loading' ? 'Пункт погрузки' : 'Пункт выгрузки'}</div>` +
    `<div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:2px">${esc(p.short)} · заявок: ${p.requests.length}</div>` +
    `<div style="font-size:12px;color:#334155;margin-top:2px">${esc(p.name)}</div>` +
    `<div style="font-size:11px;color:#64748b">${esc(p.address)}</div>` +
    dist +
    (p.requests.length > 0
      ? `<ul style="list-style:none;display:flex;flex-direction:column;gap:${withBid ? 8 : 3}px;margin:6px 0 0;padding:6px 0 0;border-top:1px solid #e2e8f0">${rows}${more}</ul>`
      : '') +
    `</div>`
  )
}

/** Источник данных карты: значок «©», полный текст — по наведению */
export const MapCredit = L.Control.extend({
  onAdd() {
    const a = L.DomUtil.create('a') as HTMLAnchorElement
    a.href = 'https://www.openstreetmap.org/copyright'
    a.target = '_blank'
    a.rel = 'noreferrer'
    a.title = 'Данные карты: © участники OpenStreetMap'
    a.setAttribute('aria-label', a.title)
    a.textContent = '©'
    a.style.cssText =
      'display:flex;align-items:center;justify-content:center;width:18px;height:18px;margin:0 6px 6px 0;' +
      'border-radius:9999px;background:rgba(255,255,255,.8);color:#94a3b8;font-size:11px;text-decoration:none'
    return a
  },
})

export default function DeliveryMap({ points, focusId, onBid }: {
  points: MapPoint[]
  focusId: string | null
  /** «Откликнуться» из карточки точки; без обработчика кнопки не показываются (логист) */
  onBid?: (requestId: string) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const onBidRef = useRef(onBid)
  useEffect(() => { onBidRef.current = onBid }, [onBid])
  const withBid = Boolean(onBid)

  // стабильная подпись набора точек: не перерисовываем маркеры и не
  // сбрасываем зум при фоновом обновлении данных без изменений
  const signature = points.map((p) => `${p.id}:${p.requests.map((r) => `${r.id}${r.canBid ? '+' : ''}`).join(',')}`).join('|')

  // инициализация карты — один раз на монтирование
  useEffect(() => {
    const el = containerRef.current
    if (!el || mapRef.current) return
    // стандартная строка «Leaflet | © OpenStreetMap» отключена — вместо неё значок «©»
    const map = L.map(el, { center: [48.5, 38.0], zoom: 4, attributionControl: false })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map)
    new MapCredit({ position: 'bottomright' }).addTo(map)
    // Leaflet гасит всплытие кликов из карточки — обработчик «Откликнуться» вешаем при открытии
    map.on('popupopen', (e: L.PopupEvent) => {
      e.popup.getElement()?.querySelectorAll<HTMLButtonElement>('[data-bid]').forEach((btn) => {
        btn.onclick = () => {
          const id = btn.dataset.bid
          if (id) onBidRef.current?.(id)
        }
      })
    })
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
      marker.bindPopup(popupHtml(p, withBid), { maxWidth: 300 })
      markersRef.current.set(p.id, marker)
      bounds.extend([p.lat, p.lng])
    }
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.2), { maxZoom: 8 })
    // points читаются по подписи signature — при смене состава или откликов карточки перестраиваются
  }, [signature, withBid])

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
