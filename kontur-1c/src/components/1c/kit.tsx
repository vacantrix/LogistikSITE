'use client'

// ─── Визуальные примитивы «1С:Предприятие 8.3 (Такси)» ──────────────────────
// Иконки, кнопки, поля, шапки форм и таблицы в стиле 1С.

import { cn } from '@/lib/utils'

/* Логотип 1С (жёлто-красный), как в заголовке конфигуратора */
export function OneCLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="4" fill="#FFCB30" />
      <rect x="1" y="1" width="30" height="15" rx="4" fill="#FFDD55" />
      <rect x="1" y="10" width="30" height="12" fill="#F5A623" />
      <text
        x="16"
        y="22.5"
        textAnchor="middle"
        fontFamily="'Segoe UI', Tahoma, Arial, sans-serif"
        fontSize="15"
        fontWeight="700"
        fill="#C43E1C"
      >
        1С
      </text>
    </svg>
  )
}

/* Кнопка команды (Создать, Печать, Заполнить…) */
export function C1Button({
  children,
  accent,
  className,
  title,
  disabled,
  onClick,
  type = 'button',
}: {
  children: React.ReactNode
  accent?: boolean
  className?: string
  title?: string
  disabled?: boolean
  onClick?: () => void
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn('c1-btn', accent && 'c1-btn-accent', className)}
    >
      {children}
    </button>
  )
}

/* Кнопка-иконка без рамки (панель инструментов формы) */
export function C1IconButton({
  children,
  title,
  onClick,
  className,
  disabled,
}: {
  children: React.ReactNode
  title?: string
  onClick?: () => void
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn('c1-iconbtn', disabled && 'opacity-40', className)}
    >
      {children}
    </button>
  )
}

/* Кнопка-иконка с рамкой (командная панель списка) */
export function C1ToolButton({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  title?: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn('c1-btn', 'w-[26px] justify-center px-0')}
    >
      {children}
    </button>
  )
}

/* Поле ввода */
export function C1Input({
  value,
  onChange,
  placeholder,
  className,
  type = 'text',
  name,
  step,
  min,
  required,
  defaultValue,
  disabled,
}: {
  value?: string | number
  onChange?: (v: string) => void
  placeholder?: string
  className?: string
  type?: string
  name?: string
  step?: string
  min?: string
  required?: boolean
  defaultValue?: string | number
  disabled?: boolean
}) {
  return (
    <input
      type={type}
      name={name}
      step={step}
      min={min}
      required={required}
      disabled={disabled}
      value={value}
      defaultValue={defaultValue}
      placeholder={placeholder}
      onChange={(e) => onChange?.(e.target.value)}
      className={cn('c1-input', className)}
    />
  )
}

/* Выбор (нативный select в стиле 1С: стрелка-кнопка справа) */
export function C1Select({
  value,
  onChange,
  options,
  className,
  name,
  required,
  placeholder,
  disabled,
}: {
  value?: string
  onChange?: (v: string) => void
  options: { value: string; label: string; disabled?: boolean }[]
  className?: string
  name?: string
  required?: boolean
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <select
      name={name}
      required={required}
      disabled={disabled}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      className={cn('c1-select cursor-default pr-5', !value && placeholder && 'text-[#9a9a9a]', className)}
      style={{
        appearance: 'none',
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='9' height='6' viewBox='0 0 9 6'><path d='M0 0h9L4.5 6z' fill='%23666666'/></svg>\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 5px center',
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/* Строка заголовка формы: [←][→] [★] Заголовок ... [ссылка][меню][закрыть] */
export function FormTitleBar({
  title,
  starred = true,
  onClose,
  subtitle,
}: {
  title: string
  starred?: boolean
  onClose?: () => void
  subtitle?: string
}) {
  return (
    <div className="flex h-[38px] shrink-0 items-center gap-1.5 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2.5">
      <C1IconButton title="Назад">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M10.5 3L5.5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </C1IconButton>
      <C1IconButton title="Вперёд">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M5.5 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </C1IconButton>
      <span
        className="ml-1 inline-flex h-[15px] w-[15px] items-center justify-center"
        title="Избранное"
        style={{ color: '#f08c00' }}
      >
        {starred && (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="#f08c00">
            <path d="M8 1.5l1.9 4.1 4.5.5-3.4 3 .95 4.4L8 11.2l-3.95 2.3.95-4.4-3.4-3 4.5-.5z" />
          </svg>
        )}
      </span>
      <div className="ml-1.5 flex min-w-0 items-baseline gap-2">
        <span className="truncate text-[15px] font-semibold text-[#1c1c1c]">{title}</span>
        {subtitle && <span className="truncate text-[11px] text-[#8a8a8a]">{subtitle}</span>}
      </div>
      <div className="ml-auto flex items-center gap-0.5">
        <C1IconButton title="Ссылка на объект">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M6.5 9.5l3-3M5 7L3.6 8.4a2.6 2.6 0 003.7 3.7L8.5 11M7.5 5l1.2-1.2a2.6 2.6 0 013.7 3.7L11 8.7"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </C1IconButton>
        <C1IconButton title="Ещё">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="3.5" cy="8" r="1.2" />
            <circle cx="8" cy="8" r="1.2" />
            <circle cx="12.5" cy="8" r="1.2" />
          </svg>
        </C1IconButton>
        {onClose && (
          <C1IconButton title="Закрыть" onClick={onClose}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </C1IconButton>
        )}
      </div>
    </div>
  )
}

/* Чекбокс 1С */
export function C1Checkbox({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean
  onChange?: (v: boolean) => void
  label?: string
  className?: string
}) {
  return (
    <label className={cn('inline-flex cursor-default items-center gap-1.5 text-[12px] select-none', className)}>
      <span
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onClick={() => onChange?.(!checked)}
        onKeyDown={(e) => e.key === ' ' && (e.preventDefault(), onChange?.(!checked))}
        className="inline-flex h-[14px] w-[14px] items-center justify-center rounded-[2px] border bg-white"
        style={{ borderColor: checked ? '#5f9dd0' : '#b4b4b4', background: checked ? '#dcebfb' : '#fff' }}
      >
        {checked && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 5.5l2.3 2.3L8.5 2.5" stroke="#2f6db0" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {label}
    </label>
  )
}

/* Строка статуса внизу окна 1С */
export function StatusBar({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex h-[24px] shrink-0 items-center justify-between border-t border-[#d4d4d4] bg-[#f2f2f2] px-3 text-[11px] text-[#5c5c5c]">
      <div className="min-w-0 truncate">{left}</div>
      <div className="ml-4 shrink-0 truncate">{right}</div>
    </div>
  )
}

/* Панель формы (белое полотно с рамкой, как окно 1С) */
export function C1Form({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden bg-white', className)}>{children}</div>
}
