'use client'

/**
 * Поля проформы водителя: дата — ввод по маске ДД.ММ.ГГГГ и календарь; адрес и место
 * рождения — подсказки из карты OpenStreetMap и выбор точки на карте; «Кем выдан» —
 * формулировки по региону адреса и значения из базы; должность — встроенный вариант.
 * Любое поле можно заполнить и вручную: подсказки только ускоряют ввод.
 */
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { CalendarDays, ChevronDown, Loader2, MapPin } from 'lucide-react'
import { ru } from 'react-day-picker/locale'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api } from '@/lib/api'
import type { Suggestion } from '@/lib/suggest'

const MapPickDialog = dynamic(() => import('@/components/platform/map-pick-dialog'), { ssr: false })

/** Встроенные варианты должности */
export const POSITIONS = ['Водитель'] as const

function confCls(c: number): string {
  if (c >= 0.8) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (c >= 0.55) return 'bg-amber-50 text-amber-700 border-amber-200'
  return 'bg-red-50 text-red-700 border-red-200'
}

/** Уверенность нейросети в прочитанном поле */
function ConfChip({ c }: { c: number }) {
  const pct = Math.round(c * 100)
  return <span className={`ml-1.5 inline-flex items-center rounded border px-1 py-px text-[10px] font-semibold ${confCls(c)}`}>{pct}%</span>
}

/** Подпись поля: красная — обязательное поле пусто после «Проверить»; чип — уверенность нейросети */
export function FieldLabel({ htmlFor, label, invalid, conf }: { htmlFor: string; label: string; invalid?: boolean; conf?: number }) {
  return (
    <Label htmlFor={htmlFor} className={`text-xs ${invalid ? 'font-semibold text-red-600' : 'text-muted-foreground'}`}>
      {label}
      {invalid && <span aria-hidden> — заполните</span>}
      {conf !== undefined && conf > 0 && <ConfChip c={conf} />}
    </Label>
  )
}

export const fieldCls = (invalid?: boolean, mono?: boolean) =>
  `h-8 text-sm ${mono ? 'font-mono' : ''} ${invalid ? 'border-red-400 bg-red-50/40 focus-visible:ring-red-300' : ''}`

export interface ProformaFieldProps {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  conf?: number
  invalid?: boolean
  disabled?: boolean
  className?: string
}

// ——— дата: маска и календарь ———

const maskDate = (raw: string) => {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('.')
}

function parseRu(s: string): Date | undefined {
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!m) return undefined
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  return d.getDate() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 ? d : undefined
}

