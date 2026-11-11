'use client'

// Демо-панель: управление сценарием и имитатор приложения водителя

import { useState } from 'react'
import { C1Button, C1Checkbox, C1Select, FormTitleBar } from '@/components/1c/kit'
import { apiPost, apiGet } from './api'
import { usePoll } from './usePoll'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { CheckCircle2, Circle, XCircle } from 'lucide-react'
import { PRETRIP_STEPS } from '@/lib/1c/statuses'

type AutoflowStep = { step: string; ok: boolean; detail: string }
type Driver = { id: string; fullName: string; appId: string | null }
type Order = {
  number: string
  client: string
  cargo: string
  fromLabel: string
  toLabel: string
  status: 'DISPATCH' | 'ASSIGNED' | 'DONE'
  vehicle: string
  distanceKm: number
  durationMin: number
}
type LogEntry = { at: string; orderId: string; action: string }

const STATUS_RU: Record<string, string> = { DISPATCH: 'в диспетчерской', ASSIGNED: 'назначена', DONE: 'выполнена' }
const STATUS_DOT: Record<string, string> = { DISPATCH: '#e8a000', ASSIGNED: '#2f6db0', DONE: '#2f8a2f' }

export function DemoScreen({ onClose }: { onClose?: () => void }) {
  const { data: driversData } = usePoll<{ rows: Driver[] }>('/api/office/catalog/drivers', 30000)
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState<AutoflowStep[]>([])

  // имитатор приложения водителя
  const [driverId, setDriverId] = useState<string>('')
  const [orders, setOrders] = useState<Order[]>([])
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const [localSteps, setLocalSteps] = useState<string[]>([])
  const [orderNumber, setOrderNumber] = useState<string>('')
  const [driverMsg, setDriverMsg] = useState<string>('')

  async function run(action: 'random-request' | 'autoflow' | 'reset') {
    setBusy(action)
    try {
      const res = await apiPost<{ ok: boolean; message?: string; log?: AutoflowStep[] }>('/api/office/demo', { action })
      if (action === 'autoflow' && res.log) {
        setLog(res.log)
        const failed = res.log.filter((l) => !l.ok)
        if (failed.length === 0) toast.success('Автопрогон завершён: весь сценарий прошёл')
        else toast.error('Автопрогон: есть отказ шагов')
      } else {
        toast.success(res.message ?? 'Готово')
        if (action === 'reset') { setLog([]); setOrders([]); setOrderNumber('') }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(null)
    }
  }

  async function refreshOrders(dId: string) {
    setDriverMsg('')
    try {
      const res = await apiGet<{ orders: Order[]; eventLog: LogEntry[] }>('/api/1c/orders', { headers: { 'X-Driver-Id': dId } })
      setOrders(res.orders)
      setLogEntries(res.eventLog)
      const active = res.orders.find((o) => o.status === 'ASSIGNED')
      setOrderNumber((prev) => (prev && res.orders.some((o) => o.number === prev) ? prev : active?.number ?? ''))
    } catch (e) {
      setDriverMsg(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  async function driverAction(action: string, stepId?: string) {
    if (!driverId || !orderNumber) return
    try {
      const res = await apiPost<{ ok: boolean }>('/api/1c/orders', { orderId: orderNumber, action, ...(stepId ? { stepId } : {}) }, {
        headers: { 'X-Driver-Id': driverId },
      })
      if (action === 'PRETRIP_STEP' && stepId) {
        setLocalSteps((s) => (s.includes(stepId) ? s : [...s, stepId]))
        setDriverMsg(`Шаг ${stepId} записан (PRETRIP_STEP)`)
      } else {
        setDriverMsg(`Действие ${action} принято сервером «1С»`)
      }
      await refreshOrders(driverId)
      if (res.ok && action === 'COMPLETE_TRIP') toast.success('Рейс завершён: TRIP_DONE, заявка DONE')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Отказ'
      setDriverMsg(`Отказ: ${message}`)
      toast.error(message)
    }
  }

  const order = orders.find((o) => o.number === orderNumber)
  // шаги осмотра: оптимистично локальные + подтверждённые сервером (eventLog из GET /api/1c/orders)
  const stepsDone = Array.from(
    new Set([
      ...localSteps,
      ...logEntries
        .filter((e) => e.orderId === orderNumber && e.action.startsWith('PRETRIP_STEP:'))
        .map((e) => e.action.slice('PRETRIP_STEP:'.length)),
    ]),
  )
  const allStepsDone = stepsDone.length >= 6

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <FormTitleBar title="Демо-панель" onClose={onClose} />

      <div className="flex min-h-0 flex-1 gap-0">
        {/* Левая колонка: сценарий */}
        <div className="flex w-[340px] shrink-0 flex-col border-r border-[#d4d4d4]">
          <div className="flex h-[30px] shrink-0 items-center border-b border-[#d4d4d4] bg-[#f2f2f2] px-2.5 text-[13px] font-semibold">
            Сценарий демонстрации
          </div>
          <div className="c1-scroll flex-1 space-y-2 overflow-y-auto p-2.5">
            <C1Button className="w-full justify-start" disabled={busy !== null} onClick={() => void run('random-request')}>
              <svg width="11" height="11" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="#2f7a36" strokeWidth="1.6" /></svg>
              Создать случайную заявку
            </C1Button>
            <C1Button accent className="w-full justify-start" disabled={busy !== null} onClick={() => void run('autoflow')}>
              <svg width="9" height="11" viewBox="0 0 9 11"><path d="M1 1l7 4.5L1 10z" fill="#4a2f00" /></svg>
              Автопрогон сквозного сценария
            </C1Button>
            <C1Button className="w-full justify-start" disabled={busy !== null} onClick={() => void run('reset')}>
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M12 7a5 5 0 11-1.5-3.6M12 1.5V5H8.5" stroke="#c43e1c" strokeWidth="1.3" strokeLinecap="round" /></svg>
              Сброс и пересев базы
            </C1Button>
            {busy && <div className="text-[12px] text-[#8a8a8a]">Выполняется…</div>}

            {log.length > 0 && (
              <div className="rounded-[3px] border border-[#d4d4d4] p-2">
                {log.map((l, i) => (
                  <div key={i} className="flex items-start gap-1.5 py-0.5 text-[12px]">
                    {l.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2f8a2f]" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#c43e1c]" />}
                    <div className="min-w-0">
                      <div className="font-medium">{l.step}</div>
                      <div className="text-[11px] text-[#8a8a8a]">{l.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Правая колонка: имитатор приложения водителя */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[30px] shrink-0 items-center border-b border-[#d4d4d4] bg-[#f2f2f2] px-2.5 text-[13px] font-semibold">
            Приложение водителя · имитатор контракта /api/1c/orders
          </div>
          <div className="c1-scroll flex-1 space-y-3 overflow-y-auto p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="c1-label">Водитель (X-Driver-Id):</span>
              <C1Select
                className="w-[280px]"
                value={driverId}
                onChange={(v) => { setDriverId(v); void refreshOrders(v) }}
                placeholder="Выберите водителя"
                options={(driversData?.rows ?? []).map((d) => ({ value: d.id, label: d.fullName + (d.appId ? ' · демо-приложение' : '') }))}
              />
              {driverId && (
                <C1Button onClick={() => void refreshOrders(driverId)}>
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M12 7a5 5 0 11-1.5-3.6M12 1.5V5H8.5" stroke="#2f6db0" strokeWidth="1.3" strokeLinecap="round" /></svg>
                  Обновить GET /api/1c/orders
                </C1Button>
              )}
            </div>

            {orders.length > 0 && (
              <table className="c1-table">
                <thead>
                  <tr>
                    <th className="w-[120px]">Заявка</th>
                    <th className="w-[130px]">Статус</th>
                    <th className="w-[200px]">Груз</th>
                    <th className="w-[180px]">Маршрут</th>
                    <th>Расчёт маршрута</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.number} className={cn(orderNumber === o.number && 'c1-row-sel')} onClick={() => { setOrderNumber(o.number); setLocalSteps([]); setDriverMsg('') }}>
                      <td><span className="c1-link">{o.number}</span></td>
                      <td>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block h-[8px] w-[8px] rounded-full" style={{ background: STATUS_DOT[o.status] ?? '#8a8a8a' }} />
                          {STATUS_RU[o.status] ?? o.status}
                        </span>
                      </td>
                      <td>{o.cargo}</td>
                      <td>{o.fromLabel} → {o.toLabel}</td>
                      <td>{o.distanceKm} км · {o.durationMin} мин</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {order && order.status === 'ASSIGNED' && (
              <div className="rounded-[3px] border border-[#d4d4d4] p-2.5">
                <div className="mb-1.5 text-[13px] font-semibold">Предрейсовая фотофиксация — 6 шагов</div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {PRETRIP_STEPS.map((s) => {
                    const done = stepsDone.includes(s.stepId)
                    return (
                      <C1Button key={s.stepId} className={cn('justify-start !h-auto py-1 text-left', done && 'border-[#9cc49c] bg-[#eef7ee]')} onClick={() => void driverAction('PRETRIP_STEP', s.stepId)}>
                        {done ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#2f8a2f]" /> : <Circle className="h-3.5 w-3.5 shrink-0 text-[#8a8a8a]" />}
                        <span className="truncate">{s.stepId}</span>
                      </C1Button>
                    )
                  })}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <C1Button onClick={() => void driverAction('ACCEPT')}>ACCEPT — взять заявку</C1Button>
                  <C1Button accent disabled={!allStepsDone} onClick={() => void driverAction('START_ROUTE')}>
                    START_ROUTE — начать маршрут
                  </C1Button>
                  <C1Button disabled={!allStepsDone || stepsDone.length === 0} onClick={() => void driverAction('COMPLETE_TRIP')}>
                    COMPLETE_TRIP — завершить рейс
                  </C1Button>
                </div>
                {!allStepsDone && (
                  <div className="mt-1.5 text-[11px] text-[#8a8a8a]">
                    Кнопка «Начать маршрут» активна после всех шести шагов — сервер отклонит START_ROUTE с причиной (409).
                  </div>
                )}
              </div>
            )}

            {driverMsg && (
              <div className="rounded-[3px] border border-[#bcd2ea] bg-[#f4f8fd] px-2.5 py-1.5 font-mono text-[11px] text-[#2f6db0]">{driverMsg}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
