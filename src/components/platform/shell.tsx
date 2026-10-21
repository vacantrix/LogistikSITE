'use client'

/**
 * Оболочка платформы: тёмно-синяя шапка с вошедшим пользователем и два вида платформы:
 *  — внутренний контур АЭМЗ (Логист 1 / Логист 2): площадка со встроенными торгами,
 *    сверка, реестр, справочники, отчёты;
 *  — кабинет перевозчика: участие в отборе рейсов, свои заявки и документы.
 */
import type { ReactNode } from 'react'
import { Building2, LogOut, ShieldCheck, Truck, UserCog } from 'lucide-react'
import type { RoleKind, TabKey } from '@/components/platform/common'

/** Полный список разделов с пометкой ролей: L — логист, C — перевозчик.
 *  Сводка удалена (полоса «Требует внимания» на площадке), торги влиты в площадку,
 *  настройки — будущий административный контур (экран settings.tsx остаётся в коде).
 *  Порядок вкладок перевозчика фиксирован (замечание пользователя): всё происходит
 *  по очереди — площадка → мои заявки → документы → экипаж → справочники. */
const NAV_ALL: { key: TabKey; label: string; roles: RoleKind[] }[] = [
  { key: 'board', label: 'Площадка заявок', roles: ['logist', 'carrier'] },
  { key: 'my', label: 'Мои заявки', roles: ['carrier'] },
  { key: 'apply', label: 'Подать документы', roles: ['carrier'] },
  { key: 'crew', label: 'Назначение экипажей', roles: ['carrier'] },
  { key: 'verify', label: 'Сверка документов', roles: ['logist'] },
  { key: 'registry', label: 'Реестр рейсов', roles: ['logist'] },
  { key: 'directory', label: 'Справочники', roles: ['logist', 'carrier'] },
  { key: 'reports', label: 'Отчёты', roles: ['logist'] },
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

export function Shell({ tab, onNavigate, role, userName, onLogout, children }: {
  tab: TabKey
  onNavigate: (t: TabKey) => void
  role: RoleSelection
  /** имя вошедшего пользователя (логист или перевозчик) */
  userName: string
  onLogout: () => void
  children: ReactNode
}) {
  const isLogist = role.kind === 'logist'
  const nav = navFor(role.kind)

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-40 bg-[#0E1B2C] text-white shadow-lg shadow-slate-900/10">
        <div className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight sm:text-base">АЭМЗ Логистика</div>
              <div className="text-[11px] uppercase tracking-widest text-slate-300">Отдел логистики</div>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {/* бейдж вида платформы. Real-time индикатор убран (Task 52):
                потеря связи теперь показывается оверлеем «Восстанавливаем соединение» */}
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
            {/* роль задаётся учётной записью: переключателя ролей больше нет */}
            <span className="max-w-[220px] truncate text-sm font-medium text-white sm:max-w-[280px]" title={userName}>
              {userName}
            </span>
            <button
              type="button"
              onClick={onLogout}
              className="flex h-9 items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3 text-xs font-semibold text-blue-100 transition-colors hover:bg-white/20 hover:text-white"
              aria-label="Выйти из платформы"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Выйти
            </button>
          </div>
        </div>
        <nav aria-label="Разделы платформы" className="border-t border-white/10">
          <div className="flex w-full gap-1 overflow-x-auto px-2 py-1.5 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

      <main className="w-full flex-1 px-4 py-6 sm:px-6">{children}</main>

      <footer className="mt-auto bg-[#0E1B2C] text-blue-100" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs">
          <div>АЭМЗ · Отдел логистики</div>
          <div className="text-blue-300">
            {isLogist ? userName : 'Кабинет перевозчика'}
          </div>
        </div>
      </footer>
    </div>
  )
}
