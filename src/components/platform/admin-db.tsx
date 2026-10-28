'use client'

/** «База данных» — прямой редактор таблиц платформы (только администрация, Task 109) */
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Database, Loader2, Plus, Search, Trash2 } from 'lucide-react'
import {
  EmptyState, ErrorBlock, LoadingBlock, NoticeLine, SectionHeader, StatusDot, type TabProps,
} from '@/components/platform/common'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import type { AdminDbTableData, AdminDbTableDTO } from '@/lib/types'

type AdminDbColumn = AdminDbTableData['columns'][number]
type AdminDbCell = string | number | boolean | null

/** Что открыто в окне редактора: создание или изменение записи */
type Editing = { op: 'create' } | { op: 'update'; id: string }

/** ISO → «ДД.ММ.ГГГГ ЧЧ:мм» (уже отформатированное значение возвращается как есть) */
const fmtDateTime = (v: string): string => {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Значение строки → значения формы: строки как есть, булевы — «yes»/«no»/«» */
const rowToValues = (columns: AdminDbColumn[], row: Record<string, AdminDbCell>): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const col of columns) {
    if (col.key === 'id') continue
    const v = row[col.key]
    out[col.key] = col.kind === 'boolean'
      ? (v === true ? 'yes' : v === false ? 'no' : '')
      : (v === null || v === undefined ? '' : String(v))
  }
  return out
}

