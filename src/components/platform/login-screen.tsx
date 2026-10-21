'use client'

/**
 * Экран входа на платформу: логин + пароль из созданного справочника
 * пользователей. Демо-доступы показываются только на демо-стенде —
 * когда задан NEXT_PUBLIC_DEMO_PASSWORD (тот же, что SEED_PASSWORD при заполнении базы).
 */
import { useState } from 'react'
import { Building2, KeyRound, Loader2, LogIn, ShieldCheck, UserCog } from 'lucide-react'

/** Демо-доступы (демо-контур): пароль один, логины разные */
export const DEMO_ACCOUNTS: { login: string; name: string; role: 'logist' | 'carrier' }[] = [
  { login: 'logist1', name: 'Логист 1', role: 'logist' },
  { login: 'logist2', name: 'Логист 2', role: 'logist' },
  { login: 'carrier-a', name: 'ООО «Перевозчик А»', role: 'carrier' },
  { login: 'carrier-b', name: 'ООО «Перевозчик Б»', role: 'carrier' },
  { login: 'carrier-v', name: 'ООО «Перевозчик В»', role: 'carrier' },
  { login: 'carrier-g', name: 'ООО «Перевозчик Г»', role: 'carrier' },
]
export const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? ''

export function LoginScreen({ onAuthed }: { onAuthed: () => void }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDemo, setShowDemo] = useState(false)

  const submit = async () => {
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
        setError(data?.error ?? 'Не удалось войти')
        return
      }
      onAuthed()
    } catch {
      setError('Сервер недоступен — попробуйте ещё раз')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          {/* логотип */}
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0E1B2C] shadow-lg">
              <ShieldCheck className="h-7 w-7 text-blue-400" aria-hidden />
            </div>
            <h1 className="mt-4 text-2xl font-bold text-slate-900">АЭМЗ Логистика</h1>
            <p className="mt-1 text-sm text-slate-500">Платформа работы с привлечённым транспортом</p>
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
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
                  {error}
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

            {DEMO_PASSWORD && (
            <button
              type="button"
              onClick={() => setShowDemo((v) => !v)}
              aria-expanded={showDemo}
              className="mt-4 flex w-full items-center justify-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-800"
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden />
              {showDemo ? 'Скрыть демо-доступы' : 'Демо-доступы для тестирования'}
            </button>
            )}
            {DEMO_PASSWORD && showDemo && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3" role="note">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Пароль для всех: <span className="font-mono text-slate-900">{DEMO_PASSWORD}</span>
                </p>
                <ul className="mt-2 space-y-1">
                  {DEMO_ACCOUNTS.map((a) => (
                    <li key={a.login}>
                      <button
                        type="button"
                        onClick={() => {
                          setLogin(a.login)
                          setPassword(DEMO_PASSWORD)
                          setError(null)
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-white"
                        aria-label={`Подставить доступ ${a.name}`}
                      >
                        {a.role === 'logist'
                          ? <UserCog className="h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden />
                          : <Building2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />}
                        <span className="font-mono font-semibold text-slate-800">{a.login}</span>
                        <span className="truncate text-slate-500">{a.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="bg-[#0E1B2C] py-4 text-center text-xs text-blue-200">
        АЭМЗ · Отдел логистики
      </footer>
    </div>
  )
}
