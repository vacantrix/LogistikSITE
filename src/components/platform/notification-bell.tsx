'use client'

/**
 * Колокольчик уведомлений (Task 69): персональные события роли.
 *  — логист: новые ставки, итоги торгов, экипажи от перевозчиков, готовые документы;
 *  — перевозчик: победа в торгах, перебитая ставка, возврат/подтверждение документов,
 *    закрытие рейса, удаление заявки.
 * Обновляется по liveTick (шина WS), по открытию и страховочным интервалом;
 * клик по уведомлению отмечает его прочитанным и ведёт в нужный раздел.
 * Непрочитанный счётчик выносится в вкладку браузера: цифра в заголовке плюс
 * синий кружок с белой цифрой на иконке вкладки (lib/favicon-badge, Task 103).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Bell, CheckCheck, FileCheck2, FilePen, FileSignature, Gavel, Trash2, TrendingDown, Trophy, Truck, Undo2, Users, type LucideIcon,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { setFaviconBadge } from '@/lib/favicon-badge'
import type { RoleKind, TabKey } from '@/components/platform/common'
import type { NotificationDTO } from '@/lib/types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full'

/** Иконка и цвет уведомления по типу события */
const NOTIF_META: Record<string, { Icon: LucideIcon; cls: string }> = {
  BID_PLACED: { Icon: Gavel, cls: 'bg-sky-100 text-sky-700' },
  BID_OUTBID: { Icon: TrendingDown, cls: 'bg-amber-100 text-amber-700' },
  AUCTION_FINISHED: { Icon: Gavel, cls: 'bg-violet-100 text-violet-700' },
  WINNER_AWARDED: { Icon: Trophy, cls: 'bg-emerald-100 text-emerald-700' },
  CREW_ASSIGNED: { Icon: Users, cls: 'bg-blue-100 text-blue-700' },
  DOCS_READY: { Icon: FileCheck2, cls: 'bg-blue-100 text-blue-700' },
  DOCS_RETURNED: { Icon: Undo2, cls: 'bg-amber-100 text-amber-700' },
  DOCS_CONFIRMED: { Icon: CheckCheck, cls: 'bg-emerald-100 text-emerald-700' },
  TRIP_CLOSED: { Icon: Truck, cls: 'bg-slate-200 text-slate-700' },
  REQUEST_DELETED: { Icon: Trash2, cls: 'bg-red-100 text-red-700' },
  MOVED_TO_DRAFT: { Icon: FilePen, cls: 'bg-slate-200 text-slate-700' },
  EDO_READY: { Icon: FileSignature, cls: 'bg-teal-100 text-teal-700' },
  EDO_SIGNED: { Icon: FileSignature, cls: 'bg-emerald-100 text-emerald-700' },
}

/** Куда вести по клику: раздел зависит от роли получателя */
const NAV_TARGET: Record<string, Partial<Record<RoleKind, TabKey>>> = {
  BID_PLACED: { logist: 'board', carrier: 'board' },
  BID_OUTBID: { logist: 'board', carrier: 'board' },
  AUCTION_FINISHED: { logist: 'requests', carrier: 'my' },
  WINNER_AWARDED: { logist: 'requests', carrier: 'my' },
  CREW_ASSIGNED: { logist: 'requests', carrier: 'crew' },
  DOCS_READY: { logist: 'verify', carrier: 'apply' },
  DOCS_RETURNED: { logist: 'verify', carrier: 'apply' },
  DOCS_CONFIRMED: { logist: 'requests', carrier: 'my' },
  TRIP_CLOSED: { logist: 'registry', carrier: 'my' },
  REQUEST_DELETED: { logist: 'requests', carrier: 'my' },
  MOVED_TO_DRAFT: { logist: 'drafts' },
  EDO_READY: { logist: 'edo', carrier: 'edo' },
  EDO_SIGNED: { logist: 'edo', carrier: 'edo' },
}

