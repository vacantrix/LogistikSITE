'use client'

/**
 * Форма заявки (Task 64) — одна для «Площадки заявок», «Черновиков заявок» и «Реестра заявок»:
 *  — новая заявка: «Опубликовать» (сразу на площадку) или «Сохранить в черновики»
 *    (заявка остаётся у логиста, перевозчики её не видят);
 *  — правка черновика или заявки, которая ещё на площадке.
 * Груз выбирается только из справочника грузов, точки — из справочника точек.
 * Параметры торгов всегда на виду: ставка и срок приёма ставок решают исход торгов.
 * Монтируется на время показа (родитель рендерит её только открытой, с key заявки):
 * форма заполняется один раз при открытии — данными заявки или автосохранением.
 */
import { useEffect, useRef, useState } from 'react'
import { FileText, Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { PointSelect } from '@/components/platform/point-autocomplete'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { fileToCompressedDataUri } from '@/lib/demo-media'
import { canonicalPoint } from '@/lib/points'
import type { CargoTypeDTO, RequestDTO, RequestMode } from '@/lib/types'

/** Ключ автосохранения новой заявки в localStorage: случайно закрытое окно не теряет данные */
const CREATE_AUTOSAVE_KEY = 'aemz_request_form_v2'

const MAX_FILE_SIZE = 8 * 1024 * 1024
const MAX_FILES = 8
const TRUCK_TYPES = ['Тент', 'Реф', 'Изотерм', 'Борт']
export const DEADLINE_OPTIONS: [string, string][] = [
  ['2', '2 часа'], ['4', '4 часа'], ['8', '8 часов'], ['24', '1 сутки'], ['48', '2 суток'], ['72', '3 суток'],
]

const EMPTY_FORM = {
  cargoTypeId: '',
  fromPoint: '',
  toPoint: '',
  loadDate: '', // YYYY-MM-DD (input type=date); в заявку уходит ДД.ММ.ГГГГ
  loadWindow: '08:00–12:00',
  comment: '',
  tonnage: '20',
  truckType: 'Тент',
  mode: 'AUCTION' as RequestMode,
  startRate: '',
  deadlineHours: '4',
}
type FormState = typeof EMPTY_FORM

const isoToRuDate = (iso: string): string => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}
const ruToIsoDate = (s: string): string => {
  const m = (s ?? '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

function formFromRequest(r: RequestDTO): FormState {
  return {
    cargoTypeId: r.cargoTypeId ?? '',
    fromPoint: canonicalPoint(r.fromPoint) ?? '',
    toPoint: canonicalPoint(r.toPoint) ?? '',
    loadDate: ruToIsoDate(r.loadDate),
    loadWindow: r.loadWindow === '—' ? '08:00–12:00' : r.loadWindow,
    comment: r.comment ?? '',
    tonnage: String(r.tonnage),
    truckType: r.truckType,
    mode: r.mode,
    startRate: r.startRate > 0 ? String(r.startRate) : '',
    deadlineHours: '4',
  }
}

/** Справочник грузов — один раз на сессию страницы */
let cargoCache: CargoTypeDTO[] | null = null

/** Новая заявка: автосохранённая форма, если окно в прошлый раз закрыли случайно */
function restoreAutosave(): FormState {
  try {
    const raw = localStorage.getItem(CREATE_AUTOSAVE_KEY)
    return raw ? { ...EMPTY_FORM, ...(JSON.parse(raw) as Partial<FormState>) } : EMPTY_FORM
  } catch {
    return EMPTY_FORM
  }
}

export type RequestFormResult = 'published' | 'draft' | 'updated'

export function RequestFormDialog({ open, onOpenChange, request, onDone }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** заявка для правки (черновик или на площадке); без неё — новая заявка */
  request?: RequestDTO | null
  onDone: (request: RequestDTO, result: RequestFormResult) => void
}) {
  const { toast } = useToast()
  const editing = Boolean(request)
  const isDraft = request?.status === 'DRAFT'
  const [form, setForm] = useState<FormState>(() => (request ? formFromRequest(request) : restoreAutosave()))
  const [files, setFiles] = useState<File[]>([])
  const [cargoTypes, setCargoTypes] = useState<CargoTypeDTO[] | null>(cargoCache)
  const [saving, setSaving] = useState<RequestFormResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open || cargoCache) return
    api.directory()
      .then((d) => { cargoCache = d.cargoTypes; setCargoTypes(d.cargoTypes) })
      .catch(() => toast({ title: 'Справочник грузов не загрузился', description: 'Закройте форму и откройте снова', variant: 'destructive' }))
  }, [open, toast])

  // автосохранение новой заявки: каждое изменение формы пишется в localStorage
  // (после успешного сохранения ключ удаляется, а форма закрывается вместе с компонентом)
  useEffect(() => {
    if (!open || editing || saving) return
    try { localStorage.setItem(CREATE_AUTOSAVE_KEY, JSON.stringify(form)) } catch { /* приватный режим */ }
  }, [open, editing, form, saving])

  const rateNum = Number(form.startRate.replace(/\s/g, '').replace(',', '.'))
  const rateOk = form.startRate.trim() !== '' && Number.isFinite(rateNum) && rateNum > 0
  const baseOk = form.cargoTypeId !== '' && form.fromPoint !== '' && form.toPoint !== ''
  const canDraft = baseOk && (form.startRate.trim() === '' || rateOk)
  const canPublish = baseOk && rateOk
  // правка заявки на площадке требует ставку, черновик можно сохранить и без неё
  const canSave = editing && (isDraft ? canDraft : canPublish)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  const pickCargo = (id: string) => {
    const ct = cargoTypes?.find((c) => c.id === id)
    // тип ТС подставляется из справочника грузов — его можно сменить вручную
    setForm((f) => ({ ...f, cargoTypeId: id, truckType: ct?.truckType && TRUCK_TYPES.includes(ct.truckType) ? ct.truckType : f.truckType }))
  }

  const onPickFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return
    const picked = Array.from(list)
    const tooBig = picked.filter((f) => f.size > MAX_FILE_SIZE)
    if (tooBig.length > 0) {
      toast({ title: 'Файлы пропущены', description: `Больше 8 МБ: ${tooBig.map((f) => f.name).join(', ')}`, variant: 'destructive' })
    }
    setFiles((prev) => [...prev, ...picked.filter((f) => f.size <= MAX_FILE_SIZE)].slice(0, MAX_FILES))
  }

  const payload = () => ({
    cargoTypeId: form.cargoTypeId,
    fromPoint: form.fromPoint,
    toPoint: form.toPoint,
    tonnage: Number(form.tonnage) || 20,
    truckType: form.truckType,
    mode: form.mode,
    loadDate: form.loadDate ? isoToRuDate(form.loadDate) : '—',
    loadWindow: form.loadWindow.trim() || '08:00–12:00',
    comment: form.comment.trim(),
  })

  const submit = async (result: RequestFormResult) => {
    setSaving(result)
    try {
      let saved: RequestDTO
      if (request) {
        const { mode, ...rest } = payload()
        saved = (await api.action(request.id, 'edit', {
          ...rest,
          ...(isDraft ? { mode } : {}),
          startRate: rateOk ? rateNum : undefined,
        })).request
      } else {
        saved = (await api.createRequest({
          ...payload(),
          startRate: rateOk ? rateNum : undefined,
          ...(result === 'draft' ? { draft: true } : { deadlineHours: Number(form.deadlineHours) || 4 }),
        })).request
        // вложения загружаются после создания заявки; сбой файла не отменяет заявку
        for (const f of files) {
          try {
            const dataUri = await fileToCompressedDataUri(f)
            await api.uploadDocument(saved.id, { type: 'ATTACHMENT', fileName: f.name, dataUri })
          } catch {
            toast({ title: 'Файл не приложен', description: `${f.name}: заявка сохранена, но файл не загрузился`, variant: 'destructive' })
          }
        }
        try { localStorage.removeItem(CREATE_AUTOSAVE_KEY) } catch { /* ignore */ }
      }
      onOpenChange(false)
      onDone(saved, result)
    } catch (e) {
      toast({ title: 'Заявка не сохранена', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setSaving(null)
    }
  }

  const sectionTitle = (n: number, text: string) => (
    <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700" aria-hidden>{n}</span>
      {text}
    </h4>
  )
  const req = <span className="text-red-500" aria-hidden>*</span>

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {!request ? 'Новая заявка' : isDraft ? `Черновик ${request.number}` : `Редактирование заявки ${request.number}`}
          </DialogTitle>
          <DialogDescription>
            {!request
              ? '«Опубликовать» — заявка сразу выходит на площадку с номером Z-XXXX. «Сохранить в черновики» — заявка остаётся в «Черновиках заявок», перевозчики её не видят.'
              : isDraft
                ? 'Черновик не виден перевозчикам. Опубликовать его можно в «Черновиках заявок».'
                : 'Заявка открыта для ставок — изменения сразу видны перевозчикам.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section aria-label="Груз и маршрут" className="space-y-3">
            {sectionTitle(1, 'Груз и маршрут')}
            <div className="space-y-1.5">
              <Label htmlFor="rf-cargo">Груз — из справочника грузов {req}</Label>
              <Select value={form.cargoTypeId} onValueChange={pickCargo} disabled={!cargoTypes}>
                <SelectTrigger id="rf-cargo" className="w-full">
                  <SelectValue placeholder={cargoTypes ? 'Выберите груз' : 'Загружаем справочник…'} />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {(cargoTypes ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cargoTypes && cargoTypes.length === 0 && (
                <p className="text-xs text-amber-700">Справочник грузов пуст — добавьте груз в «Справочниках»</p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rf-from">Точка А — погрузка {req}</Label>
                <PointSelect id="rf-from" value={form.fromPoint} onChange={(v) => set('fromPoint', v)} ariaLabel="Точка А — погрузка" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rf-to">Точка Б — выгрузка {req}</Label>
                <PointSelect id="rf-to" value={form.toPoint} onChange={(v) => set('toPoint', v)} ariaLabel="Точка Б — выгрузка" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rf-date">Дата погрузки</Label>
                <Input id="rf-date" type="date" value={form.loadDate} onChange={(e) => set('loadDate', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rf-window">Окно погрузки</Label>
                <Input id="rf-window" placeholder="08:00–12:00" value={form.loadWindow} onChange={(e) => set('loadWindow', e.target.value)} />
              </div>
            </div>
          </section>

          <section aria-label="Параметры торгов" className="space-y-3">
            {sectionTitle(2, 'Параметры торгов')}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rf-tonnage">Тоннаж, т</Label>
                <Input id="rf-tonnage" type="number" min={1} max={200} value={form.tonnage} onChange={(e) => set('tonnage', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rf-truck">Тип ТС</Label>
                <Select value={form.truckType} onValueChange={(v) => set('truckType', v)}>
                  <SelectTrigger id="rf-truck" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRUCK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rf-mode">Вид тендера</Label>
                <Select value={form.mode} onValueChange={(v) => set('mode', v as RequestMode)} disabled={editing && !isDraft}>
                  <SelectTrigger id="rf-mode" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUCTION">Торги (аукцион на понижение)</SelectItem>
                    <SelectItem value="CLOSED">Закрытые ставки</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rf-rate">Стартовая ставка, ₽/т {req}</Label>
                <Input id="rf-rate" type="number" min={1} step={100} placeholder="Например, 8400" value={form.startRate} onChange={(e) => set('startRate', e.target.value)} />
              </div>
              {!editing && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="rf-deadline">Приём ставок после публикации</Label>
                  <Select value={form.deadlineHours} onValueChange={(v) => set('deadlineHours', v)}>
                    <SelectTrigger id="rf-deadline" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DEADLINE_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Если за это время ставок не будет, заявка сама уйдёт в «Черновики заявок».
                  </p>
                </div>
              )}
            </div>
          </section>

          <section aria-label="Дополнительно" className="space-y-3">
            {sectionTitle(3, 'Дополнительно')}
            <div className="space-y-1.5">
              <Label htmlFor="rf-comment">Комментарий для исполнителя</Label>
              <Textarea
                id="rf-comment"
                rows={3}
                placeholder="Особые условия погрузки, контакты на месте, требования к машине…"
                value={form.comment}
                onChange={(e) => set('comment', e.target.value)}
              />
            </div>
            {!editing && (
              <div className="space-y-1.5">
                <Label htmlFor="rf-files">Прикреплённые файлы</Label>
                <input
                  ref={fileInputRef}
                  id="rf-files"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => { onPickFiles(e.target.files); e.target.value = '' }}
                />
                <Button type="button" variant="outline" className="gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={files.length >= MAX_FILES}>
                  <Paperclip className="h-4 w-4 text-slate-500" aria-hidden />
                  Прикрепить файлы
                </Button>
                {files.length > 0 && (
                  <ul className="space-y-1.5" aria-label="Выбранные файлы">
                    {files.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                        <span className="min-w-0 flex-1 break-all text-xs font-medium text-slate-700">{f.name}</span>
                        <span className="shrink-0 text-[10px] text-slate-400">{Math.max(1, Math.round(f.size / 1024))} КБ</span>
                        <button
                          type="button"
                          onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                          aria-label={`Убрать файл ${f.name}`}
                          className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">Фото или сканы (JPG, PNG, WebP) до 8 МБ, до {MAX_FILES} файлов — например, схема погрузки.</p>
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          {editing ? (
            <Button onClick={() => void submit('updated')} disabled={!canSave || saving !== null}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => void submit('draft')}
                disabled={!canDraft || saving !== null}
                title={canDraft ? 'Заявка останется в «Черновиках заявок»' : 'Выберите груз и точки А и Б'}
              >
                {saving === 'draft' ? 'Сохраняем…' : 'Сохранить в черновики'}
              </Button>
              <Button
                onClick={() => void submit('published')}
                disabled={!canPublish || saving !== null}
                title={canPublish ? 'Опубликовать заявку на площадке' : 'Выберите груз, точки А и Б и укажите стартовую ставку'}
              >
                {saving === 'published' ? 'Публикуем…' : 'Опубликовать'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
