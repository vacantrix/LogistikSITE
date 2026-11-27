'use client'

/**
 * Раздел «Облачная LLM» (только администратор) — права нейросети ИИ-помощника.
 *
 * ИИ-помощник логистов отвечает на облаке: движок — GigaChat (Сбер), ключи в .env.local.
 * Этот раздел вынесен в «Управление» рядом с PaddleOCR (локальное распознавание
 * документов на серверах АЭМЗ) — так обе нейросети платформы настраиваются в одном
 * служебном меню. Здесь:
 *   1) состояние облачного движка: настроены ли ключи, модель, область доступа;
 *   2) матрица прав нейросети ИИ-помощника — те же режимы, что в разделе «Права»
 *      чата: правка действует сразу для следующих вопросов (промпт и контекст
 *      собираются по новой матрице), смена фиксируется в журнале нейросети.
 *
 * Права «Заявки, рейсы, ЭДО, 1С» и «Персональные данные» зашиты в платформу
 * и не редактируются (безопасность). Доступ к самому ИИ-помощнику выдаётся
 * правом «ИИ-помощник» в «Профилях и доступах» — контур логистов.
 */
import { useCallback, useEffect, useState } from 'react'
import { Ban, CloudCog, Eye, KeyRound, Lock, PenLine, RefreshCw, ShieldCheck } from 'lucide-react'
import {
  ErrorBlock, LoadingBlock, NoticeLine, SectionHeader, StatusDot, type TabProps,
} from '@/components/platform/common'
import { aiFetch } from '@/components/platform/ai-shared'
import { AI_RIGHT_MODE_LABELS, type AiRight, type AiRightMode } from '@/lib/ai/rights'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'

const RIGHT_ICON: Record<AiRightMode, typeof Ban> = {
  write: PenLine, 'read-partial': Eye, denied: Ban,
}
const RIGHT_BADGE: Record<AiRightMode, string> = {
  write: 'bg-emerald-100 text-emerald-800',
  'read-partial': 'bg-amber-100 text-amber-800',
  denied: 'bg-red-100 text-red-800',
}

/** Состояние облачного движка из /api/ai/rights (gigachatConnectionInfo) */
interface EngineInfo {
  configured: boolean
  model: string
  scope: string
}

