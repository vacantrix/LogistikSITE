'use client'

/**
 * Выбор точки «Точка А / Точка Б» (Task 64, переработан в 110-a и в подсказках адресов):
 *  — быстрый выбор «АЭМЗ» одной кнопкой;
 *  — точки справочника платформы (src/lib/points.ts) с поиском по введённому тексту;
 *  — живые подсказки адресов России с сервера (/api/suggest → DaData ФИАС, без ключа —
 *    карта OSM): выпадают плавно под полем, debounce 300 мс — лимиты API не тратятся на
 *    быстрый набор; клик по подсказке подставляет полный адрес и закрывает список;
 *  — любой другой адрес можно вписать руками — сохраняется в заявке как есть
 *    («Использовать адрес»). Расстояние КМ и маршрут считаются по точкам справочника.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Factory, Loader2, MapPin } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { POINT_SUGGESTIONS } from '@/lib/points'
import type { Suggestion } from '@/lib/suggest'

/** Значение точки АЭМЗ в справочнике — быстрый выбор одной кнопкой */
const AEMZ_VALUE = 'Абинск'

/** Задержка перед запросом подсказок, мс — каждая буква не должна тратить лимиты API */
const SUGGEST_DEBOUNCE_MS = 300
/** С такой длины текста спрашиваем сервер */
const SUGGEST_MIN_Q = 3

export function PointSelect({ id, value, onChange, placeholder, ariaLabel }: {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [remote, setRemote] = useState<Suggestion[]>([])
  const [remoteState, setRemoteState] = useState<'idle' | 'loading' | 'ready'>('idle')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // порядковый номер последнего запроса: ответ устаревшего запроса не перезаписывает свежий
  const reqSeq = useRef(0)

  // клик вне панели закрывает; blur ничего не меняет — введённый адрес остаётся в поле
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  // подсказки адресов с сервера: debounce 300 мс, ответы приходят вне порядка — глушим устаревшие.
  // Вся смена состояния — внутри колбэка таймера: setState в теле эффекта даёт каскадные рендеры
  useEffect(() => {
    const q = value.trim()
    const seq = ++reqSeq.current
    const timer = setTimeout(async () => {
      if (q.length < SUGGEST_MIN_Q) {
        setRemote([])
        setRemoteState('idle')
        return
      }
      setRemoteState('loading')
      try {
        const d = await api.suggestAddress(q)
        if (seq !== reqSeq.current) return
        setRemote(d.items ?? [])
        setRemoteState('ready')
      } catch {
        if (seq !== reqSeq.current) return
        setRemote([])
        setRemoteState('ready')
      }
    }, SUGGEST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [value])

  const q = value.trim().toLowerCase()
  // короткий запрос: серверные подсказки прячем сразу, не дожидаясь сброса по таймеру
  const shortQuery = q.length < SUGGEST_MIN_Q
  // точки справочника, отфильтрованные по введённому тексту (город, название, адрес)
  const list = q === ''
    ? POINT_SUGGESTIONS
    : POINT_SUGGESTIONS.filter((p) => `${p.value}\n${p.label}\n${p.sub}`.toLowerCase().includes(q))
  // свободный адрес: текст есть и он не совпадает (без регистра) ни с одним значением справочника
  const knownValue = POINT_SUGGESTIONS.some((p) => p.value.toLowerCase() === q)
  const showCustom = q !== '' && !knownValue
  // серверные подсказки не дублируют то, что уже в поле; на коротком запросе — спрятаны
  const remoteItems = (shortQuery ? [] : remote).filter((s) => s.label.toLowerCase() !== q)

  const pick = useCallback((v: string) => {
    onChange(v)
    setOpen(false)
    inputRef.current?.blur()
  }, [onChange])

  return (
    <div ref={rootRef} className="relative">
      {/* в поле — текущее значение как есть: справочное или произвольный адрес;
          onChange уходит на каждое изменение, валидность (непустота) решает родитель */}
      <Input
        id={id}
        ref={inputRef}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // закрыть только панель, а не диалог формы вокруг
            e.stopPropagation()
            setOpen(false)
          }
          // Enter на подсказке (у поля нет формы вокруг) — подставить первый адрес
          if (e.key === 'Enter' && remoteItems.length > 0 && document.activeElement === inputRef.current) {
            e.preventDefault()
            pick(remoteItems[0].label)
          }
        }}
        placeholder={placeholder ?? 'Выберите точку'}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        autoComplete="off"
      />

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-1.5">
            <div className="px-2 pb-1 pt-1 text-[11px] font-medium text-slate-400">Быстрый выбор</div>
            <button
              type="button"
              onClick={() => { onChange(AEMZ_VALUE); setOpen(false) }}
              className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-slate-100"
            >
              <Factory className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
              <span className="block min-w-0 truncate text-sm font-medium text-slate-800">
                АЭМЗ · Абинский электрометаллургический завод
              </span>
            </button>
          </div>

          <div role="listbox" aria-label={ariaLabel ? `${ariaLabel}: подсказки адресов` : 'Подсказки адресов'} className="max-h-72 overflow-y-auto p-1">
            {/* живые подсказки адресов с сервера (DaData/OSM) */}
            {remoteState === 'loading' && remoteItems.length === 0 && (
              <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Ищем адрес…
              </div>
            )}
            {remoteItems.length > 0 && (
              <div className="px-2 pb-1 pt-1 text-[11px] font-medium text-slate-400">Адреса России</div>
            )}
            {remoteItems.map((s) => (
              <button
                key={`addr-${s.label}`}
                type="button"
                role="option"
                aria-selected={s.label === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s.label)}
                className="flex min-h-9 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-slate-100"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">{s.label}</span>
                  {s.hint && <span className="block truncate text-xs text-muted-foreground">{s.hint}</span>}
                </span>
                {s.source === 'dadata' && (
                  <span className="ml-auto mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">ФИАС</span>
                )}
              </button>
            ))}

            {/* точки справочника платформы */}
            {list.length > 0 && (
              <div className="px-2 pb-1 pt-1 text-[11px] font-medium text-slate-400">Справочник платформы</div>
            )}
            {list.map((p) => (
              <button
                key={p.value}
                type="button"
                role="option"
                aria-selected={p.value === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p.value)}
                className="flex min-h-9 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-slate-100"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">{p.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{p.sub}</span>
                </span>
              </button>
            ))}

            {list.length === 0 && remoteItems.length === 0 && remoteState !== 'loading' && !showCustom && (
              <div className="px-3 py-4 text-sm text-slate-500">Ничего не найдено</div>
            )}
            {showCustom && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(value.trim())}
                className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-slate-100"
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                <span className="block min-w-0 truncate text-sm text-slate-700">Использовать адрес: «{value.trim()}»</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
