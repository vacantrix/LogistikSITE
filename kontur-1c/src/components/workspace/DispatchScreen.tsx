'use client'

// Рабочее место диспетчерской — форма «Маршрутные листы» (список + панель назначения).
// Разметка имитирует список документов 1С (скриншот 1С:ERP, интерфейс «Такси»).

import { useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { C1Button, C1Input, C1Select, C1ToolButton, FormTitleBar } from '@/components/1c/kit'
import { apiPost } from './api'
import { usePoll } from './usePoll'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { CANCEL_REASONS, STATUS_LABELS } from '@/lib/1c/statuses'
import { buildYandexRouteUrl, pointsLabel } from '@/lib/1c/yandexRoute'

type RequestRow = {
  id: string; number: string; status: string; contractor: { name: string }; cargo: string; weightT: number
  from: { name: string; address: string; lat: number; lon: number }
  to: { name: string; address: string; lat: number; lon: number }
  loadingAt: string; unloadingWindow: string; docs: string[]
  routeLink: string | null; routeWaypoints: [number, number][] | null
}
type Vehicle = { id: string; plate: string; model: string; kind: string; bodyType: string; capacityT: number; volumeM3: number | null; readiness: string; isActive: boolean }
type Trailer = { id: string; plate: string; model: string; type: string; isActive: boolean }
type Driver = { id: string; fullName: string; isActive: boolean; appId: string | null }
type TripRow = { number: string; driver: { id: string } | null; trip: { status: string } | null }
type Catalog = { rows: { id: string; name: string; address?: string }[] }

// зеркала правил 5.3 для бейджей кандидатов (сервер перепроверяет при проведении)
const BODY_CARGO: Record<string, string[]> = {
  tarp: ['металло', 'паллет', 'мешк', 'ферм', 'прокат', 'лист', 'оборудован', 'пиломатериал', 'труб', 'рулон', 'шпала', 'кирпич'],
  fridge: ['продукт', 'мясо', 'рыба', 'молок', 'заморож', 'овощ', 'фрукт', 'морожен', 'медикамент', 'цвет'],
  flatbed: ['металло', 'прокат', 'лист', 'труб', 'жби', 'плита', 'бетон', 'кирпич', 'ферм', 'контейнер', 'рулон'],
  tank: ['наливн', 'топлив', 'битум'],
}
const BODY_RU: Record<string, string> = { tarp: 'штора', fridge: 'реф', flatbed: 'борт', tank: 'цистерна' }
const KIND_RU: Record<string, string> = { tractor: 'тягач', tipper: 'самосвал', van: 'фургон' }

const STATUS_DOT: Record<string, string> = {
  NEW: '#8a8a8a', DISPATCH: '#e8a000', ASSIGNED: '#2f6db0', ACCEPTED: '#00a0b0',
  PRETRIP: '#7a4fb0', IN_PROGRESS: '#1c5a3a', DONE: '#2f8a2f', CANCELLED: '#c43e1c',
}

// дата в формате списка 1С: 13.11.2026 11:34:02
const fmt1C = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const d = new Date(iso)
  const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return `${date} ${time}`
}

function vehicleIssues(v: Vehicle, r: RequestRow): string[] {
  const issues: string[] = []
  if (!v.isActive) issues.push('не активено')
  if (v.readiness !== 'ready') issues.push(v.readiness === 'repair' ? 'в ремонте' : 'на обслуживании')
  if (r.weightT > v.capacityT) issues.push(`грузоподъёмность ${v.capacityT} т < ${r.weightT} т`)
  const keys = BODY_CARGO[v.bodyType] ?? []
  if (!keys.some((k) => r.cargo.toLowerCase().includes(k))) issues.push(`кузов «${BODY_RU[v.bodyType]}» не под груз`)
  return issues
}

