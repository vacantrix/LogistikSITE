'use client'

/**
 * «Базовые права ролей» — встраиваемая карта «роль × право».
 * Живёт внутри единого раздела «Профили и доступы» (слияние бывших разделов
 * «Профили и доступы» и «Права доступа»): база роли + персональные права
 * конкретным пользователям поверх неё (их редактирует admin-users.tsx).
 * Выключенное право полностью скрывает функцию из интерфейса роли и
 * блокируется на сервере.
 */
import { useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { EmptyState, NoticeLine } from '@/components/platform/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { PERM_GROUPS, PERM_DEFAULTS, ROLE_LABELS, type PermKey, type PermRole } from '@/lib/perm-catalog'
import type { PermMatrixRow } from '@/lib/types'

const ROLE_ORDER: PermRole[] = ['logist', 'carrier', 'admin']

/** Карта базовых прав ролей с внешним состоянием (общий с редактором персональных прав) */
export default function RolePermMatrix({ rows, onRowsChange }: {
  rows: PermMatrixRow[] | null
  onRowsChange: (rows: PermMatrixRow[]) => void
}) {
  const { toast } = useToast()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const prevRef = useRef<PermMatrixRow[] | null>(null)

  const allowedOf = (role: PermRole, key: PermKey): boolean =>
    rows?.find((r) => r.role === role)?.items.find((i) => i.key === key)?.allowed ?? false

  const flip = async (role: PermRole, key: PermKey, next: boolean) => {
    if (!rows) return
    setBusyKey(`${role}:${key}`)
    prevRef.current = rows
    // оптимистично: тумблер переключается сразу, при ошибке — откат
    onRowsChange(rows.map((r) => r.role === role
      ? { ...r, items: r.items.map((i) => i.key === key ? { ...i, allowed: next } : i) }
      : r))
    try {
      const d = await api.permissionsUpdate([{ role, key, allowed: next }])
      onRowsChange(d.perms)
      toast({
        title: next ? 'Право включено' : 'Право отключено',
        description: `${ROLE_LABELS[role]} · ${permTitle(key)} — функция ${next ? 'появится' : 'исчезнет'} из интерфейса этой роли`,
      })
    } catch (e) {
      if (prevRef.current) onRowsChange(prevRef.current)
      toast({ title: 'Не удалось изменить право', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setBusyKey(null)
    }
  }

  const resetRole = async (role: PermRole) => {
    if (!rows) return
    setBusyKey(`reset:${role}`)
    prevRef.current = rows
    try {
      const updates = PERM_GROUPS.flatMap((g) => g.items)
        .map((i) => ({ role, key: i.key as string, allowed: PERM_DEFAULTS[role][i.key] }))
      const d = await api.permissionsUpdate(updates)
      onRowsChange(d.perms)
      toast({ title: 'Права сброшены', description: `${ROLE_LABELS[role]} — возвращён стандартный набор прав` })
    } catch (e) {
      if (prevRef.current) onRowsChange(prevRef.current)
      toast({ title: 'Не удалось сбросить права', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-1 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-violet-600" aria-hidden />
          <h3 className="text-sm font-semibold text-slate-900">Базовые права ролей</h3>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Первый слой доступа: что разрешено роли в целом. Персональные права конкретному
          пользователю настраиваются кнопкой «Права» напротив его профиля в списке выше и
          перекрывают базу роли.
        </p>

        <NoticeLine className="mb-4">
          Правила применяются сразу: интерфейс перестаёт показывать функцию у пользователей
          этой роли после обновления страницы, сервер отклоняет прямые запросы к API.
        </NoticeLine>

        <div className="space-y-4">
          {PERM_GROUPS.map((group) => (
            <div key={group.title}>
              <h4 className="mb-2 text-[11px] font-semibold text-slate-400">{group.title}</h4>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <div
                    key={item.key}
                    className="flex flex-col gap-2 border-b border-slate-100 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900">{item.label}</div>
                      {item.hint && <div className="mt-0.5 text-xs text-slate-500">{item.hint}</div>}
                    </div>
                    <div className="grid grid-cols-3 gap-2 sm:w-[420px] sm:shrink-0">
                      {ROLE_ORDER.map((role) => {
                        const on = allowedOf(role, item.key)
                        const busy = busyKey === `${role}:${item.key}`
                        return (
                          <label
                            key={role}
                            className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 transition-colors hover:bg-slate-50"
                          >
                            <Switch
                              checked={on}
                              disabled={busy || rows === null}
                              onCheckedChange={(v) => void flip(role, item.key, v)}
                              aria-label={`${item.label} — ${ROLE_LABELS[role]}`}
                            />
                            <span className={`text-xs font-medium ${on ? 'text-slate-900' : 'text-slate-400'}`}>
                              {ROLE_LABELS[role]}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <div className="text-sm text-slate-700">
              Стандартные наборы: логисту — все функции, перевозчику — торги, документы и ЭДО,
              администрации — просмотр всех разделов. Сброс возвращает эти значения.
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {ROLE_ORDER.map((role) => (
              <Button
                key={role}
                variant="outline"
                size="sm"
                disabled={busyKey === `reset:${role}` || rows === null}
                onClick={() => void resetRole(role)}
              >
                Сбросить: {ROLE_LABELS[role]}
              </Button>
            ))}
          </div>
        </div>

        <EmptyState
          icon={<ShieldCheck className="h-10 w-10" aria-hidden />}
          title="Подсказка"
          hint="Права проверяются и на сервере: прямые запросы к API без права отклоняются с пояснением, поэтому отключённая функция недоступна даже через инструменты разработчика."
        />
      </CardContent>
    </Card>
  )
}

function permTitle(key: PermKey): string {
  for (const g of PERM_GROUPS) {
    const item = g.items.find((i) => i.key === key)
    if (item) return item.label
  }
  return key
}
