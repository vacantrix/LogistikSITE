'use client'

/**
 * Выбор адреса на карте для проформы водителя: щелчок по карте ставит точку,
 * адрес точки берётся из OpenStreetMap, «Подставить» переносит его в поле.
 * Загружается только в браузере (next/dynamic, ssr: false) — Leaflet работает с window.
 */
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Loader2, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MapCredit } from '@/components/platform/delivery-map'
import { api } from '@/lib/api'
import type { Suggestion } from '@/lib/suggest'

/** Без выбранной ранее точки карта открывается на Абинске */
const ABINSK: [number, number] = [44.867, 38.16]

export default function MapPickDialog({
  title, level, center, onPick, onClose,
}: {
  title: string
  /** address — адрес с улицей и домом, place — населённый пункт */
  level: 'address' | 'place'
  center: { lat: number; lon: number } | null
  onPick: (s: Suggestion) => void
  onClose: () => void
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [found, setFound] = useState<Suggestion | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const seq = useRef(0)
  const startRef = useRef(center)

  useEffect(() => {
    if (!el) return
    const start = startRef.current
    const map = L.map(el, {
      center: start ? [start.lat, start.lon] : ABINSK,
      zoom: start ? 15 : level === 'place' ? 8 : 13,
      attributionControl: false,
    })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map)
    new MapCredit({ position: 'bottomright' }).addTo(map)
    const marker = L.circleMarker([0, 0], { radius: 8, color: '#1d4ed8', weight: 3, fillColor: '#3b82f6', fillOpacity: 0.6 })
    if (start) marker.setLatLng([start.lat, start.lon]).addTo(map)

    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng).addTo(map)
      const my = ++seq.current
      setLoading(true)
      setFailed(false)
      api.suggest({ kind: 'reverse', lat: e.latlng.lat, lon: e.latlng.lng, level: level === 'place' ? 'place' : undefined })
        .then((r) => {
          if (seq.current !== my) return
          setFound(r.items[0] ?? null)
          setFailed(r.items.length === 0)
        })
        .catch(() => {
          if (seq.current === my) setFailed(true)
        })
        .finally(() => {
          if (seq.current === my) setLoading(false)
        })
    })
    // окно открывается с анимацией — подгоняем канвас под итоговый размер
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      map.remove()
    }
  }, [el, level])

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-700" aria-hidden />
            {title}: выбор на карте
          </DialogTitle>
          <DialogDescription className="sr-only">
            Щёлкните по карте — адрес точки подставится в поле после нажатия «Подставить».
          </DialogDescription>
        </DialogHeader>
        <div ref={setEl} className="h-[55vh] min-h-[280px] w-full overflow-hidden rounded-lg border border-slate-200" />
        <div className="flex min-h-9 flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 text-sm" aria-live="polite">
            {loading ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Ищем адрес точки…
              </span>
            ) : found ? (
              <span className="font-medium text-slate-900">{found.label}</span>
            ) : failed ? (
              <span className="text-amber-700">Адрес этой точки не найден — выберите точку рядом</span>
            ) : (
              <span className="text-muted-foreground">Щёлкните по карте</span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>Отмена</Button>
          <Button size="sm" disabled={!found || loading} onClick={() => found && onPick(found)}>Подставить</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
