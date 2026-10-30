'use client'

/**
 * Раздел «Нейросеть» (только администратор) — настройки пропуска документов.
 *
 * Фото и файлы хранятся на серверах АЭМЗ; распознавание работает на серверах АЭМЗ
 * (сейчас показательно развёрнуто на отдельном GPU-ПК — временный стенд, подбор по
 * объёму VRAM). Значения хранятся в БД и применяются сразу после сохранения (очередь
 * распознавания перечитывает их перед каждым документом): максимум фото в обработке,
 * таймаут, кэш повторных сканов и сжатие фото перед отправкой в нейросеть.
 *
 * Многопользовательский сценарий: несколько перевозчиков могут подавать документы
 * одновременно — все фото встают в общую очередь; машина берёт в работу не больше
 * «максимума фото в обработке», остальные честно ждут своего хода.
 *
 * Здесь же — живая статистика контура (шлюз, очередь, кэш), проверка нейросети
 * и реальный тестовый прогон демо-скана с замером времени.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { BrainCircuit, Eraser, Gauge, Hourglass, ImageDown, Layers, Play, RefreshCw, Save, Undo2, Waypoints } from 'lucide-react'
import {
  ErrorBlock, LoadingBlock, SectionHeader, type TabProps,
} from '@/components/platform/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import type { NnSettingsDTO, NnStatusDTO, NnTestResultDTO, NnUpstreamDTO } from '@/lib/types'

const fmtSec = (v: number) => (v >= 60 ? `${Math.floor(v / 60)} мин ${v % 60 ? `${v % 60} с` : ''}`.trim() : `${v} с`)
const fmtCache = (v: number) => (v === 0 ? 'выключен' : v >= 60 ? `${Math.floor(v / 60)} ч${v % 60 ? ` ${v % 60} мин` : ''}` : `${v} мин`)
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} с` : `${ms} мс`)
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

  useEffect(() => () => { alive.current = false }, [])

  const load = useCallback(async () => {
    try {
      const s = await api.nnStatus()
      if (!alive.current) return
      setStatus(s)
      setDraft((cur) => cur ?? s.settings)
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
    draft.maxSide !== status.settings.maxSide
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
        title: 'Настройки нейросети сохранены',
        description: 'Применены сразу — очередь распознавания уже работает с новыми значениями',
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

  if (status === null && !error) return <LoadingBlock label="Загрузка настроек нейросети…" />
  if (error && !status) return <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />

  const lim = status?.limits
  const svc = status?.service

  return (
    <div>
      <SectionHeader title="Нейросеть" />

      {/* ——— 1. Пропуск документов ——— */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-slate-900">
            <Gauge className="h-5 w-5 text-emerald-600" aria-hidden />
            Пропуск документов
          </CardTitle>
          <CardDescription>
            Скорость и надёжность распознавания нейросети на серверах АЭМЗ. Несколько перевозчиков могут подавать
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
                hint="Сколько фотографий машина нейросети обрабатывает одновременно — подбирается под объём VRAM видеокарты. Остальные фото автоматически ждут в общей очереди: неважно, сколько перевозчиков загрузили единовременно."
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
                hint="Сколько ждать нейросеть по одному документу. Если узел нейросети недоступен или завис — документ раньше выйдет из ожидания и вернётся «на проверку»."
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
                hint="Тот же файл (по содержимому) за это время распознаётся мгновенно, без повторного прогона нейросети. 0 — кэш выключен."
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
                    hint="Фото уменьшается до этого размера перед отправкой в нейросеть: меньше мегабайт и пикселей — быстрее распознавание. Слишком маленькое значение снижает читаемость мелкого текста."
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

      {/* ——— 2. Живой статус контура ——— */}
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
              label="Нейросеть"
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
              Проверить нейросеть
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

      {/* ——— 3. Тестовый прогон ——— */}
      <Card className="mt-6 border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-slate-900">
            <Play className="h-5 w-5 text-emerald-600" aria-hidden />
            Тестовый прогон
          </CardTitle>
          <CardDescription>
            Реальный путь демо-скана: платформа → шлюз → нейросеть на серверах АЭМЗ. Замер — с учётом текущих настроек
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
              {testing ? 'Нейросеть распознаёт…' : 'Запустить распознавание'}
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
