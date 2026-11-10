'use client'

import dynamic from 'next/dynamic'

/** Приложение целиком клиентское: MapLibre + localStorage (аналог Room). */
const App = dynamic(() => import('@/components/azmz/app'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-[#0A1420] flex items-center justify-center">
      <div className="text-[#F97316] text-sm font-medium animate-pulse">АЗМЗ Логистика — загрузка…</div>
    </div>
  ),
})

export default function ClientRoot() {
  return <App />
}
