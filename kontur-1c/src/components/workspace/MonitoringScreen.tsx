'use client'

// «Мониторинг (GPS)» — рабочее место диспетчера: живые позиции машин
// на мини-картах. Телеметрия: приложение водителя шлёт фикс каждые 5 с
// во время рейса → сервер приложения (:3002) → этот экран (опрос 3 с).
// Карта — схематичная SVG (без внешних тайлов): маршрут из GeoJSON рейса,
// точки погрузки/выгрузки и грузовик с курсом (стрелка) и скоростью.

import { Badge } from '@/components/ui/badge'
import { FormTitleBar, C1ToolButton } from '@/components/1c/kit'
import { usePoll } from './usePoll'
import { Navigation, RadioTower } from 'lucide-react'

type TrackRow = {
  driverId: string
  driverName: string
  vehicleLabel: string | null
  tripNumber: string | null
  status: string | null
  fromName: string | null
  toName: string | null
  lat: number
  lon: number
  speedKmh: number
  heading: number
  receivedAt: number
  ageMs: number
  stale: boolean
  routeCoords: [number, number][]
  routeDistanceM: number | null
  points: { kind: string; name: string | null; lat: number; lon: number }[]
}

export type { TrackRow }

const STATUS_RU: Record<string, string> = {
  assigned: 'Назначен', ASSIGNED: 'Назначен', accepted: 'Принят водителем', ACCEPTED: 'Принят водителем',
  in_progress: 'В пути', IN_PROGRESS: 'В пути', PRETRIP: 'Предрейсовая подготовка',
  completed: 'Выполнен', done: 'Выполнен', DONE: 'Выполнен',
}

/** Мини-карта: маршрут + точки + грузовик. Проекция lon/lat → SVG (y инверт). */
export function MiniMap({ row }: { row: TrackRow }) {
  const W = 320
  const H = 190
  const pad = 26

  const all: [number, number][] = [
    ...row.routeCoords,
    [row.lon, row.lat],
    ...row.points.map((p) => [p.lon, p.lat] as [number, number]),
  ]
  const lons = all.map((c) => c[0])
  const lats = all.map((c) => c[1])
  const minLon = Math.min(...lons)
  const maxLon = Math.max(...lons)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const spanLon = Math.max(1e-4, maxLon - minLon)
  const spanLat = Math.max(1e-4, maxLat - minLat)
  // масштаб с сохранением пропорций, центр — середина bbox
  const scale = Math.min((W - pad * 2) / spanLon, (H - pad * 2) / spanLat)
  const offX = (W - spanLon * scale) / 2
  const offY = (H - spanLat * scale) / 2
  const px = (lon: number) => offX + (lon - minLon) * scale
  const py = (lat: number) => offY + (maxLat - lat) * scale

  const path = row.routeCoords.map((c, i) => `${i === 0 ? 'M' : 'L'}${px(c[0]).toFixed(1)},${py(c[1]).toFixed(1)}`).join(' ')
  const loading = row.points.find((p) => p.kind === 'loading')
  const unloading = row.points.find((p) => p.kind === 'unloading')
  const cx = px(row.lon)
  const cy = py(row.lat)
  const moving = row.speedKmh > 3

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full rounded-md border border-[#d8dee6] bg-[#eef2f6]" role="img" aria-label="Схема маршрута с позицией машины">
      <defs>
        <filter id="truckShadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.4" floodOpacity="0.35" />
        </filter>
      </defs>
      {/* сетка-фон */}
      {[1, 2, 3].map((i) => (
        <line key={`h${i}`} x1="0" y1={(H / 4) * i} x2={W} y2={(H / 4) * i} stroke="#dde4ec" strokeWidth="1" />
      ))}
      {[1, 2, 3].map((i) => (
        <line key={`v${i}`} x1={(W / 4) * i} y1="0" x2={(W / 4) * i} y2={H} stroke="#dde4ec" strokeWidth="1" />
      ))}
      {/* маршрут */}
      {path && <path d={path} fill="none" stroke="#2f6db0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />}
      {/* точки погрузки/выгрузки */}
      {loading && (
        <g>
          <circle cx={px(loading.lon)} cy={py(loading.lat)} r="5.5" fill="#fff" stroke="#1c5a3a" strokeWidth="2.5" />
          <text x={px(loading.lon)} y={py(loading.lat) - 9} textAnchor="middle" fontSize="9" fill="#1c5a3a" fontWeight="600">погрузка</text>
        </g>
      )}
      {unloading && (
        <g>
          <circle cx={px(unloading.lon)} cy={py(unloading.lat)} r="5.5" fill="#fff" stroke="#c43e1c" strokeWidth="2.5" />
          <text x={px(unloading.lon)} y={py(unloading.lat) - 9} textAnchor="middle" fontSize="9" fill="#c43e1c" fontWeight="600">выгрузка</text>
        </g>
      )}
      {/* грузовик: пульс + стрелка курса */}
      <circle cx={cx} cy={cy} r="13" fill="#f97316" opacity="0.16">
        <animate attributeName="r" values="10;16;10" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.22;0.05;0.22" dur="2s" repeatCount="indefinite" />
      </circle>
      <g transform={`translate(${cx},${cy}) rotate(${row.heading})`} filter="url(#truckShadow)">
        <path d="M-8,-5 L-8,5 L-3,5 L2,9 L2,-9 L-3,-5 Z" fill="#f97316" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M2,-6 L2,6 L10,3 L10,-3 Z" fill="#c2410c" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
      </g>
      <text x={W - 6} y={H - 6} textAnchor="end" fontSize="9" fill="#7a8899">
        {row.lat.toFixed(4)}° N · {row.lon.toFixed(4)}° E{moving ? ` · ${Math.round(row.speedKmh)} км/ч` : ''}
      </text>
    </svg>
  )
}

function ageText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 5) return 'только что'
  if (s < 60) return `${s} с назад`
  const m = Math.floor(s / 60)
  return `${m} мин ${s % 60} с назад`
}

