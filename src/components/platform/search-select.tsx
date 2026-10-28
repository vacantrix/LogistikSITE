'use client'

/**
 * Быстрый комбобокс без Radix (Task 110-a): мгновенное открытие по клику и
 * минимум DOM — для длинных справочников (водители, тягачи, прицепы, грузы),
 * где задержка портала и анимаций Radix Select заметна. Поиск по подстроке,
 * клавиатура (стрелки/Enter/Escape/Tab), показ максимум 80 совпадений.
 * Открытие — только по клику; клик вне панели закрывает.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SearchSelectOption {
  value: string
  label: string
  /** вторая строка под label (адрес, категория) — приглушённым мелким текстом */
  sub?: string
  /** приглушённый вариант (например «занят» в другом рейсе) */
  muted?: boolean
}

/** Максимум отрисованных совпадений: длинные выборки не тормозят панель */
const MAX_VISIBLE = 80

export function SearchSelect({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  emptyText = 'Ничего не найдено',
  disabled,
  id,
  className,
}: {
  value: string
  options: SearchSelectOption[]
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel?: string
  emptyText?: string
  disabled?: boolean
  id?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const selected = options.find((o) => o.value === value)

  // фильтрация по подстроке в нижнем регистре по label + sub
  const q = query.trim().toLowerCase()
  const matched = useMemo(
    () => (q === ''
      ? options
      : options.filter((o) => `${o.label}\n${o.sub ?? ''}`.toLowerCase().includes(q))),
    [options, q],
  )
  const visible = useMemo(() => matched.slice(0, MAX_VISIBLE), [matched])

  // клик вне панели закрывает (само открытие — только по клику, не по фокусу)
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  // активный элемент держится в зоне видимости при перемещении стрелками
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const openPanel = () => {
    setQuery('')
    const idx = options.findIndex((o) => o.value === value)
    setActive(Math.max(0, idx))
    setOpen(true)
  }

  const choose = (o: SearchSelectOption) => {
    onChange(o.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  // клавиатура в поле поиска: стрелки — активный элемент, Enter — выбор,
  // Escape/Tab — закрыть (stopPropagation у Escape, чтобы не закрыть Dialog вокруг)
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, visible.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const o = visible[active]
      if (o) choose(o)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {/* триггер в стиле SelectTrigger: текст слева, шеврон справа */}
      <button
        type="button"
        id={id}
        ref={triggerRef}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-xs transition-[color,box-shadow] outline-none',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span className={cn('min-w-0 truncate text-left', selected || value !== '' ? 'text-slate-900' : 'text-muted-foreground')}>
          {selected ? selected.label : value !== '' ? value : (placeholder ?? 'Выберите…')}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3">
            <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0) }}
              onKeyDown={onPanelKeyDown}
              placeholder="Поиск…"
              aria-label={ariaLabel ? `Поиск: ${ariaLabel}` : 'Поиск в списке'}
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>
          <div ref={listRef} role="listbox" aria-label={ariaLabel} className="max-h-72 overflow-y-auto p-1">
            {visible.map((o, i) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                data-idx={i}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                className={cn(
                  'flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  i === active && 'bg-slate-100',
                )}
              >
                <span className="min-w-0">
                  <span className={cn('block truncate text-sm', o.muted ? 'text-slate-400' : 'text-slate-800', o.value === value && 'font-semibold')}>
                    {o.label}
                  </span>
                  {o.sub && <span className="block truncate text-xs text-muted-foreground">{o.sub}</span>}
                </span>
                {o.value === value && <Check className="h-4 w-4 shrink-0 text-slate-600" aria-hidden />}
              </button>
            ))}
            {visible.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-slate-500">{emptyText}</div>
            )}
          </div>
          {matched.length > MAX_VISIBLE && (
            <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400">
              Показаны первые {MAX_VISIBLE} из {matched.length} — уточните запрос
            </div>
          )}
        </div>
      )}
    </div>
  )
}
