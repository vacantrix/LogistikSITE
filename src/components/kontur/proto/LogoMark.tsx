import { withBasePath } from '@/lib/kontur/base-path'

/**
 * Знак «АЭМЗ Поток» — настоящая эмблема завода (public/logo-aemz-emblem.png):
 * тёмно-синяя плитка с глобусом-звездой, прозрачные скруглённые углы —
 * на тёмной шапке и на светлом фоне выглядит одинаково уместно.
 */
export function LogoMark({ className = 'h-10 w-auto' }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={withBasePath('/logo-aemz-emblem.png')}
      alt="АЭМЗ — Абинский электрометаллургический завод"
      className={`shrink-0 select-none ${className}`}
      draggable={false}
    />
  )
}
