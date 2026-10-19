'use client'

/** «Сверка документов» — экран логиста: фото и распознанные поля рядом, подтверждение в 1С */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Ban, Check, CheckCheck, CircleAlert, Info, Undo2, UserCog, X,
} from 'lucide-react'
import {
  DocStatusBadge, EmptyState, ErrorBlock, LoadingBlock, SectionHeader, StatusBadge, type TabProps,
} from '@/components/platform/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { DOC_TYPE_LABEL, money } from '@/lib/status'
import type { DocType, DocumentDTO, DriverDTO, RequestDTO, TruckDTO } from '@/lib/types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full'

const DOC_ORDER: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG', 'LICENSE', 'STS']

/** госномер: латиница/кириллица — взаимно однозначное приведение */
const PLATE_MAP: Record<string, string> = {
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H',
  'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X',
}

function normBase(s: string): string {
  return s.toUpperCase().replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim()
}

function normValue(s: string, kind: 'fio' | 'plate' | 'digits' | 'text'): string {
  const base = normBase(s)
  if (kind === 'fio') return base
  if (kind === 'plate') return base.split('').map((c) => PLATE_MAP[c] ?? c).join('')
  if (kind === 'digits') return s.replace(/\D/g, '')
  return base
}

interface VerifyRow {
  label: string
  expected: string | null // null — сверка не требуется
  actual: string
  conf: number | null
  kind: 'fio' | 'plate' | 'digits' | 'text'
}

function buildRows(
  type: DocType, doc: DocumentDTO, driver: DriverDTO | null, truck: TruckDTO | null,
): VerifyRow[] {
  const f = (k: string) => doc.fields?.[k]?.trim() ?? ''
  const c = (k: string) => (doc.confidence?.[k] != null ? doc.confidence[k] : null)

  if (type === 'PASSPORT_PHOTO') {
    const parts = (driver?.fullName ?? '').split(' ')
    return [
      { label: 'Фамилия', expected: driver ? parts[0] ?? '' : null, actual: f('Фамилия'), conf: c('Фамилия'), kind: 'fio' },
      { label: 'Имя', expected: driver ? parts[1] ?? '' : null, actual: f('Имя'), conf: c('Имя'), kind: 'fio' },
      { label: 'Отчество', expected: driver ? parts[2] ?? '' : null, actual: f('Отчество'), conf: c('Отчество'), kind: 'fio' },
      { label: 'Дата рождения', expected: driver?.birthDate ?? null, actual: f('Дата рождения'), conf: c('Дата рождения'), kind: 'text' },
      { label: 'Серия и номер', expected: driver?.passport ?? null, actual: f('Серия и номер'), conf: c('Серия и номер'), kind: 'digits' },
    ]
  }
  if (type === 'PASSPORT_REG') {
    return ['Дата регистрации', 'Код подразделения', 'Адрес регистрации'].map((k) => ({
      label: k, expected: null, actual: f(k), conf: c(k), kind: 'text' as const,
    }))
  }
  if (type === 'LICENSE') {
    return [
      { label: 'ФИО', expected: driver?.fullName ?? null, actual: f('ФИО'), conf: c('ФИО'), kind: 'fio' },
      { label: 'Дата рождения', expected: driver?.birthDate ?? null, actual: f('Дата рождения'), conf: c('Дата рождения'), kind: 'text' },
      { label: 'Номер ВУ', expected: driver?.license ?? null, actual: f('Номер ВУ'), conf: c('Номер ВУ'), kind: 'digits' },
      { label: 'Действует до', expected: driver?.licenseTill ?? null, actual: f('Действует до'), conf: c('Действует до'), kind: 'text' },
    ]
  }
  return [
    { label: 'Госномер', expected: truck?.plate ?? null, actual: f('Госномер'), conf: c('Госномер'), kind: 'plate' },
    { label: 'VIN', expected: truck?.vin ?? null, actual: f('VIN'), conf: c('VIN'), kind: 'text' },
    { label: 'Номер СТС', expected: truck?.sts ?? null, actual: f('Номер СТС'), conf: c('Номер СТС'), kind: 'digits' },
  ]
}

