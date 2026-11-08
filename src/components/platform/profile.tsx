'use client'

/**
 * «Профиль» — проформа своей учётной записи (Task 109).
 * Task 112: заголовок и роль перенесены в белую карточку (весь профиль — одна плашка);
 * правка личных данных — только с правом profile:edit (по умолчанию лишь у администрации,
 * выдаётся пользователю в «Профилях и доступах») — без права форма не отображается вовсе,
 * данные показываются для чтения. После сохранения плашка аккаунта в шапке обновляется
 * сразу (событие aemz:profile-updated).
 */
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { CircleUserRound, Loader2, Save } from 'lucide-react'
import {
  ErrorBlock, InfoTip, LoadingBlock, NoticeLine, type RoleKind, type TabProps,
} from '@/components/platform/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useCan } from '@/components/platform/perms'
import { api } from '@/lib/api'
import type { ProfileDTO } from '@/lib/types'

/** Редактируемые поля проформы */
type Draft = Pick<ProfileDTO,
  'fullName' | 'position' | 'phone' | 'email' | 'companyName' | 'inn' | 'kpp' | 'address' | 'director' | 'contactName' | 'note'>

const toDraft = (p: ProfileDTO): Draft => ({
  fullName: p.fullName, position: p.position, phone: p.phone, email: p.email,
  companyName: p.companyName, inn: p.inn, kpp: p.kpp, address: p.address,
  director: p.director, contactName: p.contactName, note: p.note,
})

/** Название роли в шапке проформы */
const ROLE_LABEL: Record<RoleKind, string> = {
  admin: 'администрация',
  logist: 'логист АЭМЗ',
  carrier: 'перевозчик',
}

/** «27.10.2026, 14:03» — момент последнего сохранения проформы */
const fmtUpdatedAt = (iso: string): string =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Строка «подпись — значение» для режима просмотра (без права на правку) */
function ViewRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="break-words text-sm font-medium text-slate-800">{value?.trim() || '—'}</div>
    </div>
  )
}

