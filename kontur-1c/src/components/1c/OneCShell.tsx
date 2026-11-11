'use client'

// ─── Оболочка «1С:Предприятие 8.3 (Такси)» ──────────────────────────────────
// Заголовок приложения, панель разделов, панель открытых окон, строка состояния.

import { useEffect, useRef, useState } from 'react'
import { OneCLogo, C1IconButton } from './kit'
import { cn } from '@/lib/utils'

export type OneCSection = {
  id: string
  label: string
  icon: React.ReactNode
  // окно, открываемое по клику на раздел
  windowId?: string
  // либо подменю (как раздел «НСИ и администрирование»)
  menu?: { windowId: string; label: string; disabled?: boolean }[]
}

export type OneCWindow = {
  id: string
  title: string
  closable?: boolean
}

function useOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])
  return ref
}

/* ── Заголовок приложения ─────────────────────────────────────────────────── */
function TitleBar({
  userName,
  role,
  roles,
  onRoleChange,
}: {
  userName: string
  role: string
  roles: string[]
  onRoleChange: (r: string) => void
}) {
  const [userOpen, setUserOpen] = useState(false)
  const userRef = useOutside(() => setUserOpen(false))

  return (
    <div className="flex h-[40px] shrink-0 items-center gap-2 bg-[#f2f2f2] px-2.5">
      <OneCLogo size={24} />
      <C1IconButton title="Меню">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </C1IconButton>
      <div className="ml-1 flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
        <span className="text-[13px] text-[#1c1c1c]">АЗМЗ ООО / 1С:ERP Управление предприятием 2</span>
        <span className="hidden text-[12px] text-[#8a8a8a] md:inline">(1С:Предприятие)</span>
      </div>

      {/* Поиск по приложению */}
      <div className="mx-auto hidden items-center lg:flex">
        <div className="flex h-[26px] w-[300px] items-center gap-1.5 rounded-[3px] border border-[#c9c9c9] bg-white px-2">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0">
            <circle cx="7" cy="7" r="4.5" stroke="#8a8a8a" strokeWidth="1.4" />
            <path d="M10.5 10.5L14 14" stroke="#8a8a8a" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            className="w-full bg-transparent text-[12px] outline-none placeholder:text-[#9a9a9a]"
            placeholder="Поиск Ctrl+Shift+F"
            aria-label="Поиск по приложению"
          />
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1 text-[#5c5c5c]">
        <C1IconButton title="Оповещения">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 2a4 4 0 00-4 4v2.5L2.8 11h10.4L12 8.5V6a4 4 0 00-4-4zM6.5 12.5a1.5 1.5 0 003 0"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </C1IconButton>
        <C1IconButton title="История">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 4.5V8l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </C1IconButton>
        <C1IconButton title="Избранное">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 2l1.7 3.6 3.9.4-2.9 2.6.8 3.9L8 10.5l-3.5 2 .8-3.9L2.4 6l3.9-.4z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
        </C1IconButton>

        {/* Пользователь: смена рабочего места (роли) */}
        <div className="relative" ref={userRef}>
          <button
            type="button"
            onClick={() => setUserOpen((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-[3px] px-2 py-1 text-[12px] text-[#1c1c1c] hover:bg-[#e2e2e2]',
              userOpen && 'bg-[#dcdcdc]',
            )}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="5.5" r="2.8" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2.8 13.5a5.4 5.4 0 0110.4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span className="max-w-[180px] truncate">{userName}</span>
            <svg width="9" height="6" viewBox="0 0 9 6" className="text-[#666]">
              <path d="M0 0h9L4.5 6z" fill="currentColor" />
            </svg>
          </button>
          {userOpen && (
            <div className="absolute right-0 top-[30px] z-50 w-64 rounded-[3px] border border-[#b4b4b4] bg-white py-1 shadow-[0_4px_14px_rgba(0,0,0,0.22)]">
              <div className="border-b border-[#e5e5e5] px-3 pb-1.5 pt-1">
                <div className="text-[12px] font-semibold text-[#1c1c1c]">{userName}</div>
                <div className="text-[11px] text-[#8a8a8a]">Котельников Р.С. · диспетчерская АЗМЗ</div>
              </div>
              <div className="px-3 pb-1 pt-1.5 text-[11px] text-[#8a8a8a]">Рабочее место (роль):</div>
              {roles.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    onRoleChange(r)
                    setUserOpen(false)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-[#e3effa]"
                >
                  <span
                    className="inline-block h-[9px] w-[9px] shrink-0 rounded-full border"
                    style={{
                      borderColor: role === r ? '#2f6db0' : '#a9a9a9',
                      background: role === r ? '#2f6db0' : 'transparent',
                    }}
                  />
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>

        <C1IconButton title="Функции текущего режима">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="3" r="1.2" />
            <circle cx="8" cy="8" r="1.2" />
            <circle cx="8" cy="13" r="1.2" />
          </svg>
        </C1IconButton>
        {/* Кнопки окна приложения — декоративные, как в 1С */}
        <div className="ml-1 hidden items-center text-[#5c5c5c] lg:flex">
          <C1IconButton title="Свернуть">
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 8h8" stroke="currentColor" strokeWidth="1.3" /></svg>
          </C1IconButton>
          <C1IconButton title="Развернуть">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="2.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1.2" /></svg>
          </C1IconButton>
          <C1IconButton title="Закрыть" className="hover:!bg-[#e81123] hover:!text-white">
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.2" /></svg>
          </C1IconButton>
        </div>
      </div>
    </div>
  )
}

/* ── Панель разделов ──────────────────────────────────────────────────────── */
function SectionBar({
  sections,
  onOpenWindow,
}: {
  sections: OneCSection[]
  onOpenWindow: (id: string) => void
}) {
  const [openMenu, setOpenMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const close = useRef(() => {})
  const menuRef = useOutside(() => close.current())

  return (
    <div className="flex h-[42px] shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-[#d4d4d4] bg-[#f2f2f2] px-1.5 c1-scroll" style={{ scrollbarWidth: 'none' }}>
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={(e) => {
            if (s.menu) {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setOpenMenu((v) => (v?.id === s.id ? null : { id: s.id, x: r.left, y: r.bottom + 2 }))
            } else if (s.windowId) {
              onOpenWindow(s.windowId)
            }
          }}
          className={cn(
            'flex items-center gap-2 whitespace-nowrap rounded-[3px] px-3 text-[13px] text-[#1c1c1c] hover:bg-[#e2e2e2]',
            openMenu?.id === s.id && 'bg-[#dcdcdc]',
          )}
        >
          <span className="text-[#4d4d4d]">{s.icon}</span>
          {s.label}
        </button>
      ))}
      <div className="ml-auto flex items-center pr-1 text-[11px] text-[#8a8a8a]">
        <span className="hidden whitespace-nowrap xl:inline">Контур 1С · эмулятор учётного контура</span>
      </div>

      {/* Подменю раздела — fixed, чтобы не обрезалось прокруткой панели */}
      {openMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 w-64 rounded-[3px] border border-[#b4b4b4] bg-white py-1 shadow-[0_4px_14px_rgba(0,0,0,0.22)]"
          style={{ left: openMenu.x, top: openMenu.y }}
        >
          {sections
            .find((s) => s.id === openMenu.id)
            ?.menu?.map((m) => (
              <button
                key={m.windowId}
                type="button"
                disabled={m.disabled}
                onClick={() => {
                  onOpenWindow(m.windowId)
                  setOpenMenu(null)
                }}
                className={cn(
                  'block w-full px-3 py-1.5 text-left text-[12px] hover:bg-[#e3effa]',
                  m.disabled && 'text-[#a2a2a2]',
                )}
              >
                {m.label}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

/* ── Панель открытых окон ─────────────────────────────────────────────────── */
function WindowTabs({
  windows,
  activeId,
  onSelect,
  onClose,
}: {
  windows: OneCWindow[]
  activeId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
}) {
  return (
    <div className="flex h-[32px] shrink-0 items-end gap-[2px] border-b border-[#c9c9c9] bg-[#e9e9e9] px-1.5 pt-[3px]">
      {windows.map((w) => {
        const active = w.id === activeId
        return (
          <div
            key={w.id}
            onClick={() => onSelect(w.id)}
            className={cn(
              'group flex h-[29px] cursor-default items-center gap-1.5 rounded-t-[4px] border border-b-0 px-2.5 text-[12px]',
              active
                ? 'border-[#c9c9c9] bg-white font-semibold text-[#1c1c1c]'
                : 'border-transparent bg-[#dcdcdc] text-[#4d4d4d] hover:bg-[#e6e6e6]',
            )}
          >
            {w.id === 'home' ? (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[#c43e1c]">
                <path d="M2.5 7.5L8 2.5l5.5 5V13a.8.8 0 01-.8.8H9.8V10H6.2v3.8H3.3a.8.8 0 01-.8-.8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[#2f6db0]">
                <rect x="3" y="2" width="10" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
                <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
              </svg>
            )}
            <span className="max-w-[220px] truncate">{w.title}</span>
            {w.closable !== false && w.id !== 'home' && (
              <button
                type="button"
                title="Закрыть окно"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(w.id)
                }}
                className="ml-0.5 inline-flex h-[16px] w-[16px] items-center justify-center rounded-[2px] text-[#6e6e6e] hover:bg-[#d0d0d0] hover:text-[#1c1c1c]"
              >
                <svg width="9" height="9" viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.2" /></svg>
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── Оболочка целиком ─────────────────────────────────────────────────────── */
export function OneCShell({
  sections,
  windows,
  activeId,
  onSelectWindow,
  onOpenWindow,
  onCloseWindow,
  userName,
  role,
  roles,
  onRoleChange,
  statusLeft,
  statusRight,
  children,
}: {
  sections: OneCSection[]
  windows: OneCWindow[]
  activeId: string
  onSelectWindow: (id: string) => void
  onOpenWindow: (id: string) => void
  onCloseWindow: (id: string) => void
  userName: string
  role: string
  roles: string[]
  onRoleChange: (r: string) => void
  statusLeft?: React.ReactNode
  statusRight?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="c1-root flex h-screen min-h-screen w-full flex-col overflow-hidden">
      <TitleBar userName={userName} role={role} roles={roles} onRoleChange={onRoleChange} />
      <SectionBar sections={sections} onOpenWindow={onOpenWindow} />
      <WindowTabs windows={windows} activeId={activeId} onSelect={onSelectWindow} onClose={onCloseWindow} />
      <div className="flex min-h-0 flex-1 flex-col bg-[#f4f4f4]">{children}</div>
      <div className="flex h-[24px] shrink-0 items-center justify-between border-t border-[#d4d4d4] bg-[#f2f2f2] px-3 text-[11px] text-[#5c5c5c]">
        <div className="min-w-0 truncate">{statusLeft}</div>
        <div className="ml-4 shrink-0 truncate">{statusRight}</div>
      </div>
    </div>
  )
}
