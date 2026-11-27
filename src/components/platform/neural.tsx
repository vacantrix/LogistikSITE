'use client'

/**
 * Раздел «PaddleOCR» (только администратор) — конструктор распознавания документов.
 *
 * Движок — PaddleOCR на серверах АЭМЗ (показательно развёрнут на отдельном GPU-ПК).
 * Администратор настраивает из интерфейса ВСЁ, как нейросеть работает:
 *
 *   1) «Движок и параметры распознавания» — КАК нейросеть смотрит на документ:
 *      набор моделей детекции (server — точность / mobile — скорость), язык модели
 *      чтения (ru | en | ch), авто-поворот/выравнивание скана, порог уверенности
 *      детекции текста и порог уверенности чтения поля (ниже — значение уходит
 *      «на проверку» человеку, платформа не показывает непроверенное);
 *   2) «Шаблоны документов» — НА ЧТО смотрит нейросеть: какие виды документов
 *      распознаются и какие поля движок ищет в каждом (имя, как искать — вид поля,
 *      необязательность, регулярка-подсказка, пояснение). Шаблоны хранятся в БД
 *      (OcrTemplate/OcrField) и применяются к СЛЕДУЮЩЕМУ документу после сохранения;
 *   3) «Пропуск документов» — пропускная способность: максимум фото в обработке
 *      (общая очередь всех перевозчиков), таймаут, кэш повторных сканов, сжатие фото.
 *
 * Параметры и поля передаются движку с каждым запросом (платформа → шлюз → PaddleOCR),
 * поэтому правки администратора действуют без перезапуска узла.
 *
 * Здесь же — живая статистика контура (шлюз, очередь, кэш), проверка движка
 * и реальный тестовый прогон демо-скана с замером времени.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BrainCircuit, Eraser, FileText, Gauge, Hourglass, ImageDown, Layers, PenLine, Play, Plus,
  RefreshCw, Save, Trash2, Undo2, Waypoints,
} from 'lucide-react'
import {
  ErrorBlock, LoadingBlock, SectionHeader, type TabProps,
} from '@/components/platform/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import type { NnSettingsDTO, NnStatusDTO, NnTestResultDTO, NnUpstreamDTO, OcrFieldDTO, OcrTemplateDTO } from '@/lib/types'

const fmtSec = (v: number) => (v >= 60 ? `${Math.floor(v / 60)} мин ${v % 60 ? `${v % 60} с` : ''}`.trim() : `${v} с`)
const fmtCache = (v: number) => (v === 0 ? 'выключен' : v >= 60 ? `${Math.floor(v / 60)} ч${v % 60 ? ` ${v % 60} мин` : ''}` : `${v} мин`)
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} с` : `${ms} мс`)
const fmtConf = (v: number) => `${Math.round(v * 100)} %`
const fmtUptime = (sec: number) => {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h ? `${h} ч ${m} мин` : m ? `${m} мин` : `${sec} с`
}

const TEST_DOCS = [
  { value: 'PASSPORT_PHOTO', label: 'Паспорт: страница с фото' },
  { value: 'PASSPORT_REG', label: 'Паспорт: регистрация' },
  { value: 'STS', label: 'СТС тягача' },
] as const

const MODEL_SETS = [
  { value: 'server', label: 'Server — точность', hint: 'PP-OCRv5 server: крупная модель, максимум качества' },
  { value: 'mobile', label: 'Mobile — скорость', hint: 'лёгкая модель: быстрее на слабом железе' },
] as const

const LANGS = [
  { value: 'ru', label: 'Русский (ru)', hint: 'eslav-модель чтения — русский и латиница' },
  { value: 'en', label: 'Английский (en)', hint: 'латиница: доверенности на транслите, инвойсы' },
  { value: 'ch', label: 'Китайский (ch)', hint: 'китайские документы' },
] as const

const FIELD_KINDS = [
  { value: 'text', label: 'Текст', hint: 'любая строка' },
  { value: 'fio', label: 'ФИО', hint: 'фамилия/имя/отчество — сверка словарём' },
  { value: 'date', label: 'Дата', hint: 'приводится к ДД.ММ.ГГГГ' },
  { value: 'passport', label: 'Серия и номер', hint: 'цифры с разделителями' },
  { value: 'plate', label: 'Госномер', hint: 'формат автомобильного номера' },
  { value: 'vin', label: 'VIN', hint: '17 знаков идентификации ТС' },
  { value: 'code', label: 'Код', hint: 'числовой код подразделения' },
] as const

/** Один слайдер настройки: подпись + значение + пояснение */
function NnSlider({ id, label, value, min, max, step, display, hint, onChange }: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  hint: string
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-sm font-bold text-slate-900">{display}</span>
      </div>
      <Slider
        id={id}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        aria-label={label}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

const emptyField = (): OcrFieldDTO => ({ label: '', kind: 'text', optional: false, pattern: null, hint: null, order: 0 })

export default function NeuralTab(_: TabProps) {
  const { toast } = useToast()
  const [status, setStatus] = useState<NnStatusDTO | null>(null)
  const [draft, setDraft] = useState<NnSettingsDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [upstream, setUpstream] = useState<NnUpstreamDTO | null>(null)
  const [checking, setChecking] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testDoc, setTestDoc] = useState<string>('PASSPORT_PHOTO')
  const [testResult, setTestResult] = useState<NnTestResultDTO | null>(null)
  const alive = useRef(true)

  // ——— шаблоны документов (конструктор) ———
  const [templates, setTemplates] = useState<OcrTemplateDTO[]>([])
  const [tplError, setTplError] = useState<string | null>(null)
  const [editDocType, setEditDocType] = useState<string | null>(null) // какой шаблон открыт в редакторе
  const [tplDraft, setTplDraft] = useState<OcrTemplateDTO | null>(null) // черновик редактируемого шаблона
  const [tplSaving, setTplSaving] = useState(false)
  const [creating, setCreating] = useState(false) // форма «новый шаблон»
  const [newDocType, setNewDocType] = useState('')
  const [newTitle, setNewTitle] = useState('')

  useEffect(() => () => { alive.current = false }, [])

  const load = useCallback(async () => {
    try {
      const s = await api.nnStatus()
      if (!alive.current) return
      setStatus(s)
      setDraft((cur) => cur ?? s.settings)
      setTemplates(Array.isArray(s.templates) ? s.templates : [])
      setError(null)
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 15_000)
    return () => clearInterval(t)
  }, [load])

  const dirty = draft && status && (
    draft.parallel !== status.settings.parallel ||
    draft.timeoutSec !== status.settings.timeoutSec ||
    draft.cacheMin !== status.settings.cacheMin ||
    draft.maxSide !== status.settings.maxSide ||
    draft.detConf !== status.settings.detConf ||
    draft.recConf !== status.settings.recConf ||
    draft.autoRotate !== status.settings.autoRotate ||
    draft.lang !== status.settings.lang ||
    draft.modelSet !== status.settings.modelSet
  )

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const res = await api.saveNn(draft)
      if (!alive.current) return
      setStatus((s) => (s ? { ...s, settings: res.settings, limits: res.limits } : s))
      setDraft(res.settings)
      toast({
        title: 'Настройки PaddleOCR сохранены',
        description: 'Движок и пропуск применяются к следующему документу — без перезапуска узла',
      })
      void load()
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    if (status) setDraft(status.defaults)
  }

  const checkEngine = async () => {
    setChecking(true)
    try {
      const res = await api.nnAction({ action: 'upstream' })
      if (!alive.current) return
      setUpstream(res)
      void load()
    } catch (e) {
      toast({
        title: 'Проверка не удалась',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      if (alive.current) setChecking(false)
    }
  }

  const clearCache = async () => {
    try {
      await api.nnAction({ action: 'clear-cache' })
      if (!alive.current) return
      toast({ title: 'Кэш сканов очищен', description: 'Все документы снова пойдут через нейросеть' })
      void load()
    } catch {
      toast({ title: 'Не удалось очистить кэш', variant: 'destructive' })
    }
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await api.nnAction({ action: 'test', docType: testDoc, fresh: true })
      if (!alive.current) return
      setTestResult(res)
      void load()
    } catch (e) {
      if (alive.current) {
        setTestResult({ ok: false, ms: 0, docType: testDoc, label: '', error: e instanceof Error ? e.message : 'Ошибка запроса' })
      }
    } finally {
      if (alive.current) setTesting(false)
    }
  }

  // ——— шаблоны: открытие редактора, правка полей, сохранение ———

  const openTemplate = (tpl: OcrTemplateDTO): void => {
    setTplError(null)
    setEditDocType(tpl.docType)
    setTplDraft({ ...tpl, fields: tpl.fields.map((f) => ({ ...f })) })
  }

  const closeTemplate = (): void => {
    setEditDocType(null)
    setTplDraft(null)
    setCreating(false)
    setNewDocType('')
    setNewTitle('')
  }

  const patchTpl = (patch: Partial<OcrTemplateDTO>): void => {
    setTplDraft((t) => (t ? { ...t, ...patch } : t))
  }

  const patchField = (idx: number, patch: Partial<OcrFieldDTO>): void => {
    setTplDraft((t) => (t ? { ...t, fields: t.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)) } : t))
  }

  const addField = (): void => {
    setTplDraft((t) => (t ? { ...t, fields: [...t.fields, { ...emptyField(), order: t.fields.length }] } : t))
  }

  const removeField = (idx: number): void => {
    setTplDraft((t) => (t ? { ...t, fields: t.fields.filter((_, i) => i !== idx) } : t))
  }

  const tplDirty = tplDraft != null && templates.find((t) => t.docType === tplDraft.docType) != null
    ? JSON.stringify(normalizeTpl(tplDraft)) !== JSON.stringify(normalizeTpl(templates.find((t) => t.docType === tplDraft.docType)!))
    : true

  const saveTemplate = async () => {
    if (!tplDraft) return
    setTplSaving(true)
    setTplError(null)
    try {
      const res = await api.saveNnTemplate(normalizeTpl(tplDraft))
      if (!alive.current) return
      const saved = res.template
      setTemplates((list) => {
        const i = list.findIndex((t) => t.docType === saved.docType)
        if (i === -1) return [...list, saved]
        return list.map((t) => (t.docType === saved.docType ? saved : t))
      })
      setTplDraft(saved)
      setCreating(false)
      setNewDocType('')
      setNewTitle('')
      toast({
        title: 'Шаблон сохранён',
        description: `«${saved.title}»: ${saved.fields.length} пол${saved.fields.length % 10 === 1 && saved.fields.length % 100 !== 11 ? 'е' : 'ей'} — движок ищет их в следующем документе`,
      })
      void load()
    } catch (e) {
      setTplError(e instanceof Error ? e.message : 'Не удалось сохранить шаблон')
    } finally {
      setTplSaving(false)
    }
  }

  const deleteTemplate = async (docType: string) => {
    setTplSaving(true)
    try {
      await api.deleteNnTemplate(docType)
      if (!alive.current) return
      setTemplates((list) => list.filter((t) => t.docType !== docType))
      if (editDocType === docType) closeTemplate()
      toast({ title: 'Шаблон удалён', description: `Вид ${docType} больше не распознаётся — документы уйдут на ручную проверку` })
      void load()
    } catch (e) {
      toast({ title: 'Не удалось удалить шаблон', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setTplSaving(false)
    }
  }

  const startCreating = (): void => {
    setTplError(null)
    setCreating(true)
    setEditDocType(null)
    setTplDraft({ docType: '', title: '', enabled: true, order: templates.length, fields: [{ ...emptyField() }] })
  }

  const confirmCreating = (): void => {
    const dt = newDocType.trim().toUpperCase().replace(/\s+/g, '_')
    if (!/^[A-Z][A-Z0-9_]{1,40}$/.test(dt)) {
      setTplError('Код вида: латиница/цифры/подчёркивание, например TRUSTED_LETTER')
      return
    }
    if (templates.some((t) => t.docType === dt)) {
      setTplError(`Шаблон ${dt} уже есть — отредактируйте существующий`)
      return
    }
    if (!newTitle.trim()) {
      setTplError('Задайте название шаблона')
      return
    }
    setTplDraft({ docType: dt, title: newTitle.trim(), enabled: true, order: templates.length, fields: [{ ...emptyField() }] })
    setEditDocType(dt)
    setCreating(false)
    setNewDocType('')
    setNewTitle('')
  }

  if (status === null && !error) return <LoadingBlock label="Загрузка настроек PaddleOCR…" />
  if (error && !status) return <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />

  const lim = status?.limits
  const svc = status?.service

  return (
    <div>
      <SectionHeader
        title="PaddleOCR"
        eyebrow="Администрирование"
        tone="slate"
        desc="Конструктор распознавания документов на серверах АЭМЗ: как нейросеть работает (параметры движка), на что смотрит (шаблоны полей) и сколько успевает (пропуск). Права нейросети ИИ-помощника — в разделе «Облачная LLM»."
      />

      {/* ——— 1. Движок и параметры распознавания (как нейросеть смотрит на документ) ——— */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-slate-900">
            <BrainCircuit className="h-5 w-5 text-emerald-600" aria-hidden />
            Движок и параметры распознавания
          </CardTitle>
          <CardDescription>
            Как нейросеть читает документ: модели, язык, выравнивание и пороги уверенности.
            Параметры передаются движку с каждым запросом — сохранённые значения
            применяются к следующему документу без перезапуска узла
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {draft && lim && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="nn-modelset">Модель детекции</Label>
                  <Select value={draft.modelSet} onValueChange={(v) => setDraft((d) => (d ? { ...d, modelSet: v } : d))}>
                    <SelectTrigger id="nn-modelset" className="h-9" aria-label="Модель детекции">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODEL_SETS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          <span className="flex flex-col items-start gap-0.5">
                            <span className="text-sm font-medium">{m.label}</span>
                            <span className="text-xs text-slate-500">{m.hint}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Слой, который находит текст на фото. Server — максимум точности, mobile — быстрее на слабом железе
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nn-lang">Язык модели чтения</Label>
                  <Select value={draft.lang} onValueChange={(v) => setDraft((d) => (d ? { ...d, lang: v } : d))}>
                    <SelectTrigger id="nn-lang" className="h-9" aria-label="Язык модели чтения">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGS.map((l) => (
                        <SelectItem key={l.value} value={l.value}>
                          <span className="flex flex-col items-start gap-0.5">
                            <span className="text-sm font-medium">{l.label}</span>
                            <span className="text-xs text-slate-500">{l.hint}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Какой recognition-моделью читать найденный текст — русский паспорт или доверенность на транслите
                  </p>
                </div>
              </div>

              <NnSlider
                id="nn-detconf"
                label="Порог детекции текста"
                value={draft.detConf}
                min={lim.detConf.min}
                max={lim.detConf.max}
                step={0.05}
                display={fmtConf(draft.detConf)}
                hint="Насколько уверенно фрагмент должен выглядеть как текст, чтобы нейросеть вообще пыталась его читать. Ниже порог — больше мусорных «прочтений», выше — часть мелкого текста теряется"
                onChange={(v) => setDraft((d) => (d ? { ...d, detConf: v } : d))}
              />

              <NnSlider
                id="nn-recconf"
                label="Порог чтения поля"
                value={draft.recConf}
                min={lim.recConf.min}
                max={lim.recConf.max}
                step={0.01}
                display={fmtConf(draft.recConf)}
                hint="Уверенность, ниже которой значение не показывается человеку автоматически: поле уходит «на проверку». Ниже порог — больше автоматических полей, выше — больше ручной работы"
                onChange={(v) => setDraft((d) => (d ? { ...d, recConf: v } : d))}
              />

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="nn-autorotate" className="flex items-center gap-2">
                    <Undo2 className="h-4 w-4 text-slate-500" aria-hidden />
                    Авто-поворот и выравнивание
                  </Label>
                  <Switch
                    id="nn-autorotate"
                    checked={draft.autoRotate}
                    onCheckedChange={(on) => setDraft((d) => (d ? { ...d, autoRotate: on } : d))}
                    aria-label="Авто-поворот и выравнивание документа"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Документ, снятый с поворотом или под углом, выравнивается перед распознаванием —
                  иначе строки читаются хуже. Выключайте только для идеально ровных сканов ради скорости
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                <Button onClick={() => void save()} disabled={saving}>
                  <Save className="h-4 w-4" aria-hidden />
                  {saving ? 'Сохранение…' : 'Сохранить параметры'}
                </Button>
                {dirty && <span className="text-xs text-amber-600">Есть несохранённые изменения</span>}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ——— 2. Шаблоны документов (на что смотрит нейросеть) ——— */}
      <Card className="mt-6 border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-slate-900">
            <FileText className="h-5 w-5 text-emerald-600" aria-hidden />
            Шаблоны документов
          </CardTitle>
          <CardDescription>
            Какие поля движок ищет в каждом виде документа. Поля и правила задаются здесь —
            очередь распознавания берёт шаблон из базы перед каждым документом, правки
            применяются к следующему скану. Отключённый или удалённый шаблон — вид документа
            больше не распознаётся, сканы уходят на ручную проверку
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {tplError && <ErrorBlock message={tplError} onRetry={() => setTplError(null)} />}

          {/* список шаблонов */}
          <div className="space-y-2">
            {templates.map((t) => {
              const opened = editDocType === t.docType
              return (
                <div key={t.docType} className={`rounded-xl border ${opened ? 'border-emerald-300' : 'border-slate-200'} bg-white`}>
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                    <span className="font-mono text-[11px] text-slate-400">{t.docType}</span>
                    <span className="text-sm font-semibold text-slate-900">{t.title}</span>
                    <Badge variant="outline" className="border-slate-300 text-slate-500">
                      {t.fields.length} полей
                    </Badge>
                    {!t.enabled && (
                      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">отключён</Badge>
                    )}
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      <Switch
                        checked={t.enabled}
                        onCheckedChange={(on) => opened ? patchTpl({ enabled: on }) : void api.saveNnTemplate({ ...t, enabled: on }).then(() => { void load() }).catch(() => toast({ title: 'Не удалось переключить шаблон', variant: 'destructive' }))}
                        aria-label={`Шаблон «${t.title}» ${t.enabled ? 'включён' : 'отключён'}`}
                      />
                      <Button variant={opened ? 'default' : 'outline'} size="sm" className="h-8" onClick={() => (opened ? closeTemplate() : openTemplate(t))}>
                        <PenLine className="mr-1 h-3.5 w-3.5" aria-hidden />
                        {opened ? 'Закрыть' : 'Редактировать'}
                      </Button>
                    </span>
                  </div>

                  {/* редактор шаблона */}
                  {opened && tplDraft && (
                    <div className="space-y-4 border-t border-slate-100 px-3 py-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <div className="space-y-1.5">
                          <Label htmlFor={`tpl-title-${t.docType}`}>Название шаблона</Label>
                          <Input
                            id={`tpl-title-${t.docType}`}
                            value={tplDraft.title}
                            onChange={(e) => patchTpl({ title: e.target.value })}
                            placeholder="Паспорт: страница с фото"
                          />
                        </div>
                        <div className="flex items-end gap-2">
                          <Badge variant="outline" className="h-9 border-slate-300 font-mono text-[11px] text-slate-500">
                            вид: {tplDraft.docType}
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-9 gap-1 text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => void deleteTemplate(tplDraft.docType)}
                            disabled={tplSaving}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            Удалить шаблон
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-baseline justify-between">
                          <Label>Поля документа</Label>
                          <span className="text-xs text-muted-foreground">движок ищет поля в порядке списка</span>
                        </div>
                        {tplDraft.fields.length === 0 && (
                          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            Шаблон без полей — сохраните хотя бы одно поле, иначе вид документа не будет распознаваться
                          </p>
                        )}
                        <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                          {tplDraft.fields.map((f, i) => (
                            <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 md:grid-cols-[minmax(9rem,1.4fr)_minmax(7rem,1fr)_auto]">
                              <div className="space-y-1">
                                <Label htmlFor={`f-label-${i}`} className="text-[11px] text-slate-500">Имя поля в документе</Label>
                                <Input
                                  id={`f-label-${i}`}
                                  value={f.label}
                                  onChange={(e) => patchField(i, { label: e.target.value })}
                                  placeholder="Фамилия"
                                  className="h-8 bg-white"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor={`f-kind-${i}`} className="text-[11px] text-slate-500">Как искать</Label>
                                <Select value={f.kind} onValueChange={(v) => patchField(i, { kind: v })}>
                                  <SelectTrigger id={`f-kind-${i}`} className="h-8 bg-white" aria-label={`Тип поля ${f.label || i}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {FIELD_KINDS.map((k) => (
                                      <SelectItem key={k.value} value={k.value} className="text-xs">
                                        {k.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-end justify-between gap-2 md:justify-start">
                                <label className="flex cursor-pointer items-center gap-1.5 pb-1 text-xs text-slate-600">
                                  <Switch
                                    checked={f.optional}
                                    onCheckedChange={(on) => patchField(i, { optional: on })}
                                    aria-label={`Поле «${f.label}» необязательное`}
                                  />
                                  необязательное
                                </label>
                                <button
                                  type="button"
                                  onClick={() => removeField(i)}
                                  className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                  aria-label={`Удалить поле ${f.label || i + 1}`}
                                  title="Удалить поле"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              </div>
                              <div className="space-y-1 md:col-span-2">
                                <Label htmlFor={`f-pattern-${i}`} className="text-[11px] text-slate-500">Регулярка извлечения (необязательно)</Label>
                                <Input
                                  id={`f-pattern-${i}`}
                                  value={f.pattern ?? ''}
                                  onChange={(e) => patchField(i, { pattern: e.target.value })}
                                  placeholder="например: \\d{2}\\.\\d{2}\\.\\d{4}"
                                  className="h-8 bg-white font-mono text-xs"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor={`f-hint-${i}`} className="text-[11px] text-slate-500">Подсказка движку</Label>
                                <Input
                                  id={`f-hint-${i}`}
                                  value={f.hint ?? ''}
                                  onChange={(e) => patchField(i, { hint: e.target.value })}
                                  placeholder="например: искать под словом «Фамилия»"
                                  className="h-8 bg-white text-xs"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                        <Button variant="outline" size="sm" className="h-8 gap-1" onClick={addField}>
                          <Plus className="h-3.5 w-3.5" aria-hidden />
                          Добавить поле
                        </Button>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
                        <Button onClick={() => void saveTemplate()} disabled={tplSaving}>
                          <Save className="h-4 w-4" aria-hidden />
                          {tplSaving ? 'Сохранение…' : 'Сохранить шаблон'}
                        </Button>
                        {tplDirty && <span className="text-xs text-amber-600">Черновик не сохранён</span>}
                        <span className="text-xs text-muted-foreground">
                          {tplDraft.enabled ? 'движок ищет эти поля в следующем документе' : 'шаблон отключён — вид не распознаётся'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* новый шаблон */}
          {!creating && (
            <Button variant="outline" className="gap-1.5" onClick={startCreating}>
              <Plus className="h-4 w-4" aria-hidden />
              Новый вид документа
            </Button>
          )}
          {creating && (
            <div className="space-y-3 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/40 px-3 py-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(9rem,1fr)_minmax(12rem,1.4fr)_auto]">
                <div className="space-y-1">
                  <Label htmlFor="new-doctype">Код вида (латиница)</Label>
                  <Input id="new-doctype" value={newDocType} onChange={(e) => setNewDocType(e.target.value)} placeholder="TRUSTED_LETTER" className="h-9 font-mono text-xs" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-title">Название</Label>
                  <Input id="new-title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Доверенное письмо" className="h-9" />
                </div>
                <div className="flex items-end gap-2">
                  <Button size="sm" className="h-9" onClick={confirmCreating}>К полям</Button>
                  <Button variant="outline" size="sm" className="h-9" onClick={closeTemplate}>Отмена</Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Код вида — как платформа и движок зовут этот документ; поля задаёте на следующем шаге
              </p>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Слой сверки распознанных значений с заявкой (что считается совпадением) — настройки верификации:
            пороги уверенности приёмки и правила. Шаблоны здесь отвечают за распознавание — «на что смотрит и как смотрит нейросеть».
          </p>
        </CardContent>
      </Card>

      {/* ——— 3. Пропуск документов ——— */}
      <Card className="mt-6 border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-slate-900">
            <Gauge className="h-5 w-5 text-emerald-600" aria-hidden />
            Пропуск документов
          </CardTitle>
          <CardDescription>
            Скорость и надёжность распознавания PaddleOCR на серверах АЭМЗ. Несколько перевозчиков могут подавать
            документы одновременно — все фото встают в общую очередь, машина берёт в работу не больше
            «максимума фото в обработке», остальные ждут. Изменения применяются сразу после сохранения — без перезапуска
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {draft && lim && (
            <>
              <NnSlider
                id="nn-parallel"
                label="Максимум фото в обработке"
                value={draft.parallel}
                min={lim.parallel.min}
                max={lim.parallel.max}
                step={1}
                display={`${draft.parallel} фото`}
                hint="Сколько фотографий машина PaddleOCR обрабатывает одновременно — подбирается под объём VRAM видеокарты. Остальные фото автоматически ждут в общей очереди: неважно, сколько перевозчиков загрузили единовременно."
                onChange={(v) => setDraft((d) => (d ? { ...d, parallel: v } : d))}
              />

              <NnSlider
                id="nn-timeout"
                label="Таймаут одного документа"
                value={draft.timeoutSec}
                min={lim.timeoutSec.min}
                max={lim.timeoutSec.max}
                step={10}
                display={fmtSec(draft.timeoutSec)}
                hint="Сколько ждать PaddleOCR по одному документу. Если узел распознавания недоступен или завис — документ раньше выйдет из ожидания и вернётся «на проверку»."
                onChange={(v) => setDraft((d) => (d ? { ...d, timeoutSec: v } : d))}
              />

              <NnSlider
                id="nn-cache"
                label="Кэш повторных сканов"
                value={draft.cacheMin}
                min={lim.cacheMin.min}
                max={lim.cacheMin.max}
                step={5}
                display={fmtCache(draft.cacheMin)}
                hint="Тот же файл (по содержимому) за это время распознаётся мгновенно, без повторного прогона PaddleOCR. 0 — кэш выключен."
                onChange={(v) => setDraft((d) => (d ? { ...d, cacheMin: v } : d))}
              />

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="nn-shrink" className="flex items-center gap-2">
                    <ImageDown className="h-4 w-4 text-slate-500" aria-hidden />
                    Сжимать фото перед отправкой
                  </Label>
                  <Switch
                    id="nn-shrink"
                    checked={draft.maxSide > 0}
                    onCheckedChange={(on) => setDraft((d) => (d ? { ...d, maxSide: on ? 1600 : 0 } : d))}
                    aria-label="Сжатие фото перед отправкой в нейросеть"
                  />
                </div>
                {draft.maxSide > 0 ? (
                  <NnSlider
                    id="nn-maxside"
                    label="Длинная сторона фото"
                    value={draft.maxSide}
                    min={lim.maxSide.min}
                    max={lim.maxSide.max}
                    step={100}
                    display={`${draft.maxSide} px`}
                    hint="Фото уменьшается до этого размера перед отправкой в PaddleOCR: меньше мегабайт и пикселей — быстрее распознавание. Слишком маленькое значение снижает читаемость мелкого текста."
                    onChange={(v) => setDraft((d) => (d ? { ...d, maxSide: v } : d))}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Выключено — фото уходят в исходном размере (максимальная точность, медленнее).
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                <Button onClick={() => void save()} disabled={saving}>
                  <Save className="h-4 w-4" aria-hidden />
                  {saving ? 'Сохранение…' : 'Сохранить'}
                </Button>
                <Button variant="outline" onClick={reset} disabled={!dirty}>
                  <Undo2 className="h-4 w-4" aria-hidden />
                  По умолчанию
                </Button>
                {dirty && <span className="text-xs text-amber-600">Есть несохранённые изменения</span>}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ——— 4. Живой статус контура ——— */}
      <Card className="mt-6 border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-slate-900">
            <Waypoints className="h-5 w-5 text-emerald-600" aria-hidden />
            Живой статус
          </CardTitle>
          <CardDescription>Обновляется каждые 15 секунд; проверка движка — по кнопке</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <StatChip
              Icon={BrainCircuit}
              label="PaddleOCR"
              value={svc?.running ? 'работает' : 'недоступна'}
              tone={svc?.running ? 'ok' : 'bad'}
            />
            <StatChip Icon={Layers} label="Очередь" value={`${status?.queue.active ?? 0} в работе · ${status?.queue.waiting ?? 0} ждут`} />
            <StatChip Icon={Gauge} label="Распознано" value={String(svc?.processed ?? 0)} />
            <StatChip Icon={Hourglass} label="Время работы" value={svc?.uptimeSec != null ? fmtUptime(svc.uptimeSec) : '—'} />
            <StatChip Icon={ImageDown} label="Кэш сканов" value={`${status?.cache.size ?? 0} · ${status?.cache.hits ?? 0} попаданий`} />
            <StatChip Icon={RefreshCw} label="Сэкономлено" value={fmtMs(status?.cache.savedMs ?? 0)} />
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <Button variant="outline" className="gap-1.5" onClick={() => void checkEngine()} disabled={checking}>
              {checking ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <BrainCircuit className="h-4 w-4" aria-hidden />}
              Проверить PaddleOCR
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => void clearCache()}>
              <Eraser className="h-4 w-4" aria-hidden />
              Очистить кэш сканов
            </Button>
            {upstream && (
              <span className={`text-xs ${upstream.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                {upstream.ok
                  ? `Движок отвечает: ${upstream.engine ?? 'PaddleOCR'}${upstream.version ? ` · ${upstream.version}` : ''}${upstream.gpu ? ` · ${upstream.gpu}` : ''} · ${upstream.ms} мс`
                  : `Движок не ответил: ${upstream.error ?? 'нет связи'} (${upstream.ms} мс)`}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ——— 5. Тестовый прогон ——— */}
      <Card className="mt-6 border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-slate-900">
            <Play className="h-5 w-5 text-emerald-600" aria-hidden />
            Тестовый прогон
          </CardTitle>
          <CardDescription>
            Реальный путь демо-скана: платформа → шлюз → PaddleOCR на серверах АЭМЗ. Замер — с учётом текущих
            параметров движка и полей шаблона
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={testDoc} onValueChange={setTestDoc}>
              <SelectTrigger className="h-9 w-full sm:w-64" aria-label="Вид документа для теста">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEST_DOCS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => void runTest()} disabled={testing}>
              {testing ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
              {testing ? 'PaddleOCR распознаёт…' : 'Запустить распознавание'}
            </Button>
          </div>

          {testResult && (
            <div
              role="status"
              className={`rounded-lg border p-3 text-sm ${testResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-800'}`}
            >
              {testResult.ok ? (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-emerald-300 bg-white text-emerald-800">{testResult.label}</Badge>
                    <Badge variant="outline" className="border-slate-300 bg-white font-mono text-slate-700">{fmtMs(testResult.ms)}</Badge>
                  </div>
                  <p>
                    Качество фото {testResult.quality} · распознано полей {testResult.fieldsCount} из {testResult.fieldsTotal}
                    {testResult.detectedType ? ` · вид: ${testResult.detectedType}` : ''}
                  </p>
                  <p className="text-xs text-emerald-700">Движок: {testResult.engine}</p>
                </div>
              ) : (
                <p>{testResult.error} · прошло {fmtMs(testResult.ms)}</p>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Тест идёт с пустым кэшем (fresh) — время честное. Повторная проверка того же файла в рабочих заявках возьмёт результат из кэша.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function normalizeTpl(t: OcrTemplateDTO): OcrTemplateDTO {
  return {
    docType: t.docType,
    title: t.title,
    enabled: t.enabled,
    order: t.order ?? 0,
    fields: t.fields.map((f, i) => ({
      label: f.label,
      kind: f.kind,
      optional: Boolean(f.optional),
      pattern: f.pattern != null && String(f.pattern).trim() !== '' ? String(f.pattern).trim() : null,
      hint: f.hint != null && String(f.hint).trim() !== '' ? String(f.hint).trim() : null,
      order: i,
    })),
  }
}

function StatChip({ Icon, label, value, tone }: {
  Icon: typeof Gauge
  label: string
  value: string
  tone?: 'ok' | 'bad'
}) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
        <Icon className={`h-3.5 w-3.5 ${tone === 'ok' ? 'text-emerald-500' : tone === 'bad' ? 'text-red-500' : 'text-slate-400'}`} aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-0.5 truncate text-sm font-bold ${tone === 'ok' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-600' : 'text-slate-900'}`}>
        {value}
      </div>
    </div>
  )
}
