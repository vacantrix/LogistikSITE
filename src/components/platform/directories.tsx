'use client'

/** «Справочники» — единый справочник: перевозчики, водители, тягачи, прицепы */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Truck, User, Users, Wrench } from 'lucide-react'
import {
  ErrorBlock, LoadingBlock, SectionHeader, type TabProps,
} from '@/components/platform/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import type { CarrierDTO } from '@/lib/types'

const THIN_SCROLL = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full'

type Kind = 'carrier' | 'driver' | 'truck' | 'trailer'

type TabKind = 'carriers' | 'drivers' | 'trucks' | 'trailers'

interface FieldDef {
  key: string
  label: string
  placeholder?: string
}

const FORM_FIELDS: Record<Kind, FieldDef[]> = {
  carrier: [
    { key: 'name', label: 'Название', placeholder: 'ООО «Перевозчик Д»' },
    { key: 'inn', label: 'ИНН', placeholder: '2310045675' },
    { key: 'contractNo', label: 'Договор №', placeholder: '24-Д' },
    { key: 'contractDate', label: 'Дата договора', placeholder: '01.11.2025' },
  ],
  driver: [
    { key: 'fullName', label: 'ФИО', placeholder: 'Смирнов Олег Викторович' },
    { key: 'birthDate', label: 'Дата рождения', placeholder: '11.03.1993' },
    { key: 'passport', label: 'Паспорт (серия и номер)', placeholder: '52 07 123456' },
    { key: 'license', label: 'Номер ВУ', placeholder: '52 07 123456' },
    { key: 'licenseTill', label: 'ВУ действует до', placeholder: '10.09.2031' },
    { key: 'categories', label: 'Категории', placeholder: 'C, CE' },
  ],
  truck: [
    { key: 'brand', label: 'Марка', placeholder: 'MAN TGX' },
    { key: 'plate', label: 'Госномер', placeholder: 'А321ВС777' },
    { key: 'vin', label: 'VIN', placeholder: '17 символов' },
    { key: 'sts', label: 'СТС', placeholder: '99 00 123456' },
    { key: 'owner', label: 'Собственник', placeholder: 'ООО «Перевозчик А»' },
  ],
  trailer: [
    { key: 'plate', label: 'Госномер', placeholder: 'АВ123777' },
    { key: 'type', label: 'Тип', placeholder: 'Полуприцеп тент' },
    { key: 'sts', label: 'СТС', placeholder: '99 00 123457' },
  ],
}

const KIND_TITLES: Record<Kind, string> = {
  carrier: 'Перевозчики',
  driver: 'Водители',
  truck: 'Тягачи (ТС)',
  trailer: 'Прицепы',
}

function AccessBadge({ access }: { access: boolean }) {
  return access ? (
    <Badge variant="outline" className="whitespace-nowrap border-emerald-300 bg-emerald-50 text-emerald-700">
      Доступ открыт
    </Badge>
  ) : (
    <Badge variant="outline" className="whitespace-nowrap border-slate-300 bg-slate-100 text-slate-600">
      Закрыт
    </Badge>
  )
}

