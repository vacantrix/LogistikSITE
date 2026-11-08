'use client'

/**
 * Песочные часы (Task 101) — анимация подготовки при формировании отчёта.
 * Верхний песок осыпается тонкой струйкой в нижнюю колбу, нижняя копится,
 * и каждые несколько секунд часы переворачиваются на 180° — полная колба
 * снова оказывается сверху. Чистый SVG + CSS-ключевые кадры (globals.css),
 * без картинок и внешних библиотек; тайминги песка синхронизированы с
 * переворотом. При prefers-reduced-motion остаётся мягкая пульсация струйки.
 */
import { useId } from 'react'

export function HourglassLoader({ size = 120, className }: { size?: number; className?: string }) {
  // уникальные id градиентов: на странице может быть несколько экземпляров
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const sandId = `hg-sand-${uid}`
  const capId = `hg-cap-${uid}`

  return (
    <svg
      width={size}
      height={Math.round(size * 1.4)}
      viewBox="0 0 100 140"
      role="img"
      aria-label="Песочные часы — отчёт формируется"
      className={className}
    >
      <defs>
        <linearGradient id={sandId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <linearGradient id={capId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d97706" />
          <stop offset="100%" stopColor="#92400e" />
        </linearGradient>
      </defs>
      {/* вся фигура вращается вокруг центра (50,70) — см. .hg-rotor в globals.css */}
      <g className="hg-rotor">
        {/* колбы */}
        <path
          d="M31 16 C31 36 43 50 47 64 L53 64 C57 50 69 36 69 16 Z"
          fill="rgba(148,163,184,0.14)"
          stroke="#94a3b8"
          strokeOpacity="0.9"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M47 76 L53 76 C57 90 69 104 69 124 L31 124 C31 104 43 90 47 76 Z"
          fill="rgba(148,163,184,0.14)"
          stroke="#94a3b8"
          strokeOpacity="0.9"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* песок: верхний осыпается к горловине, нижний нагромождается от дна */}
        <polygon className="hg-sand-top" points="34,20 66,20 50,63" fill={`url(#${sandId})`} />
        <polygon className="hg-sand-bottom" points="50,77 66,124 34,124" fill={`url(#${sandId})`} />
        {/* струйка между колбами */}
        <rect className="hg-stream" x="49.1" y="63" width="1.8" height="15" rx="0.9" fill="#f59e0b" />
        {/* корпус */}
        <rect x="22" y="6" width="56" height="9" rx="3" fill={`url(#${capId})`} />
        <rect x="22" y="125" width="56" height="9" rx="3" fill={`url(#${capId})`} />
      </g>
    </svg>
  )
}

export default HourglassLoader