export default function AdminDbTab(_props: TabProps) {
  const { toast } = useToast()
  const [tables, setTables] = useState<AdminDbTableDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [tableKey, setTableKey] = useState('')
  const [data, setData] = useState<AdminDbTableData | null>(null)
  const [tableLoading, setTableLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('') // отправленный поисковый запрос

  const [editing, setEditing] = useState<Editing | null>(null)
  const [values, setValues] = useState<Record<string, string> | null>(null)
  const [rowLoading, setRowLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const loadTables = useCallback(async () => {
    try {
      const t = await api.adminDbTables()
      setTables(t.tables)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  const loadRows = useCallback(async (key: string, q: string) => {
    if (!key) return
    setTableLoading(true)
    try {
      const res = await api.adminDbTable(key, q ? { q } : {})
      setData(res.data ?? null)
      setError(null)
    } catch (e) {
      toast({
        title: 'Не удалось загрузить таблицу',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setTableLoading(false)
    }
  }, [toast])

  useEffect(() => { void loadTables() }, [loadTables])

  const selectTable = (key: string) => {
    setTableKey(key)
    setSearch('')
    setQuery('')
    setData(null)
    void loadRows(key, '')
  }

  const submitSearch = (e: FormEvent) => {
    e.preventDefault()
    if (!tableKey) return
    setQuery(search)
    void loadRows(tableKey, search)
  }

  /** Полные значения строки (сервер отдаёт их без обрезки длинных полей) */
  const openEdit = async (id: string) => {
    setEditing({ op: 'update', id })
    setValues(null)
    setRowLoading(true)
    try {
      const res = await api.adminDbTable(tableKey, { id })
      if (!res.row) throw new Error('Запись не найдена')
      setValues(rowToValues(data?.columns ?? [], res.row.values))
    } catch (e) {
      toast({
        title: 'Не удалось открыть запись',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
      setEditing(null)
    } finally {
      setRowLoading(false)
    }
  }

  const openCreate = () => {
    if (!data) return
    setEditing({ op: 'create' })
    setValues(Object.fromEntries(data.columns.filter((c) => c.key !== 'id').map((c) => [c.key, ''])))
  }

  /** Данные формы → тело запроса; при создании пустые поля не отправляются (сервер применит умолчания) */
  const buildData = (op: 'create' | 'update'): Record<string, string | number | boolean | null> => {
    const out: Record<string, string | number | boolean | null> = {}
    if (!data || !values) return out
    for (const col of data.columns) {
      if (col.key === 'id') continue
      const raw = values[col.key] ?? ''
      if (op === 'create' && raw === '') continue
      if (col.kind === 'boolean') {
        if (raw === '') continue
        out[col.key] = raw === 'yes'
      } else {
        out[col.key] = raw
      }
    }
    return out
  }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await api.adminDbMutate({
        table: tableKey,
        op: editing.op,
        ...(editing.op === 'update' ? { id: editing.id } : {}),
        data: buildData(editing.op),
      })
      toast({ title: editing.op === 'create' ? 'Запись создана' : 'Запись сохранена' })
      setEditing(null)
      await Promise.all([loadRows(tableKey, query), loadTables()])
    } catch (e) {
      toast({
        title: 'Не удалось сохранить запись',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const removeRow = async () => {
    if (!editing || editing.op !== 'update') return
    setDeleting(true)
    try {
      await api.adminDbMutate({ table: tableKey, op: 'delete', id: editing.id })
      toast({ title: 'Запись удалена' })
      setConfirmDelete(false)
      setEditing(null)
      await Promise.all([loadRows(tableKey, query), loadTables()])
    } catch (e) {
      toast({
        title: 'Не удалось удалить запись',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
    }
  }

  const set = (key: string) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((s) => (s ? { ...s, [key]: e.target.value } : s))
  const setBool = (key: string, v: string) => setValues((s) => (s ? { ...s, [key]: v } : s))

  const cell = (col: AdminDbColumn, v: AdminDbCell) => {
    if (v === null) return <span className="text-slate-400">—</span>
    if (col.kind === 'boolean') {
      return <StatusDot dot={v ? 'bg-emerald-500' : 'bg-slate-400'}>{v ? 'Да' : 'Нет'}</StatusDot>
    }
    if (col.kind === 'datetime') return <span className="whitespace-nowrap text-slate-600">{fmtDateTime(String(v))}</span>
    if (col.kind === 'number') return <span className="whitespace-nowrap font-mono text-xs text-slate-900">{String(v)}</span>
    return <span className="block max-w-[280px] whitespace-normal break-words text-slate-600">{String(v)}</span>
  }

  if (tables === null && !error) return <LoadingBlock label="Загрузка таблиц…" />
  if (error && !tables) return <ErrorBlock message={error} onRetry={() => { setError(null); void loadTables() }} />

  const currentLabel = data?.table.label ?? tables?.find((t) => t.key === tableKey)?.label ?? ''
  const columns = data?.columns ?? []

  return (
    <div>
      <SectionHeader
        title="База данных"
        eyebrow="Администрирование"
        desc="Прямое редактирование любых таблиц платформы. Изменения вступают в силу сразу и не отменяются — действуйте аккуратно."
      />

      <NoticeLine tone="warning" className="mb-4">
        Прямой доступ к данным. Записи можно создавать, изменять и удалять — изменения сразу видны всем пользователям платформы.
      </NoticeLine>

      {/* ——— Управление: таблица, поиск, создание ——— */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="db-table">Таблица</Label>
          <Select value={tableKey} onValueChange={selectTable}>
            <SelectTrigger id="db-table" className="w-[250px]" aria-label="Таблица базы данных">
              <SelectValue placeholder="Выберите таблицу" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {(tables ?? []).map((t) => (
                <SelectItem key={t.key} value={t.key}>{t.label} · {t.count}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <form className="min-w-[220px] flex-1 space-y-1.5" onSubmit={submitSearch}>
          <Label htmlFor="db-search">Поиск</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              id="db-search"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по строкам…"
              aria-label="Поиск по строкам таблицы"
            />
          </div>
        </form>

        <Button onClick={openCreate} disabled={!tableKey} className="min-h-10">
          <Plus className="h-4 w-4" aria-hidden />
          Создать запись
        </Button>
      </div>

      {/* ——— Строки таблицы ——— */}
      {!tableKey && !error ? (
        <EmptyState
          icon={<Database className="h-8 w-8" aria-hidden />}
          title="Выберите таблицу"
        />
      ) : tableLoading && !data ? (
        <LoadingBlock label="Загрузка строк…" />
      ) : data ? (
        <>
          {data.truncated ? (
            <NoticeLine tone="info" className="mb-3">
              Показаны первые {data.rows.length} записей — уточните поиск
            </NoticeLine>
          ) : (
            <div className="mb-2 text-sm text-slate-500">Показано {data.rows.length} из {data.table.count}</div>
          )}

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="font-mono text-xs">id</TableHead>
                      {columns.filter((c) => c.key !== 'id').map((c) => (
                        <TableHead key={c.key} className="font-mono text-xs">{c.key}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={columns.length} className="py-10 text-center text-sm text-slate-500">
                          Ничего не найдено
                        </TableCell>
                      </TableRow>
                    ) : data.rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => void openEdit(row.id)}
                            className="block max-w-[180px] break-all text-left font-mono text-xs text-blue-600 hover:underline"
                            aria-label={`Изменить запись ${row.id}`}
                          >
                            {row.id}
                          </button>
                        </TableCell>
                        {columns.filter((c) => c.key !== 'id').map((c) => (
                          <TableCell key={c.key}>{cell(c, row.values[c.key] ?? null)}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* ——— Окно создания / редактирования записи ——— */}
      {editing && (
        <Dialog open onOpenChange={(o) => { if (!o) setEditing(null) }}>
          <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editing.op === 'create' ? `Новая запись — ${currentLabel}` : `Запись ${editing.id}`}
              </DialogTitle>
              <DialogDescription>
                Таблица «{currentLabel}»{editing.op === 'update' ? ` · id: ${editing.id}` : ' · создание записи'}
              </DialogDescription>
            </DialogHeader>

            {rowLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                Загрузка записи…
              </div>
            ) : values ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  {columns.filter((c) => c.key !== 'id').map((col) => {
                    const v = values[col.key] ?? ''
                    const long = col.kind === 'string' && v.length > 80
                    return (
                      <div key={col.key} className={`space-y-1.5 ${long ? 'sm:col-span-2' : ''}`}>
                        <Label htmlFor={`dbf-${col.key}`} className="font-mono text-xs">{col.key}</Label>
                        {col.kind === 'boolean' ? (
                          <Select value={v} onValueChange={(val) => setBool(col.key, val)}>
                            <SelectTrigger id={`dbf-${col.key}`} aria-label={`Поле ${col.key}`}>
                              <SelectValue placeholder="Не выбрано" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="yes">Да</SelectItem>
                              <SelectItem value="no">Нет</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : long ? (
                          <Textarea id={`dbf-${col.key}`} rows={4} value={v} onChange={set(col.key)} className="font-mono text-xs" />
                        ) : (
                          <Input
                            id={`dbf-${col.key}`}
                            type={col.kind === 'number' ? 'number' : 'text'}
                            value={v}
                            onChange={set(col.key)}
                            placeholder={col.kind === 'datetime' ? 'ГГГГ-ММ-ДД ЧЧ:мм' : ''}
                            className={col.kind === 'string' ? undefined : 'font-mono text-xs'}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
                <p className="text-xs text-muted-foreground">Пустое значение сохраняется как NULL (для необязательных полей)</p>
              </>
            ) : null}

            <DialogFooter className="gap-2">
              {editing.op === 'update' && (
                <Button
                  variant="outline"
                  className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving || deleting}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Удалить запись
                </Button>
              )}
              <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Отмена</Button>
              <Button onClick={save} disabled={saving || rowLoading}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Сохранить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ——— Подтверждение удаления записи ——— */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить запись?</AlertDialogTitle>
            <AlertDialogDescription>
              Запись будет удалена из таблицы «{currentLabel}» без возможности восстановления. Если на неё ссылаются
              другие данные, сначала удалите связанные записи.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => { e.preventDefault(); void removeRow() }}
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
