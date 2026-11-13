'use client'

import dynamic from 'next/dynamic'
import { BootSplash } from '@/components/azmz/boot-splash'

/** Приложение целиком клиентское: MapLibre + localStorage (аналог Room).
 *  Пока грузится чанк — тёмная preload-заглушка (без логотипа: бейдж
 *  «вспыхивает» один раз в интро сразу после загрузки). */
const App = dynamic(() => import('@/components/azmz/app'), {
  ssr: false,
  loading: () => <BootSplash stage="preload" />,
})

export default function ClientRoot() {
  return <App />
}
