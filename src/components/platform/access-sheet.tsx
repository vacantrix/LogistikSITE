'use client'

/**
 * Панель «Доступ» пользователя: должность, личные исключения (с причиной и сроком),
 * итоговые права с источником и «что увидит пользователь». Изменения сохраняются
 * кнопкой через окно со списком «было → стало»; сервер повторяет все проверки.
 */
import { useMemo, useState } from 'react'
import { ChevronDown, Loader2, Plus, ShieldCheck } from 'lucide-react'
import {
  CONTOUR_META, DiffList, ExceptionChip, RiskBadge, effectiveOf, exActive, plural, ruDate, ruShort, todayIso,
  type DiffLine, type ExceptionDraft,
} from '@/components/platform/access-ui'
import { StatusDot } from '@/components/platform/common'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { permGroupsFor, permLabel, permsFor, type PermKey } from '@/lib/perm-catalog'
import type { AccessDataDTO, AccessTemplateDTO, AccessUserDTO } from '@/lib/types'

export function AccessSheet({ user, templates, onClose, onSaved }: {
  user: AccessUserDTO
  templates: AccessTemplateDTO[]
  onClose: () => void
  onSaved: (data: AccessDataDTO) => void
}) {
  const { toast } = useToast()
  const contour = user.role
  const today = todayIso()
  const own = templates.filter((t) => t.contour === contour)
  const [templateId, setTemplateId] = useState(user.templateId ?? own.find((t) => t.isDefault)?.id ?? own[0]?.id ?? '')
  const [exceptions, setExceptions] = useState<ExceptionDraft[]>(user.exceptions.map(({ key, effect, reason, expiresAt }) => ({ key, effect, reason, expiresAt })))
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<{ key: string; effect: 'allow' | 'deny'; reason: string; until: string }>({ key: '', effect: 'allow', reason: '', until: '' })
  const [formError, setFormError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [showSees, setShowSees] = useState(false)

  const tpl = own.find((t) => t.id === templateId)
  const tplPerms = useMemo(() => new Set(tpl?.perms ?? []), [tpl])
  const beforeTpl = new Set(templates.find((t) => t.id === user.templateId)?.perms ?? [])
  const catalog = permsFor(contour)
  const groups = permGroupsFor(contour)
  const free = catalog.filter((p) => !exceptions.some((e) => e.key === p.key))

  /** Изменения «было → стало» для окна подтверждения */
  const changes = useMemo<DiffLine[]>(() => {
    const lines: DiffLine[] = []
    if (templateId !== user.templateId) {
      lines.push({ sign: '•', text: `Должность: «${user.templateName}» → «${tpl?.name ?? '—'}»` })
    }
    for (const e of exceptions) {
      const old = user.exceptions.find((x) => x.key === e.key)
      if (!old || old.effect !== e.effect || old.reason !== e.reason || old.expiresAt !== e.expiresAt) {
        lines.push({
          sign: '•',
          text: `Исключение «${permLabel(e.key as PermKey, contour)}»: ${e.effect === 'allow' ? 'разрешено' : 'запрещено'}${e.expiresAt ? ` до ${ruDate(e.expiresAt)}` : ' бессрочно'}. Причина: ${e.reason}`,
        })
      }
    }
    for (const old of user.exceptions) {
      if (!exceptions.some((e) => e.key === old.key)) lines.push({ sign: '•', text: `Снято исключение «${permLabel(old.key as PermKey, contour)}»` })
    }
    for (const p of catalog) {
      const a = effectiveOf(beforeTpl, user.exceptions, p.key, today).on
      const b = effectiveOf(tplPerms, exceptions, p.key, today).on
      if (a !== b) lines.push({ sign: b ? '+' : '−', text: permLabel(p.key, contour) })
    }
    return lines
  }, [templateId, exceptions, user, tpl, tplPerms, today])

  const effOn = catalog.filter((p) => effectiveOf(tplPerms, exceptions, p.key, today).on)

  const addException = () => {
    const key = form.key
    if (!key) { setFormError('Выберите право'); return }
    const base = tplPerms.has(key)
    if (form.effect === 'allow' && base) { setFormError('Это право уже есть в должности — исключение ничего не изменит'); return }
    if (form.effect === 'deny' && !base) { setFormError('В должности этого права нет — запрещать нечего'); return }
    if (form.reason.trim().length < 3) { setFormError('Укажите причину: кто и зачем получает исключение'); return }
    if (form.until && form.until < today) { setFormError('Срок уже прошёл — выберите дату не раньше сегодняшней'); return }
    setExceptions((xs) => [...xs, { key, effect: form.effect, reason: form.reason.trim(), expiresAt: form.until || null }])
    setAdding(false)
    setForm({ key: '', effect: 'allow', reason: '', until: '' })
    setFormError('')
  }

  const save = async () => {
    setSaving(true)
    setSaveError('')
    try {
      const data = await api.accessUserSave({ userId: user.id, templateId, exceptions })
      toast({ title: 'Доступ сохранён', description: `${user.fullName}: права обновятся у пользователя сразу, без перезагрузки страницы` })
      setConfirm(false)
      onSaved(data)
      onClose()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Не удалось сохранить доступ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o && !saving) onClose() }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-slate-200 p-5">
          <SheetTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-violet-600" aria-hidden />
            Доступ · {user.fullName}
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusDot dot={CONTOUR_META[contour].dot}>{CONTOUR_META[contour].label}</StatusDot>
            <span>{user.login}{user.carrierName ? ` · ${user.carrierName}` : ''}{user.position ? ` · ${user.position}` : ''}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-0 overflow-y-auto px-5">
          {/* ——— должность ——— */}
          <section className="border-b border-slate-200 py-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Должность</div>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger aria-label="Должность" className="w-full"><SelectValue placeholder="Выберите должность" /></SelectTrigger>
              <SelectContent>
                {own.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} — {t.perms.length} {plural(t.perms.length, 'право', 'права', 'прав')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tpl?.description && <p className="mt-2 text-xs text-slate-500">{tpl.description}</p>}
          </section>

          {/* ——— исключения ——— */}
          <section className="border-b border-slate-200 py-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Личные исключения</span>
              {!adding && free.length > 0 && (
                <Button variant="ghost" size="sm" className="h-8 gap-1 text-violet-700 hover:bg-violet-50 hover:text-violet-800" onClick={() => { setAdding(true); setForm((f) => ({ ...f, key: free[0]?.key ?? '' })) }}>
                  <Plus className="h-4 w-4" aria-hidden /> Добавить
                </Button>
              )}
            </div>

            {exceptions.length === 0 && !adding && (
              <p className="text-sm text-slate-500">Нет. Работает ровно должность.</p>
            )}

            <div className="space-y-2">
              {exceptions.map((e) => {
                const active = exActive(e, today)
                const useless = active && ((e.effect === 'allow' && tplPerms.has(e.key)) || (e.effect === 'deny' && !tplPerms.has(e.key)))
                return (
                  <div key={e.key} className={`rounded-lg border border-slate-200 p-3 ${active ? '' : 'opacity-60'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <ExceptionChip ex={e} contour={contour} />
                      <Button
                        variant="ghost" size="sm" className="h-7 px-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setExceptions((xs) => xs.filter((x) => x.key !== e.key))}
                      >
                        Снять
                      </Button>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-600">
                      {e.expiresAt ? (active ? `до ${ruDate(e.expiresAt)}` : `истекло ${ruDate(e.expiresAt)} — не действует`) : 'бессрочно'} · {e.reason}
                    </p>
                    {useless && (
                      <p className="mt-1 text-xs text-amber-700">
                        Ничего не меняет: {e.effect === 'allow' ? 'право уже есть в должности' : 'в должности этого права нет'} — можно снять
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            {adding && (
              <div className="mt-2 space-y-3 rounded-lg border border-dashed border-violet-300 bg-violet-50/60 p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ex-key">Право</Label>
                  <Select value={form.key} onValueChange={(v) => { setForm((f) => ({ ...f, key: v, effect: tplPerms.has(v) ? 'deny' : 'allow' })); setFormError('') }}>
                    <SelectTrigger id="ex-key" className="w-full bg-white"><SelectValue placeholder="Выберите право" /></SelectTrigger>
                    <SelectContent>
                      {free.map((p) => (
                        <SelectItem key={p.key} value={p.key}>
                          {permLabel(p.key, contour)}{tplPerms.has(p.key) ? ' — есть в должности' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <RadioGroup
                  value={form.effect}
                  onValueChange={(v) => { setForm((f) => ({ ...f, effect: v as 'allow' | 'deny' })); setFormError('') }}
                  className="flex flex-wrap gap-4"
                  aria-label="Что сделать с правом"
                >
                  <label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="allow" id="ex-allow" /> Разрешить</label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="deny" id="ex-deny" /> Запретить</label>
                </RadioGroup>
                <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
                  <div className="space-y-1.5">
                    <Label htmlFor="ex-reason">Причина</Label>
                    <Input id="ex-reason" className="bg-white" value={form.reason} onChange={(ev) => { setForm((f) => ({ ...f, reason: ev.target.value })); setFormError('') }} placeholder="Замещает ведущего на время отпуска" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ex-until">Действует до</Label>
                    <Input id="ex-until" className="bg-white" type="date" min={today} value={form.until} onChange={(ev) => { setForm((f) => ({ ...f, until: ev.target.value })); setFormError('') }} />
                  </div>
                </div>
                {formError && <p className="text-sm text-red-600" role="alert">{formError}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={addException}>Добавить исключение</Button>
                  <Button size="sm" variant="outline" onClick={() => { setAdding(false); setFormError('') }}>Отмена</Button>
                </div>
              </div>
            )}
            {!adding && (
              <p className="mt-2 text-xs text-slate-500">
                Исключение — для одного человека и с причиной. Если одинаковые исключения нужны нескольким, заведите должность.
              </p>
            )}
          </section>

          {/* ——— итог ——— */}
          <section className="border-b border-slate-200 py-4">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Итоговые права · {effOn.length} из {catalog.length}
            </div>
            {groups.map((g) => (
              <div key={g.title} className="mt-3">
                <div className="mb-1 text-[11px] font-semibold text-slate-400">{g.title}</div>
                {g.items.map((p) => {
                  const r = effectiveOf(tplPerms, exceptions, p.key, today)
                  return (
                    <div key={p.key} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-2 py-1">
                      <span
                        className={`mt-0.5 grid h-[18px] w-[18px] place-items-center rounded-full text-[11px] font-bold ${r.on ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}
                        aria-hidden
                      >
                        {r.on ? '✓' : '–'}
                      </span>
                      <span className={`flex flex-wrap items-center gap-1.5 text-sm ${r.on ? 'text-slate-900' : 'text-slate-400'}`}>
                        <span className="sr-only">{r.on ? 'Есть: ' : 'Нет: '}</span>
                        {permLabel(p.key, contour)}
                        {r.on && <RiskBadge perm={p.key} />}
                      </span>
                      <span className={`whitespace-nowrap text-right text-xs ${r.source === 'exception' ? 'font-semibold text-violet-700' : 'text-slate-400'}`}>
                        {r.source === 'exception' ? `исключение${r.ex?.expiresAt ? ` до ${ruShort(r.ex.expiresAt)}` : ''}` : r.on ? 'из должности' : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </section>

          {/* ——— что увидит пользователь ——— */}
          <section className="py-4">
            <button
              type="button"
              className="flex items-center gap-1 text-sm font-medium text-violet-700 hover:underline"
              aria-expanded={showSees}
              onClick={() => setShowSees((v) => !v)}
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${showSees ? 'rotate-180' : ''}`} aria-hidden />
              Что увидит пользователь · {effOn.length} {plural(effOn.length, 'функция', 'функции', 'функций')}
            </button>
            {showSees && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                {effOn.length === 0 && <li>Только просмотр разделов своего контура</li>}
                {effOn.map((p) => <li key={p.key}>{p.hint}</li>)}
              </ul>
            )}
          </section>
        </div>

        <SheetFooter className="flex-row flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 p-4">
          <span className="mr-auto text-sm text-slate-600">{changes.length ? `Изменений: ${changes.length}` : 'Изменений нет'}</span>
          <Button variant="outline" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button onClick={() => { setSaveError(''); setConfirm(true) }} disabled={changes.length === 0 || !templateId}>Сохранить…</Button>
        </SheetFooter>

        <AlertDialog open={confirm} onOpenChange={(o) => { if (!o && !saving) setConfirm(false) }}>
          <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle>Сохранить доступ: {user.fullName}</AlertDialogTitle>
              <AlertDialogDescription>Права обновятся у пользователя сразу, без перезагрузки страницы.</AlertDialogDescription>
            </AlertDialogHeader>
            <DiffList lines={changes} />
            {saveError && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{saveError}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={saving}>Вернуться</AlertDialogCancel>
              <Button onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Сохранить
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  )
}
