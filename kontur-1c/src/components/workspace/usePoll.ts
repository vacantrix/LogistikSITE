'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Поллинг экранов офиса: 5 секунд на первой очереди (SSE — вторая очередь по ТЗ)
export function usePoll<T>(url: string, intervalMs = 5000): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tick = useRef(0)

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData((await res.json()) as T)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    }
  }, [url])

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setInterval>
    const loop = async () => {
      await load()
      if (alive) timer = setTimeout(loop, intervalMs)
    }
    void loop()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [load, intervalMs])

  const reload = useCallback(() => {
    tick.current += 1
    void load()
  }, [load])

  return { data, error, reload }
}
