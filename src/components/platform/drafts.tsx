'use client'

/**
 * «Черновики заявок» — заявки, которые не на площадке:
 *  — сохранённые логистом без публикации («Сохранить в черновики»);
 *  — торги, закончившиеся без единой ставки: по окончании срока заявка уходит
 *    сюда сама (src/lib/requests.ts → moveUnansweredToDrafts).
 * Перевозчики черновики не видят. Отсюда заявку правят, публикуют с новым
 * сроком и ставкой или удаляют.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, FilePen, Pencil, Plus, Send, Trash2, Truck } from 'lucide-react'
import {
  EmptyState, ErrorBlock, InfoTip, LoadingBlock, ModeBadge, NoticeLine, SectionHeader, StatusDot, type TabProps,
} from '@/components/platform/common'
import { useCan } from '@/components/platform/perms'
import { RoutePointsInline } from '@/components/platform/route-dialog'
import { DEADLINE_OPTIONS, RequestFormDialog } from '@/components/platform/request-form'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { pointInfo } from '@/lib/points'
import { fmtDateTime, num, rate } from '@/lib/status'
import type { RequestDTO } from '@/lib/types'

/** Почему заявка в черновиках: последнее из событий «сохранена» / «без откликов» */
function draftOrigin(r: RequestDTO): { unanswered: boolean; at: string } {
  const last = [...r.events]
    .filter((e) => e.type === 'MOVED_TO_DRAFT' || e.type === 'REQUEST_DRAFTED')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  return { unanswered: last?.type === 'MOVED_TO_DRAFT', at: last?.createdAt ?? r.updatedAt }
}

/** Дата погрузки ДД.ММ.ГГГГ уже прошла */
function loadDatePassed(loadDate: string): boolean {
  const m = loadDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!m) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) < today
}

