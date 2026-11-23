/**
 * Официальный знак АЭМЗ: бирюзовый «орбитальный глобус» с белой четырёхлучевой звездой.
 * graphite — знак на тёмно-синей плашке (для светлого фона),
 * inverse — знак без плашки (для тёмной шапки платформы).
 * Та же геометрия — в public/logo-mark.svg (иконка вкладки браузера).
 */
const NAVY = '#101C28'
const TEAL = '#8DCACF'
const WHITE = '#FFFFFF'

export function LogoMark({ variant = 'graphite', className = 'h-9 w-9' }: { variant?: 'graphite' | 'inverse'; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={`shrink-0 ${className}`} aria-hidden>
      {variant === 'graphite' && <rect width="64" height="64" rx="14.5" fill={NAVY} />}
      <g fill="none" stroke={TEAL} strokeWidth="2.2" strokeLinecap="round">
        <ellipse cx="32" cy="32" rx="26" ry="14.5" />
        <ellipse cx="32" cy="32" rx="16" ry="14.5" />
        <line x1="32" y1="17.5" x2="32" y2="46.5" />
        <ellipse cx="32" cy="32" rx="24" ry="8" />
        <line x1="6" y1="32" x2="58" y2="32" />
      </g>
      <g fill="none" stroke={WHITE} strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round">
        <path d="M32 17.5 L35.75 28.25 L46.5 32 L35.75 35.75 L32 46.5 L28.25 35.75 L17.5 32 L28.25 28.25 Z" />
        <path d="M32 27 L37 32 L32 37 L27 32 Z" />
      </g>
    </svg>
  )
}
