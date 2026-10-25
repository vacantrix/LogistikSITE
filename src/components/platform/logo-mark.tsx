/**
 * Знак LogistikSITE: оранжевая «дорога» с разметкой, сложенная в галочку (концепт логотипа).
 * graphite — основной (графитовый квадрат), inverse — для тёмной шапки (оранжевый квадрат).
 * Та же геометрия — в public/logo-mark.svg (иконка вкладки браузера).
 */
const GRAPHITE = '#1A1A1E'
const ORANGE = '#EA580C'
const CHECK = 'M13.6 34.1 L28.1 48.1 L52.9 15.9'

export function LogoMark({ variant = 'graphite', className = 'h-9 w-9' }: { variant?: 'graphite' | 'inverse'; className?: string }) {
  const [square, check] = variant === 'inverse' ? [ORANGE, GRAPHITE] : [GRAPHITE, ORANGE]
  return (
    <svg viewBox="0 0 64 64" className={`shrink-0 ${className}`} aria-hidden>
      <rect width="64" height="64" rx="14.5" fill={square} />
      <path d={CHECK} fill="none" stroke={check} strokeWidth="8.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d={CHECK} fill="none" stroke={square} strokeWidth="1.3" strokeLinecap="round" strokeDasharray="3.2 2.6" />
    </svg>
  )
}