export default function DirectoriesTab({ activeCarrierId: _activeCarrierId, onNavigate: _onNavigate }: TabProps) {
  const { toast } = useToast()
  const [carriers, setCarriers] = useState<CarrierDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKind>('carriers')
  const [addKind, setAddKind] = useState<Kind | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const dir = await api.directory()
      setCarriers(dir.carriers)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const driversFlat = useMemo(
    () => (carriers ?? []).flatMap((c) => c.drivers.map((d) => ({ d, carrierName: c.name }))),
    [carriers],
  )
  const trucksFlat = useMemo(
    () => (carriers ?? []).flatMap((c) => c.trucks.map((t) => ({ t, carrierName: c.name }))),
    [carriers],
  )
  const trailersFlat = useMemo(
    () => (carriers ?? []).flatMap((c) => c.trailers.map((z) => ({ z, carrierName: c.name }))),
    [carriers],
  )

  const openAdd = (kind: Kind) => {
    setForm({ carrierId: carriers?.[0]?.id ?? '' })
    setAddKind(kind)
  }

  const submitAdd = async () => {
    if (!addKind) return
    setSaving(true)
    try {
      await api.createDirectory(addKind, form)
      toast({
        title: 'Запись добавлена в справочник',
        description: `${KIND_TITLES[addKind]}: запись создана и доступна агентам на площадке`,
      })
      setAddKind(null)
      await load()
    } catch (e) {
      toast({
        title: 'Не удалось добавить запись',
        description: e instanceof Error ? e.message : 'Проверьте заполнение полей',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (carriers === null && !error) return <LoadingBlock label="Загрузка справочников…" />
  if (error) return <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />

  const addLabel = addKind ? KIND_TITLES[addKind] : ''

  return (
    <div>
      <SectionHeader
        eyebrow="РЕШЕНИЕ 2 · СПРАВОЧНИК"
        title="Единый справочник: водитель вводится один раз"
        desc="Заполняется с площадки: после подтверждения логистом данные записываются автоматически. При повторной перевозке агент выбирает водителя из списка — документы заново не загружаются."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKind)} className="gap-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="carriers">
            <Users className="h-4 w-4" aria-hidden />
            Перевозчики
          </TabsTrigger>
          <TabsTrigger value="drivers">
            <User className="h-4 w-4" aria-hidden />
            Водители
          </TabsTrigger>
          <TabsTrigger value="trucks">
            <Truck className="h-4 w-4" aria-hidden />
            Тягачи (ТС)
          </TabsTrigger>
          <TabsTrigger value="trailers">
            <Wrench className="h-4 w-4" aria-hidden />
            Прицепы
          </TabsTrigger>
        </TabsList>

        {/* -------- Перевозчики -------- */}
        <TabsContent value="carriers">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm text-slate-500">Записей: {(carriers ?? []).length}</div>
                <Button size="sm" onClick={() => openAdd('carrier')}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Добавить перевозчика
                </Button>
              </div>
              <div className={`max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200 ${THIN_SCROLL}`}>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>Название</TableHead>
                      <TableHead>ИНН</TableHead>
                      <TableHead>Договор</TableHead>
                      <TableHead>Доступ</TableHead>
                      <TableHead>Взято заявок</TableHead>
                      <TableHead>Ставок</TableHead>
                      <TableHead>Водители/ТС</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(carriers ?? []).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium text-slate-800">{c.name}</TableCell>
                        <TableCell className="font-mono text-xs text-slate-600">{c.inn}</TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600">№{c.contractNo} от {c.contractDate}</TableCell>
                        <TableCell><AccessBadge access={c.access} /></TableCell>
                        <TableCell className="font-semibold text-slate-800">{c.takenCount}</TableCell>
                        <TableCell className="text-slate-600">{c.bidsCount}</TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600">
                          {c.drivers.length} / {c.trucks.length}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(carriers ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-slate-400">Записей нет</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------- Водители -------- */}
        <TabsContent value="drivers">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm text-slate-500">Записей: {driversFlat.length}</div>
                <Button size="sm" onClick={() => openAdd('driver')}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Добавить водителя
                </Button>
              </div>
              <div className={`max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200 ${THIN_SCROLL}`}>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>ФИО</TableHead>
                      <TableHead>Дата рождения</TableHead>
                      <TableHead>Паспорт</TableHead>
                      <TableHead>ВУ (номер)</TableHead>
                      <TableHead>Действует до</TableHead>
                      <TableHead>Категории</TableHead>
                      <TableHead>Перевозчик</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {driversFlat.map(({ d, carrierName }) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium text-slate-800">{d.fullName}</TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600">{d.birthDate}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">{d.passport}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">{d.license}</TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600">{d.licenseTill}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {d.categories.split(',').map((cat) => cat.trim()).filter(Boolean).map((cat) => (
                              <Badge key={cat} variant="outline" className="border-slate-300 bg-slate-50 text-slate-700">{cat}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-600">{carrierName}</TableCell>
                      </TableRow>
                    ))}
                    {driversFlat.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-slate-400">Записей нет</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------- Тягачи -------- */}
        <TabsContent value="trucks">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm text-slate-500">Записей: {trucksFlat.length}</div>
                <Button size="sm" onClick={() => openAdd('truck')}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Добавить тягач
                </Button>
              </div>
              <div className={`max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200 ${THIN_SCROLL}`}>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>Марка</TableHead>
                      <TableHead>Госномер</TableHead>
                      <TableHead>VIN</TableHead>
                      <TableHead>СТС</TableHead>
                      <TableHead>Собственник</TableHead>
                      <TableHead>Перевозчик</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trucksFlat.map(({ t, carrierName }) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium text-slate-800">{t.brand}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-sm font-semibold text-slate-800">{t.plate}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-slate-500">{t.vin}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">{t.sts}</TableCell>
                        <TableCell className="text-slate-600">{t.owner}</TableCell>
                        <TableCell className="text-slate-600">{carrierName}</TableCell>
                      </TableRow>
                    ))}
                    {trucksFlat.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-slate-400">Записей нет</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------- Прицепы -------- */}
        <TabsContent value="trailers">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4 sm:p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm text-slate-500">Записей: {trailersFlat.length}</div>
                <Button size="sm" onClick={() => openAdd('trailer')}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Добавить прицеп
                </Button>
              </div>
              <div className={`max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-slate-200 ${THIN_SCROLL}`}>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>Госномер</TableHead>
                      <TableHead>Тип</TableHead>
                      <TableHead>СТС</TableHead>
                      <TableHead>Перевозчик</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trailersFlat.map(({ z, carrierName }) => (
                      <TableRow key={z.id}>
                        <TableCell className="whitespace-nowrap font-mono text-sm font-semibold text-slate-800">{z.plate}</TableCell>
                        <TableCell className="text-slate-600">{z.type}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">{z.sts}</TableCell>
                        <TableCell className="text-slate-600">{carrierName}</TableCell>
                      </TableRow>
                    ))}
                    {trailersFlat.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-slate-400">Записей нет</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* диалог добавления записи */}
      <Dialog open={!!addKind} onOpenChange={(o) => { if (!o) setAddKind(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Добавить запись — {addLabel}</DialogTitle>
            <DialogDescription>
              Запись появится в справочнике и станет доступна агентам при подаче заявки.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {(addKind === 'driver' || addKind === 'truck' || addKind === 'trailer') && (
              <div className="space-y-1.5">
                <Label>Перевозчик</Label>
                <Select value={form.carrierId ?? ''} onValueChange={(v) => setForm((f) => ({ ...f, carrierId: v }))}>
                  <SelectTrigger aria-label="Выбор перевозчика">
                    <SelectValue placeholder="Выберите перевозчика" />
                  </SelectTrigger>
                  <SelectContent>
                    {(carriers ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {addKind && FORM_FIELDS[addKind].map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`add-${field.key}`}>{field.label}</Label>
                <Input
                  id={`add-${field.key}`}
                  placeholder={field.placeholder}
                  value={form[field.key] ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddKind(null)}>Отмена</Button>
            <Button disabled={saving} onClick={() => void submitAdd()}>
              {saving ? 'Сохранение…' : 'Добавить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
