'use client'

/**
 * Вкладки «Кто имеет право» (обратный поиск: у кого есть право и почему)
 * и «Журнал изменений» (записи ACCESS_CHANGED, перенос прав, прежние правки матрицы).
 */
import { useState } from 'react'
import { History } from 'lucide-react'
import { CONTOUR_META, CONTOUR_ORDER, RiskBadge, TemplateChip, ruDate } from '@/components/platform/access-ui'
import { EmptyState } from '@/components/platform/common'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { permHint, permLabel, permsFor, type Contour, type PermKey } from '@/lib/perm-catalog'
import type { AccessDataDTO, AccessJournalDTO } from '@/lib/types'

export function AccessWho({ data }: { data: AccessDataDTO }) {
  const [value, setValue] = useState('carrier|edo:sign')
  const [contour, key] = value.split('|') as [Contour, PermKey]
  const rows = data.users.filter((u) => u.role === contour)
  const yes = rows.filter((u) => u.effective.includes(key))

  return (
    <Card className="gap-0 border-slate-200 p-0 shadow-sm">
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
        <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-md">
          <Label htmlFor="who-perm">Право</Label>
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger id="who-perm" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONTOUR_ORDER.map((c) => (
                <SelectGroup key={c}>
                  <SelectLabel>{CONTOUR_META[c].label}</SelectLabel>
                  {permsFor(c).map((p) => (
                    <SelectItem key={`${c}|${p.key}`} value={`${c}|${p.key}`}>{permLabel(p.key, c)}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <RiskBadge perm={key} />
      </div>
      <p className="border-b border-slate-200 px-4 py-3 text-sm text-slate-600">
        «{permLabel(key, contour)}» ({CONTOUR_META[contour].label}) — есть у <b className="text-slate-900">{yes.length}</b> из {rows.length}. {permHint(key)}.
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Пользователь</TableHead>
              <TableHead>Должность</TableHead>
              <TableHead>Итог</TableHead>
              <TableHead>Источник</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u) => {
              const on = u.effective.includes(key)
              const ex = u.exceptions.find((e) => e.key === key && e.active)
              return (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-semibold text-slate-900">{u.fullName}</div>
                    <div className="text-xs text-slate-500">{u.login}{u.carrierName ? ` · ${u.carrierName}` : ''}</div>
                  </TableCell>
                  <TableCell><TemplateChip name={u.templateName} /></TableCell>
                  <TableCell className="whitespace-nowrap">
                    {on ? <span className="font-semibold text-emerald-700">✓ есть</span> : <span className="text-slate-400">— нет</span>}
                  </TableCell>
                  <TableCell className="min-w-[220px] text-sm text-slate-600">
                    {ex
                      ? `исключение${ex.expiresAt ? ` до ${ruDate(ex.expiresAt)}` : ''}: ${ex.reason}`
                      : on ? 'из должности' : 'нет в должности'}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}

export function AccessJournal({ journal }: { journal: AccessJournalDTO[] }) {
  if (journal.length === 0) {
    return <EmptyState icon={<History className="h-10 w-10" aria-hidden />} title="Изменений доступа пока нет" hint="Здесь появятся правки должностей и личных исключений: кто, кому, что и почему" />
  }
  return (
    <Card className="gap-0 border-slate-200 p-0 shadow-sm">
      <ul>
        {journal.map((j) => (
          <li key={j.id} className="grid gap-1 border-b border-slate-100 px-4 py-3 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
            <time className="font-mono text-xs text-slate-500" dateTime={j.at}>
              {new Date(j.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </time>
            <div className="min-w-0 text-sm">
              <div className="text-slate-900">{j.message}</div>
              <div className="mt-0.5 text-xs text-slate-500">{j.actorName ?? 'Система'}</div>
              {j.reason && <div className="mt-0.5 text-xs text-slate-600">Причина: {j.reason}</div>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
