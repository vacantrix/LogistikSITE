'use client'

import { Download } from 'lucide-react'

/**
 * Кнопка «Установить приложение» — скачивает НАСТОЯЩЕЕ приложение (APK)
 * с этого же сайта. Без лишних надписей: нажал — файл в загрузках,
 * открыл — установил. Для Android; на iOS установка APK не работает.
 */

export function InstallAppButton({ variant = 'pill' }: { variant?: 'pill' | 'block' }) {
  if (variant === 'block') {
    return (
      <a
        href="/dl/Drivemobile.apk"
        download
        className="w-full h-12 bg-[#F97316] text-white rounded-xl text-[14px] font-bold flex items-center justify-center gap-2 shadow-lg active:scale-[0.99] transition-transform"
      >
        <Download className="h-5 w-5" />
        Установить приложение
      </a>
    )
  }
  return (
    <a
      href="/dl/Drivemobile.apk"
      download
      aria-label="Установить приложение на телефон"
      className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white bg-[#F97316] rounded-full px-2.5 py-1.5 shadow-[0_6px_18px_rgba(249,115,22,0.4)] active:scale-[0.97] transition-transform"
    >
      <Download className="h-3.5 w-3.5" />
      Установить приложение
    </a>
  )
}