export default function DraftsTab({ onNavigate, liveTick }: TabProps) {
  const { toast } = useToast()
  const [requests, setRequests] = useState<RequestDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [publishId, setPublishId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [publishHours, setPublishHours] = useState('4')
  const [publishRate, setPublishRate] = useState('')
  // права платформы (Task 111): каждая функция видна только при включённом праве —
  // без права кнопка исчезает из интерфейса целиком (сервер проверяет то же самое)
  const can = useCan()
  const canCreate = can('draft:create')
  const canEdit = can('draft:edit')
  const canDelete = can('draft:delete')
  const mayPublish = can('request:publish')

  const load = useCallback(async () => {
    try {
      const d = await api.listRequests({ status: 'DRAFT' })
      setRequests(d.requests)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (liveTick > 0) void load() }, [liveTick, load])

  // свежие сверху: по времени, когда заявка попала в черновики
  const drafts = useMemo(
    () => [...(requests ?? [])].sort((a, b) => draftOrigin(b).at.localeCompare(draftOrigin(a).at)),
    [requests],
  )
  const editTarget = drafts.find((r) => r.id === editId) ?? null
  const publishTarget = drafts.find((r) => r.id === publishId) ?? null
  const deleteTarget = drafts.find((r) => r.id === deleteId) ?? null

  const openPublish = (r: RequestDTO) => {
    setPublishHours('4')
    setPublishRate(r.startRate > 0 ? String(r.startRate) : '')
    setPublishId(r.id)
  }

  const publishRateNum = Number(publishRate.replace(/\s/g, '').replace(',', '.'))
  const canPublish = Number.isFinite(publishRateNum) && publishRateNum > 0 && !(publishTarget && loadDatePassed(publishTarget.loadDate))

  const doPublish = async () => {
    if (!publishTarget) return
    setBusy(true)
    try {
      await api.action(publishTarget.id, 'publish', { deadlineHours: Number(publishHours), startRate: publishRateNum })
      toast({ title: 'Заявка опубликована', description: `№${publishTarget.number} — на площадке, приём ставок открыт` })
      setPublishId(null)
      await load()
    } catch (e) {
      toast({ title: 'Не удалось опубликовать', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await api.action(deleteTarget.id, 'delete')
      toast({ title: 'Черновик удалён', description: `№${deleteTarget.number}: в реестре заявок помечен «Удалена»` })
      setDeleteId(null)
      await load()
    } catch (e) {
      toast({ title: 'Не удалось удалить', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Черновики заявок">
      <SectionHeader
        title="Черновики заявок"
        desc="Заявки, которые не на площадке: сохранённые без публикации и торги, по которым за время приёма ставок не было ни одной ставки. Перевозчики черновики не видят."
      >
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" aria-hidden />
            Новая заявка
          </Button>
        )}
      </SectionHeader>

      {requests === null && !error && <LoadingBlock label="Загружаем черновики…" />}
      {error && <ErrorBlock message={error} onRetry={() => void load()} />}

      {requests !== null && !error && (
        drafts.length === 0 ? (
          <EmptyState
            icon={<FilePen className="h-10 w-10" aria-hidden />}
            title="Черновиков нет"
            hint="Сохраните заявку кнопкой «Сохранить в черновики» — или сюда сами попадут торги без ставок"
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {drafts.map((r) => {
              const origin = draftOrigin(r)
              const passed = loadDatePassed(r.loadDate)
              return (
                <Card key={r.id} className="border-slate-200 shadow-sm">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{r.number}</span>
                      {origin.unanswered ? (
                        <StatusDot dot="bg-amber-500" tone="warning">Торги без ставок</StatusDot>
                      ) : (
                        <StatusDot dot="bg-slate-400">Сохранён без публикации</StatusDot>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">{fmtDateTime(origin.at)}</span>
                    </div>

                    <RoutePointsInline from={r.fromPoint} to={r.toPoint} />

                    <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                      <div className="flex items-start gap-2 text-slate-700">
                        <Truck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                        <span>{r.cargo}, {num(r.tonnage)} т · {r.truckType}</span>
                      </div>
                      <div className={`flex items-start gap-2 ${passed ? 'text-red-600' : 'text-slate-700'}`}>
                        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                        <span>
                          {r.loadDate && r.loadDate !== '—' ? `Погрузка ${r.loadDate}` : 'Дата погрузки не указана'}
                          {r.loadWindow && r.loadWindow !== '—' ? `, ${r.loadWindow}` : ''}
                          {passed && ' — дата прошла'}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      <ModeBadge mode={r.mode} />
                      <span className="text-sm text-slate-700">
                        Стартовая ставка: <b>{r.startRate > 0 ? rate(r.startRate) : 'не задана'}</b>
                      </span>
                      <div className="ml-auto flex items-center gap-1.5">
                        {mayPublish && (
                          <Button size="sm" className="gap-1.5" onClick={() => openPublish(r)}>
                            <Send className="h-4 w-4" aria-hidden />
                            Опубликовать
                          </Button>
                        )}
                        {canEdit && (
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-500 hover:bg-amber-50 hover:text-amber-700" onClick={() => setEditId(r.id)} aria-label={`Изменить черновик ${r.number}`} title="Изменить">
                            <Pencil className="h-4 w-4" aria-hidden />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => setDeleteId(r.id)}
                            aria-label={`Удалить черновик ${r.number}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                            Удалить
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )
      )}

      {/* новая заявка: опубликованная уходит на площадку, черновик — в этот список */}
      {canCreate && createOpen && (
        <RequestFormDialog
          open
          onOpenChange={setCreateOpen}
          onDone={(request, result) => {
            if (result === 'draft') {
              toast({ title: 'Черновик сохранён', description: `№${request.number} — в списке черновиков` })
              void load()
            } else {
              toast({ title: 'Заявка опубликована', description: `№${request.number} — уже на площадке` })
              onNavigate('board')
            }
          }}
        />
      )}

      {canEdit && editTarget && (
        <RequestFormDialog
          key={editTarget.id}
          open
          onOpenChange={(o) => { if (!o) setEditId(null) }}
          request={editTarget}
          onDone={(request) => {
            toast({ title: 'Черновик обновлён', description: `№${request.number}: изменения сохранены` })
            void load()
          }}
        />
      )}

      {/* публикация черновика: новый срок приёма ставок и стартовая ставка */}
      <Dialog open={publishTarget !== null} onOpenChange={(o) => { if (!o) setPublishId(null) }}>
        <DialogContent className="sm:max-w-md">
          {publishTarget && (
            <>
              <DialogHeader>
                <DialogTitle>Опубликовать {publishTarget.number}</DialogTitle>
                <DialogDescription>
                  {pointInfo(publishTarget.fromPoint).short} → {pointInfo(publishTarget.toPoint).short} · {publishTarget.cargo}, {num(publishTarget.tonnage)} т
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dp-rate" className="flex items-center gap-1.5">
                    Стартовая ставка, ₽/т
                    {draftOrigin(publishTarget).unanswered && (
                      <InfoTip label="Ставок не было">В прошлый раз ставок не было — возможно, стоит поднять стартовую ставку.</InfoTip>
                    )}
                  </Label>
                  <Input id="dp-rate" type="number" min={1} step={100} value={publishRate} onChange={(e) => setPublishRate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dp-hours">Приём ставок</Label>
                  <Select value={publishHours} onValueChange={setPublishHours}>
                    <SelectTrigger id="dp-hours" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DEADLINE_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {loadDatePassed(publishTarget.loadDate) && (
                  <NoticeLine tone="danger">
                    Дата погрузки {publishTarget.loadDate} уже прошла — сначала измените её в черновике.
                  </NoticeLine>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPublishId(null)}>Отмена</Button>
                <Button onClick={() => void doPublish()} disabled={!canPublish || busy}>
                  {busy ? 'Публикуем…' : 'Опубликовать'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить черновик?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && `№${deleteTarget.number} (${pointInfo(deleteTarget.fromPoint).short} → ${pointInfo(deleteTarget.toPoint).short}) будет удалён. В реестре заявок он останется со статусом «Удалена».`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); void doDelete() }}
              className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600"
            >
              {busy ? 'Удаляем…' : 'Да, удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
