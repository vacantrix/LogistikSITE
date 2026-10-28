'use client'

/**
 * Контекст прав платформы (Task 111): матрица «роль × право» грузится один раз
 * при входе и доступна всем разделам через useCan(). Правило видимости: нет права —
 * функция не отображается вовсе (не disabled), сервер дублирует проверку.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import type { PermKey } from '@/lib/perm-catalog'

export interface PermSnapshot {
  /** права текущей роли — список разрешённых ключей */
  mine: PermKey[]
  /** готовность загрузки */
  ready: boolean
}

const PermContext = createContext<PermSnapshot>({ mine: [], ready: false })

/** Провайдер: грузит права текущего пользователя (/api/permissions → mine) */
export function PermProvider({ children }: { children: ReactNode }) {
  const [mine, setMine] = useState<PermKey[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    api.permissions()
      .then((d) => {
        if (!alive) return
        setMine((d.mine ?? []) as PermKey[])
        setReady(true)
      })
      .catch(() => {
        // права не загрузились — не блокируем интерфейс: сервер всё равно проверит
        if (alive) setReady(true)
      })
    return () => { alive = false }
  }, [])

  const value = useMemo(() => ({ mine, ready }), [mine, ready])
  return <PermContext.Provider value={value}>{children}</PermContext.Provider>
}

/** Хук доступа к правам: can('draft:delete') → показывать ли функцию */
export function useCan(): (key: PermKey) => boolean {
  const { mine } = useContext(PermContext)
  return useCallback((key: PermKey) => mine.includes(key), [mine])
}

/** Список разрешённых ключей (для навигации и сложных случаев) */
export function usePerms(): PermSnapshot {
  return useContext(PermContext)
}
