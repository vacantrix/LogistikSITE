'use client'

import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'

/**
 * Кнопка установки приложения (PWA) на телефон.
 *
 * Появляется только когда браузер умеет установить приложение сам
 * (Chrome/Android, событие beforeinstallprompt; HTTPS обязателен — превью
 * отдаётся по нему). Нажатие открывает системный диалог «Установить»,
 * иконка ставится на домашний экран. В Safari/iOS системного диалога нет —
 * кнопка там не показывается (установка через «На экран „Домой“»).
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Событие ловится один раз на модуль — кнопки на разных экранах живут одной состояние. */
let captured: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    captured = e as BeforeInstallPromptEvent
    listeners.forEach((l) => l())
  })
}

export function usePwaInstall() {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    const notify = () => setAvailable(true)
    listeners.add(notify)
    if (captured) setAvailable(true)
    return () => {
      listeners.delete(notify)
    }
  }, [])
  return {
    canInstall: available,
    install: async (): Promise<boolean> => {
      if (!captured) return false
      await captured.prompt()
      const { outcome } = await captured.userChoice
      if (outcome === 'accepted') {
        captured = null
        setAvailable(false)
      }
      return outcome === 'accepted'
    },
  }
}

export function InstallAppButton({ variant = 'pill' }: { variant?: 'pill' | 'block' }) {
  const { canInstall, install } = usePwaInstall()
  if (!canInstall) return null

  if (variant === 'block') {
    return (
      <button
        onClick={() => void install()}
        className="w-full h-12 bg-[#F97316] text-white rounded-xl text-[14px] font-bold flex items-center justify-center gap-2 shadow-lg active:scale-[0.99] transition-transform"
      >
        <Download className="h-5 w-5" />
        Установить приложение
      </button>
    )
  }
  return (
    <button
      onClick={() => void install()}
      aria-label="Установить приложение на телефон"
      className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white bg-[#F97316] rounded-full px-2.5 py-1.5 shadow-[0_6px_18px_rgba(249,115,22,0.4)] active:scale-[0.97] transition-transform"
    >
      <Download className="h-3.5 w-3.5" />
      Установить приложение
    </button>
  )
}
