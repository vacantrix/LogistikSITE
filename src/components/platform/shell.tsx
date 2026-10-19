'use client'

/**
 * Оболочка платформы: тёмно-синяя шапка, селектор «Роль» и два вида платформы:
 *  — внутренний контур АЭМЗ (Логист 1 / Логист 2): управление площадкой, сверка, реестр, отчёты;
 *  — кабинет перевозчика: участие в отборе рейсов, свои заявки и документы.
 */
import type { ReactNode } from 'react'
import { Building2, ShieldCheck, Truck, UserCog } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { RoleKind, TabKey } from '@/components/platform/common'

/** Полный список разделов с пометкой ролей: L — логист, C — перевозчик */
const NAV_ALL: { key: TabKey; label: string; roles: RoleKind[] }[] = [
  { key: 'dashboard', label: 'Сводка', roles: ['logist'] },
  { key: 'board', label: 'Площадка заявок', roles: ['logist', 'carrier'] },
  { key: 'apply', label: 'Подать заявку', roles: ['carrier'] },
  { key: 'my', label: 'Мои заявки', roles: ['carrier'] },
  { key: 'auctions', label: 'Торги', roles: ['logist'] },
  { key: 'verify', label: 'Сверка документов', roles: ['logist'] },
  { key: 'registry', label: 'Реестр рейсов', roles: ['logist'] },
  { key: 'directory', label: 'Справочники', roles: ['logist', 'carrier'] },
  { key: 'reports', label: 'Отчёты', roles: ['logist'] },
  { key: 'settings', label: 'Настройки', roles: ['logist'] },
]

/** Разделы, доступные выбранной роли */
export function navFor(role: RoleKind): { key: TabKey; label: string }[] {
  return NAV_ALL.filter((n) => n.roles.includes(role)).map(({ key, label }) => ({ key, label }))
}

export function firstTabFor(role: RoleKind): TabKey {
  return navFor(role)[0]?.key ?? 'board'
}

export interface RoleSelection {
  kind: RoleKind
  /** имя тестового логиста (для kind = logist) */
  logistName?: string
  /** перевозчик (для kind = carrier) */
  carrierId?: string | null
}

export function Shell({ tab, onNavigate, carriers, role, onRoleChange, children }: {
  tab: TabKey
  onNavigate: (t: TabKey) => void
  carriers: { id: string; name: string }[]
  role: RoleSelection
  onRoleChange: (r: RoleSelection) => void
  children: ReactNode
}) {
  const isLogist = role.kind === 'logist'
  const nav = navFor(role.kind)
  const roleValue = isLogist ? `logist:${role.logistName ?? 'Логист 1'}` : `carrier:${role.carrierId ?? ''}`

  const changeRole = (v: string) => {
    if (v.startsWith('logist:')) {
      onRoleChange({ kind: 'logist', logistName: v.slice('logist:'.length) })
    } else {
      const id = v.slice('carrier:'.length)
      onRoleChange({ kind: 'carrier', carrierId: id || carriers[0]?.id || null })
    }
  }

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
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {/* бейдж вида платформы */}
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                isLogist ? 'border-blue-400/40 bg-blue-500/15 text-blue-200' : 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
              }`}
              role="status"
            >
              {isLogist ? <UserCog className="h-3.5 w-3.5" aria-hidden /> : <Building2 className="h-3.5 w-3.5" aria-hidden />}
              {isLogist ? 'Внутренний контур АЭМЗ' : 'Кабинет перевозчика'}
            </span>
            <Truck className="hidden h-4 w-4 text-blue-300 sm:block" aria-hidden />
            <span className="hidden text-xs text-blue-200 sm:block">Роль:</span>
            <Select value={roleValue} onValueChange={changeRole}>
              <SelectTrigger className="h-9 w-[210px] border-white/20 bg-white/10 text-white [&>svg]:text-blue-200 sm:w-[250px]" aria-label="Выбор роли">
                <SelectValue placeholder="Выберите роль" />
              </SelectTrigger>
              <SelectContent>
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400" aria-hidden>
                  Внутренний контур АЭМЗ
                </div>
                <SelectItem value="logist:Логист 1">Логист 1</SelectItem>
                <SelectItem value="logist:Логист 2">Логист 2</SelectItem>
                <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400" aria-hidden>
                  Перевозчики
                </div>
                {carriers.map((c) => (
                  <SelectItem key={c.id} value={`carrier:${c.id}`}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <nav aria-label="Разделы платформы" className="border-t border-white/10">
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {nav.map((item) => (
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
          <div className="text-blue-300">
            {isLogist ? `Вид: внутренний контур · ${role.logistName ?? 'Логист'}` : 'Вид: кабинет перевозчика'} · заявки · торги · документы · нейросеть · 1С:ERP
          </div>
        </div>
      </footer>
    </div>
  )
}