function confClass(conf: number): string {
  if (conf >= 0.95) return 'text-emerald-600'
  if (conf >= 0.6) return 'text-blue-600'
  return 'text-amber-600'
}

function IssueIcon({ docStatus }: { docStatus: DocumentDTO['status'] }) {
  if (docStatus === 'REJECTED') return <Ban className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
  if (docStatus === 'MANUAL') return <UserCog className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden />
  return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
}

export default function VerificationTab({ activeCarrierId: _activeCarrierId, onNavigate }: TabProps) {
  const { toast } = useToast()
  const [requests, setRequests] = useState<RequestDTO[] | null>(null)
  const [carriersLoaded, setCarriersLoaded] = useState(false)
  const [driverMap, setDriverMap] = useState<Map<string, DriverDTO>>(new Map())
  const [truckMap, setTruckMap] = useState<Map<string, TruckDTO>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [docTab, setDocTab] = useState<DocType | null>(null)
  const [confirmedNumber, setConfirmedNumber] = useState<string | null>(null)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')

  const load = useCallback(async () => {
    try {
      const [rq, dir] = await Promise.all([api.listRequests(), api.directory()])
      setRequests(rq.requests)
      const dm = new Map<string, DriverDTO>()
      const tm = new Map<string, TruckDTO>()
      for (const c of dir.carriers) {
        for (const d of c.drivers) dm.set(d.id, d)
        for (const t of c.trucks) tm.set(t.id, t)
      }
      setDriverMap(dm)
      setTruckMap(tm)
      setCarriersLoaded(true)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const queue = useMemo(() => (requests ?? []).filter((r) => r.status === 'AT_LOGIST'), [requests])
  const needFix = useMemo(() => (requests ?? []).filter((r) => r.status === 'DOCS_REVIEW'), [requests])

  const selected = useMemo(() => queue.find((r) => r.id === selectedId) ?? null, [queue, selectedId])

  // автоподбор заявки: первая в очереди / замена устаревшего выбора
  useEffect(() => {
    if (!queue.some((r) => r.id === selectedId)) setSelectedId(queue[0]?.id ?? null)
  }, [queue, selectedId])

  // активный документ: выбранная вкладка или первый документ заявки
  const activeDocType: DocType | null = useMemo(() => {
    if (!selected) return null
    if (docTab && selected.documents.some((d) => d.type === docTab)) return docTab
    return selected.documents[0]?.type ?? null
  }, [selected, docTab])
  const activeDoc = selected?.documents.find((d) => d.type === activeDocType) ?? null

  const driver = selected ? driverMap.get(selected.driverId ?? '') ?? null : null
  const truck = selected ? truckMap.get(selected.truckId ?? '') ?? null : null

  const doConfirm = async (r: RequestDTO) => {
    setBusy(r.id)
    try {
      await api.action(r.id, 'confirm')
      toast({
        title: 'Данные переданы в 1C:ERP: справочник и реестр',
        description: `Заявка №${r.number} записана в реестр рейсов, пакет на пропуск и ЭТрН сформированы`,
      })
      setConfirmedNumber(r.number)
      setSelectedId(null)
      setDocTab(null)
      await load()
    } catch (e) {
      toast({
        title: 'Не удалось подтвердить заявку',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setBusy(null)
    }
  }

  const doReturn = async () => {
    if (!selected) return
    const reason = returnReason.trim()
    if (!reason) return
    setBusy(selected.id)
    try {
      await api.action(selected.id, 'return', { reason })
      toast({
        title: 'Заявка возвращена агенту',
        description: `№${selected.number}: агент получит причину и догрузит документы в ту же заявку`,
      })
      setReturnOpen(false)
      setReturnReason('')
      setSelectedId(null)
      await load()
    } catch (e) {
      toast({
        title: 'Не удалось вернуть заявку',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setBusy(null)
    }
  }

  if (requests === null && !error) return <LoadingBlock label="Загрузка очереди сверки…" />
  if (error) return <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />

  return (
    <div>
      <SectionHeader
        title="Сверка документов"
      >
        <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
          В очереди: {queue.length}
        </Badge>
      </SectionHeader>

      {/* заявки, требующие исправления у агента — только информирование */}
      {needFix.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <CircleAlert className="h-4 w-4" aria-hidden />
            Требуют исправления (у агента): {needFix.length}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {needFix.map((r) => (
              <Badge key={r.id} variant="outline" className="border-amber-300 bg-white text-amber-800">
                №{r.number} · {r.fromPoint} → {r.toPoint} · документы на догрузке
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* результат подтверждения */}
      {confirmedNumber && (
        <Card className="mb-4 border-emerald-200 bg-emerald-50 shadow-sm">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <CheckCheck className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
            <div className="text-sm font-medium text-emerald-900">
              Заявка №{confirmedNumber} принята — поиск в реестре рейсов
            </div>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-100"
              onClick={() => onNavigate('registry')}
            >
              Открыть реестр
            </Button>
          </CardContent>
        </Card>
      )}

      {queue.length === 0 ? (
        <EmptyState
          icon={<CheckCheck className="h-10 w-10" aria-hidden />}
          title="Очередь сверки пуста"
          hint="Заявки, прошедшие проверку нейросети, появятся здесь"
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[288px_minmax(0,1fr)]">
          {/* список очереди */}
          <div className="space-y-2">
            <div className="lg:hidden">
              <Label htmlFor="queue-select" className="sr-only">Заявка в очереди</Label>
              <Select value={selectedId ?? ''} onValueChange={setSelectedId}>
                <SelectTrigger id="queue-select" aria-label="Выбор заявки из очереди сверки">
                  <SelectValue placeholder="Выберите заявку" />
                </SelectTrigger>
                <SelectContent>
                  {queue.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      №{r.number} · {r.winnerName ?? '—'} · {money(r.bestRate)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className={`hidden max-h-[640px] space-y-2 overflow-y-auto pr-1 lg:block ${THIN_SCROLL}`}>
              {queue.map((r) => {
                const active = r.id === selected?.id
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    aria-pressed={active}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? 'border-blue-500 bg-blue-50/70 ring-1 ring-blue-200'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-blue-700">№{r.number}</span>
                      <span className="text-sm font-semibold text-slate-900">{money(r.bestRate)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-600">{r.fromPoint} → {r.toPoint} · {r.cargo}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">{r.winnerName ?? '—'}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* детали выбранной заявки */}
          {selected && carriersLoaded && (
            <Card className="min-w-0 border-slate-200 shadow-sm">
              <CardContent className="space-y-4 p-4 sm:p-6">
                {/* шапка */}
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-900">
                      Заявка №{selected.number} · {selected.winnerName ?? '—'}
                    </h3>
                    <StatusBadge status={selected.status} />
                  </div>
                  <div className="text-sm text-slate-600">
                    Водитель и ТС:{' '}
                    <span className="font-medium text-slate-800">
                      {driver ? driver.fullName : '—'}{truck ? ` · ${truck.brand} (${truck.plate})` : ''}
                    </span>
                  </div>
                  <div className="text-sm text-slate-600">
                    {selected.fromPoint} → {selected.toPoint} · {selected.cargo} · ставка {money(selected.bestRate)}
                  </div>
                </div>

                {/* вкладки документов */}
                {selected.documents.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {DOC_ORDER.flatMap((t) => {
                      const doc = selected.documents.find((d) => d.type === t)
                      if (!doc) return []
                      const active = doc.type === activeDocType
                      return [
                        <button
                          key={t}
                          type="button"
                          onClick={() => setDocTab(t)}
                          aria-pressed={active}
                          className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                            active
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {DOC_TYPE_LABEL[t]}
                          <DocStatusBadge status={doc.status} />
                        </button>,
                      ]
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    Документы не загружены.
                  </div>
                )}

                {/* содержимое вкладки */}
                {activeDoc && (
                  <div className="space-y-3">
                    {activeDoc.status === 'MANUAL' && (
                      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        Ручная проверка: результат неоднозначен, решение за сотрудником.
                      </div>
                    )}

                    <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
                      {/* фото документа */}
                      <div className="self-start rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <img
                          src={activeDoc.dataUri}
                          alt={`${DOC_TYPE_LABEL[activeDoc.type]} — ${activeDoc.fileName}`}
                          className="mx-auto max-h-72 w-auto rounded-lg border border-slate-200 bg-slate-100 object-contain p-2"
                        />
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-slate-500">
                          <span className="max-w-full truncate font-medium">{activeDoc.fileName}</span>
                          {activeDoc.quality != null && (
                            <span>
                              Качество фото:{' '}
                              <b className={activeDoc.quality >= 60 ? 'text-emerald-600' : 'text-amber-600'}>{activeDoc.quality}</b>
                            </span>
                          )}
                          {activeDoc.engine && <span>{activeDoc.engine}</span>}
                        </div>
                      </div>

                      {/* сверка полей */}
                      <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-slate-50">
                              <TableHead className="w-[26%]">Поле</TableHead>
                              <TableHead>Из заявки</TableHead>
                              <TableHead>С документа</TableHead>
                              <TableHead className="text-center">Сверка</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {buildRows(activeDoc.type, activeDoc, driver, truck).map((row) => {
                              const mismatch =
                                row.expected != null && row.actual !== '' &&
                                normValue(row.expected, row.kind) !== normValue(row.actual, row.kind)
                              return (
                                <TableRow key={row.label} className={mismatch ? 'bg-red-50' : undefined}>
                                  <TableCell className="whitespace-nowrap font-medium text-slate-700">{row.label}</TableCell>
                                  <TableCell className="text-slate-600">{row.expected ?? '—'}</TableCell>
                                  <TableCell>
                                    <div className="text-slate-900">{row.actual || '—'}</div>
                                    {row.conf != null && (
                                      <div className={`text-[11px] ${confClass(row.conf)}`}>
                                        {Math.round(row.conf * 100)}% уверенность
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-center">
                                    {row.expected == null ? (
                                      <span className="text-xs text-slate-400">—</span>
                                    ) : mismatch ? (
                                      <X className="mx-auto h-4 w-4 text-red-600" aria-label="Не совпадает" />
                                    ) : (
                                      <Check className="mx-auto h-4 w-4 text-emerald-600" aria-label="Совпадает" />
                                    )}
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                        {activeDoc.type === 'PASSPORT_REG' && (
                          <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                            Сверка с заявкой не требуется — данные со штампа фиксируются в справочнике.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* флаги проверки */}
                    {activeDoc.issues.length > 0 && (
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Флаги проверки</div>
                        <ul className="mt-2 space-y-1.5">
                          {activeDoc.issues.map((issue, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                              <IssueIcon docStatus={activeDoc.status} />
                              <span>{issue}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* действия */}
                <div className="space-y-2 border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      className="bg-emerald-600 text-white hover:bg-emerald-700"
                      disabled={busy === selected.id}
                      onClick={() => void doConfirm(selected)}
                    >
                      <CheckCheck className="h-4 w-4" aria-hidden />
                      Подтвердить — данные в 1С
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy === selected.id}
                      onClick={() => { setReturnReason(''); setReturnOpen(true) }}
                    >
                      <Undo2 className="h-4 w-4" aria-hidden />
                      Вернуть агенту
                    </Button>
                    {busy === selected.id && <span className="text-xs text-slate-400">Выполняется…</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    При возврате агент получает причину и догружает документы в ту же заявку.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* диалог возврата агенту */}
      <Dialog open={returnOpen} onOpenChange={(o) => { if (!o) setReturnOpen(false) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Вернуть заявку агенту</DialogTitle>
            <DialogDescription>
              {selected && <>№{selected.number} · {selected.winnerName ?? '—'}. Агент получит причину и догрузит документы в ту же заявку.</>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="return-reason">Причина</Label>
            <Textarea
              id="return-reason"
              rows={3}
              placeholder="Например: Номер ВУ не совпадает с фото"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              aria-label="Причина возврата заявки агенту"
            />
            {!returnReason.trim() && <div className="text-xs text-slate-500">Укажите причину — без неё вернуть нельзя.</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnOpen(false)}>Отмена</Button>
            <Button disabled={!returnReason.trim() || busy !== null} onClick={() => void doReturn()}>
              <Undo2 className="h-4 w-4" aria-hidden />
              Вернуть агенту
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
