'use client'

/**
 * «Профили и доступы» — раздел только для администрации: учётные записи контура
 * (логисты и администрация), матрица доступа по ролям и сводка справочников парка.
 * Название и подача — как в LogistikSITE («Профили и доступы»), контент —
 * логистический контур АЭМЗ.
 */
import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/kontur/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/kontur/ui/table'
import { Database, ShieldCheck, Truck, UserCog, Users } from 'lucide-react'
import type { StateResponse } from '@/lib/kontur/client-types'
import { RoleBadge } from './ProfileMenu'
import { DotWord, InfoTip } from './bits'
import { apiFetch as fetch } from '@/lib/kontur/base-path'

type AccountRow = {
  id: string; login: string; fullName: string; position: string
  role: 'logist' | 'admin'; phone?: string | null; email?: string | null
}

/** Что видит каждая роль на контуре (матрица доступа прототипа) */
const ACCESS_ROWS: { section: string; logist: string; admin: string }[] = [
  { section: 'Заявки: реестр 1С, планирование состава, карточка рейса', logist: 'полный', admin: 'полный' },
  { section: 'Разбор needs_review', logist: 'полный', admin: 'полный' },
  { section: 'Справочники: водители, тягачи, прицепы', logist: 'просмотр и правка', admin: 'просмотр и правка' },
  { section: 'Outbox → 1С, Устройства', logist: 'полный', admin: 'полный' },
  { section: 'Профили и доступы (этот раздел)', logist: 'нет', admin: 'полный' },
]

export function AdminPanel({ state }: { state: StateResponse }) {
  const [accounts, setAccounts] = useState<AccountRow[]>([])

  useEffect(() => {
    // загрузка после монтирования: setState в промисе, не в теле эффекта
    fetch('/api/auth/accounts')
      .then((r) => (r.ok ? r.json() : []))
      .then(setAccounts)
      .catch(() => setAccounts([]))
  }, [])

  const logists = accounts.filter((a) => a.role === 'logist').length
  const admins = accounts.filter((a) => a.role === 'admin').length

  return (
    <div className="space-y-4">
      {/* Сводка контура */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600" aria-hidden>
              <Users className="h-5 w-5" />
            </span>
            <div>
              <div className="text-lg font-bold text-slate-900">{logists}</div>
              <div className="text-xs text-slate-500">логистов в контуре</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600" aria-hidden>
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <div className="text-lg font-bold text-slate-900">{admins}</div>
              <div className="text-xs text-slate-500">администрация</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600" aria-hidden>
              <Truck className="h-5 w-5" />
            </span>
            <div>
              <div className="text-lg font-bold text-slate-900">{state.vehicles.length + state.trailers.length}</div>
              <div className="text-xs text-slate-500">единиц техники в справочниках</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Учётные записи */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
            <UserCog className="h-4 w-4 text-slate-400" aria-hidden />
            Учётные записи контура
            <InfoTip label="Учётные записи">
              На контуре — логисты и администрация. Водители работают через мобильное приложение
              (API /api/driver), учётные записи кабинета им не нужны.
            </InfoTip>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>ФИО</TableHead>
                  <TableHead>Логин</TableHead>
                  <TableHead>Должность</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>Контакты</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium text-slate-800">{a.fullName}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">{a.login}</TableCell>
                    <TableCell className="text-xs text-slate-600">{a.position}</TableCell>
                    <TableCell><RoleBadge role={a.role} /></TableCell>
                    <TableCell className="text-xs text-slate-500">{a.phone || '—'} · {a.email || '—'}</TableCell>
                  </TableRow>
                ))}
                {accounts.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="py-6 text-center text-slate-400">Учётные записи появятся после пересоздания демо-данных</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Матрица доступа по ролям */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
            <ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden />
            Матрица доступа
            <InfoTip label="Матрица доступа">
              Роль учётки определяет разделы кабинета. Логисты ведут операционную работу;
              администрация дополнительно управляет профилями и доступами.
            </InfoTip>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Раздел кабинета</TableHead>
                  <TableHead>Логист</TableHead>
                  <TableHead>Администрация</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ACCESS_ROWS.map((r) => (
                  <TableRow key={r.section}>
                    <TableCell className="text-slate-700">{r.section}</TableCell>
                    <TableCell>
                      {r.logist === 'полный' || r.logist === 'просмотр и правка'
                        ? <DotWord dot="bg-emerald-500">{r.logist}</DotWord>
                        : <DotWord dot="bg-slate-300">нет</DotWord>}
                    </TableCell>
                    <TableCell><DotWord dot="bg-emerald-500">{r.admin}</DotWord></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex items-start gap-2 border-y border-slate-200 py-2.5 text-sm text-slate-700" role="status">
            <Database className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <div className="min-w-0 flex-1">
              Справочники парка (водители, тягачи, прицепы) — единые на весь контур: состав на рейсы
              назначается только из них, привлечённый транспорт не используется (решение владельца, 2026-11-18).
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