export default function ProfileTab(_props: TabProps) {
  const { toast } = useToast()
  const can = useCan()
  const canEdit = can('profile:edit')
  const [profile, setProfile] = useState<ProfileDTO | null>(null)
  const [role, setRole] = useState<RoleKind>('logist')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.getProfile()
      setProfile(res.profile)
      setRole((res.role as RoleKind) ?? 'logist')
      setDraft(toDraft(res.profile))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const res = await api.saveProfile(draft)
      setProfile(res.profile)
      setDraft(toDraft(res.profile))
      // плашка аккаунта в шапке отражает изменения сразу (Task 112)
      window.dispatchEvent(new CustomEvent<ProfileDTO>('aemz:profile-updated', { detail: res.profile }))
      toast({ title: 'Проформа сохранена' })
    } catch (e) {
      toast({
        title: 'Не удалось сохранить проформу',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (profile === null && !error) return <LoadingBlock label="Загрузка проформы…" />
  if (error && !profile) return <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />

  const isCarrier = role === 'carrier'
  const set = (key: keyof Draft) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((d) => (d ? { ...d, [key]: e.target.value } : d))

  return (
    // весь профиль — одна белая плашка: заголовок, роль и данные внутри карточки (Task 112)
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="p-4 sm:p-6">
        {/* заголовок внутри плашки */}
        <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100" aria-hidden>
            <CircleUserRound className="h-6 w-6 text-slate-500" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-slate-500">Проформа учётной записи</div>
            <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
              Профиль
              <InfoTip label="О разделе «Профиль»">
                Проформа — карточка ваших данных: она видна администрации платформы. У перевозчика реквизиты компании
                сохраняются и в карточке компании.
              </InfoTip>
            </h2>
            <div className="mt-0.5 text-sm text-slate-500">
              Роль: {ROLE_LABEL[role]}
              {profile?.updatedAt ? ` · обновлено ${fmtUpdatedAt(profile.updatedAt)}` : ''}
            </div>
          </div>
        </div>

        {error && profile && (
          <div className="mt-4 text-sm text-red-700">Не удалось обновить данные: {error}. Показаны последние загруженные значения.</div>
        )}

        {draft && (
          canEdit ? (
            <div className="mt-5 grid gap-4">
              {/* ——— Личные данные (все роли) ——— */}
              <div className="flex items-center gap-2 border-b border-slate-200 pb-2 text-sm font-semibold text-slate-900">
                Личные данные
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-fullname">ФИО</Label>
                  <Input id="profile-fullname" value={draft.fullName} onChange={set('fullName')} placeholder="Иванов Иван Иванович" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-position">Должность</Label>
                  <Input id="profile-position" value={draft.position} onChange={set('position')} placeholder="Менеджер по логистике" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-phone">Телефон</Label>
                  <Input id="profile-phone" value={draft.phone} onChange={set('phone')} placeholder="+7 900 000-00-00" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-email">Рабочая почта</Label>
                  <Input id="profile-email" type="email" value={draft.email} onChange={set('email')} placeholder="name@company.ru" />
                </div>
              </div>

              {/* ——— Данные компании (только перевозчик) ——— */}
              {isCarrier && (
                <>
                  <div className="mt-2 flex items-center gap-2 border-b border-slate-200 pb-2 text-sm font-semibold text-slate-900">
                    Данные компании
                    <InfoTip label="О данных компании">Наименование, ИНН, КПП и телефон сохраняются в карточке компании</InfoTip>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="profile-company">Наименование организации</Label>
                      <Input id="profile-company" value={draft.companyName} onChange={set('companyName')} placeholder="ООО «Перевозчик»" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="profile-inn">ИНН</Label>
                      <Input id="profile-inn" value={draft.inn} onChange={set('inn')} placeholder="0000000000" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="profile-kpp">КПП</Label>
                      <Input id="profile-kpp" value={draft.kpp} onChange={set('kpp')} placeholder="000000000" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="profile-address">Юридический адрес</Label>
                      <Input id="profile-address" value={draft.address} onChange={set('address')} placeholder="Индекс, город, улица, дом" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="profile-director">Руководитель</Label>
                      <Input id="profile-director" value={draft.director} onChange={set('director')} placeholder="Генеральный директор" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="profile-contact">Контактное лицо</Label>
                      <Input id="profile-contact" value={draft.contactName} onChange={set('contactName')} placeholder="ФИО и телефон" />
                    </div>
                  </div>
                </>
              )}

              {/* ——— Примечание (все роли) ——— */}
              <div className="mt-2 space-y-1.5">
                <Label htmlFor="profile-note">Примечание</Label>
                <Textarea
                  id="profile-note"
                  value={draft.note}
                  onChange={set('note')}
                  rows={3}
                  placeholder="Реквизиты договора, банковские детали и другие заметки"
                />
              </div>

              <div className="mt-2">
                <Button onClick={save} disabled={saving} className="min-h-10">
                  {saving
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    : <Save className="h-4 w-4" aria-hidden />}
                  Сохранить
                </Button>
              </div>
            </div>
          ) : (
            // нет права — правка целиком отсутствует: данные только для чтения (Task 112)
            <div className="mt-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <ViewRow label="ФИО" value={draft.fullName} />
                <ViewRow label="Должность" value={draft.position} />
                <ViewRow label="Телефон" value={draft.phone} />
                <ViewRow label="Рабочая почта" value={draft.email} />
              </div>
              {isCarrier && (
                <>
                  <div className="mb-3 mt-5 border-b border-slate-200 pb-2 text-sm font-semibold text-slate-900">Данные компании</div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ViewRow label="Наименование организации" value={draft.companyName} />
                    <ViewRow label="ИНН" value={draft.inn} />
                    <ViewRow label="КПП" value={draft.kpp} />
                    <ViewRow label="Юридический адрес" value={draft.address} />
                    <ViewRow label="Руководитель" value={draft.director} />
                    <ViewRow label="Контактное лицо" value={draft.contactName} />
                  </div>
                </>
              )}
              <div className="mt-5">
                <ViewRow label="Примечание" value={draft.note} />
              </div>
              <NoticeLine className="mt-5" tone="info">
                Данные профиля изменяет администрация платформы — передайте ей нужные правки через «Обращения».
              </NoticeLine>
            </div>
          )
        )}
      </CardContent>
    </Card>
  )
}
