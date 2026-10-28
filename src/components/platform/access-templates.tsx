'use client'

/**
 * Вкладка «Должности»: наборы прав внутри контура. Показываются только права выбранного
 * контура; изменения сохраняются через окно со списком изменений и затронутых людей.
 */
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Star } from 'lucide-react'
import { CONTOUR_META, CONTOUR_ORDER, DiffList, RiskBadge, plural, type DiffLine } from '@/components/platform/access-ui'
import type { RoleKind } from '@/components/platform/common'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { permGroupsFor, permLabel, type PermKey } from '@/lib/perm-catalog'
import type { AccessDataDTO, AccessTemplateDTO } from '@/lib/types'

/** Черновик должности: id = null — новая */
interface Draft { id: string | null; name: string; description: string; perms: Set<string> }

const toDraft = (t: AccessTemplateDTO): Draft => ({ id: t.id, name: t.name, description: t.description, perms: new Set(t.perms) })

export function AccessTemplates({ data, onSaved }: { data: AccessDataDTO; onSaved: (d: AccessDataDTO) => void }) {
  const { toast } = useToast()
  const [contour, setContour] = useState<RoleKind>('logist')
  const list = data.templates.filter((t) => t.contour === contour)
  const [selectedId, setSelectedId] = useState<string | null>(list[0]?.id ?? null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirm, setConfirm] = useState<'save' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selected = data.templates.find((t) => t.id === selectedId && t.contour === contour) ?? null
  // выбор другой должности или свежие данные — черновик заново из сохранённой
  useEffect(() => {
    if (draft?.id === null) return
    setDraft(selected ? toDraft(selected) : null)
  }, [selected?.id, selected?.updatedAt])
  useEffect(() => {
    if (!list.some((t) => t.id === selectedId) && draft?.id !== null) setSelectedId(list[0]?.id ?? null)
  }, [contour, data])

  const base = draft?.id ? new Set(selected?.perms ?? []) : new Set<string>()
  const added = draft ? [...draft.perms].filter((k) => !base.has(k)) : []
  const removed = draft ? [...base].filter((k) => !draft.perms.has(k)) : []
  const renamed = draft && selected && draft.id ? draft.name.trim() !== selected.name || draft.description.trim() !== selected.description : false
  const dirty = draft ? draft.id === null || added.length > 0 || removed.length > 0 || renamed : false
  const users = draft?.id ? data.users.filter((u) => u.templateId === draft.id) : []

  const lines = useMemo<DiffLine[]>(() => {
    if (!draft) return []
    const out: DiffLine[] = []
    if (draft.id === null) out.push({ sign: '•', text: `Новая должность «${draft.name.trim()}» (${CONTOUR_META[contour].label.toLowerCase()})` })
    else if (selected && draft.name.trim() !== selected.name) out.push({ sign: '•', text: `Название: «${selected.name}» → «${draft.name.trim()}»` })
    if (draft.id && selected && draft.description.trim() !== selected.description) out.push({ sign: '•', text: 'Описание изменено' })
    for (const k of added) out.push({ sign: '+', text: permLabel(k as PermKey, contour) })
    for (const k of removed) out.push({ sign: '−', text: permLabel(k as PermKey, contour) })
    return out
  }, [draft, selected, added, removed, contour])

  const toggle = (key: string, on: boolean) =>
    setDraft((d) => {
      if (!d) return d
      const perms = new Set(d.perms)
      if (on) perms.add(key)
      else perms.delete(key)
      return { ...d, perms }
    })

  const startNew = () => {
    const src = selected ?? list[0]
    let name = 'Новая должность', i = 2
    while (list.some((t) => t.name === name)) name = `Новая должность ${i++}`
    setDraft({ id: null, name, description: src ? `Копия должности «${src.name}»` : '', perms: new Set(src?.perms ?? []) })
  }

  const run = async (fn: () => Promise<AccessDataDTO>, done: string, after?: (d: AccessDataDTO) => void) => {
    setBusy(true)
    setError('')
    try {
      const d = await fn()
      onSaved(d)
      after?.(d)
      setConfirm(null)
      toast({ title: done })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    if (!draft) return
    const name = draft.name.trim()
    void run(
      () => api.accessTemplateSave({ id: draft.id ?? undefined, contour, name, description: draft.description.trim(), perms: [...draft.perms] }),
      draft.id ? `Должность «${name}» сохранена${users.length ? ` — права ${users.length} ${plural(users.length, 'пользователя', 'пользователей', 'пользователей')} обновятся сразу` : ''}` : `Должность «${name}» создана`,
      (d) => {
        if (draft.id === null) {
          const created = d.templates.find((t) => t.contour === contour && t.name === name)
          setDraft(created ? toDraft(created) : null)
          setSelectedId(created?.id ?? null)
        }
      },
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1" role="group" aria-label="Контур">
          {CONTOUR_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={contour === c}
              onClick={() => { setContour(c); setDraft(null); setSelectedId(data.templates.find((t) => t.contour === c)?.id ?? null) }}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${contour === c ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {CONTOUR_META[c].short}
            </button>
          ))}
        </div>
        <span className="text-sm text-slate-500">Показаны только права контура «{CONTOUR_META[contour].label}»</span>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="gap-0 border-slate-200 p-2 shadow-sm">
          {list.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={draft?.id === t.id}
              onClick={() => { setSelectedId(t.id); setDraft(toDraft(t)) }}
              className={`grid w-full gap-0.5 rounded-md border px-3 py-2.5 text-left transition-colors ${
                draft?.id === t.id ? 'border-violet-200 bg-violet-50' : 'border-transparent hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                {t.name}
                {t.isDefault && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="для новых учёток" />}
              </span>
              <span className="text-xs text-slate-500">
                {t.perms.length} {plural(t.perms.length, 'право', 'права', 'прав')} · {t.userCount} {plural(t.userCount, 'пользователь', 'пользователя', 'пользователей')}
              </span>
            </button>
          ))}
          {draft?.id === null && (
            <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2.5 text-sm font-semibold text-violet-800">{draft.name || 'Новая должность'}</div>
          )}
          <Button variant="outline" size="sm" className="m-2 gap-1" onClick={startNew} disabled={draft?.id === null}>
            <Plus className="h-4 w-4" aria-hidden /> Новая должность
          </Button>
        </Card>

        {draft ? (
          <Card className="gap-0 border-slate-200 p-0 shadow-sm">
            <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">Название</Label>
                <Input id="tpl-name" value={draft.name} onChange={(e) => setDraft((d) => d && { ...d, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-desc">Описание</Label>
                <Input id="tpl-desc" value={draft.description} onChange={(e) => setDraft((d) => d && { ...d, description: e.target.value })} placeholder="Кому подходит должность" />
              </div>
              {draft.id && selected && (
                <div className="flex flex-wrap items-center gap-3 text-sm sm:col-span-2">
                  {selected.isDefault ? (
                    <span className="inline-flex items-center gap-1 text-slate-600"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden /> Назначается новым учёткам контура</span>
                  ) : (
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-violet-700" disabled={busy}
                      onClick={() => void run(() => api.accessTemplateDefault(selected.id), `«${selected.name}» — основная должность для новых учёток`)}>
                      Сделать основной для новых учёток
                    </Button>
                  )}
                  <Button
                    variant="ghost" size="sm" className="ml-auto h-8 px-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                    disabled={busy || selected.isDefault || selected.userCount > 0}
                    title={selected.isDefault ? 'Основная должность не удаляется' : selected.userCount > 0 ? 'Сначала переведите пользователей на другую должность' : undefined}
                    onClick={() => { setError(''); setConfirm('delete') }}
                  >
                    Удалить
                  </Button>
                </div>
              )}
            </div>

            {permGroupsFor(contour).map((g) => (
              <div key={g.title}>
                <div className="px-4 pb-1 pt-3 text-[11px] font-semibold text-slate-400">{g.title}</div>
                {g.items.map((p) => {
                  const on = draft.perms.has(p.key)
                  const changed = draft.id !== null && on !== base.has(p.key)
                  return (
                    <label
                      key={p.key}
                      htmlFor={`perm-${p.key}`}
                      className={`grid cursor-pointer grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-3 px-4 py-2 transition-colors ${changed ? 'bg-violet-50' : 'hover:bg-slate-50'}`}
                    >
                      <Checkbox id={`perm-${p.key}`} checked={on} onCheckedChange={(v) => toggle(p.key, v === true)} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-900">{permLabel(p.key, contour)}</span>
                        <span className="block text-xs text-slate-500">{p.hint}</span>
                      </span>
                      <RiskBadge perm={p.key} />
                    </label>
                  )
                })}
              </div>
            ))}

            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-b-xl border-t border-slate-200 bg-slate-50 p-4">
              <span className="mr-auto text-sm text-slate-600">
                {draft.id === null
                  ? `Новая должность · ${draft.perms.size} ${plural(draft.perms.size, 'право', 'права', 'прав')}`
                  : dirty
                    ? `Изменено${added.length ? ` +${added.length}` : ''}${removed.length ? ` −${removed.length}` : ''} · затронет ${users.length} ${plural(users.length, 'пользователя', 'пользователей', 'пользователей')}`
                    : `${draft.perms.size} ${plural(draft.perms.size, 'право', 'права', 'прав')} · ${users.length} ${plural(users.length, 'пользователь', 'пользователя', 'пользователей')}`}
              </span>
              <Button variant="outline" disabled={!dirty || busy} onClick={() => setDraft(selected && draft.id ? toDraft(selected) : list[0] ? toDraft(list[0]) : null)}>Отменить</Button>
              <Button disabled={!dirty || busy || draft.name.trim().length < 2} onClick={() => { setError(''); setConfirm('save') }}>Сохранить…</Button>
            </div>
          </Card>
        ) : (
          <Card className="border-slate-200 p-6 text-sm text-slate-500 shadow-sm">Выберите должность слева или создайте новую.</Card>
        )}
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o && !busy) setConfirm(null) }}>
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
          {confirm === 'delete' && selected ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Удалить должность «{selected.name}»?</AlertDialogTitle>
                <AlertDialogDescription>На ней никого нет. Восстановить можно, создав должность заново.</AlertDialogDescription>
              </AlertDialogHeader>
              {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Вернуться</AlertDialogCancel>
                <Button className="bg-red-600 text-white hover:bg-red-700" disabled={busy}
                  onClick={() => void run(() => api.accessTemplateDelete(selected.id), `Должность «${selected.name}» удалена`, () => { setDraft(null); setSelectedId(null) })}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Удалить
                </Button>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{draft?.id === null ? 'Создать должность' : `Сохранить должность «${draft?.name.trim()}»`}</AlertDialogTitle>
                <AlertDialogDescription>
                  {users.length
                    ? `Затронет: ${users.map((u) => u.fullName).join(', ')}. Права обновятся у них сразу.`
                    : 'На этой должности пока никого нет.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <DiffList lines={lines} />
              {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Вернуться</AlertDialogCancel>
                <Button disabled={busy} onClick={save}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Сохранить
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
