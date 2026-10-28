'use client'

/**
 * Контекст прав платформы: итоговые права пользователя (должность ± личные исключения)
 * доступны всем разделам через useCan(). Правило видимости: нет права — функция
 * не отображается вовсе (не disabled), сервер дублирует проверку.
 *
 * Права перечитываются без перезагрузки страницы: по live-событию PERMS_CHANGED
 * (администрация изменила должность или исключения — refreshKey), при возврате на вкладку
 * и после ответа сервера «нет права» (событие PERMS_STALE_EVENT из api.ts).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, PERMS_STALE_EVENT } from '@/lib/api'
import type { PermKey } from '@/lib/perm-catalog'

export interface PermSnapshot {
  /** итоговые права пользователя — список разрешённых ключей */
  mine: PermKey[]
  /** должность пользователя */
  templateName: string | null
  /** готовность загрузки */
  ready: boolean
}

const PermContext = createContext<PermSnapshot>({ mine: [], templateName: null, ready: false })

export function PermProvider({ refreshKey = 0, children }: { refreshKey?: number; children: ReactNode }) {
  const [mine, setMine] = useState<PermKey[]>([])
  const [templateName, setTemplateName] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    api.permissions()
      .then((d) => {
        if (!alive) return
        setMine((d.mine ?? []) as PermKey[])
        setTemplateName(d.templateName ?? null)
        setReady(true)
      })
      .catch(() => {
        // права не загрузились — не блокируем интерфейс: сервер всё равно проверит
        if (alive) setReady(true)
      })
    return () => { alive = false }
  }, [refreshKey, nonce])

  // вернулись на вкладку или сервер ответил «нет права» — перечитать права
  useEffect(() => {
    const reload = () => setNonce((n) => n + 1)
    const onVisible = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(PERMS_STALE_EVENT, reload)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(PERMS_STALE_EVENT, reload)
    }
  }, [])

  const value = useMemo(() => ({ mine, templateName, ready }), [mine, templateName, ready])
  return <PermContext.Provider value={value}>{children}</PermContext.Provider>
}

/** Хук доступа к правам: can('draft:delete') → показывать ли функцию */
export function useCan(): (key: PermKey) => boolean {
  const { mine } = useContext(PermContext)
  return useCallback((key: PermKey) => mine.includes(key), [mine])
}

/** Список разрешённых ключей и должность (для навигации и сложных случаев) */
export function usePerms(): PermSnapshot {
  return useContext(PermContext)
}
