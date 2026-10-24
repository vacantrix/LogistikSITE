'use client'

/**
 * «Реестр заявок» (Task 66) — единый экран со всеми заявками платформы.
 * Быстрая навигация (Task 68): верхние табы — по статусам (Все / Новая / В работе /
 * Завершена / Удалена) со счётчиками и мгновенной фильтрацией (Task 69 — категории
 * удалены с платформы как ненужные). Поиск по ID/грузу, сортировка по дате создания
 * (по умолчанию — самые свежие сверху). Статусы синхронизированы с пайплайном
 * перевозчика и реестром рейсов: один источник (статус заявки в БД) + liveTick.
 * Действия по правам: Просмотр — всем, Редактировать и Удалить — логисту,
 * причём удаление доступно только для текущих (не завершённых) заявок.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Eye,
  Pencil,
  ScrollText,
  Search,
  Trash2,
} from 'lucide-react'
import {
  EmptyState, ErrorBlock, LoadingBlock, SectionHeader, type TabProps,
} from '@/components/platform/common'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { pointInfo } from '@/lib/points'
import { RequestFormDialog } from '@/components/platform/request-form'
import {
  DELETABLE_STATUSES, REQUEST_GROUP_META, REQUEST_STATUS_META,
  fmtDateTime, num, rate, requestGroupOf, type RequestGroup,
} from '@/lib/status'
import type { RequestDTO } from '@/lib/types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300'

type GroupFilter = 'ALL' | RequestGroup
type SortOrder = 'desc' | 'asc'

export default function RequestsRegistryTab({ activeCarrierId: _activeCarrierId, onNavigate: _onNavigate, liveTick }: TabProps) {
  const { toast } = useToast()
  const [requests, setRequests] = useState<RequestDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // фильтры реестра (Task 68: табы — статусы; Task 69 — категории удалены)
  const [group, setGroup] = useState<GroupFilter>('ALL') // таб статуса
  const [q, setQ] = useState('')
  const [order, setOrder] = useState<SortOrder>('desc')

  // диалоги: держим id, свежие данные — из списка
  const [detailId, setDetailId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      // реестр — единственный раздел, который видит и удалённые заявки (Task 65)
      const d = await api.listRequests({ includeDeleted: true })
      setRequests(d.requests)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // real-time (Task 49): событие из шины WS мгновенно догружает реестр
  useEffect(() => {
    if (liveTick > 0) void load()
  }, [liveTick, load])

  // ——— фильтрация и сортировка ———
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = (requests ?? []).filter((r) => {
      if (group !== 'ALL' && requestGroupOf(r.status) !== group) return false
      if (!needle) return true
      // поиск по ID заявки или названию груза (+ маршрут для удобства)
      return [r.number, r.cargo, r.fromPoint, r.toPoint]
        .some((v) => v.toLowerCase().includes(needle))
    })
    return list.sort((a, b) => (order === 'desc'
      ? b.createdAt.localeCompare(a.createdAt) || b.number.localeCompare(a.number)
      : a.createdAt.localeCompare(b.createdAt) || a.number.localeCompare(b.number)))
  }, [requests, group, q, order])

  const groupCounts = useMemo(() => {
    const counts = { draft: 0, new: 0, working: 0, done: 0, deleted: 0 } as Record<string, number>
    for (const r of requests ?? []) counts[requestGroupOf(r.status)] += 1
    return counts
  }, [requests])

  const detail = (requests ?? []).find((r) => r.id === detailId) ?? null
  const deleteTarget = (requests ?? []).find((r) => r.id === deleteId) ?? null
  const editTarget = (requests ?? []).find((r) => r.id === editId) ?? null

  // ——— удаление (Task 65): только текущие заявки, с подтверждением ———
  const doDelete = async () => {
    if (!deleteTarget) return
    setBusy(deleteTarget.id)
    try {
      await api.action(deleteTarget.id, 'delete')
      toast({ title: 'Заявка удалена', description: `№${deleteTarget.number}: снята с площадки, в реестре помечена «Удалена»` })
      setDeleteId(null)
      await load()
    } catch (e) {
      toast({ title: 'Не удалось удалить заявку', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <SectionHeader title="Реестр заявок">
        <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
          Заявок: {filtered.length}{filtered.length !== (requests?.length ?? 0) ? ` из ${requests?.length ?? 0}` : ''}
        </Badge>
      </SectionHeader>

      {requests === null && !error && <LoadingBlock label="Загрузка реестра заявок…" />}
      {error && <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />}

      {requests !== null && !error && (
        <div className="space-y-4">
          {/* Табы статусов (Task 68) — быстрая навигация по стадиям заявки:
              Новая → В работе → Завершена / Удалена. Переключение мгновенно фильтрует список,
              счётчики считаются по всей базе, а не по текущему поиску */}
          <Tabs value={group} onValueChange={(v) => setGroup(v as GroupFilter)}>
            <TabsList className="h-auto flex-wrap justify-start gap-1 bg-slate-100 p-1">
              <TabsTrigger value="ALL" className="gap-1.5 data-[state=active]:bg-white">
                Все заявки
                <Badge variant="outline" className="h-5 border-slate-200 bg-white px-1.5 text-[10px] text-slate-500">{requests.length}</Badge>
              </TabsTrigger>
              {(Object.keys(REQUEST_GROUP_META) as (keyof typeof REQUEST_GROUP_META)[]).map((g) => (
                <TabsTrigger key={g} value={g} className="gap-1.5 data-[state=active]:bg-white">
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${REQUEST_GROUP_META[g].dot}`} aria-hidden />
                    {REQUEST_GROUP_META[g].label}
                  </span>
                  <Badge variant="outline" className="h-5 border-slate-200 bg-white px-1.5 text-[10px] text-slate-500">{groupCounts[g] ?? 0}</Badge>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Инструменты: поиск, статус, сортировка */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Поиск по ID заявки или названию груза…"
                  className="pl-9"
                  aria-label="Поиск по ID заявки или названию груза"
                />
              </div>
              <Select value={order} onValueChange={(v) => setOrder(v as SortOrder)}>
                <SelectTrigger className="w-[190px]" aria-label="Сортировка по дате создания">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">Сначала новые</SelectItem>
                  <SelectItem value="asc">Сначала старые</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Таблица реестра */}
          {filtered.length === 0 ? (
            <EmptyState
              icon={<ScrollText className="h-10 w-10" aria-hidden />}
              title={requests.length === 0 ? 'Заявок пока нет' : 'Ничего не найдено'}
              hint={requests.length === 0
                ? 'Создайте первую заявку на «Площадке заявок» — она появится здесь'
                : 'Измените статус или условия поиска'}
            />
          ) : (
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-0">
                {/* Task 73: список без внутреннего скролл-окна — уходит вниз вместе со страницей;
                    шапка таблицы прилипает под шапкой сайта (md:top = высота хедера),
                    перехват скролла контейнером отключён через .registry-sticky-table (globals.css) */}
                <div className="registry-sticky-table">
                  <Table>
                    <TableHeader className="z-10 bg-slate-50 shadow-[0_2px_6px_-2px_rgba(15,23,42,0.12)] md:sticky md:top-[105px]">
                      <TableRow className="bg-slate-50">
                        <TableHead className="whitespace-nowrap">ID заявки</TableHead>
                        <TableHead className="whitespace-nowrap">Дата создания</TableHead>
                        <TableHead className="whitespace-nowrap">Статус</TableHead>
                        <TableHead className="whitespace-nowrap">Маршрут</TableHead>
                        <TableHead className="whitespace-nowrap">Логист / Создатель</TableHead>
                        <TableHead className="whitespace-nowrap">Груз</TableHead>
                        <TableHead className="text-right">Действия</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((r) => {
                        const g = REQUEST_GROUP_META[requestGroupOf(r.status)]
                        const deletable = DELETABLE_STATUSES.includes(r.status)
                        const editable = r.status === 'PUBLISHED' || r.status === 'DRAFT'
                        return (
                          <TableRow key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetailId(r.id)}>
                            <TableCell className="whitespace-nowrap font-bold text-blue-700">№{r.number}</TableCell>
                            <TableCell className="whitespace-nowrap text-slate-600">{fmtDateTime(r.createdAt)}</TableCell>
                            <TableCell className="whitespace-nowrap">
                              {/* группа статуса + точный статус (Task 67): «Завершена» — только закрытый рейс.
                                  Task 73: яркий насыщенный пузырь группы + читаемая подпись под ним */}
                              <div className="flex flex-col items-start gap-0.5">
                                <Badge variant="outline" className={`${g.badge} whitespace-nowrap`}>{g.label}</Badge>
                                <span className="text-[11px] font-medium leading-tight text-slate-600">
                                  {REQUEST_STATUS_META[r.status as RequestDTO['status']]?.label ?? r.status}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[260px] text-slate-700">
                              <span className="block break-words">
                                {pointInfo(r.fromPoint).short} → {pointInfo(r.toPoint).short}
                              </span>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-slate-600">{r.createdBy || '—'}</TableCell>
                            <TableCell className="max-w-[200px] text-slate-600">
                              <span className="line-clamp-2" title={`${r.cargo}, ${num(r.tonnage)} т`}>{r.cargo}, {num(r.tonnage)} т</span>
                            </TableCell>
                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-slate-500 hover:bg-blue-50 hover:text-blue-700"
                                  onClick={() => setDetailId(r.id)}
                                  aria-label={`Просмотреть заявку ${r.number}`}
                                  title="Просмотр"
                                >
                                  <Eye className="h-4 w-4" aria-hidden />
                                </Button>
                                {editable && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-slate-500 hover:bg-amber-50 hover:text-amber-700"
                                    onClick={() => setEditId(r.id)}
                                    aria-label={`Редактировать заявку ${r.number}`}
                                    title={r.status === 'DRAFT' ? 'Редактировать черновик' : 'Редактировать (пока заявка на площадке)'}
                                  >
                                    <Pencil className="h-4 w-4" aria-hidden />
                                  </Button>
                                )}
                                {deletable && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                    onClick={() => setDeleteId(r.id)}
                                    aria-label={`Удалить заявку ${r.number}`}
                                    title="Удалить"
                                  >
                                    <Trash2 className="h-4 w-4" aria-hidden />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
                <div className="border-t border-slate-100 px-4 py-2 text-xs text-muted-foreground">
                  Нажмите на строку или иконку «Просмотр», чтобы открыть карточку заявки. Редактирование — у черновиков и заявок на площадке; удаление — для текущих заявок.
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Карточка заявки */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetailId(null) }}>
        <DialogContent className={`max-h-[88vh] overflow-y-auto sm:max-w-2xl ${THIN_SCROLL}`}>
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  Заявка <span className="text-blue-700">{detail.number}</span>
                  <Badge variant="outline" className={REQUEST_GROUP_META[requestGroupOf(detail.status)].badge}>
                    {REQUEST_GROUP_META[requestGroupOf(detail.status)].label}
                  </Badge>
                  <Badge variant="outline" className="whitespace-nowrap border-slate-200 bg-slate-100 text-slate-700">
                    {REQUEST_STATUS_META[detail.status]?.label ?? detail.status}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  Создана {fmtDateTime(detail.createdAt)} · {detail.createdBy}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  { label: 'Груз', value: `${detail.cargo}, ${num(detail.tonnage)} т` },
                  { label: 'Точка А (погрузка)', value: `${pointInfo(detail.fromPoint).short} — ${pointInfo(detail.fromPoint).address}` },
                  { label: 'Точка Б (выгрузка)', value: `${pointInfo(detail.toPoint).short} — ${pointInfo(detail.toPoint).address}` },
                  { label: 'Желаемые сроки', value: `${detail.loadDate}, ${detail.loadWindow}` },
                  { label: 'Перевозчик', value: detail.winnerName ?? '—' },
                  { label: 'Стартовая ставка', value: detail.startRate > 0 ? rate(detail.startRate) : 'не задана' },
                  { label: 'Лучшая ставка', value: detail.bestRate != null ? rate(detail.bestRate) : '—' },
                ].map((f) => (
                  <div key={f.label} className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{f.label}</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-900">{f.value}</div>
                  </div>
                ))}
              </div>
              {detail.comment && (
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Комментарий для исполнителя</div>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{detail.comment}</p>
                </div>
              )}
              {/* вложения (Task 64) */}
              {detail.documents.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-900">Вложения ({detail.documents.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {detail.documents.map((d) => (
                      <a
                        key={d.id}
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-700"
                      >
                        {d.fileName}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Подтверждение удаления (Task 65) */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить заявку?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {deleteTarget && (
                  <>
                    Вы уверены, что хотите удалить текущую заявку{' '}
                    <span className="font-semibold text-slate-900">№{deleteTarget.number}</span>
                    {' '}({pointInfo(deleteTarget.fromPoint).short} → {pointInfo(deleteTarget.toPoint).short})?{' '}
                    Это действие нельзя отменить. Заявка будет снята с площадки; в реестре она останется со статусом «Удалена».
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(e) => { e.preventDefault(); void doDelete() }}
              className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600"
            >
              {busy === deleteTarget?.id ? 'Удаляем…' : 'Да, удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Редактирование — черновика или заявки, пока она на площадке (общая форма заявки) */}
      {editTarget && (
        <RequestFormDialog
          key={editTarget.id}
          open
          onOpenChange={(o) => { if (!o) setEditId(null) }}
          request={editTarget}
          onDone={(request) => {
            toast({
              title: 'Заявка обновлена',
              description: request.status === 'DRAFT'
                ? `№${request.number}: черновик сохранён`
                : `№${request.number}: изменения сохранены и уже видны перевозчикам`,
            })
            void load()
          }}
        />
      )}
    </div>
  )
}