/* Иконки первой пары колонок списка 1С: документ + транспорт */
function DocIcon() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" className="shrink-0">
      <path d="M2 1.5h7l3 3V14.5H2z" fill="#fff" stroke="#7a9cc0" strokeWidth="1" />
      <path d="M9 1.5v3h3" fill="#e8f0f8" stroke="#7a9cc0" strokeWidth="1" />
      <path d="M4 7h6M4 9h6M4 11h4" stroke="#9ab4cc" strokeWidth="0.9" />
    </svg>
  )
}
function TruckIcon({ muted }: { muted?: boolean }) {
  return (
    <svg width="17" height="15" viewBox="0 0 18 15" className="shrink-0">
      <rect x="1" y="3" width="9" height="6.5" rx="0.8" fill={muted ? '#e2e2e2' : '#3f9c46'} stroke={muted ? '#b8b8b8' : '#2f7a36'} strokeWidth="0.9" />
      <path d="M10 5h3.2l2.3 2.4v2.1H10z" fill={muted ? '#eeeeee' : '#66b96c'} stroke={muted ? '#b8b8b8' : '#2f7a36'} strokeWidth="0.9" />
      <circle cx="4.5" cy="11.5" r="1.6" fill="#5c5c5c" stroke="#333" strokeWidth="0.7" />
      <circle cx="13" cy="11.5" r="1.6" fill="#5c5c5c" stroke="#333" strokeWidth="0.7" />
    </svg>
  )
}

