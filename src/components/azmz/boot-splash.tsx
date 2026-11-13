'use client'

/**
 * Сплэш-экран «АЗМЗ Логистика» — анимация старта приложения.
 *
 * stage="preload" — заглушка в client-root, пока грузится JS-чанк:
 *   тёмный фон, пульсирующий словесный знак и полоса загрузки (без логотипа,
 *   чтобы бейдж «появился» ровно один раз — в интро).
 * stage="intro" — полноценная анимация при монтировании приложения:
 *   бейдж АЭМЗ выпрыгивает с пружиной, молния вспыхивает расходящимся
 *   кольцом, словесный знак выплывает снизу, под ним — дорога с бегущей
 *   разметкой и грузовичком, тонкая полоса загрузки и версия.
 *
 * Уход: когда ready=true, экран плавно растворяется (fade + лёгкий zoom),
 * после завершения перехода вызывается onFinished — родитель размонтирует.
 */

import { useEffect, useRef, useState } from 'react'
import { APP_VERSION } from '@/lib/version'

export function BootSplash({
  stage = 'intro',
  ready = false,
  onFinished,
}: {
  stage?: 'preload' | 'intro'
  /** данные готовы → запускаем плавный уход с экрана */
  ready?: boolean
  /** fade-out завершён — экран можно размонтировать */
  onFinished?: () => void
}) {
  const [gone, setGone] = useState(false)
  // колбэк в ref: эффект не должен перезапускаться от нового инстанса функции
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished

  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => {
      setGone(true)
      onFinishedRef.current?.()
    }, 470)
    return () => clearTimeout(t)
  }, [ready])

  if (gone) return null

  return (
    <div
      className={`azmz-boot ${stage === 'preload' ? 'azmz-boot--preload' : ''} ${ready ? 'azmz-boot--out' : ''}`}
      role="status"
      aria-label="АЗМЗ Логистика — загрузка"
    >
      <div className="azmz-boot__glow azmz-boot__glow--o" aria-hidden="true" />
      <div className="azmz-boot__glow azmz-boot__glow--b" aria-hidden="true" />

      <div className="azmz-boot__inner">
        {stage === 'intro' ? (
          <>
            <div className="azmz-boot__badge">
              <span className="azmz-boot__ring" aria-hidden="true" />
              <svg viewBox="0 0 24 24" className="azmz-boot__bolt" aria-hidden="true">
                <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
              </svg>
              <span className="azmz-boot__badge-text">АЭМЗ</span>
            </div>

            <div className="azmz-boot__word">АЭМЗ Логистика</div>
            <div className="azmz-boot__sub">Приложение водителя</div>

            <div className="azmz-boot__road" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="azmz-boot__truck" aria-hidden="true">
                <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
                <path d="M15 18H9" />
                <path d="M19 18h2a1 1 0 0 0 1-1v-3.654a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
                <circle cx="17" cy="18" r="2" />
                <circle cx="7" cy="18" r="2" />
              </svg>
            </div>
          </>
        ) : (
          <div className="azmz-boot__pre-text">АЗМЗ Логистика — загрузка…</div>
        )}

        <div className="azmz-boot__bar" aria-hidden="true">
          <i />
        </div>
      </div>

      {stage === 'intro' && <div className="azmz-boot__ver">v {APP_VERSION}</div>}
    </div>
  )
}
