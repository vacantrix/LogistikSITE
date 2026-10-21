'use client'

/**
 * Анимация смены ставки (Task 50).
 *
 * Когда кто-то делает ставку ниже текущей, цена приходит по WebSocket и здесь
 * меняется значение. В момент изменения новое значение «падает» на место
 * старого со зелёной вспышкой, после анимации на месте ставки остаётся новая
 * стоимость. Анимация срабатывает только на реальную смену значения между
 * рендерами — перерисовки без изменения цены остаются спокойными.
 */

import { useState } from 'react'

export function AnimatedRate({
  value,
  format,
  className = '',
}: {
  value: number | null
  format: (v: number) => string
  className?: string
}) {
  const [state, setState] = useState<{ value: number | null; pulse: number }>({ value, pulse: 0 })

  // значение изменилось (пришла новая ставка) — пересчёт прямо в рендере,
  // без эффекта: React докрутит состояние до коммита («You Might Not Need an Effect»)
  if (state.value !== value) {
    setState({
      value,
      pulse: state.value !== null && value !== null ? state.pulse + 1 : state.pulse,
    })
  }

  return (
    <span
      key={state.pulse}
      className={`inline-block ${state.pulse > 0 ? 'bid-anim' : ''} ${className}`}
      aria-live="polite"
    >
      {value == null ? '—' : format(value)}
    </span>
  )
}