const pad = (n: number) => String(n).padStart(2, '0')
const formatRu = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`

/** Дата: ввод цифрами (точки ставятся сами) или выбор в календаре; будущие даты недоступны */
export function DateField({
  fromYear = 1940, defaultYear, ...p
}: ProformaFieldProps & {
  /** первый год в списке календаря */
  fromYear?: number
  /** год, который календарь показывает при пустом поле */
  defaultYear?: number
}) {
  const [open, setOpen] = useState(false)
  const selected = parseRu(p.value)
  const today = new Date()
  return (
    <div className={`min-w-0 ${p.className ?? ''}`}>
      <FieldLabel htmlFor={p.id} label={p.label} invalid={p.invalid} conf={p.conf} />
      <div className="relative mt-1">
        <Input
          id={p.id}
          value={p.value}
          placeholder={p.placeholder ?? 'ДД.ММ.ГГГГ'}
          inputMode="numeric"
          autoComplete="off"
          disabled={p.disabled}
          aria-invalid={p.invalid || undefined}
          className={`${fieldCls(p.invalid)} pr-8`}
          onChange={(e) => p.onChange(maskDate(e.target.value))}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={p.disabled}
              title="Выбрать в календаре"
              aria-label={`${p.label}: выбрать в календаре`}
              className="absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-md text-slate-400 hover:text-blue-700 disabled:pointer-events-none"
            >
              <CalendarDays className="h-4 w-4" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              locale={ru}
              captionLayout="dropdown"
              formatters={{ formatMonthDropdown: (d) => d.toLocaleString('ru-RU', { month: 'short' }) }}
              selected={selected}
              defaultMonth={selected ?? new Date(defaultYear ?? today.getFullYear(), 0)}
              startMonth={new Date(fromYear, 0)}
              endMonth={today}
              disabled={{ after: today }}
              onSelect={(d) => {
                if (!d) return
                p.onChange(formatRu(d))
                setOpen(false)
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

// ——— поле с вариантами ———

/** Поле ввода со списком вариантов под ним: стрелки ↑/↓, Enter — выбрать, Esc — скрыть */
export function SuggestField({
  load, onPick, minChars = 3, openOnFocus = false, mono, trailing, ...p
}: ProformaFieldProps & {
  /** варианты для введённого текста */
  load: (q: string) => Promise<Suggestion[]>
  onPick?: (s: Suggestion) => void
  minChars?: number
  /** список открывается сразу при фокусе (встроенные варианты, формулировки) */
  openOnFocus?: boolean
  mono?: boolean
  /** кнопка справа внутри поля */
  trailing?: ReactNode
}) {
  const [focused, setFocused] = useState(false)
  const [closed, setClosed] = useState(false)
  const [items, setItems] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const loadRef = useRef(load)
  const picked = useRef('')
  const seq = useRef(0)
  useEffect(() => {
    loadRef.current = load
  })

  // варианты запрашиваются после паузы в наборе; только что выбранный текст не перезапрашивается
  useEffect(() => {
    if (!focused) return
    const q = p.value.trim()
    if (q === picked.current && q !== '') return
    if (q.length < minChars && !openOnFocus) return
    const my = ++seq.current
    const t = setTimeout(() => {
      setLoading(true)
      loadRef.current(q)
        .then((list) => {
          if (seq.current !== my) return
          setItems(list)
          setActive(-1)
        })
        .catch(() => {
          if (seq.current === my) setItems([])
        })
        .finally(() => {
          if (seq.current === my) setLoading(false)
        })
    }, q.length < minChars ? 0 : 350)
    return () => clearTimeout(t)
  }, [p.value, focused, minChars, openOnFocus])

  const open = focused && !closed && items.length > 0 && (openOnFocus || p.value.trim().length >= minChars)
  const listId = `${p.id}-list`

  const pick = (s: Suggestion) => {
    picked.current = s.label
    p.onChange(s.label)
    onPick?.(s)
    setClosed(true)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' && items.length > 0) setClosed(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      pick(items[active])
    } else if (e.key === 'Escape') {
      setClosed(true)
    }
  }

  const tail = trailing ?? (openOnFocus ? (
    <button
      type="button"
      tabIndex={-1}
      disabled={p.disabled}
      aria-label={`${p.label}: показать варианты`}
      className="flex h-8 w-8 items-center justify-center text-slate-400 hover:text-blue-700 disabled:pointer-events-none"
      onMouseDown={(e) => {
        e.preventDefault()
        setClosed(false)
        inputRef.current?.focus()
      }}
    >
      <ChevronDown className="h-4 w-4" aria-hidden />
    </button>
  ) : null)

  return (
    <div className={`min-w-0 ${p.className ?? ''}`}>
      <FieldLabel htmlFor={p.id} label={p.label} invalid={p.invalid} conf={p.conf} />
      <Popover open={open}>
        <PopoverAnchor asChild>
          <div className="relative mt-1">
            <Input
              ref={inputRef}
              id={p.id}
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
              autoComplete="off"
              value={p.value}
              placeholder={p.placeholder}
              disabled={p.disabled}
              aria-invalid={p.invalid || undefined}
              className={`${fieldCls(p.invalid, mono)} ${tail ? (loading ? 'pr-14' : 'pr-8') : loading ? 'pr-8' : ''}`}
              onFocus={() => {
                setFocused(true)
                setClosed(false)
              }}
              onBlur={() => setFocused(false)}
              onKeyDown={onKeyDown}
              onChange={(e) => {
                picked.current = ''
                setClosed(false)
                p.onChange(e.target.value)
              }}
            />
            <div className="absolute inset-y-0 right-0 flex items-center">
              {loading && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin text-slate-400" aria-hidden />}
              {tail}
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-[var(--radix-popover-trigger-width)] min-w-[16rem] p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <ul id={listId} role="listbox" aria-label={p.label} className="max-h-64 overflow-y-auto" onMouseDown={(e) => e.preventDefault()}>
            {items.map((s, i) => (
              <li
                key={s.label}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`cursor-pointer rounded px-2 py-1.5 text-sm ${i === active ? 'bg-blue-50 text-blue-900' : 'text-slate-800'}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(s)}
              >
                <div className="leading-snug">{s.label}</div>
                {s.hint && <div className="text-[11px] text-muted-foreground">{s.hint}</div>}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** Адрес или место рождения: подсказки из карты по мере ввода и выбор точки на карте */
export function GeoField({
  kind, onPickGeo, ...p
}: ProformaFieldProps & {
  /** address — адрес с улицей и домом, place — населённый пункт */
  kind: 'address' | 'place'
  /** выбранный вариант с регионом и координатами (нужен «Кем выдан») */
  onPickGeo?: (s: Suggestion) => void
}) {
  const [mapOpen, setMapOpen] = useState(false)
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(null)
  const picked = (s: Suggestion) => {
    if (s.lat != null && s.lon != null) setCenter({ lat: s.lat, lon: s.lon })
    onPickGeo?.(s)
  }
  return (
    <>
      <SuggestField
        {...p}
        load={(q) => api.suggest({ kind, q }).then((r) => r.items)}
        onPick={picked}
        trailing={
          <button
            type="button"
            disabled={p.disabled}
            title="Выбрать на карте"
            aria-label={`${p.label}: выбрать на карте`}
            className="flex h-8 w-8 items-center justify-center text-slate-400 hover:text-blue-700 disabled:pointer-events-none"
            onClick={() => setMapOpen(true)}
          >
            <MapPin className="h-4 w-4" aria-hidden />
          </button>
        }
      />
      {mapOpen && (
        <MapPickDialog
          title={p.label}
          level={kind}
          center={center}
          onClose={() => setMapOpen(false)}
          onPick={(s) => {
            p.onChange(s.label)
            picked(s)
            setMapOpen(false)
          }}
        />
      )}
    </>
  )
}

/** «Кем выдан»: формулировки по региону адреса регистрации и значения, уже введённые в базе */
export function IssuedByField({
  region, county, address, ...p
}: ProformaFieldProps & { region?: string; county?: string; address: string }) {
  return (
    <SuggestField
      {...p}
      minChars={1}
      openOnFocus
      load={(q) => api.suggest({ kind: 'issuer', q, region, county, address }).then((r) => r.items)}
    />
  )
}

/** Должность: встроенный вариант «Водитель», можно вписать свою */
export function PositionField(p: ProformaFieldProps) {
  return (
    <SuggestField
      {...p}
      minChars={0}
      openOnFocus
      load={async () => POSITIONS.map((label) => ({ label }))}
    />
  )
}