export default function CloudLlmTab(_: TabProps) {
  const { toast } = useToast()
  const [rights, setRights] = useState<AiRight[] | null>(null)
  const [lockedRights, setLockedRights] = useState<string[]>([])
  const [engine, setEngine] = useState<EngineInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await aiFetch('/api/ai/rights')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setRights(json.rights as AiRight[])
      setLockedRights(Array.isArray(json.locked) ? (json.locked as string[]) : [])
      setEngine(json.engine ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRights(null)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const changeRight = useCallback(async (right: AiRight, mode: AiRightMode) => {
    setSavingKey(right.key)
    try {
      const res = await aiFetch('/api/ai/rights', { method: 'PUT', body: JSON.stringify({ key: right.key, mode }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setRights(json.rights as AiRight[])
      toast({
        title: 'Право обновлено',
        description: `«${right.title}» → ${AI_RIGHT_MODE_LABELS[mode]}. Матрица действует для следующих вопросов.`,
      })
    } catch (e) {
      toast({ title: 'Право не сохранено', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setSavingKey(null)
    }
  }, [toast])

  return (
    <div>
      <SectionHeader
        title="Облачная LLM"
        eyebrow="Администрирование"
        tone="slate"
        desc="Права нейросети ИИ-помощника и состояние облачного движка GigaChat (Сбер). Локальное распознавание документов — в разделе «PaddleOCR»."
      >
        <Button variant="outline" className="h-9" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Обновить
        </Button>
      </SectionHeader>

      {error && !rights && <ErrorBlock message={error} onRetry={() => void load()} />}

      {/* ——— 1. Движок ——— */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-slate-900">
            <CloudCog className="h-5 w-5 text-emerald-600" aria-hidden />
            Облачный движок
          </CardTitle>
          <CardDescription>
            ИИ-помощник логистов работает в облаке — единственный движок GigaChat (Сбер),
            без скрытых переключений: сбой движка показывается человеку честной ошибкой
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                <CloudCog className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                <span className="truncate">Движок</span>
              </div>
              <div className="mt-0.5 truncate text-sm font-bold text-slate-900">GigaChat (Сбер)</div>
            </div>
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                <span className="truncate">Область доступа</span>
              </div>
              <div className="mt-0.5 truncate text-sm font-bold text-slate-900 font-mono text-[13px]">{engine?.scope ?? '—'}</div>
            </div>
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                <Eye className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                <span className="truncate">Модель по умолчанию</span>
              </div>
              <div className="mt-0.5 truncate text-sm font-bold text-slate-900 font-mono text-[13px]">{engine?.model ?? '—'}</div>
            </div>
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                <KeyRound className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                <span className="truncate">Ключи GIGACHAT</span>
              </div>
              <div className="mt-1">
                <StatusDot dot={engine?.configured ? 'bg-emerald-500' : 'bg-red-500'}>
                  {engine == null ? '—' : engine.configured ? 'настроены' : 'не заполнены'}
                </StatusDot>
              </div>
            </div>
          </div>

          {engine && !engine.configured && (
            <NoticeLine tone="warning">
              Ключи GigaChat не заполнены: задайте GIGACHAT_CLIENT_ID и GIGACHAT_CLIENT_SECRET в .env.local —
              без них ИИ-помощник отвечает ошибкой (резервный движок отключён и не подменяет облако молча).
            </NoticeLine>
          )}
          <p className="text-xs text-muted-foreground">
            Уровень модели для конкретного вопроса логист выбирает в чате рядом с кнопкой отправки;
            здесь показан уровень по умолчанию (GIGACHAT_MODEL).
          </p>
        </CardContent>
      </Card>

      {/* ——— 2. Права нейросети ИИ-помощника ——— */}
      <Card className="mt-6 border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-slate-900">
            <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden />
            Права нейросети ИИ-помощника
          </CardTitle>
          <CardDescription>
            Режимы применяются к следующим вопросам сразу — сервер собирает промпт и контекст
            по действующей матрице. Права «Заявки, рейсы, ЭДО, 1С» и «Персональные данные»
            зашиты в платформу и не редактируются
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {rights === null && !error && <LoadingBlock label="Загружаем матрицу прав…" />}
          {rights !== null && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {rights.map((r) => {
                const Icon = RIGHT_ICON[r.mode]
                const locked = lockedRights.includes(r.key)
                return (
                  <Card key={r.key} className="border-slate-200 shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Icon
                          className={`h-4 w-4 shrink-0 ${r.mode === 'denied' ? 'text-red-500' : r.mode === 'read-partial' ? 'text-amber-600' : 'text-emerald-600'}`}
                          aria-hidden
                        />
                        <span className="text-sm font-semibold text-slate-900">{r.title}</span>
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                          {locked && (
                            <Badge variant="outline" className="gap-1 border-slate-300 text-slate-500">
                              <Lock className="h-3 w-3" aria-hidden />
                              зашито
                            </Badge>
                          )}
                          {!locked ? (
                            <Select
                              value={r.mode}
                              onValueChange={(v) => void changeRight(r, v as AiRightMode)}
                              disabled={savingKey === r.key}
                            >
                              <SelectTrigger className="h-8 w-[210px] text-xs" aria-label={`Режим права «${r.title}»`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(['write', 'read-partial', 'denied'] as AiRightMode[]).map((mode) => (
                                  <SelectItem key={mode} value={mode} className="text-xs">
                                    {AI_RIGHT_MODE_LABELS[mode]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge className={`border-0 ${RIGHT_BADGE[r.mode]}`}>{AI_RIGHT_MODE_LABELS[r.mode]}</Badge>
                          )}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-slate-600">{r.detail}</p>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ——— 3. Кто пользуется ИИ-помощником ——— */}
      <Card className="mt-6 border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-slate-900">
            <Eye className="h-5 w-5 text-emerald-600" aria-hidden />
            Кто пользуется
          </CardTitle>
          <CardDescription>Доступ к ИИ-помощнику выдаётся правом «ИИ-помощник» в «Профилях и доступах»</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <div className="text-[11px] font-medium text-slate-500">Логист АЭМЗ</div>
              <div className="mt-1 text-sm text-slate-700">
                Право «ИИ-помощник» — в должностях контура; вкладка «ИИ-помощник» и «Избранное»
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <div className="text-[11px] font-medium text-slate-500">Администрация</div>
              <div className="mt-1 text-sm text-slate-700">
                Весь набор прав по должности «Администратор»; матрица прав нейросети правится здесь
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <div className="text-[11px] font-medium text-slate-500">Перевозчики</div>
              <div className="mt-1 text-sm text-slate-700">
                Доступа к ИИ-помощнику нет: право существует только во внутреннем контуре
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Кому из логистов выдана вкладка — смотрите «Профили и доступы» → «Кто имеет право».
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