/** «Только что / 7 мин назад / 3 ч назад / вчера / 12.03» */
function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'только что'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч назад`
  if (h < 48) return 'вчера'
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

export function NotificationBell({ role, onNavigate, liveTick }: {
  role: RoleKind
  onNavigate: (t: TabKey) => void
  liveTick: number
}) {
  const [items, setItems] = useState<NotificationDTO[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)

  const load = useCallback(() => {
    return api.listNotifications()
      .then((d) => {
        setItems(d.notifications)
        setUnread(d.unread)
        setLoadedOnce(true)
      })
      .catch(() => { /* сессия истекла и т.п. — колокольчик просто не обновится */ })
  }, [])

  // первичная загрузка + догрузка по live-событиям шины + страховочный интервал
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (liveTick > 0) void load() }, [liveTick, load])
  useEffect(() => {
    const t = setInterval(() => void load(), 30_000)
    return () => clearInterval(t)
  }, [load])

  // вкладка браузера: цифра в заголовке + синий кружок с белой цифрой на иконке
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) АЭМЗ Логистика` : 'АЭМЗ Логистика'
    setFaviconBadge(unread)
  }, [unread])

  const openPanel = (o: boolean) => {
    setOpen(o)
    if (o) void load()
  }

  const markAll = async () => {
    try {
      await api.markNotifications({ all: true })
      setItems((list) => list.map((n) => ({ ...n, read: true })))
      setUnread(0)
    } catch { /* повторим при следующем открытии */ }
  }

  const onItemClick = async (n: NotificationDTO) => {
    if (!n.read) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      setUnread((u) => Math.max(0, u - 1))
      void api.markNotifications({ ids: [n.id] }).catch(() => {})
    }
    const target = NAV_TARGET[n.type]?.[role] ?? (role === 'logist' ? 'requests' : 'my')
    setOpen(false)
    onNavigate(target)
  }

  return (
    <Popover open={open} onOpenChange={openPanel}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Уведомления: ${unread} непрочитанных` : 'Уведомления'}
          className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
            open
              ? 'bg-white/20 text-white'
              : 'border border-white/20 bg-white/10 text-blue-100 hover:bg-white/20 hover:text-white'
          }`}
        >
          <Bell className="h-4 w-4" aria-hidden />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-[#0E1B2C] bg-red-500 px-0.5 text-[9px] font-bold leading-none text-white"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(23rem,calc(100vw-1.5rem))] p-0"
        aria-label="Список уведомлений"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">Уведомления</span>
            {unread > 0 && (
              <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{unread}</span>
            )}
          </div>
          {unread > 0 && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-blue-700 hover:bg-blue-50" onClick={() => void markAll()}>
              Прочитать все
            </Button>
          )}
        </div>

        <div className={`max-h-96 overflow-y-auto ${THIN_SCROLL}`}>
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
              <Bell className="h-7 w-7 text-slate-300" aria-hidden />
              <div className="text-sm font-medium text-slate-600">
                {loadedOnce ? 'Уведомлений нет' : 'Загрузка…'}
              </div>
              <div className="text-xs text-slate-400">
                {role === 'logist'
                  ? 'Ставки перевозчиков и события по заявкам появятся здесь'
                  : 'События по вашим заявкам и рейсам появятся здесь'}
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((n) => {
                const meta = NOTIF_META[n.type] ?? { Icon: Bell, cls: 'bg-slate-100 text-slate-600' }
                const { Icon } = meta
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => void onItemClick(n)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${n.read ? '' : 'bg-blue-50/50'}`}
                      aria-label={`${n.title}. ${n.body}`}
                    >
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.cls}`} aria-hidden>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className={`truncate text-sm ${n.read ? 'font-medium text-slate-700' : 'font-semibold text-slate-900'}`}>
                            {n.title}
                          </span>
                          <span className="shrink-0 text-[11px] leading-none text-slate-400">{relTime(n.createdAt)}</span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-slate-500">{n.body}</span>
                      </span>
                      {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" aria-hidden />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
