'use client'

// «Главная страница» — стартовая страница 1С: плитки показателей и формы-списки

import { StatusDot } from './badges'
import { fmtDateTime } from './api'
import { usePoll } from './usePoll'
import { cn } from '@/lib/utils'
import { REQUEST_STATUSES, STATUS_LABELS } from '@/lib/1c/statuses'

type Dashboard = {
  counts: Record<string, number>
  total: number
  statusOrder: string[]
  activeTrips: {
    tripCode: string
    status: string
    lastEventType: string | null
    lastEventAt: string | null
    driver: string
    vehicle: string
    from: string | null
    to: string | null
  }[]
  feed: { id: number; user: string; action: string; entity: string; entityId: string | null; level: string; at: string }[]
}

const EVENT_RU: Record<string, string> = {
  DEPARTURE: 'в движении',
  ARRIVAL_LOADING: 'на погрузке',
  LOADING_DONE: 'погрузка завершена',
  REST_START: 'на стоянке',
  REST_END: 'с стоянки',
  ARRIVAL_UNLOADING: 'на выгрузке',
  UNLOADING_DONE: 'выгрузка завершена',
  TRIP_DONE: 'рейс завершён',
}

export function DashboardScreen() {
  const { data } = usePoll<Dashboard>('/api/office/dashboard')

  return (
    <div className="c1-scroll min-h-0 flex-1 overflow-y-auto bg-[#f4f4f4] p-3">
      {/* Плитки статусной модели (как формы стартовой страницы 1С) */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        {REQUEST_STATUSES.map((s) => (
          <div key={s} className="rounded-[3px] border border-[#d4d4d4] bg-white px-3 py-2">
            <div className="text-[20px] font-semibold leading-tight text-[#1c1c1c]">{data?.counts[s] ?? 0}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-tight text-[#5c5c5c]">
              <StatusDot status={s} />
              {STATUS_LABELS[s]}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-5">
        {/* Активные рейсы */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-[3px] border border-[#d4d4d4] bg-white xl:col-span-3">
          <div className="flex h-[30px] shrink-0 items-center border-b border-[#d4d4d4] bg-[#f2f2f2] px-2.5 text-[13px] font-semibold text-[#1c1c1c]">
            Активные рейсы
          </div>
          <div className="c1-scroll min-h-0 flex-1 overflow-auto">
            <table className="c1-table">
              <thead>
                <tr>
                  <th className="w-[110px]">Рейс</th>
                  <th className="w-[180px]">Водитель / ТС</th>
                  <th className="w-[150px]">Маршрут</th>
                  <th>Состояние</th>
                </tr>
              </thead>
              <tbody>
                {(data?.activeTrips ?? []).map((t) => (
                  <tr key={t.tripCode}>
                    <td><span className="c1-link">{t.tripCode}</span></td>
                    <td>
                      <div>{t.driver}</div>
                      <div className="text-[11px] text-[#8a8a8a]">{t.vehicle}</div>
                    </td>
                    <td>{t.from} → {t.to}</td>
                    <td>
                      <StatusDot status={t.status === 'in_progress' ? 'IN_PROGRESS' : 'ASSIGNED'} withLabel />
                      {t.lastEventType && (
                        <div className="text-[11px] text-[#8a8a8a]">
                          {EVENT_RU[t.lastEventType] ?? t.lastEventType} · {fmtDateTime(t.lastEventAt)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {(data?.activeTrips ?? []).length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-[12px] text-[#8a8a8a]">Нет активных рейсов</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Лента журнала */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-[3px] border border-[#d4d4d4] bg-white xl:col-span-2">
          <div className="flex h-[30px] shrink-0 items-center border-b border-[#d4d4d4] bg-[#f2f2f2] px-2.5 text-[13px] font-semibold text-[#1c1c1c]">
            Журнал регистрации (последние события)
          </div>
          <div className="c1-scroll min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
            {(data?.feed ?? []).map((f) => (
              <div key={f.id} className="flex items-start gap-2 border-b border-[#f0f0f0] py-1 text-[12px] last:border-0">
                <span
                  className={cn('mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full')}
                  style={{ background: f.level === 'warning' ? '#e8a000' : f.level === 'error' ? '#c43e1c' : '#b8b8b8' }}
                />
                <div className="min-w-0">
                  <div className="truncate">
                    <span className="font-medium">{f.user}</span> · {f.action}
                    {f.entityId ? <span className="text-[#8a8a8a]"> · {f.entityId}</span> : null}
                  </div>
                  <div className="text-[11px] text-[#8a8a8a]">{fmtDateTime(f.at)}</div>
                </div>
              </div>
            ))}
            {(data?.feed ?? []).length === 0 && (
              <div className="py-6 text-center text-[12px] text-[#8a8a8a]">Событий нет</div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-[#8a8a8a]">
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="9" rx="1" stroke="#8a8a8a" strokeWidth="1.1" /><path d="M4 13h6" stroke="#8a8a8a" strokeWidth="1.1" /></svg>
        Экраны обновляются опросом раз в 5 секунд; SSE — вторая очередь после стабилизации контрактов.
      </div>
    </div>
  )
}