export function DispatchScreen({ onClose }: { onClose?: () => void }) {
  const { data: requestsData, reload } = usePoll<{ requests: RequestRow[] }>('/api/office/requests?status=DISPATCH')
  const { data: vehiclesData } = usePoll<{ rows: Vehicle[] }>('/api/office/catalog/vehicles')
  const { data: trailersData } = usePoll<{ rows: Trailer[] }>('/api/office/catalog/trailers')
  const { data: driversData } = usePoll<{ rows: Driver[] }>('/api/office/catalog/drivers')
  const { data: tripsData } = usePoll<{ trips: TripRow[] }>('/api/office/trips')
  const { data: contractorsData } = usePoll<Catalog>('/api/office/catalog/contractors')
  const { data: locationsData } = usePoll<Catalog>('/api/office/catalog/locations')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [vehicleId, setVehicleId] = useState<string>('')
  const [trailerId, setTrailerId] = useState<string>('')
  const [driverId, setDriverId] = useState<string>('')
  const [assigning, setAssigning] = useState(false)
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [cancelTarget, setCancelTarget] = useState<RequestRow | null>(null)
  const [cancelReason, setCancelReason] = useState<string>(CANCEL_REASONS[0])
  const [cancelOpen, setCancelOpen] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // маршрут через Яндекс.Карты: вставка ссылки и разбор rtext
  const [routeLinkInput, setRouteLinkInput] = useState('')
  const [parsingRoute, setParsingRoute] = useState(false)

  const pool = requestsData?.requests ?? []
  const selected = pool.find((r) => r.id === selectedId) ?? null
  const rows = useMemo(
    () => pool.filter((r) => !filterText || `${r.number} ${r.cargo} ${r.from.name} ${r.to.name} ${r.contractor.name}`.toLowerCase().includes(filterText.toLowerCase())),
    [pool, filterText],
  )

  // водитель → код незавершённого рейса (для подсказки в выпадающем списке;
  // сервер перепроверяет правила 5.3 при проведении)
  const busyDriverTrip = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of tripsData?.trips ?? []) {
      if (t.trip && ['assigned', 'in_progress'].includes(t.trip.status) && t.driver) m.set(t.driver.id, t.number)
    }
    return m
  }, [tripsData])

  const candidates = useMemo(() => {
    if (!selected || !vehiclesData) return []
    return vehiclesData.rows
      .map((v) => ({ v, issues: vehicleIssues(v, selected) }))
      .sort((a, b) => a.issues.length - b.issues.length)
  }, [selected, vehiclesData])

  function select(r: RequestRow) {
    setSelectedId(r.id)
    setVehicleId('')
    setTrailerId('')
    setDriverId('')
    setServerErrors([])
    setRouteLinkInput('')
  }

  async function assign() {
    if (!selected || !vehicleId || !driverId) return
    setAssigning(true)
    setServerErrors([])
    try {
      const res = await apiPost<{ number: string }>(`/api/office/requests/${selected.id}/assign`, {
        vehicleId,
        trailerId: trailerId || null,
        driverId,
        actor: 'Диспетчер Е. Крылова',
      })
      toast.success(`Проведено: ${res.number} — рейс рождён, план обмена записан`)
      setSelectedId(null)
      reload()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Отказ проведения'
      setServerErrors(message.split('; '))
      toast.error('Документ не проведён')
    } finally {
      setAssigning(false)
    }
  }

  async function cancel() {
    if (!cancelTarget) return
    try {
      await apiPost(`/api/office/requests/${cancelTarget.id}/cancel`, { reason: cancelReason, actor: 'Диспетчер Е. Крылова' })
      toast.success(`Заявка ${cancelTarget.number} отменена`)
      setCancelOpen(false)
      setCancelTarget(null)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка отмены')
    }
  }

  // «Построить маршрут»: открыть Яндекс.Карты с точками заявки
  // (если маршрут уже сохранён — со всеми его точками, чтобы править дальше)
  function openYandexRoute() {
    if (!selected) return
    const url =
      selected.routeLink ??
      buildYandexRouteUrl([
        { lat: selected.from.lat, lon: selected.from.lon },
        { lat: selected.to.lat, lon: selected.to.lon },
      ])
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  // «Разобрать ссылку»: rtext → routeWaypoints, оба поля сохраняются в заявку
  async function parseRouteLink() {
    if (!selected || !routeLinkInput.trim()) return
    setParsingRoute(true)
    try {
      const res = await apiPost<{ number: string; points: number }>(`/api/office/requests/${selected.id}/route`, {
        link: routeLinkInput.trim(),
        actor: 'Диспетчер Е. Крылова',
      })
      toast.success(`Маршрут: ${pointsLabel(res.points)} — сохранён в заявку ${res.number}`)
      setRouteLinkInput('')
      reload()
    } catch (e) {
      // кривая ссылка — только ошибка, заявку не блокируем
      toast.error(e instanceof Error ? e.message : 'Ссылка не разобрана')
    } finally {
      setParsingRoute(false)
    }
  }

  async function create(form: FormData) {
    setCreating(true)
    try {
      const docs = String(form.get('docs') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      const res = await apiPost<{ request: { id: string; number: string } }>('/api/office/requests', {
        contractorId: form.get('contractorId'),
        cargo: form.get('cargo'),
        weightT: Number(form.get('weightT')),
        fromLocationId: form.get('fromLocationId'),
        toLocationId: form.get('toLocationId'),
        loadingAt: new Date(String(form.get('loadingAt'))).toISOString(),
        unloadingWindow: form.get('unloadingWindow'),
        docs,
        actor: 'Диспетчер Е. Крылова',
      })
      toast.success(`Заявка ${res.request.number} создана и встала в пул «Маршрутных листов»`)
      setCreateOpen(false)
      setSelectedId(res.request.id)
      setVehicleId('')
      setTrailerId('')
      setDriverId('')
      setServerErrors([])
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка создания')
    } finally {
      setCreating(false)
    }
  }

  const notImplemented = (what: string) => toast.info(`${what} — в демо-стенде не реализовано`)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <FormTitleBar title="Маршрутные листы" onClose={onClose} />

      {/* Командная панель списка */}
      <div className="flex h-[34px] shrink-0 items-center gap-1 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2">
        <C1Button className="!h-[24px]" onClick={() => setCreateOpen(true)}>
          <svg width="11" height="11" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="#2f7a36" strokeWidth="1.6" /></svg>
          Создать
          <svg width="8" height="5" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6z" fill="#666" /></svg>
        </C1Button>
        <C1ToolButton title="Скопировать" onClick={() => notImplemented('Скопировать')}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><rect x="4.5" y="4.5" width="7" height="7" rx="1" stroke="#5c5c5c" strokeWidth="1.1" /><path d="M9.5 2.5h-7v7" stroke="#5c5c5c" strokeWidth="1.1" /></svg>
        </C1ToolButton>
        <C1ToolButton title="Изменить" onClick={() => notImplemented('Изменить')}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M9.5 2l2.5 2.5L5 11.5l-3 .5.5-3z" stroke="#c98a00" strokeWidth="1.1" strokeLinejoin="round" /></svg>
        </C1ToolButton>
        <C1Button className="!h-[24px]" onClick={() => notImplemented('Печать')}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M3 1h6v3H3zM2 7h8v4H2z" stroke="#5c5c5c" strokeWidth="1.1" /><path d="M4 7V5h4v2" stroke="#5c5c5c" strokeWidth="1.1" /></svg>
          Печать
          <svg width="8" height="5" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6z" fill="#666" /></svg>
        </C1Button>
        <C1Button className="!h-[24px]" onClick={() => notImplemented('Отчеты')}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M1 10.5c2-4 8-4 10 0M6 6.5a2.6 2.6 0 100-5.2 2.6 2.6 0 000 5.2z" stroke="#5c5c5c" strokeWidth="1.1" /></svg>
          Отчеты
          <svg width="8" height="5" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6z" fill="#666" /></svg>
        </C1Button>

        <div className="ml-auto flex items-center gap-1">
          <input
            ref={searchRef}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Поиск (Ctrl+F)"
            className="c1-input w-[210px]"
          />
          <C1ToolButton title="Найти" onClick={() => searchRef.current?.focus()}>
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4" stroke="#5c5c5c" strokeWidth="1.3" /><path d="M9 9l3.5 3.5" stroke="#5c5c5c" strokeWidth="1.3" /></svg>
          </C1ToolButton>
          <C1Button className="!h-[24px]" onClick={() => notImplemented('Ещё')}>
            Ещё
            <svg width="8" height="5" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6z" fill="#666" /></svg>
          </C1Button>
        </div>
      </div>

      {/* Список документов «Маршрутные листы» */}
      <div className="c1-scroll min-h-[180px] flex-1 overflow-auto">
        <table className="c1-table">
          <thead>
            <tr>
              <th className="w-[24px] min-w-[24px] max-w-[24px] px-0" />
              <th className="w-[26px] min-w-[26px] max-w-[26px] px-0" />
              <th className="w-[110px]">Номер</th>
              <th className="w-[135px]">
                Дата
                <span className="ml-1 inline-block text-[9px] text-[#2f6db0]">▼</span>
              </th>
              <th className="w-[90px]">ТС</th>
              <th className="w-[170px]">Водители</th>
              <th className="w-[120px]">Перевозчик</th>
              <th className="w-[130px]">Адрес отправления</th>
              <th className="w-[130px]">Адрес прибытия</th>
              <th className="w-[80px]">Статус</th>
              <th>Комментарий</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sel = r.id === selectedId
              return (
                <tr key={r.id} className={cn(sel && 'c1-row-pink')} onClick={() => select(r)}>
                  <td className="px-1 text-center"><DocIcon /></td>
                  <td className="px-1 text-center"><TruckIcon muted={sel} /></td>
                  <td>{r.number}</td>
                  <td>{fmt1C(r.loadingAt)}</td>
                  <td />
                  <td />
                  <td className="truncate">АЗМЗ ООО</td>
                  <td>{r.from.name}</td>
                  <td>{r.to.name}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-[8px] w-[8px] rounded-full" style={{ background: STATUS_DOT[r.status] ?? '#8a8a8a' }} />
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="max-w-[420px]">
                    <span className="text-[#1c1c1c]">{r.cargo}</span>
                    <span className="text-[#8a8a8a]"> · {r.weightT} т · окно: {r.unloadingWindow}{r.docs.length ? ` · ${r.docs.join(', ')}` : ''}</span>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="py-8 text-center text-[12px] text-[#8a8a8a]">
                  {pool.length === 0 ? 'Пул диспетчерской пуст — все заявки назначены' : 'Не найдено по строке поиска'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Разделитель панелей */}
      <div className="c1-splitter shrink-0" />

      {/* Нижняя панель: назначение ТС и водителя (проведение документа) */}
      <div className="flex min-h-[220px] shrink-0 flex-col overflow-hidden" style={{ height: 300 }}>
        <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2">
          <C1Button accent className="!h-[25px]" disabled={!selected || !vehicleId || !driverId || assigning} onClick={() => void assign()}>
            <svg width="10" height="9" viewBox="0 0 10 9"><path d="M0 4.5L3.5 8 10 0.8" stroke="#4a2f00" strokeWidth="1.8" fill="none" /></svg>
            {assigning ? 'Проведение…' : 'Назначить — провести документ'}
          </C1Button>
          <C1Button className="!h-[25px]" disabled={!selected} onClick={() => { if (selected) { setCancelTarget(selected); setCancelOpen(true) } }}>
            <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4.2" stroke="#c43e1c" strokeWidth="1.2" fill="none" /><path d="M1.8 1.8l6.4 6.4" stroke="#c43e1c" strokeWidth="1.2" /></svg>
            Отменить заявку
          </C1Button>
          <span className="ml-2 truncate text-[12px] text-[#5c5c5c]">
            {selected
              ? `${selected.number} · ${selected.contractor.name} · ${selected.cargo} · ${selected.weightT} т · ${selected.from.name} → ${selected.to.name} · погрузка ${fmt1C(selected.loadingAt)} · окно: ${selected.unloadingWindow}${selected.docs.length ? ` · документы: ${selected.docs.join(', ')}` : ''}`
              : 'Выберите заявку в списке — правила 5.3: готовность · грузоподъёмность · кузов'}
          </span>
          {/* Подсказка: что не заполнено для проведения (кнопка неактивна) */}
          {selected && (!vehicleId || !driverId) && (
            <span className="shrink-0 rounded-[3px] border border-[#e8c88a] bg-[#fdf6e7] px-2 py-[3px] text-[11px] text-[#8a5a00]">
              Для проведения не хватает:
              {!vehicleId ? ' выбора ТС (строка с зелёной галочкой в таблице)' : ''}
              {!vehicleId && !driverId ? ' ·' : ''}
              {!driverId ? ' выбора водителя в списке' : ''}
            </span>
          )}
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1 border-b border-[#e5e5e5] bg-[#fafafa] px-3 py-1.5 text-[12px] lg:grid-cols-4">
          <div><span className="text-[#8a8a8a]">Заказчик: </span>{selected?.contractor.name ?? '—'}</div>
          <div><span className="text-[#8a8a8a]">Груз: </span>{selected ? `${selected.cargo} · ${selected.weightT} т` : '—'}</div>
          <div><span className="text-[#8a8a8a]">Погрузка: </span>{selected ? fmt1C(selected.loadingAt) : '—'}</div>
          <div><span className="text-[#8a8a8a]">Окно выгрузки: </span>{selected?.unloadingWindow ?? '—'}</div>
        </div>

        {/* Маршрут через Яндекс.Карты: построить → поделиться → вставить ссылку → разобрать */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[#e5e5e5] bg-[#fafafa] px-3 py-1.5">
          <C1Button
            className="!h-[24px]"
            disabled={!selected}
            onClick={openYandexRoute}
            title="Открыть Яндекс.Карты с точками заявки (маршрут правится там, потом «Поделиться» → «Ссылка»)"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M1.5 8.5C3.5 4 10.5 4 12.5 8.5" stroke="#2f6db0" strokeWidth="1.3" strokeLinecap="round" />
              <circle cx="2" cy="10.5" r="1.5" fill="#2f6db0" /><circle cx="12" cy="10.5" r="1.5" fill="#c43e1c" />
              <path d="M2 10.5h4.5l1.5-2 1.5 2H12" stroke="#5c5c5c" strokeWidth="1.1" fill="none" />
            </svg>
            Построить маршрут
          </C1Button>
          <span className="c1-label">Ссылка на маршрут (Яндекс.Карты):</span>
          <C1Input
            className="w-[340px] max-w-[45%]"
            value={routeLinkInput}
            onChange={setRouteLinkInput}
            placeholder="https://yandex.ru/maps/?rtext=…~…&rtt=auto"
            disabled={!selected}
          />
          <C1Button
            className="!h-[24px]"
            disabled={!selected || !routeLinkInput.trim() || parsingRoute}
            onClick={() => void parseRouteLink()}
            title="Разобрать rtext: точки маршрута сохраняются в заявку"
          >
            {parsingRoute ? 'Разбор…' : 'Разобрать ссылку'}
          </C1Button>
          {selected?.routeWaypoints && selected.routeWaypoints.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#1c5a3a]">
              <svg width="11" height="11" viewBox="0 0 12 12"><path d="M1.5 6.5L4.5 9.5 10.5 2.5" stroke="#2f7a36" strokeWidth="1.6" fill="none" /></svg>
              Маршрут: {pointsLabel(selected.routeWaypoints.length)}
            </span>
          ) : (
            <span className="text-[11px] text-[#8a8a8a]">после назначения водитель получит точки — приложение строит рейс по ним</span>
          )}
        </div>

        <div className="c1-scroll min-h-0 flex-1 overflow-auto">
          <table className="c1-table">
            <thead>
              <tr>
                <th className="w-[26px] px-0" />
                <th className="w-[150px]">Транспортное средство</th>
                <th className="w-[90px]">Тип</th>
                <th className="w-[90px]">Кузов</th>
                <th className="w-[70px]">Груз, т</th>
                <th className="w-[110px]">Готовность</th>
                <th>Оценка правилами 5.3</th>
              </tr>
            </thead>
            <tbody>
              {selected ? (
                candidates.map(({ v, issues }) => {
                  const ok = issues.length === 0
                  return (
                    <tr
                      key={v.id}
                      className={cn(vehicleId === v.id && 'c1-row-sel', !ok && 'text-[#a2a2a2]')}
                      onClick={() => ok && setVehicleId(v.id)}
                    >
                      <td className="px-1 text-center">
                        {ok ? (
                          <svg width="13" height="13" viewBox="0 0 14 14" className="mx-auto"><circle cx="7" cy="7" r="6" fill="#dff0df" stroke="#2f8a2f" strokeWidth="1" /><path d="M4 7.2l2 2 4-4.4" stroke="#2f8a2f" strokeWidth="1.4" fill="none" /></svg>
                        ) : (
                          <svg width="13" height="13" viewBox="0 0 14 14" className="mx-auto"><circle cx="7" cy="7" r="6" fill="#f7d8da" stroke="#c43e1c" strokeWidth="1" /><path d="M4.6 4.6l4.8 4.8M9.4 4.6l-4.8 4.8" stroke="#c43e1c" strokeWidth="1.3" /></svg>
                        )}
                      </td>
                      <td>{v.model} · {v.plate}</td>
                      <td>{KIND_RU[v.kind] ?? v.kind}</td>
                      <td>{BODY_RU[v.bodyType] ?? v.bodyType}</td>
                      <td>{v.capacityT}</td>
                      <td>{v.readiness === 'ready' ? 'готов' : v.readiness === 'repair' ? 'ремонт' : 'обслуживание'}</td>
                      <td className={ok ? 'text-[#2f7a36]' : 'text-[#c43e1c]'}>{ok ? 'подходит под рейс' : issues.join('; ')}</td>
                    </tr>
                  )
                })
              ) : (
                <tr><td colSpan={7} className="py-6 text-center text-[12px] text-[#8a8a8a]">ТС не отбираются — заявка не выбрана</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Подбор прицепа и водителя + сообщения сервера */}
        <div className="shrink-0 border-t border-[#e5e5e5] bg-[#fafafa] px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="c1-label">Прицеп:</span>
            <C1Select
              className="w-[210px]"
              value={trailerId}
              onChange={setTrailerId}
              placeholder="Без прицепа"
              disabled={!selected}
              options={(trailersData?.rows ?? []).filter((t) => t.isActive).map((t) => ({ value: t.id, label: `${t.model} · ${t.plate} (${BODY_RU[t.type] ?? t.type})` }))}
            />
            <span className="c1-label">Водитель:</span>
            <C1Select
              className="w-[260px]"
              value={driverId}
              onChange={setDriverId}
              placeholder="Из справочника водителей"
              disabled={!selected}
              options={(driversData?.rows ?? []).filter((d) => d.isActive).map((d) => ({
                value: d.id,
                label: d.fullName + (busyDriverTrip.has(d.id) ? ` · занят в рейсе ${busyDriverTrip.get(d.id)}` : ''),
                disabled: busyDriverTrip.has(d.id),
              }))}
            />
            <span className="text-[11px] text-[#8a8a8a]">
              Назначение — одна транзакция: ASSIGNED → рейс + точки маршрута → записи плана обмена → SystemNote водителю
            </span>
          </div>
          {serverErrors.length > 0 && (
            <div className="mt-2 rounded-[3px] border border-[#e3b8b8] bg-[#fdf1f1] px-3 py-1.5 text-[12px] text-[#c43e1c]">
              <div className="font-semibold">Документ не проведён (аналог сообщений 1С):</div>
              {serverErrors.map((e, i) => (
                <div key={i}>• {e}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Диалог отмены (стиль 1С сохраняем shadcn-ом) */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Отмена заявки {cancelTarget?.number}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">Причина (справочник причин)</label>
            <C1Select
              className="w-full"
              value={cancelReason}
              onChange={setCancelReason}
              options={CANCEL_REASONS.map((r) => ({ value: r, label: r }))}
            />
          </div>
          <DialogFooter>
            <C1Button onClick={() => setCancelOpen(false)}>Не отменять</C1Button>
            <C1Button onClick={() => void cancel()}>Отменить с причиной</C1Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог создания заявки — кнопка «Создать» командной панели */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Новая заявка на перевозку (пул «Маршрутных листов»)</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void create(new FormData(e.currentTarget))
            }}
            className="grid gap-3"
          >
            <div className="grid gap-1.5">
              <label className="c1-label">Заказчик</label>
              <select name="contractorId" required className="c1-select w-full">
                <option value="" disabled>Из справочника контрагентов</option>
                {(contractorsData?.rows ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <label className="c1-label">Груз (номенклатура)</label>
              <C1Input name="cargo" required placeholder="Металлопрокат листовой, 2 шт." className="w-full" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <label className="c1-label">Вес, т</label>
                <C1Input name="weightT" type="number" step="0.1" min="0.1" required defaultValue="10" />
              </div>
              <div className="grid gap-1.5">
                <label className="c1-label">Погрузка</label>
                <input name="loadingAt" type="datetime-local" required className="c1-input w-full" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <label className="c1-label">Погрузка из</label>
                <select name="fromLocationId" required className="c1-select w-full">
                  <option value="" disabled>Пункт</option>
                  {(locationsData?.rows ?? []).map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <label className="c1-label">Выгрузка в</label>
                <select name="toLocationId" required className="c1-select w-full">
                  <option value="" disabled>Пункт</option>
                  {(locationsData?.rows ?? []).map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="c1-label">Окно выгрузки</label>
              <C1Input name="unloadingWindow" placeholder="сегодня 14:00–16:00" defaultValue="по согласованию" className="w-full" />
            </div>
            <div className="grid gap-1.5">
              <label className="c1-label">Документы для фотофиксации (через запятую)</label>
              <textarea name="docs" rows={2} placeholder="ТТН (2 экз.), Паспорт груза, Пропуск на терминал" className="c1-input h-auto w-full py-1" />
            </div>
            <div className="rounded-[3px] border border-[#bcd4ea] bg-[#eef5fc] px-3 py-2 text-[12px] text-[#2f6db0]">
              Заявка встанет в пул «Маршрутных листов» со статусом «Диспетчеризация» — останется выбрать ТС и водителя
              и провести документ кнопкой «Назначить — провести документ».
            </div>
            <DialogFooter>
              <C1Button onClick={() => setCreateOpen(false)}>Отмена</C1Button>
              <C1Button type="submit" accent disabled={creating}>{creating ? 'Проведение…' : 'Создать'}</C1Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
