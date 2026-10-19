'use client'

/** Оболочка платформы: тёмно-синяя шапка с разделами, выбор перевозчика, липкий футер */
import type { ReactNode } from 'react'
import { ShieldCheck, Truck } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { TabKey } from '@/components/platform/common'

export const NAV: { key: TabKey; label: string }[] = [
  { key: 'dashboard', label: 'Сводка' },
  { key: 'board', label: 'Площадка заявок' },
  { key: 'my', label: 'Мои заявки' },
  { key: 'auctions', label: 'Торги' },
  { key: 'verify', label: 'Сверка документов' },
  { key: 'registry', label: 'Реестр рейсов' },
  { key: 'directory', label: 'Справочники' },
  { key: 'reports', label: 'Отчёты' },
  { key: 'settings', label: 'Настройки' },
]

export function Shell({ tab, onNavigate, carriers, activeCarrierId, onCarrierChange, children }: {
  tab: TabKey
  onNavigate: (t: TabKey) => void
  carriers: { id: string; name: string }[]
  activeCarrierId: string | null
  onCarrierChange: (id: string) => void
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-40 bg-[#0E1B2C] text-white shadow-lg shadow-slate-900/10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight sm:text-base">Платформа привлечённого транспорта</div>
              <div className="text-[11px] uppercase tracking-widest text-blue-300">АЭМЗ · отдел логистики</div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Truck className="hidden h-4 w-4 text-blue-300 sm:block" aria-hidden />
            <span className="hidden text-xs text-blue-200 sm:block">Агент действует как:</span>
            <Select value={activeCarrierId ?? undefined} onValueChange={onCarrierChange}>
              <SelectTrigger className="h-9 w-[210px] border-white/20 bg-white/10 text-white [&>svg]:text-blue-200 sm:w-[240px]" aria-label="Выбор перевозчика">
                <SelectValue placeholder="Выберите перевозчика" />
              </SelectTrigger>
              <SelectContent>
                {carriers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <nav aria-label="Разделы платформы" className="border-t border-white/10">
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV.map((item) => (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                aria-current={tab === item.key ? 'page' : undefined}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
                  tab === item.key
                    ? 'bg-white font-semibold text-[#0E1B2C]'
                    : 'text-blue-100 hover:bg-white/10 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>

      <footer className="mt-auto bg-[#0E1B2C] text-blue-100" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs">
          <div>АЭМЗ · Отдел логистики — демо-стенд платформы · данные учебные</div>
          <div className="text-blue-300">Заявки · торги · документы · нейросеть · 1С:ERP — в одном окне</div>
        </div>
      </footer>
    </div>
  )
}
