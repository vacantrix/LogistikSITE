'use client'

/**
 * «Профили и доступы» — единый раздел администрации (слияние «Профилей и доступов»
 * и «Права доступа»). Три слоя:
 *  1. Учётные записи: создание, редактирование, удаление (Task 109);
 *  2. Персональные права по пользователям: кнопка «Права» у конкретного профиля —
 *     для каждого права три состояния (как у роли / разрешить / запретить), пресеты
 *     и превью итога (Task 114);
 *  3. Базовые права ролей — карта «роль × право» (RolePermMatrix) как нижний слой.
 * Право без разрешения полностью скрывает функцию из интерфейса пользователя и
 * блокируется на сервере.
 */
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { Loader2, Pencil, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import {
  ErrorBlock, InfoTip, LoadingBlock, SectionHeader, StatusDot, type RoleKind, type TabProps,
} from '@/components/platform/common'
import RolePermMatrix from '@/components/platform/permissions'
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
import { PERM_GROUPS, PERM_KEYS } from '@/lib/perm-catalog'
import type { AdminUserDTO, PermMatrixRow } from '@/lib/types'

/** Роль: точка и слово в списке и варианты в окне создания */
const ROLE_META: Record<RoleKind, { label: string; dot: string }> = {
  admin: { label: 'Администрация', dot: 'bg-violet-500' },
  logist: { label: 'Логист', dot: 'bg-blue-500' },
  carrier: { label: 'Перевозчик', dot: 'bg-emerald-500' },
}

/** Состояние одного персонального права: inherit — как у роли, allow/deny — перекрыть */
type PermState = 'inherit' | 'allow' | 'deny'

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

/** Черновик прав конкретного пользователя */
interface RightsDraft {
  target: AdminUserDTO
  states: Record<string, PermState>
}

const OVERRIDE_LABEL: Record<PermState, string> = {
  inherit: 'Как у роли',
  allow: 'Разрешить',
  deny: 'Запретить',
}

export default function AdminUsersTab(_props: TabProps) {
  const { toast } = useToast()
  const [users, setUsers] = useState<AdminUserDTO[] | null>(null)
  const [carriers, setCarriers] = useState<{ id: string; name: string }[]>([])
  const [permRows, setPermRows] = useState<PermMatrixRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [draft, setDraft] = useState<UserDraft | null>(null) // открытое окно создания/редактирования
  const [rights, setRights] = useState<RightsDraft | null>(null) // редактор прав пользователя
  const [savingRights, setSavingRights] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AdminUserDTO | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      const [u, d, p] = await Promise.all([api.adminUsers(), api.directory(), api.permissions()])
      setUsers(u.users)
      setCarriers(d.carriers.map((c) => ({ id: c.id, name: c.name })))
      setPermRows(p.perms)
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
        toast({ title: 'Профиль создан', description: `${draft.name} — персональные права выдаются кнопкой «Права» в его строке` })
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

  /** Сохранить персональные права пользователя: отправляем только перекрытия (allow/deny) */
  const submitRights = async () => {
    if (!rights) return
    setSavingRights(true)
    try {
      const permOverrides: Record<string, 'allow' | 'deny'> = {}
      for (const [key, value] of Object.entries(rights.states)) {
        if (value === 'allow' || value === 'deny') permOverrides[key] = value
      }
      await api.adminUserUpdate({ id: rights.target.id, permOverrides })
      toast({
        title: 'Права сохранены',
        description: `${rights.target.name}: ${Object.keys(permOverrides).length === 0
          ? 'действует база роли'
          : `персональных перекрытий — ${Object.keys(permOverrides).length}`}. Функции без права исчезнут из его интерфейса после обновления страницы.`,
      })
      setRights(null)
      await reload()
    } catch (e) {
      toast({
        title: 'Не удалось сохранить права',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setSavingRights(false)
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
        desc="Учётные записи и права в одном месте: создание профилей, персональные права конкретному пользователю поверх базовой матрицы ролей. Отключённая функция полностью скрывается из интерфейса и блокируется на сервере."
      >
        <Button onClick={() => setDraft(emptyDraft())} className="min-h-10">
          <UserPlus className="h-4 w-4" aria-hidden />
          Создать профиль
        </Button>
      </SectionHeader>

      {error && users && (
        <div className="mb-4 text-sm text-red-700">Не удалось обновить данные: {error}. Показаны последние загруженные значения.</div>
      )}

      {/* ——— Учётные записи: у каждого своя настройка прав ——— */}
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
                  <TableHead>
                    Персональные права
                    <span className="mt-0.5 block text-[11px] font-normal text-slate-400">сверх роли</span>
                  </TableHead>
                  <TableHead>Создан</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(users ?? []).map((u) => {
                  const p = u.profile
                  const filled = p && [p.fullName, p.position, p.phone, p.email].some((v) => v)
                  const allow = Object.values(u.permOverrides ?? {}).filter((v) => v === 'allow').length
                  const deny = Object.values(u.permOverrides ?? {}).filter((v) => v === 'deny').length
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
                      <TableCell className="whitespace-nowrap">
                        {allow === 0 && deny === 0 ? (
                          <span className="text-sm text-slate-500">Как у роли</span>
                        ) : (
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            {allow > 0 && (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                разрешено лично: {allow}
                              </span>
                            )}
                            {deny > 0 && (
                              <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                                запрещено лично: {deny}
                              </span>
                            )}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-slate-600">
                        {new Date(u.createdAt).toLocaleDateString('ru-RU')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="outline" size="sm" className="h-9 gap-1.5"
                            aria-label={`Права пользователя ${u.name}`}
                            onClick={() => setRights({
                              target: u,
                              states: {
                                ...Object.fromEntries(PERM_KEYS.map((k) => [k, 'inherit' as PermState])),
                                ...Object.fromEntries(Object.entries(u.permOverrides ?? {}).map(([k, v]) => [k, v as PermState])),
                              },
                            })}
                          >
                            <ShieldCheck className="h-4 w-4 text-violet-600" aria-hidden />
                            Права
                          </Button>
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
                  <p className="text-xs text-muted-foreground">
                    База роли — в карте «Базовые права ролей» ниже; персональные права — кнопкой «Права» в строке профиля.
                  </p>
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

      {/* ——— Редактор персональных прав конкретного пользователя ——— */}
      {rights && permRows && (
        <RightsDialog
          draft={rights}
          permRows={permRows}
          saving={savingRights}
          onChange={(states) => setRights((r) => (r ? { ...r, states } : r))}
          onClose={() => setRights(null)}
          onSubmit={submitRights}
        />
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

      {/* ——— Базовые права ролей: нижний слой доступа ——— */}
      <div className="mt-6">
        <RolePermMatrix rows={permRows} onRowsChange={setPermRows} />
      </div>
    </div>
  )
}

/** Итог права с учётом персонального перекрытия: allow → вкл, deny → выкл, иначе база роли */
function effectiveOf(state: PermState | undefined, role: RoleKind, permRows: PermMatrixRow[], key: string): boolean {
  if (state === 'allow') return true
  if (state === 'deny') return false
  return permRows.find((r) => r.role === role)?.items.find((i) => i.key === key)?.allowed ?? false
}

/** Окно персональных прав пользователя: база роли + перекрытия + итог по каждому праву */
function RightsDialog({ draft, permRows, saving, onChange, onClose, onSubmit }: {
  draft: RightsDraft
  permRows: PermMatrixRow[]
  saving: boolean
  onChange: (states: Record<string, PermState>) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const { target, states } = draft
  const role = target.role

  const baseAllowed = (key: string): boolean =>
    permRows.find((r) => r.role === role)?.items.find((i) => i.key === key)?.allowed ?? false

  const allowCount = Object.values(states).filter((v) => v === 'allow').length
  const denyCount = Object.values(states).filter((v) => v === 'deny').length
  const effCount = PERM_KEYS.filter((k) => effectiveOf(states[k], role, permRows, k)).length

  const setAll = (value: PermState) =>
    onChange(Object.fromEntries(PERM_KEYS.map((k) => [k, value])))

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-violet-600" aria-hidden />
            Права пользователя · {target.name}
          </DialogTitle>
        </DialogHeader>

        {/* шапка: кто и какая база */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
          <StatusDot dot={ROLE_META[role]?.dot ?? 'bg-slate-400'}>{ROLE_META[role]?.label ?? role}</StatusDot>
          <span className="text-xs text-slate-500">логин: {target.login}</span>
          <span className="ml-auto text-xs text-slate-500">
            база роли: {permRows.find((r) => r.role === role)?.items.filter((i) => i.allowed).length ?? 0} из {PERM_KEYS.length} прав
          </span>
        </div>

        {/* пресеты и сводка */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={saving} onClick={() => setAll('inherit')}>Всё как у роли</Button>
          <Button variant="outline" size="sm" disabled={saving} onClick={() => setAll('allow')}>Разрешить всё</Button>
          <Button variant="outline" size="sm" disabled={saving} onClick={() => setAll('deny')}>Запретить всё</Button>
          <span className="ml-auto text-xs text-slate-500">
            лично разрешено: <span className="font-semibold text-emerald-700">{allowCount}</span>
            {' · '}лично запрещено: <span className="font-semibold text-red-700">{denyCount}</span>
            {' · '}итог доступно: <span className="font-semibold text-slate-900">{effCount}</span> из {PERM_KEYS.length}
          </span>
        </div>

        <InfoTip label="Как работают персональные права">
          «Как у роли» — действует базовая матрица ролей (нижняя карта этого раздела). «Разрешить»
          и «Запретить» перекрывают роль лично этому пользователю: одному можно выдать удаление и
          сверку, другому оставить только просмотр. Функция без права полностью исчезает из
          интерфейса пользователя и блокируется на сервере.
        </InfoTip>

        {/* каталог прав по группам */}
        <div className="max-h-[46vh] space-y-4 overflow-y-auto rounded-lg border border-slate-200 p-3 pr-2">
          {PERM_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="mb-1.5 text-[11px] font-semibold text-slate-400">{group.title}</div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const state = states[item.key] ?? 'inherit'
                  const eff = effectiveOf(state, role, permRows, item.key)
                  return (
                    <div key={item.key} className="flex flex-col gap-2 border-b border-slate-100 py-2 last:border-b-0 sm:flex-row sm:items-center sm:gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-900">{item.label}</div>
                        {item.hint && <div className="mt-0.5 text-xs text-slate-500">{item.hint}</div>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:w-[340px] sm:shrink-0 sm:flex-nowrap">
                        {/* база роли — справочный слой */}
                        <span
                          className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${
                            baseAllowed(item.key)
                              ? 'border-slate-200 bg-white text-slate-600'
                              : 'border-slate-200 bg-slate-50 text-slate-400'
                          }`}
                          title="Право роли — базовый слой, перекрывается личным выбором"
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${baseAllowed(item.key) ? 'bg-emerald-500' : 'bg-slate-300'}`} aria-hidden />
                          роль: {baseAllowed(item.key) ? 'вкл' : 'выкл'}
                        </span>
                        {/* личный выбор */}
                        <Select
                          value={state}
                          onValueChange={(v) => onChange({ ...states, [item.key]: v as PermState })}
                        >
                          <SelectTrigger
                            aria-label={`Персональное право «${item.label}»`}
                            className={`h-8 w-[126px] shrink-0 text-xs ${
                              state === 'allow'
                                ? 'border-emerald-300 bg-emerald-50/60 text-emerald-800'
                                : state === 'deny'
                                  ? 'border-red-200 bg-red-50/60 text-red-700'
                                  : ''
                            }`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inherit">Как у роли</SelectItem>
                            <SelectItem value="allow">Разрешить</SelectItem>
                            <SelectItem value="deny">Запретить</SelectItem>
                          </SelectContent>
                        </Select>
                        {/* итог — что реально получит пользователь */}
                        <span
                          className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${
                            eff ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
                          }`}
                          title="Итоговое право пользователя с учётом перекрытий"
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${eff ? 'bg-emerald-600' : 'bg-red-500'}`} aria-hidden />
                          итог: {eff ? 'вкл' : 'выкл'}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          <p className="pt-1 text-[11px] text-slate-400">
            Всего прав в каталоге: {PERM_KEYS.length} · «{OVERRIDE_LABEL.inherit}» — действует право роли
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Сохранить права
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
