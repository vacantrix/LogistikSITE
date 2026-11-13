'use client'

// Рабочее место сбыта — форма «Заказы грузоотправителей» с деревом заказов и
// нижней панелью «Путевые листы» (имитация формы 1С из скриншота «Учет металла»).

import { Fragment, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { C1Button, C1Checkbox, C1Input, C1Select, FormTitleBar } from '@/components/1c/kit'
import { apiPost } from './api'
import { usePoll } from './usePoll'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { REQUEST_STATUSES, STATUS_LABELS } from '@/lib/1c/statuses'

type Catalog = { rows: { id: string; name: string; address?: string }[] }
type RequestRow = {
  id: string
  number: string
  status: string
  contractor: { name: string }
  cargo: string
  weightT: number
  from: { name: string }
  to: { name: string }
  loadingAt: string
  unloadingWindow: string
  docs: string[]
  vehicle: { model: string; plate: string } | null
  driver: { fullName: string } | null
  assignedBy: string | null
  closeReason: string | null
}
type TripRow = {
  number: string
  status: string
  contractor: { name: string }
  cargo: string
  weightT: number
  from: { name: string }
  to: { name: string }
  loadingAt: string
  unloadingWindow: string
  vehicle: { model: string; plate: string } | null
  trailer: { model: string; plate: string } | null
  driver: { fullName: string } | null
}

const fmtT = (t: number): string =>
  new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(t)

const fmtDateOnly = (iso: string): string => {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// квадрат сворачивания дерева 1С: ⊖ / ⊕
function TreeIcon({ open }: { open: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" className="shrink-0">
      <rect x="0.5" y="0.5" width="10" height="10" rx="1.5" fill="#fff" stroke="#7a9cc0" />
      <path d="M2.5 5.5h6" stroke="#2f6db0" strokeWidth="1.2" />
      {!open && <path d="M5.5 2.5v6" stroke="#2f6db0" strokeWidth="1.2" />}
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="#2f7a36" strokeWidth="1.6" /></svg>
  )
}

export function RequestsScreen({ onClose }: { onClose?: () => void }) {
  const { data, reload } = usePoll<{ requests: RequestRow[]; counts: Record<string, number> }>('/api/office/requests')
  const { data: contractors } = usePoll<Catalog>('/api/office/catalog/contractors')
  const { data: locations } = usePoll<Catalog>('/api/office/catalog/locations')
  const { data: tripsData } = usePoll<{ trips: TripRow[] }>('/api/office/trips')

  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [period, setPeriod] = useState<'today' | 'all'>('today')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [onlyActiveSheets, setOnlyActiveSheets] = useState(false)

  // отбор по периоду (как «Период: Сегодня» в шапке формы 1С)
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
  const rows = useMemo(() => {
    const all = data?.requests ?? []
    return all
      .filter((r) => (period === 'today' ? new Date(r.loadingAt) >= startOfDay : true))
      .filter((r) => statusFilter === 'ALL' || r.status === statusFilter)
  }, [data, statusFilter, period, startOfDay])

  // агрегаты шапки отбора: число машин/рейсов, вес по видам продукции
  const agg = useMemo(() => {
    let machines = 0, tripsCount = 0, sheetCount = 0
    const byKind = { прокат: 0, катанка: 0, прочее: 0 }
    for (const r of rows) {
      const c = r.cargo.toLowerCase()
      const key = c.includes('прокат') ? 'прокат' : c.includes('катанк') || c.includes('мото') ? 'катанка' : 'прочее'
      byKind[key] += r.weightT
      if (r.vehicle) { machines += 1; tripsCount += 1 }
    }
    const trips = tripsData?.trips ?? []
    sheetCount = trips.filter((t) => (onlyActiveSheets ? !['DONE', 'CANCELLED'].includes(t.status) : true)).length
    return { machines, tripsCount, byKind, sheetCount }
  }, [rows, tripsData, onlyActiveSheets])

  // дерево: контрагент → заявка (спецификация) → пункт разгрузки
  const groups = useMemo(() => {
    const map = new Map<string, RequestRow[]>()
    for (const r of rows) {
      const arr = map.get(r.contractor.name) ?? []
      arr.push(r)
      map.set(r.contractor.name, arr)
    }
    return [...map.entries()]
  }, [rows])

  const totals = useMemo(() => {
    const start = rows.reduce((s, r) => s + r.weightT, 0)
    const out = rows.filter((r) => r.vehicle).reduce((s, r) => s + r.weightT, 0)
    return { start, out, rest: start - out }
  }, [rows])

  function toggle(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function create(form: FormData) {
    setSaving(true)
    try {
      const docs = String(form.get('docs') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const res = await apiPost<{ request: { number: string } }>('/api/office/requests', {
        contractorId: form.get('contractorId'),
        cargo: form.get('cargo'),
        weightT: Number(form.get('weightT')),
        fromLocationId: form.get('fromLocationId'),
        toLocationId: form.get('toLocationId'),
        loadingAt: new Date(String(form.get('loadingAt'))).toISOString(),
        unloadingWindow: form.get('unloadingWindow'),
        docs,
        actor: 'Логист',
      })
      toast.success(`Заявка ${res.request.number} создана — статус DISPATCH`)
      setOpen(false)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка создания')
    } finally {
      setSaving(false)
    }
  }

  const sheets = (tripsData?.trips ?? []).filter((t) => (onlyActiveSheets ? !['DONE', 'CANCELLED'].includes(t.status) : true))

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <FormTitleBar title="Заказы грузоотправителей" onClose={onClose} />

      {/* Строка отбора (шапка формы 1С) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2.5 py-1.5">
        <span className="c1-label">Период:</span>
        <C1Select
          className="w-[130px] !border-[#ffc94d]"
          value={period}
          onChange={(v) => setPeriod(v as 'today' | 'all')}
          options={[
            { value: 'today', label: 'Сегодня' },
            { value: 'all', label: 'Все время' },
          ]}
        />
        <span className="c1-label">Транспортная компания:</span>
        <C1Select className="w-[180px]" value="" onChange={() => {}} options={[{ value: '', label: 'АЗМЗ ООО' }]} disabled />
        <span className="c1-label">Число машин:</span>
        <span className="c1-input inline-flex w-[46px] items-center justify-end bg-[#fbfbfb]">{agg.machines}</span>
        <span className="c1-label">Число рейсов:</span>
        <span className="c1-input inline-flex w-[46px] items-center justify-end bg-[#fbfbfb]">{agg.tripsCount}</span>
        <span className="c1-label">Вес машин:</span>
        <span className="c1-label text-[#1c1c1c]">Прокат:</span>
        <span className="c1-input inline-flex w-[86px] items-center justify-end bg-[#fbfbfb]">{fmtT(agg.byKind.прокат)}</span>
        <span className="c1-label text-[#1c1c1c]">Катанка:</span>
        <span className="c1-input inline-flex w-[86px] items-center justify-end bg-[#fbfbfb]">{fmtT(agg.byKind.катанка)}</span>
        <span className="c1-label text-[#1c1c1c]">Прочее:</span>
        <span className="c1-input inline-flex w-[86px] items-center justify-end bg-[#fbfbfb]">{fmtT(agg.byKind.прочее)}</span>
      </div>

      {/* Командная панель формы */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2 py-1">
        <C1Button className="!h-[24px]" title="Обновить список" onClick={() => reload()}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M12 7a5 5 0 11-1.5-3.6M12 1.5V5H8.5" stroke="#2f6db0" strokeWidth="1.3" strokeLinecap="round" /></svg>
          Обновить
        </C1Button>
        <C1Button className="!h-[24px]" onClick={() => setOpen(true)}>
          <PlusIcon />
          Создать заказ
        </C1Button>
        <span className="c1-label ml-2">Статус продукции:</span>
        <C1Select
          className="w-[210px]"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[{ value: 'ALL', label: '(все статусы)' }, ...REQUEST_STATUSES.map((s) => ({ value: s, label: `${STATUS_LABELS[s]} (${data?.counts[s] ?? 0})` }))]}
        />
        <C1Button className="!h-[24px] !px-2" title="Сбросить отбор" onClick={() => setStatusFilter('ALL')}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="#c43e1c" strokeWidth="1.4" /></svg>
        </C1Button>
        <span className="ml-auto text-[11px] text-[#8a8a8a]">Зеленая строка — заказ вывозится (есть ТС); итоги по контрагентам — голубые</span>
      </div>

      {/* Дерево заказов */}
      <div className="c1-scroll min-h-[160px] flex-1 overflow-auto">
        <table className="c1-table">
          <thead>
            <tr>
              <th className="w-[26px] min-w-[26px] px-0" />
              <th className="min-w-[300px]">Контрагент / Заказ / Пункт разгрузки</th>
              <th className="min-w-[180px]">Номенклатура</th>
              <th className="min-w-[130px]">Комментарий</th>
              <th className="min-w-[130px]">Грузополучатель</th>
              <th className="min-w-[190px]">Заказ ТС</th>
              <th className="w-[100px] text-right">На начало</th>
              <th className="w-[100px] text-right">На вывоз</th>
              <th className="w-[100px] text-right">Остаток</th>
            </tr>
          </thead>
          <tbody>
            {/* Общий итог — жёлтая строка, как в 1С */}
            <tr className="c1-row-yellow font-semibold">
              <td />
              <td>Общий итог:</td>
              <td /><td /><td /><td />
              <td className="text-right">{fmtT(totals.start)}</td>
              <td className="text-right">{fmtT(totals.out)}</td>
              <td className="text-right">{fmtT(totals.rest)}</td>
            </tr>

            {groups.map(([name, list]) => {
              const isOpen = !collapsed.has(name)
              const gStart = list.reduce((s, r) => s + r.weightT, 0)
              const gOut = list.filter((r) => r.vehicle).reduce((s, r) => s + r.weightT, 0)
              return (
                <Fragment key={`grp-${name}`}>
                  {/* Контрагент — голубая (циан) строка группы */}
                  <tr key={`g-${name}`} className="c1-row-cyan font-semibold" onClick={() => toggle(name)}>
                    <td className="px-1 text-center"><TreeIcon open={isOpen} /></td>
                    <td>{name}</td>
                    <td /><td /><td /><td />
                    <td className="text-right">{fmtT(gStart)}</td>
                    <td className="text-right">{fmtT(gOut)}</td>
                    <td className="text-right">{fmtT(gStart - gOut)}</td>
                  </tr>
                  {isOpen &&
                    list.map((r) => {
                      const dispatched = Boolean(r.vehicle)
                      return (
                        <Fragment key={`ord-${r.id}`}>
                          {/* Заявка (спецификация) */}
                          <tr key={`o-${r.id}`}>
                            <td className="px-1 text-center">
                              <svg width="11" height="11" viewBox="0 0 11 11" className="mx-auto">
                                <rect x="0.5" y="0.5" width="10" height="10" rx="1.5" fill="#fff" stroke="#c9c9c9" />
                                <path d="M2.5 5.5h6" stroke="#9ab4cc" strokeWidth="1.2" />
                              </svg>
                            </td>
                            <td style={{ paddingLeft: 26 }}>
                              <span className="c1-link">Заявка {r.number}</span>
                              <span className="text-[#8a8a8a]"> от {fmtDateOnly(r.loadingAt)}</span>
                            </td>
                            <td /><td />
                            <td>{r.to.name}</td>
                            <td>{r.vehicle ? `Заказ на ТС ${r.number} · ${r.vehicle.plate}` : ''}</td>
                            <td className="text-right">{fmtT(r.weightT)}</td>
                            <td className="text-right">{dispatched ? fmtT(r.weightT) : '\u2013'}</td>
                            <td className="text-right">{dispatched ? '0,000' : fmtT(r.weightT)}</td>
                          </tr>
                          {/* Пункт разгрузки — зеленая строка, если заказ вывозится */}
                          <tr key={`l-${r.id}`} className={cn(dispatched && 'c1-row-green')}>
                            <td />
                            <td style={{ paddingLeft: 42 }}>{r.to.name}</td>
                            <td>{r.cargo}</td>
                            <td className="text-[#8a8a8a]">{r.unloadingWindow}{r.docs.length ? ` · ${r.docs.join(', ')}` : ''}</td>
                            <td>{r.to.name}</td>
                            <td>{r.driver ? `${r.driver.fullName}` : ''}</td>
                            <td /><td />
                            <td className="text-right">{fmtT(r.weightT)}</td>
                          </tr>
                        </Fragment>
                      )
                    })}
                </Fragment>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-[12px] text-[#8a8a8a]">Заказов по отбору нет — нажмите «Создать заказ»</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Разделитель + панель «Путевые листы» */}
      <div className="c1-splitter shrink-0" />
      <div className="flex min-h-[200px] shrink-0 flex-col overflow-hidden" style={{ height: 264 }}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2 py-1.5">
          <C1Button className="!h-[25px]" title="Обновить путевые листы" onClick={() => reload()}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M12 7a5 5 0 11-1.5-3.6M12 1.5V5H8.5" stroke="#2f6db0" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </C1Button>
          <C1Button accent className="!h-[27px] !text-[13px]">
            <svg width="9" height="11" viewBox="0 0 9 11"><path d="M1 1l7 4.5L1 10z" fill="#4a2f00" /></svg>
            «Путевые листы»
          </C1Button>
          <C1Button className="!h-[25px]">
            <PlusIcon />
            Добавить
          </C1Button>
          <span className="c1-label">Дата путевого листа:</span>
          <C1Input type="date" className="w-[130px]" />
          <span className="c1-label">Машины:</span>
          <span className="c1-input inline-flex w-[40px] items-center justify-end bg-[#fbfbfb]">{sheets.length}</span>
          <span className="c1-label">Кол-во:</span>
          <span className="c1-input inline-flex w-[86px] items-center justify-end bg-[#fbfbfb]">
            {fmtT(sheets.reduce((s, t) => s + (t.weightT ?? 0), 0))}
          </span>
          <span className="text-[12px] font-semibold text-[#c43e1c]">Контактное лицо: 8 (927) 385-68-18 Игорь Попов</span>
          <C1Checkbox className="ml-auto" checked={onlyActiveSheets} onChange={setOnlyActiveSheets} label="Не выполненные" />
        </div>

        <div className="c1-scroll min-h-0 flex-1 overflow-auto">
          <table className="c1-table">
            <thead>
              <tr>
                <th className="w-[34px] text-center">№/№</th>
                <th className="w-[24px] px-0" />
                <th className="w-[80px]">Дата док.</th>
                <th className="w-[80px]">Дата выг.</th>
                <th className="w-[110px]">Транспортная компания</th>
                <th className="w-[100px]">Номер ТС</th>
                <th className="w-[90px]">Прицеп</th>
                <th className="min-w-[150px]">Водитель</th>
                <th className="min-w-[140px]">Контрагент</th>
                <th className="min-w-[150px]">Спецификация</th>
                <th className="min-w-[160px]">Пункт разгрузки</th>
                <th className="min-w-[150px]">Продукция</th>
              </tr>
            </thead>
            <tbody>
              {sheets.map((t, i) => (
                <tr key={t.number}>
                  <td className="text-center">{i + 1}</td>
                  <td className="px-1 text-center">
                    <svg width="12" height="12" viewBox="0 0 12 12" className="mx-auto"><path d="M1.5 6.5L4.5 9.5 10.5 2.5" stroke="#2f8a2f" strokeWidth="1.5" fill="none" /></svg>
                  </td>
                  <td>{fmtDateOnly(t.loadingAt)}</td>
                  <td className="max-w-[120px]">{t.unloadingWindow}</td>
                  <td>АЗМЗ ООО</td>
                  <td>{t.vehicle?.plate ?? '—'}</td>
                  <td>{t.trailer?.plate ?? ''}</td>
                  <td>{t.driver?.fullName ?? '—'}</td>
                  <td>{t.contractor.name}</td>
                  <td>Заказ на ТС {t.number}</td>
                  <td>{t.to.name}</td>
                  <td>{t.cargo}</td>
                </tr>
              ))}
              {sheets.length === 0 && (
                <tr><td colSpan={12} className="py-6 text-center text-[12px] text-[#8a8a8a]">Путевых листов нет — рейсы создаются при проведении заявки в диспетчерской</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Диалог создания заказа (форма документа 1С) */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Новая заявка на перевозку (Заказ грузоотправителя)</DialogTitle>
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
                {(contractors?.rows ?? []).map((c) => (
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
                  {(locations?.rows ?? []).map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <label className="c1-label">Выгрузка в</label>
                <select name="toLocationId" required className="c1-select w-full">
                  <option value="" disabled>Пункт</option>
                  {(locations?.rows ?? []).map((l) => (
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
            <DialogFooter>
              <C1Button onClick={() => setOpen(false)}>Отмена</C1Button>
              <C1Button type="submit" accent disabled={saving}>{saving ? 'Проведение…' : 'Создать'}</C1Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
