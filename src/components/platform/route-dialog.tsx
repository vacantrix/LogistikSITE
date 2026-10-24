'use client'

/**
 * Маршрут рейса: полные адреса погрузки и выгрузки + построение маршрута.
 *
 * RoutePointsInline — компактная пара точек (таблица площадки, карточки
 * заявок, диалоги); RouteButton — кнопка, открывающая диалог с полными
 * названиями и адресами точек и ссылкой на построение автомобильного
 * маршрута в Яндекс.Картах. Адреса берутся из lib/points.
 */
import { useState, type ComponentProps } from 'react'
import { ExternalLink, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { pointInfo, routeMapUrl } from '@/lib/points'

/** Компактная пара точек маршрута: строгая вертикальная сетка — иконки в
 *  фиксированной колонке, названия и адреса — строго друг под другом,
 *  независимо от длины текста. Погрузка сверху, выгрузка под ней. */
export function RoutePointsInline({ from, to, className }: { from: string; to: string; className?: string }) {
  const a = pointInfo(from)
  const b = pointInfo(to)
  const FromIcon = a.icon
  const ToIcon = b.icon
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <div className="grid grid-cols-[0.875rem_1fr] items-start gap-x-2 gap-y-1.5">
        {/* Погрузка */}
        <span className="flex h-3.5 items-center" aria-hidden>
          <FromIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        </span>
        <div className="min-w-0">
          <div className="break-words text-[13px] font-medium leading-tight text-slate-800">{a.short}</div>
          <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground" title={a.address}>{a.address}</div>
        </div>
        {/* Выгрузка */}
        <span className="flex h-3.5 items-center" aria-hidden>
          <ToIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        </span>
        <div className="min-w-0">
          <div className="break-words text-[13px] font-medium leading-tight text-slate-800">{b.short}</div>
          <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground" title={b.address}>{b.address}</div>
        </div>
      </div>
    </div>
  )
}

type ButtonVariant = ComponentProps<typeof Button>['variant']
type ButtonSize = ComponentProps<typeof Button>['size']

/**
 * Кнопка «Маршрут»: диалог с полными адресами погрузки/выгрузки и переходом
 * в Яндекс.Карты, где строится автомобильный маршрут между точками.
 */
export function RouteButton({
  from,
  to,
  number,
  label = 'Маршрут',
  variant = 'outline',
  size = 'sm',
  className,
}: {
  from: string
  to: string
  number?: string
  label?: string
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const a = pointInfo(from)
  const b = pointInfo(to)
  const FromIcon = a.icon
  const ToIcon = b.icon
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={`gap-1.5 ${className ?? ''}`}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Построить маршрут${number ? ` по заявке ${number}` : ''}`}
        >
          <MapPin className="h-4 w-4" aria-hidden />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Маршрут рейса{number ? ` ${number}` : ''}</DialogTitle>
          <DialogDescription>
            {b.known
              ? 'Полные адреса погрузки и выгрузки — маршрут строится в Яндекс.Картах.'
              : 'Адрес погрузки указан точно — маршрут можно продолжить в Яндекс.Картах.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Погрузка */}
          <div className="flex gap-3">
            <div className="flex flex-col items-center gap-1">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-100" aria-hidden>
                <FromIcon className="h-4 w-4" />
              </span>
              <span className="h-6 w-px border-l-2 border-dashed border-slate-200" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Погрузка</div>
              <div className="mt-0.5 text-sm font-semibold text-slate-900">{a.name}</div>
              <div className="mt-0.5 text-sm text-slate-600">{a.address}</div>
            </div>
          </div>
          {/* Выгрузка */}
          <div className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" aria-hidden>
              <ToIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Выгрузка</div>
              <div className="mt-0.5 text-sm font-semibold text-slate-900">{b.name}</div>
              <div className="mt-0.5 text-sm text-slate-600">{b.address}</div>
              {!b.known && (
                <div className="mt-1 text-xs leading-snug text-slate-500">
                  Точный адрес — в комплекте документов заявки; в карте маршрут строится от точки погрузки.
                </div>
              )}
            </div>
          </div>
        </div>

        <Button asChild className="w-full gap-2">
          <a href={routeMapUrl(from, to)} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" aria-hidden />
            {b.known ? 'Построить маршрут в Яндекс.Картах' : 'Открыть точку погрузки в Яндекс.Картах'}
          </a>
        </Button>
      </DialogContent>
    </Dialog>
  )
}