function TrackCard({ row }: { row: TrackRow }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[#d8dee6] bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-[#1b1b1b]">{row.driverName}</div>
          <div className="truncate text-[12px] text-[#5c5c5c]">{row.vehicleLabel ?? 'ТС не назначен'}</div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px]">
          <span
            className={`inline-block h-[8px] w-[8px] rounded-full ${row.stale ? 'bg-[#c4a01c]' : 'bg-[#1c5a3a] animate-pulse'}`}
          />
          {row.stale ? ageText(row.ageMs) : 'в эфире'}
        </span>
      </div>
      <MiniMap row={row} />
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        {row.tripNumber && (
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-xs font-semibold">
            Рейс {row.tripNumber}
          </Badge>
        )}
        {row.status && <span className="text-[#5c5c5c]">{STATUS_RU[row.status] ?? row.status}</span>}
        <span className="ml-auto font-semibold text-[#1b1b1b]">{Math.round(row.speedKmh)} км/ч</span>
      </div>
      {(row.fromName || row.toName) && (
        <div className="text-[12px] text-[#5c5c5c]">
          {row.fromName ?? '—'} → {row.toName ?? '—'}
          {row.routeDistanceM ? ` · ${Math.round(row.routeDistanceM / 1000)} км` : ''}
        </div>
      )}
      <div className="text-[11px] text-[#8a8a8a]">
        Последний фикс: {ageText(row.ageMs)} · телеметрия каждые 5 с из приложения водителя
      </div>
    </div>
  )
}

export function MonitoringScreen({ onClose }: { onClose?: () => void }) {
  const { data, error, reload } = usePoll<{ rows: TrackRow[]; sourceError: string | null }>('/api/office/tracking', 3000)
  const rows = data?.rows ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <FormTitleBar title="Мониторинг (GPS)" onClose={onClose} />

      <div className="flex h-[34px] shrink-0 items-center gap-1 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2">
        <C1ToolButton title="Обновить" onClick={reload}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M12 7a5 5 0 11-1.5-3.6M12 1.5V5H8.5" stroke="#2f6db0" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </C1ToolButton>
        <span className="ml-3 text-[12px] text-[#5c5c5c]">
          Позиции машин в рейсах · телеметрия из приложения водителя, обновление 3 с
        </span>
        <span className="ml-auto text-[12px] text-[#8a8a8a]">Машин на связи: {rows.filter((r) => !r.stale).length}</span>
      </div>

      <div className="c1-scroll min-h-0 flex-1 overflow-auto p-3">
        {data?.sourceError && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[13px] text-amber-900">
            Сервер телеметрии недоступен ({data.sourceError}). Проверьте, что приложение водителя запущено.
          </div>
        )}
        {error && !data && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-[13px] text-red-800">Ошибка загрузки: {error}</div>
        )}
        {rows.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {rows.map((r) => (
              <TrackCard key={r.driverId} row={r} />
            ))}
          </div>
        ) : (
          !error && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Navigation className="h-8 w-8 text-[#9ab0c4]" />
              <div className="text-[13px] font-semibold text-[#1b1b1b]">Нет активных позиций</div>
              <div className="max-w-md text-[12px] text-[#5c5c5c]">
                Позиции появляются, когда водитель в рейсе: приложение передаёт GPS-фикс каждые 5 секунд.
                Назначьте заявку в «Маршрутных листах» и дождитесь, пока водитель нажмёт «Начать маршрут».
              </div>
            </div>
          )
        )}
        {rows.length === 0 && data && !data.sourceError && (
          <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-[#8a8a8a]">
            <RadioTower className="h-3.5 w-3.5" />
            канал телеметрии: приложение водителя → сервер :3002 → «Контур 1С»
          </div>
        )}
      </div>
    </div>
  )
}
