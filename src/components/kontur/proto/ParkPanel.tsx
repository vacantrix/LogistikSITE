'use client'

/**
 * «Собственный парк» — логистический контур АЭМЗ: все ТС, прицепы и водители
 * принадлежат заводу. Логисты назначают состав на рейс только отсюда;
 * привлечённый транспорт в контуре не используется.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/kontur/ui/card'
import { Truck, UserRound, Wrench } from 'lucide-react'
import type { StateResponse } from '@/lib/kontur/client-types'
import { DotWord, Pill } from './bits'

export function ParkPanel({ state }: { state: StateResponse }) {
  const busyVehicleIds = new Set(state.trips.filter((t) => t.status === 'active').map((t) => t.vehicleId))
  const busyDriverIds = new Set(state.trips.filter((t) => t.status === 'active').map((t) => t.driverId))

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        Транспорт и водители этого раздела принадлежат АО «АЭМЗ» (собственный парк). Назначение на рейс —
        только из этого парка; привлечённый транспорт в логистическом контуре не используется.
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="h-5 w-5 text-slate-500" />Тягачи ({state.vehicles.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-500">
                <th className="pb-2 pr-2 font-medium">Марка</th>
                <th className="pb-2 pr-2 font-medium">Госномер</th>
                <th className="pb-2 pr-2 font-medium">Грузоподъёмность</th>
                <th className="pb-2 pr-2 font-medium">Объём</th>
                <th className="pb-2 pr-2 font-medium">Принадлежность</th>
                <th className="pb-2 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {state.vehicles.map((v) => (
                <tr key={v.id} className="border-b border-slate-100">
                  <td className="py-2.5 pr-2 font-medium text-slate-900">{v.brand}</td>
                  <td className="py-2.5 pr-2 font-mono text-xs">{v.plate}</td>
                  <td className="py-2.5 pr-2">{v.capacityT ? `${v.capacityT} т` : '—'}</td>
                  <td className="py-2.5 pr-2">{v.volumeM3 ? `${v.volumeM3} м³` : '—'}</td>
                  <td className="py-2.5 pr-2"><Pill className="bg-emerald-100 text-emerald-700">собственный ТС АЭМЗ</Pill></td>
                  <td className="py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {v.isRepair ? (
                        <DotWord dot="bg-red-500" tone="danger"><Wrench className="h-3 w-3" />в ремонте</DotWord>
                      ) : busyVehicleIds.has(v.id) ? (
                        <DotWord dot="bg-blue-500">в рейсе</DotWord>
                      ) : (
                        <DotWord dot="bg-emerald-500">свободен</DotWord>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="h-5 w-5 text-slate-500" />Прицепы ({state.trailers.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-500">
                <th className="pb-2 pr-2 font-medium">Марка</th>
                <th className="pb-2 pr-2 font-medium">Госномер</th>
                <th className="pb-2 pr-2 font-medium">Тип</th>
                <th className="pb-2 pr-2 font-medium">Объём</th>
                <th className="pb-2 font-medium">Принадлежность</th>
              </tr>
            </thead>
            <tbody>
              {state.trailers.map((t) => (
                <tr key={t.id} className="border-b border-slate-100">
                  <td className="py-2.5 pr-2 font-medium text-slate-900">{t.brand}</td>
                  <td className="py-2.5 pr-2 font-mono text-xs">{t.plate}</td>
                  <td className="py-2.5 pr-2">{t.type}</td>
                  <td className="py-2.5 pr-2">{t.volumeM3 ? `${t.volumeM3} м³` : '—'}</td>
                  <td className="py-2.5"><Pill className="bg-emerald-100 text-emerald-700">собственный прицеп АЭМЗ</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRound className="h-5 w-5 text-slate-500" />Водители штатного состава ({state.drivers.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-500">
                <th className="pb-2 pr-2 font-medium">ФИО</th>
                <th className="pb-2 pr-2 font-medium">Телефон</th>
                <th className="pb-2 pr-2 font-medium">Статус</th>
                <th className="pb-2 font-medium">Занятость</th>
              </tr>
            </thead>
            <tbody>
              {state.drivers.map((d) => (
                <tr key={d.id} className="border-b border-slate-100">
                  <td className="py-2.5 pr-2 font-medium text-slate-900">{d.fullName}</td>
                  <td className="py-2.5 pr-2 font-mono text-xs">{d.phone}</td>
                  <td className="py-2.5 pr-2">
                    {d.status === 'active' ? (
                      <DotWord dot="bg-emerald-500">готов к работе</DotWord>
                    ) : (
                      <DotWord dot="bg-amber-500" tone="warning">{d.statusComment || 'недоступен'}</DotWord>
                    )}
                  </td>
                  <td className="py-2.5">
                    {busyDriverIds.has(d.id)
                      ? <DotWord dot="bg-blue-500">в рейсе</DotWord>
                      : <span className="text-xs text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
