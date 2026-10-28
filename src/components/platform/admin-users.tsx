'use client'

/**
 * «Профили и доступы» — раздел администрации (право admin:users).
 * Доступ устроен как «контур → должность → исключения»:
 *  — контур — роль учётки: определяет, какие права для человека вообще существуют;
 *  — должность — набор прав внутри контура (вкладка «Должности»);
 *  — исключения — редкая личная правка одного права, с причиной и сроком (панель «Доступ»).
 * Вкладки: Пользователи · Должности · Кто имеет право · Журнал изменений.
 */
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { Loader2, Pencil, Search, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { AccessSheet } from '@/components/platform/access-sheet'
import { AccessTemplates } from '@/components/platform/access-templates'
import { CONTOUR_META, CONTOUR_ORDER, ExceptionChip, TemplateChip } from '@/components/platform/access-ui'
import { AccessJournal, AccessWho } from '@/components/platform/access-views'
import {
  ErrorBlock, LoadingBlock, SectionHeader, StatusDot, type RoleKind, type TabProps,
} from '@/components/platform/common'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import type { AccessDataDTO, AdminUserDTO } from '@/lib/types'

/** Черновик окна создания/редактирования: учётка + поля проформы */
interface UserDraft {
  id: string | null // null — создание
  login: string
  name: string
  password: string
  role: RoleKind
  carrierId: string
  templateId: string
  fullName: string
  position: string
  phone: string
  email: string
}

const emptyDraft = (): UserDraft => ({
  id: null, login: '', name: '', password: '', role: 'carrier', carrierId: '', templateId: '',
  fullName: '', position: '', phone: '', email: '',
})

const toDraft = (u: AdminUserDTO): UserDraft => ({
  id: u.id, login: u.login, name: u.name, password: '', role: u.role, carrierId: u.carrierId ?? '', templateId: u.templateId ?? '',
  fullName: u.profile?.fullName ?? '', position: u.profile?.position ?? '',
  phone: u.profile?.phone ?? '', email: u.profile?.email ?? '',
})

type Filter = 'all' | RoleKind

export default function AdminUsersTab({ liveTick }: TabProps) {
  const { toast } = useToast()
  const [users, setUsers] = useState<AdminUserDTO[] | null>(null)
  const [access, setAccess] = useState<AccessDataDTO | null>(null)
  const [carriers, setCarriers] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState('users')

  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [onlyEx, setOnlyEx] = useState(false)

  const [draft, setDraft] = useState<UserDraft | null>(null) // открытое окно создания/редактирования
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AdminUserDTO | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [accessUserId, setAccessUserId] = useState<string | null>(null) // открытая панель «Доступ»

  const load = useCallback(async () => {
    try {
      const [u, a, d] = await Promise.all([api.adminUsers(), api.accessData(), api.directory()])
      setUsers(u.users)
      setAccess(a)
      setCarriers(d.carriers.map((c) => ({ id: c.id, name: c.name })))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  useEffect(() => { void load() }, [load])
  // другой администратор поменял учётки или должности — список обновляется сам;
  // открытые окна держат свой черновик и не сбрасываются
  useEffect(() => {
    if (!liveTick) return
    void Promise.all([api.adminUsers(), api.accessData()])
      .then(([u, a]) => { setUsers(u.users); setAccess(a) })
      .catch(() => { /* фоновое обновление: ошибка не мешает работе, повторится при следующем событии */ })
  }, [liveTick])

  const reload = async () => {
    try {
      const [u, a] = await Promise.all([api.adminUsers(), api.accessData()])
      setUsers(u.users)
      setAccess(a)
      setError(null)
    } catch (e) {
      toast({ title: 'Не удалось обновить список', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    }
  }

  const set = (key: keyof UserDraft) => (e: ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => (d ? { ...d, [key]: e.target.value } : d))

  const templatesOf = (role: RoleKind) => (access?.templates ?? []).filter((t) => t.contour === role)
  const defaultTemplate = (role: RoleKind) => templatesOf(role).find((t) => t.isDefault)?.id ?? templatesOf(role)[0]?.id ?? ''

  const submit = async () => {
    if (!draft) return
    if (draft.id === null && draft.password.length < 6) {
      toast({ title: 'Пароль — минимум 6 символов', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const profile = { fullName: draft.fullName, position: draft.position, phone: draft.phone, email: draft.email }
      const carrierId = draft.role === 'carrier' ? draft.carrierId : null
      if (draft.id === null) {
        await api.adminUserCreate({
          login: draft.login, name: draft.name, password: draft.password, role: draft.role, carrierId,
          templateId: draft.templateId || null, profile,
        })
        toast({ title: 'Профиль создан', description: `${draft.name}: должность «${templatesOf(draft.role).find((t) => t.id === draft.templateId)?.name ?? 'по умолчанию'}»` })
      } else {
        await api.adminUserUpdate({
          id: draft.id, name: draft.name, role: draft.role, carrierId,
          ...(draft.password ? { password: draft.password } : {}), profile,
        })
        toast({ title: 'Профиль сохранён' })
      }
      setDraft(null)
      await reload()
    } catch (e) {
      toast({
        title: draft.id === null ? 'Не удалось создать профиль' : 'Не удалось сохранить профиль',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.adminUserDelete(deleteTarget.id)
      toast({ title: 'Профиль удалён', description: `${deleteTarget.name} (логин ${deleteTarget.login})` })
      setDeleteTarget(null)
      await reload()
    } catch (e) {
      toast({ title: 'Не удалось удалить профиль', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  if ((users === null || access === null) && !error) return <LoadingBlock label="Загрузка учётных записей…" />
  if (error && (!users || !access)) return <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />
  if (!users || !access) return null

  const accessById = new Map(access.users.map((u) => [u.id, u]))
  const q = query.trim().toLowerCase()
  const rows = users.filter((u) => {
    const a = accessById.get(u.id)
    if (filter !== 'all' && u.role !== filter) return false
    if (onlyEx && !a?.exceptions.some((e) => e.active)) return false
    if (q && ![u.name, u.login, u.carrierName ?? '', u.profile?.fullName ?? '', a?.templateName ?? ''].join(' ').toLowerCase().includes(q)) return false
    return true
  })
  const accessUser = accessUserId ? accessById.get(accessUserId) ?? null : null
  const editingRoleChange = draft?.id ? users.find((u) => u.id === draft.id)?.role !== draft.role : false

  return (
    <div>
      <SectionHeader
        title="Профили и доступы"
        eyebrow="Администрирование"
        desc="Роль определяет, какие права у человека вообще могут быть. Должность задаёт набор прав, а личные исключения — редкие правки одного права с причиной и сроком. Изменения доходят до пользователя сразу, без перезагрузки."
      >
        <Button onClick={() => setDraft({ ...emptyDraft(), templateId: defaultTemplate('carrier') })} className="min-h-10">
          <UserPlus className="h-4 w-4" aria-hidden />
          Создать профиль
        </Button>
      </SectionHeader>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto flex-wrap justify-start">
          <TabsTrigger value="users">Пользователи <span className="ml-1 font-mono text-[11px] text-slate-400">{users.length}</span></TabsTrigger>
          <TabsTrigger value="templates">Должности <span className="ml-1 font-mono text-[11px] text-slate-400">{access.templates.length}</span></TabsTrigger>
          <TabsTrigger value="who">Кто имеет право</TabsTrigger>
          <TabsTrigger value="journal">Журнал изменений</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card className="gap-0 border-slate-200 py-0 shadow-sm">
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-3">
              <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-100 p-1" role="group" aria-label="Контур">
                {(['all', ...CONTOUR_ORDER] as Filter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={filter === f}
                    onClick={() => setFilter(f)}
                    className={`rounded-md px-3 py-1 text-sm transition-colors ${filter === f ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    {f === 'all' ? 'Все' : CONTOUR_META[f].short}
                  </button>
                ))}
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                <Checkbox checked={onlyEx} onCheckedChange={(v) => setOnlyEx(v === true)} aria-label="Только с исключениями" />
                только с исключениями
              </label>
              <div className="relative ml-auto w-full sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя, логин, компания, должность" className="pl-8" aria-label="Поиск пользователей" />
              </div>
            </div>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Пользователь</TableHead>
                      <TableHead>Роль</TableHead>
                      <TableHead>Должность</TableHead>
                      <TableHead>Исключения</TableHead>
                      <TableHead className="text-right">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-slate-500">Никого не нашлось по фильтру</TableCell></TableRow>
                    )}
                    {rows.map((u) => {
                      const a = accessById.get(u.id)
                      const active = a?.exceptions.filter((e) => e.active) ?? []
                      return (
                        <TableRow key={u.id}>
                          <TableCell>
                            <div className="font-semibold text-slate-900">
                              {u.profile?.fullName || u.name}
                              {u.id === access.meId && <span className="ml-1.5 text-[11px] font-medium text-slate-400">вы</span>}
                            </div>
                            <div className="text-xs text-slate-500">{u.login}{u.carrierName ? ` · ${u.carrierName}` : ''}{u.profile?.position ? ` · ${u.profile.position}` : ''}</div>
                          </TableCell>
                          <TableCell><StatusDot dot={CONTOUR_META[u.role].dot}>{CONTOUR_META[u.role].label}</StatusDot></TableCell>
                          <TableCell>
                            <button type="button" className="rounded-full focus-visible:outline-2 focus-visible:outline-violet-500" onClick={() => setAccessUserId(u.id)} aria-label={`Доступ: ${u.name}`}>
                              <TemplateChip name={a?.templateName ?? '—'} />
                            </button>
                          </TableCell>
                          <TableCell>
                            {active.length === 0
                              ? <span className="text-sm text-slate-400">—</span>
                              : <div className="flex max-w-[320px] flex-wrap gap-1">{active.map((e) => <ExceptionChip key={e.key} ex={e} contour={u.role} />)}</div>}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="outline" size="sm" className="h-9 gap-1.5 border-violet-200 text-violet-800 hover:bg-violet-50" onClick={() => setAccessUserId(u.id)}>
                                <ShieldCheck className="h-4 w-4" aria-hidden />
                                Доступ
                              </Button>
                              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`Редактировать профиль ${u.name}`} onClick={() => setDraft(toDraft(u))}>
                                <Pencil className="h-4 w-4" aria-hidden />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-9 w-9 text-red-600 hover:bg-red-50 hover:text-red-700"
                                aria-label={`Удалить профиль ${u.name}`}
                                disabled={u.id === access.meId}
                                title={u.id === access.meId ? 'Свою учётную запись удалить нельзя' : undefined}
                                onClick={() => setDeleteTarget(u)}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates">
          <AccessTemplates data={access} onSaved={(d) => { setAccess(d); void api.adminUsers().then((u) => setUsers(u.users)).catch(() => {}) }} />
        </TabsContent>
        <TabsContent value="who">
          <AccessWho data={access} />
        </TabsContent>
        <TabsContent value="journal">
          <AccessJournal journal={access.journal} />
        </TabsContent>
      </Tabs>

      {accessUser && (
        <AccessSheet
          key={accessUser.id}
          user={accessUser}
          templates={access.templates}
          onClose={() => setAccessUserId(null)}
          onSaved={(d) => { setAccess(d); void api.adminUsers().then((u) => setUsers(u.users)).catch(() => {}) }}
        />
      )}

      {/* ——— Окно создания / редактирования профиля ——— */}
      {draft && (
        <Dialog open onOpenChange={(o) => { if (!o) setDraft(null) }}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{draft.id === null ? 'Новый профиль' : `Профиль: ${draft.name || draft.login}`}</DialogTitle>
            </DialogHeader>

            <div className="grid gap-4">
              {draft.id === null && (
                <div className="space-y-1.5">
                  <Label htmlFor="user-login">Логин</Label>
                  <Input id="user-login" value={draft.login} onChange={set('login')} placeholder="login" autoComplete="off" />
                  <p className="text-xs text-muted-foreground">латиница, цифры, . _ -</p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="user-name">Имя</Label>
                <Input id="user-name" value={draft.name} onChange={set('name')} placeholder="Как имя показывается на платформе" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="user-role">Роль</Label>
                  <Select
                    value={draft.role}
                    onValueChange={(v) => setDraft((d) => (d ? {
                      ...d, role: v as RoleKind, carrierId: v === 'carrier' ? d.carrierId : '', templateId: defaultTemplate(v as RoleKind),
                    } : d))}
                  >
                    <SelectTrigger id="user-role" aria-label="Роль пользователя">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTOUR_ORDER.map((c) => <SelectItem key={c} value={c}>{CONTOUR_META[c].label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {draft.id === null ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="user-template">Должность</Label>
                    <Select value={draft.templateId} onValueChange={(v) => setDraft((d) => (d ? { ...d, templateId: v } : d))}>
                      <SelectTrigger id="user-template" aria-label="Должность"><SelectValue placeholder="Выберите должность" /></SelectTrigger>
                      <SelectContent>
                        {templatesOf(draft.role).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (основная)' : ''}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ) : editingRoleChange ? (
                  <p className="self-end rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Смена роли переводит на основную должность нового контура и снимает личные исключения.
                  </p>
                ) : null}

                {draft.role === 'carrier' && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="user-carrier">Компания</Label>
                    <Select value={draft.carrierId || ''} onValueChange={(v) => setDraft((d) => (d ? { ...d, carrierId: v } : d))}>
                      <SelectTrigger id="user-carrier" aria-label="Компания перевозчика">
                        <SelectValue placeholder="Выберите компанию" />
                      </SelectTrigger>
                      <SelectContent>
                        {carriers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="user-password">{draft.id === null ? 'Пароль' : 'Новый пароль'}</Label>
                  <Input
                    id="user-password"
                    type="password"
                    value={draft.password}
                    onChange={set('password')}
                    placeholder={draft.id === null ? 'Минимум 6 символов' : 'Оставьте пустым — не менять'}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              {/* ——— Проформа: личные данные пользователя ——— */}
              <div className="border-t border-slate-200 pt-3 text-sm font-semibold text-slate-900">Проформа</div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="user-fullname">ФИО</Label>
                  <Input id="user-fullname" value={draft.fullName} onChange={set('fullName')} placeholder="Иванов Иван Иванович" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="user-position">Должность в компании</Label>
                  <Input id="user-position" value={draft.position} onChange={set('position')} placeholder="Менеджер по логистике" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="user-phone">Телефон</Label>
                  <Input id="user-phone" value={draft.phone} onChange={set('phone')} placeholder="+7 900 000-00-00" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="user-email">Почта</Label>
                  <Input id="user-email" type="email" value={draft.email} onChange={set('email')} placeholder="name@company.ru" />
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>Отмена</Button>
              <Button onClick={submit} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Сохранить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ——— Подтверждение удаления ——— */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить профиль {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Учётная запись потеряет доступ к платформе. Обращения пользователя, его уведомления и личные исключения будут удалены.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => { e.preventDefault(); void remove() }}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
