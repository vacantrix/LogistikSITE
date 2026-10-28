'use client'

/** «Профиль» — проформа своей учётной записи (доступна всем ролям, Task 109) */
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { Loader2, Save } from 'lucide-react'
import {
  ErrorBlock, InfoTip, LoadingBlock, SectionHeader, type RoleKind, type TabProps,
} from '@/components/platform/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
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

export default function ProfileTab(_props: TabProps) {
  const { toast } = useToast()
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
    <div>
      <SectionHeader
        title="Профиль"
        eyebrow="Проформа учётной записи"
        desc="Проформа — карточка ваших данных: она видна администрации платформы. У перевозчика реквизиты компании сохраняются и в карточке компании."
      />

      {/* роль и момент последнего сохранения — приглушённой строкой под заголовком */}
      <div className="-mt-3 mb-5 text-sm text-slate-500">
        Роль: {ROLE_LABEL[role]}
        {profile?.updatedAt ? ` · обновлено ${fmtUpdatedAt(profile.updatedAt)}` : ''}
      </div>

      {error && profile && (
        <div className="mb-4 text-sm text-red-700">Не удалось обновить данные: {error}. Показаны последние загруженные значения.</div>
      )}

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-6">
          {draft && (
            <div className="grid gap-4">
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
          )}
        </CardContent>
      </Card>
    </div>
  )
}
