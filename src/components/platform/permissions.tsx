'use client'

/**
 * «Права доступа» (Task 111) — раздел администрации: матрица «роль × право».
 * Каждая строка — функция платформы, каждая колонка — роль. Выключенное право
 * полностью скрывает функцию из интерфейса этой роли и блокируется на сервере.
 */
import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { EmptyState, ErrorBlock, LoadingBlock, NoticeLine, SectionHeader } from '@/components/platform/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { PERM_GROUPS, PERM_DEFAULTS, ROLE_LABELS, type PermKey, type PermRole } from '@/lib/perm-catalog'
import type { PermMatrixRow } from '@/lib/types'

const ROLE_ORDER: PermRole[] = ['logist', 'carrier', 'admin']

export default function PermissionsTab() {
  const { toast } = useToast()
  const [rows, setRows] = useState<PermMatrixRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await api.permissions()
      setRows(d.perms)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const allowedOf = (role: PermRole, key: PermKey): boolean =>
    rows?.find((r) => r.role === role)?.items.find((i) => i.key === key)?.allowed ?? false

  const flip = async (role: PermRole, key: PermKey, next: boolean) => {
    setBusyKey(`${role}:${key}`)
    const prev = rows
    // оптимистично: тумблер переключается сразу, при ошибке — откат
    setRows((cur) => cur?.map((r) => r.role === role
      ? { ...r, items: r.items.map((i) => i.key === key ? { ...i, allowed: next } : i) }
      : r) ?? cur)
    try {
      const d = await api.permissionsUpdate([{ role, key, allowed: next }])
      setRows(d.perms)
      toast({
        title: next ? 'Право включено' : 'Право отключено',
        description: `${ROLE_LABELS[role]} · ${permTitle(key)} — функция ${next ? 'появится' : 'исчезнет'} из интерфейса этой роли`,
      })
    } catch (e) {
      setRows(prev)
      toast({ title: 'Не удалось изменить право', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setBusyKey(null)
    }
  }

  const resetRole = async (role: PermRole) => {
    const updates = PERM_GROUPS.flatMap((g) => g.items)
      .map((i) => ({ role, key: i.key as string, allowed: PERM_DEFAULTS[role][i.key] }))
    setBusyKey(`reset:${role}`)
    try {
      const d = await api.permissionsUpdate(updates)
      setRows(d.perms)
      toast({ title: 'Права сброшены', description: `${ROLE_LABELS[role]} — возвращён стандартный набор прав` })
    } catch (e) {
      toast({ title: 'Не удалось сбросить права', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <section aria-label="Права доступа">
      <SectionHeader
        title="Права доступа"
        desc="Матрица «роль × право»: что разрешено логисту, перевозчику и администрации. Выключенное право полностью скрывает функцию из интерфейса этой роли и блокируется на сервере — раздел, кнопка или действие просто исчезают."
      />

      <NoticeLine className="mb-4">
        Правила применяются сразу: интерфейс перестаёт показывать функцию у пользователей
        этой роли после обновления страницы, сервер отклоняет прямые запросы к API.
      </NoticeLine>

      {rows === null && !error && <LoadingBlock label="Загружаем матрицу прав…" />}
      {error && <ErrorBlock message={error} onRetry={() => void load()} />}

      {rows !== null && !error && (
        <div className="space-y-4">
          {PERM_GROUPS.map((group) => (
            <Card key={group.title} className="border-slate-200 shadow-sm">
              <CardContent className="p-4 sm:p-5">
                <h3 className="mb-3 text-sm font-semibold text-slate-900">{group.title}</h3>
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
                                disabled={busy}
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
              </CardContent>
            </Card>
          ))}

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <div className="text-sm text-slate-700">
                  Стандартные наборы прав: логисту — все функции, перевозчику — торги, документы и ЭДО,
                  администрации — просмотр всех разделов. Сброс возвращает эти значения.
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {ROLE_ORDER.map((role) => (
                  <Button
                    key={role}
                    variant="outline"
                    size="sm"
                    disabled={busyKey === `reset:${role}`}
                    onClick={() => void resetRole(role)}
                  >
                    Сбросить: {ROLE_LABELS[role]}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <EmptyState
            icon={<ShieldCheck className="h-10 w-10" aria-hidden />}
            title="Подсказка"
            hint="Права проверяются и на сервере: прямые запросы к API без права отклоняются с пояснением, поэтому отключённая функция недоступна даже через инструменты разработчика."
          />
        </div>
      )}
    </section>
  )
}

function permTitle(key: PermKey): string {
  for (const g of PERM_GROUPS) {
    const item = g.items.find((i) => i.key === key)
    if (item) return item.label
  }
  return key
}
