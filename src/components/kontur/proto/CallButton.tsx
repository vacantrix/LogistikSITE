'use client'

import { useState } from 'react'
import { Phone } from 'lucide-react'
import { Button } from '@/components/kontur/ui/button'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/kontur/session-token'

/**
 * «Позвонить» — единая кнопка звонка логисту (стиль платформы).
 * Клик делает два дела:
 *   1) создаёт задачу звонка на сервере — лёгкое приложение-мост на телефоне
 *      логиста забирает её и показывает заявку с кнопкой вызова
 *      (номер не нужно вводить вручную; веб-демо моста — /phone-bridge);
 *   2) сразу набирает номер на ПК (tel:) — работает с софтфоном/трубкой.
 * Когда появится нативное приложение, tel:-канал на ПК можно отключить.
 */
export function CallButton({
  phone,
  name,
  driverId,
  orderId,
  label = 'Позвонить',
  size = 'sm',
  withLabel = true,
  className = '',
}: {
  phone?: string | null
  name?: string | null
  driverId?: string | null
  orderId?: string | null
  label?: string
  size?: 'sm' | 'default' | 'lg'
  withLabel?: boolean
  className?: string
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  const phoneChecked = phone ?? ''
  if (!phoneChecked) return null

  async function call() {
    setBusy(true)
    let pushed = false
    try {
      // Задача уходит на телефон-мост (очередь /api/call)
      const res = await authFetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push', driverId: driverId ?? undefined, orderId: orderId ?? undefined, phone: phoneChecked, name: name ?? undefined }),
      })
      pushed = res.ok
    } catch {
      /* мост недоступен — всё равно набираем на ПК */
    } finally {
      setBusy(false)
    }
    toast({
      title: `Набираем ${name ?? phoneChecked}`,
      description: pushed
        ? `${phoneChecked} · заявка передана на ваш телефон (мост) — там кнопка вызова без ввода номера`
        : phoneChecked,
    })
    window.location.href = `tel:${phoneChecked.replace(/[^\d+]/g, '')}`
  }

  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      disabled={busy}
      onClick={call}
      title={`Позвонить${name ? `: ${name}` : ''} — ${phone}`}
      className={className}
    >
      <Phone className={withLabel ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
      {withLabel && label}
    </Button>
  )
}
