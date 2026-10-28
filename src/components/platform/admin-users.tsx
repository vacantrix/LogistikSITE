'use client'

/** «Профили и доступы» — учётные записи платформы (только администрация, Task 109) */
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { Loader2, Pencil, Trash2, UserPlus } from 'lucide-react'
import {
  ErrorBlock, InfoTip, LoadingBlock, SectionHeader, StatusDot, type RoleKind, type TabProps,
} from '@/components/platform/common'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import type { AdminUserDTO } from '@/lib/types'

/** Роль: точка и слово в списке и варианты в окне создания */
const ROLE_META: Record<RoleKind, { label: string; dot: string }> = {
  admin: { label: 'Администрация', dot: 'bg-violet-500' },
  logist: { label: 'Логист', dot: 'bg-blue-500' },
  carrier: { label: 'Перевозчик', dot: 'bg-emerald-500' },
}

/** Черновик окна создания/редактирования: учётка + поля проформы */
interface UserDraft {
  id: string | null // null — создание
  login: string
  name: string
  password: string
  role: RoleKind
  carrierId: string
  fullName: string
  position: string
  phone: string
  email: string
}

const emptyDraft = (): UserDraft => ({
  id: null, login: '', name: '', password: '', role: 'carrier', carrierId: '',
  fullName: '', position: '', phone: '', email: '',
})

const toDraft = (u: AdminUserDTO): UserDraft => ({
  id: u.id, login: u.login, name: u.name, password: '', role: u.role, carrierId: u.carrierId ?? '',
  fullName: u.profile?.fullName ?? '', position: u.profile?.position ?? '',
  phone: u.profile?.phone ?? '', email: u.profile?.email ?? '',
})

export default function AdminUsersTab(_props: TabProps) {
  const { toast } = useToast()
  const [users, setUsers] = useState<AdminUserDTO[] | null>(null)
  const [carriers, setCarriers] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)

  const [draft, setDraft] = useState<UserDraft | null>(null) // открытое окно создания/редактирования
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AdminUserDTO | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      const [u, d] = await Promise.all([api.adminUsers(), api.directory()])
      setUsers(u.users)
      setCarriers(d.carriers.map((c) => ({ id: c.id, name: c.name })))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const reload = async () => {
    try {
      const u = await api.adminUsers()
      setUsers(u.users)
      setError(null)
    } catch (e) {
      toast({
        title: 'Не удалось обновить список',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    }
  }

  const set = (key: keyof UserDraft) => (e: ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => (d ? { ...d, [key]: e.target.value } : d))

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
          login: draft.login, name: draft.name, password: draft.password, role: draft.role, carrierId, profile,
        })
        toast({ title: 'Профиль создан', description: `${draft.name} — теперь может войти на платформу` })
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
      toast({
        title: 'Не удалось удалить профиль',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
    }
  }

  if (users === null && !error) return <LoadingBlock label="Загрузка учётных записей…" />
  if (error && !users) return <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />

  return (
    <div>
      <SectionHeader
        title="Профили и доступы"
        eyebrow="Администрирование"
        desc="Создание, редактирование и удаление учётных записей. Пароль хранится только хешем — после создания его нельзя посмотреть, можно лишь задать новый."
      >
        <Button onClick={() => setDraft(emptyDraft())} className="min-h-10">
          <UserPlus className="h-4 w-4" aria-hidden />
          Создать профиль
        </Button>
      </SectionHeader>

      {error && users && (
        <div className="mb-4 text-sm text-red-700">Не удалось обновить данные: {error}. Показаны последние загруженные значения.</div>
      )}

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Пользователь</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>Компания</TableHead>
                  <TableHead>Профиль</TableHead>
                  <TableHead>Создан</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(users ?? []).map((u) => {
                  const p = u.profile
                  const filled = p && [p.fullName, p.position, p.phone, p.email].some((v) => v)
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="font-semibold text-slate-900">{u.name}</div>
                        <div className="text-xs text-slate-500">{u.login}</div>
                      </TableCell>
                      <TableCell>
                        <StatusDot dot={ROLE_META[u.role]?.dot ?? 'bg-slate-400'}>{ROLE_META[u.role]?.label ?? u.role}</StatusDot>
                      </TableCell>
                      <TableCell className="text-slate-600">{u.carrierName ?? '—'}</TableCell>
                      <TableCell>
                        {filled && p ? (
                          <InfoTip label="Проформа пользователя">
                            <div className="space-y-0.5">
                              {p.fullName && <div><span className="font-medium">ФИО:</span> {p.fullName}</div>}
                              {p.position && <div><span className="font-medium">Должность:</span> {p.position}</div>}
                              {p.phone && <div><span className="font-medium">Телефон:</span> {p.phone}</div>}
                              {p.email && <div><span className="font-medium">Почта:</span> {p.email}</div>}
                            </div>
                          </InfoTip>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-slate-600">
                        {new Date(u.createdAt).toLocaleDateString('ru-RU')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost" size="icon" className="h-9 w-9"
                            aria-label={`Редактировать профиль ${u.name}`}
                            onClick={() => setDraft(toDraft(u))}
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-9 w-9 text-red-600 hover:bg-red-50 hover:text-red-700"
                            aria-label={`Удалить профиль ${u.name}`}
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

      {/* ——— Окно создания / редактирования ——— */}
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
                    onValueChange={(v) => setDraft((d) => (d ? { ...d, role: v as RoleKind, carrierId: v === 'carrier' ? d.carrierId : '' } : d))}
                  >
                    <SelectTrigger id="user-role" aria-label="Роль пользователя">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Администрация</SelectItem>
                      <SelectItem value="logist">Логист</SelectItem>
                      <SelectItem value="carrier">Перевозчик</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {draft.role === 'carrier' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="user-carrier">Компания</Label>
                    <Select
                      value={draft.carrierId || ''}
                      onValueChange={(v) => setDraft((d) => (d ? { ...d, carrierId: v } : d))}
                    >
                      <SelectTrigger id="user-carrier" aria-label="Компания перевозчика">
                        <SelectValue placeholder="Выберите компанию" />
                      </SelectTrigger>
                      <SelectContent>
                        {carriers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
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
                  <Label htmlFor="user-position">Должность</Label>
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
              Учётная запись потеряет доступ к платформе. Обращения пользователя и его уведомления будут удалены.
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
