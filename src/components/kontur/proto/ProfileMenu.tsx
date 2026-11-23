'use client'

/**
 * Профильный элемент шапки (вид по референсу владельца: аватар · ФИО · должность
 * и организация · шеврон) — теперь настоящий: подставляет вошедшего пользователя
 * и раскрывает меню аккаунта (карточка профиля, смена аккаунта, выход).
 * Стиль по мотивам LogistikSITE применён, контент не копируется.
 */
import { useState } from 'react'
import {
  ChevronDown,
  CircleUserRound,
  LogOut,
  Mail,
  Phone,
  ShieldCheck,
  UserCog,
  UserRound,
} from 'lucide-react'
import { clearSessionToken, saveSessionToken } from '@/lib/kontur/session-token'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/kontur/ui/dropdown-menu'
import type { ProfileUser } from '@/lib/kontur/client-types'
import { DEMO_PASSWORD, ROLE_LABEL } from './LoginScreen'
import { apiFetch as fetch } from '@/lib/kontur/base-path'

export function RoleBadge({ role }: { role: 'logist' | 'admin' }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700"
    >
      {role === 'admin' ? <ShieldCheck className="h-3 w-3" aria-hidden /> : <UserCog className="h-3 w-3" aria-hidden />}
      {ROLE_LABEL[role]}
    </span>
  )
}

export function ProfileMenu({
  user,
  others,
  onSwitched,
  onLoggedOut,
  onOpenAdmin,
}: {
  user: ProfileUser
  others: { id: string; login: string; fullName: string; role: 'logist' | 'admin' }[]
  onSwitched: () => void
  onLoggedOut: () => void
  onOpenAdmin?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const org = 'АО «АЭМЗ»'
  const sub = [user.position, org].filter(Boolean).join(' · ')

  async function switchTo(login: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password: DEMO_PASSWORD }),
      })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        saveSessionToken(data?.id)
      }
      onSwitched()
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    setBusy(true)
    try {
      clearSessionToken()
      await fetch('/api/auth/logout', { method: 'POST' })
      onLoggedOut()
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          aria-label="Меню аккаунта"
          title={`${user.fullName} — меню аккаунта`}
          className="flex max-w-full items-center gap-2 rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-left transition-colors hover:bg-white/20 hover:text-white"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15" aria-hidden>
            <UserRound className="h-[18px] w-[18px] text-blue-100" />
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[13px] font-semibold text-white">{user.fullName}</span>
            <span className="truncate text-[10px] text-blue-100/85">{sub}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-blue-100/80" aria-hidden />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="px-0">
          <div className="flex flex-col items-center px-4 pb-2 pt-3 text-center">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100" aria-hidden>
              <CircleUserRound className="h-9 w-9 text-slate-400" />
            </span>
            <span className="mt-2.5 block break-words text-base font-bold leading-snug text-slate-900">{user.fullName}</span>
            <span className="mt-0.5 block break-words text-center text-xs leading-snug text-slate-500">{sub}</span>
            <span className="mt-1.5"><RoleBadge role={user.role} /></span>
          </div>
          <div className="space-y-1.5 border-t border-slate-100 px-3.5 pt-2.5">
            <span className="flex items-center gap-2 text-xs text-slate-600">
              <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              <span className={`min-w-0 truncate ${user.phone ? '' : 'text-slate-300'}`}>{user.phone || 'Телефон не указан'}</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-slate-600">
              <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              <span className={`min-w-0 truncate ${user.email ? '' : 'text-slate-300'}`}>{user.email || 'Почта не указана'}</span>
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user.role === 'admin' && onOpenAdmin && (
          <button
            type="button"
            role="menuitem"
            onClick={onOpenAdmin}
            className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-slate-100 focus:bg-slate-100"
          >
            <ShieldCheck className="h-4 w-4 text-slate-500" aria-hidden />
            Раздел «Администрирование»
          </button>
        )}
        {others.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs font-medium text-slate-500">Сменить аккаунт</DropdownMenuLabel>
            {others.map((a) => (
              <button
                key={a.id}
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => void switchTo(a.login)}
                className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-slate-100 focus:bg-slate-100 disabled:opacity-50"
              >
                {a.role === 'admin'
                  ? <ShieldCheck className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                  : <UserCog className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />}
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate">{a.fullName}</span>
                  <span className="block truncate text-xs text-slate-500">{a.login} · {ROLE_LABEL[a.role]}</span>
                </span>
              </button>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <button
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={() => void logout()}
          className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-red-600 outline-none transition-colors hover:bg-slate-100 focus:bg-slate-100 focus:text-red-700 disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Выйти
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
