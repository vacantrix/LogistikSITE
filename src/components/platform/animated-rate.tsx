'use client'

/**
 * Анимация смены ставки (Task 51).
 *
 * Когда на платформе происходит действие с изменением цены (например, кто-то
 * сделал ставку ниже и она пришла по WebSocket), на месте цены крутится
 * двойная стрелка, после анимации на месте ставки остаётся новая стоимость.
 * Никаких «подпрыгиваний» — спокойная замена значения. Анимация срабатывает
 * только на реальную смену значения между рендерами — перерисовки без
 * изменения цены остаются спокойными.
 */

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

/** сколько миллисекунд крутится стрелка, прежде чем появится новая цена */
const SPIN_MS = 900

export function AnimatedRate({
  value,
  format,
  className = '',
}: {
  value: number | null
  format: (v: number) => string
  className?: string
}) {
  const [state, setState] = useState<{ shown: number | null; spinning: boolean }>({
    shown: value,
    spinning: false,
  })

  // значение изменилось (пришла новая ставка) — включаем фазу «крутится стрелка».
  // Пересчёт прямо в рендере, без эффекта: React докрутит состояние до коммита
  // («You Might Not Need an Effect»)
  if (state.shown !== value && !state.spinning) {
    setState({ shown: state.shown, spinning: true })
  }

  // фаза спиннера завершается по таймеру — на месте ставки появляется новая цена.
  // Если во время вращения пришла ещё одна ставка, таймер перезапускается
  // с актуальным значением
  useEffect(() => {
    if (!state.spinning) return
    const t = setTimeout(() => setState({ shown: value, spinning: false }), SPIN_MS)
    return () => clearTimeout(t)
  }, [state.spinning, value])

  if (state.spinning) {
    return (
      <span className={`relative inline-block ${className}`} aria-live="polite">
        {/* прежняя цена невидимой держит ширину, чтобы ячейка не прыгала */}
        <span className="invisible" aria-hidden>
          {state.shown == null ? '—' : format(state.shown)}
        </span>
        <RefreshCw
          className="bid-spin absolute inset-0 m-auto h-[1em] w-[1em] animate-spin text-sky-600"
          aria-label="Ставка обновляется"
        />
      </span>
    )
  }

  return (
    <span className={`inline-block ${className}`} aria-live="polite">
      {state.shown == null ? '—' : format(state.shown)}
    </span>
  )
}
