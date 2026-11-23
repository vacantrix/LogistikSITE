'use client'

/**
 * Экран входа в кабинет прототипа (демо-контур). Стиль по мотивам референса
 * LogistikSITE применён, контент не копируется: свои подписи и учётные записи.
 * Ролевая система контура: логисты и администрация.
 */
import { useEffect, useState } from 'react'
import { CircleAlert, Eye, EyeOff, KeyRound, Loader2, LogIn, ShieldCheck, UserCog } from 'lucide-react'
import { LogoMark } from './LogoMark'
import { clearSessionToken, saveSessionToken } from '@/lib/kontur/session-token'
import { apiFetch as fetch } from '@/lib/kontur/base-path'

export const DEMO_PASSWORD = 'demo2026'

export type AccountDto = {
  id: string
  login: string
  fullName: string
  position: string
  role: 'logist' | 'admin'
}

export function RoleMark({ role, className = 'h-4 w-4 shrink-0' }: { role: 'logist' | 'admin'; className?: string }) {
  return role === 'admin'
    ? <ShieldCheck className={`${className} text-slate-500`} aria-hidden />
    : <UserCog className={`${className} text-slate-500`} aria-hidden />
}

export const ROLE_LABEL: Record<'logist' | 'admin', string> = {
  admin: 'администрация',
  logist: 'логист',
}

export function LoginScreen({ onAuthed }: { onAuthed: () => void }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showDemo, setShowDemo] = useState(true)
  const [accounts, setAccounts] = useState<AccountDto[]>([])

  useEffect(() => {
    // загрузка демо-доступов после монтирования (setState в промисе, не синхронно в эффекте)
    fetch('/api/auth/accounts')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setAccounts(data))
      .catch(() => setAccounts([]))
  }, [])

  async function submit() {
    if (!login.trim() || !password) {
      setError('Укажите логин и пароль')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        clearSessionToken()
        setError(data?.error?.message ?? 'Не удалось войти')
        return
      }
      saveSessionToken(data?.id)
      onAuthed()
    } catch {
      setError('Сервер недоступен — попробуйте ещё раз')
    } finally {
      setBusy(false)
    }
  }

  async function quickLogin(acc: AccountDto) {
    setLogin(acc.login)
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: acc.login, password: DEMO_PASSWORD }),
      })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        saveSessionToken(data?.id)
        onAuthed()
      } else {
        clearSessionToken()
        setError('Не удалось войти демо-доступом')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 flex flex-col items-center text-center">
            <LogoMark className="h-14 w-auto drop-shadow-lg" />
            <h1 className="mt-4 text-2xl font-bold text-slate-900">АЭМЗ Поток</h1>
            <p className="mt-1 text-sm text-slate-500">Собственный парк · единая платформа</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
              className="space-y-4"
            >
              <div>
                <label htmlFor="login" className="mb-1.5 block text-sm font-medium text-slate-700">Логин</label>
                <input
                  id="login"
                  type="text"
                  autoComplete="username"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="например, logist1"
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">Пароль</label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-10 w-full rounded-lg border border-slate-300 px-3 pr-11 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                    className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="flex items-start gap-2 border-y border-slate-200 py-2.5 text-sm text-red-700" role="alert">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{error}</span>
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#0E1B2C] text-sm font-semibold text-white transition-colors hover:bg-[#16304f] disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LogIn className="h-4 w-4" aria-hidden />}
                Войти
              </button>
            </form>

            <button
              type="button"
              onClick={() => setShowDemo((v) => !v)}
              aria-expanded={showDemo}
              className="mt-4 flex w-full items-center justify-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-800"
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden />
              {showDemo ? 'Скрыть демо-доступы' : 'Демо-доступы для тестирования'}
            </button>
            {showDemo && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3" role="note">
                <p className="text-[11px] font-medium text-slate-500">
                  Пароль для всех учётных записей: <span className="font-mono text-slate-900">{DEMO_PASSWORD}</span>
                </p>
                <ul className="mt-2 space-y-1">
                  {accounts.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void quickLogin(a)}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-white"
                        aria-label={`Войти как ${a.fullName}`}
                      >
                        <RoleMark role={a.role} className="h-3.5 w-3.5 shrink-0" />
                        <span className="font-mono font-semibold text-slate-800">{a.login}</span>
                        <span className="truncate text-slate-500">{a.fullName} · {ROLE_LABEL[a.role]}</span>
                      </button>
                    </li>
                  ))}
                  {accounts.length === 0 && <li className="px-2 py-1 text-xs text-slate-400">Список загрузится после первого входа</li>}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="bg-[#0E1B2C] py-4 text-center text-xs text-blue-200">
        АЭМЗ · Отдел логистики
        <span className="ml-2 rounded border border-blue-100/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-blue-200">
          V 1.7
        </span>
      </footer>
    </div>
  )
}
