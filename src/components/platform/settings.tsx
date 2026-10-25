'use client'

/** «Настройки» — пороги уверенности и правила проверки (администратор) */
import { useCallback, useEffect, useState } from 'react'
import { History, Save, Server, ShieldCheck, UserCog } from 'lucide-react'
import {
  ErrorBlock, LoadingBlock, SectionHeader, type TabProps,
} from '@/components/platform/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import type { SettingsDTO } from '@/lib/types'

/** человекочитаемые названия правил проверки */
const RULE_LABELS: Record<string, string> = {
  passport: 'Паспорт РФ',
  plate: 'Госномер',
  vin: 'VIN',
  fio: 'ФИО и дата рождения',
  stsOwner: 'Собственник по СТС',
}

const fmtConf = (v: number): string => String(parseFloat(v.toFixed(3)))

interface Draft {
  minQuality: number
  confReupload: number
  confReject: number
  confAuto: number
}

const toDraft = (s: SettingsDTO): Draft => ({
  minQuality: s.minQuality, confReupload: s.confReupload, confReject: s.confReject, confAuto: s.confAuto,
})

export default function SettingsTab({ activeCarrierId: _activeCarrierId, onNavigate: _onNavigate }: TabProps) {
  const { toast } = useToast()
  const [settings, setSettings] = useState<SettingsDTO | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const s = await api.settings()
      setSettings(s)
      setDraft(toDraft(s))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const saved = await api.saveSettings({
        minQuality: draft.minQuality,
        confReupload: draft.confReupload,
        confReject: draft.confReject,
        confAuto: draft.confAuto,
      })
      setSettings(saved)
      setDraft(toDraft(saved))
      toast({
        title: 'Настройки сохранены',
        description: 'Пороги применены к проверке документов — без участия программиста',
      })
    } catch (e) {
      toast({
        title: 'Не удалось сохранить настройки',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (settings === null && !error) return <LoadingBlock label="Загрузка настроек…" />
  if (error && !settings) return <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />

  const rules = settings?.rules ?? {}
  const a = draft ? draft.confReupload * 100 : 0
  const b = draft ? (draft.confAuto - draft.confReupload) * 100 : 0
  const c = draft ? (1 - draft.confAuto) * 100 : 0
  const dirty = draft && settings && (
    draft.minQuality !== settings.minQuality ||
    draft.confReupload !== settings.confReupload ||
    draft.confReject !== settings.confReject ||
    draft.confAuto !== settings.confAuto
  )

  return (
    <div>
      <SectionHeader title="Настройки" />

      {error && settings && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Не удалось обновить данные: {error}. Показаны последние загруженные значения.
        </div>
      )}

      {/* 1. Пороги уверенности */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-slate-900">Пороги уверенности</CardTitle>
          <CardDescription>
            Нейросеть даёт оценку уверенности по каждому полю — пороги решают, что принять автоматически,
            что проверить подтвердениями, а что вернуть агенту
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {draft && (
            <>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Label htmlFor="slider-quality">Качество изображения, от</Label>
                  <span className="text-sm font-bold text-slate-900">{draft.minQuality}</span>
                </div>
                <Slider
                  id="slider-quality"
                  value={[draft.minQuality]}
                  min={10}
                  max={95}
                  step={5}
                  onValueChange={(v) => setDraft((d) => (d ? { ...d, minQuality: v[0] } : d))}
                  aria-label="Порог качества изображения"
                />
                <p className="text-xs text-muted-foreground">
                  Ниже порога документ не читается надёжно → статус «Перезагрузить документ».
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Label htmlFor="slider-reupload">Порог перезагрузки</Label>
                  <span className="text-sm font-bold text-slate-900">{fmtConf(draft.confReupload)}</span>
                </div>
                <Slider
                  id="slider-reupload"
                  value={[draft.confReupload]}
                  min={0.3}
                  max={0.9}
                  step={0.05}
                  onValueChange={(v) => setDraft((d) => (d ? { ...d, confReupload: v[0] } : d))}
                  aria-label="Порог перезагрузки документа"
                />
                <p className="text-xs text-muted-foreground">
                  Ниже порога поле не читается надёжно — документ возвращается агенту на перезагрузку.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Label htmlFor="slider-reject">Порог отказа при расхождении</Label>
                  <span className="text-sm font-bold text-slate-900">{fmtConf(draft.confReject)}</span>
                </div>
                <Slider
                  id="slider-reject"
                  value={[draft.confReject]}
                  min={0.3}
                  max={0.99}
                  step={0.01}
                  onValueChange={(v) => setDraft((d) => (d ? { ...d, confReject: v[0] } : d))}
                  aria-label="Порог отказа при расхождении с заявкой"
                />
                <p className="text-xs text-muted-foreground">
                  Если прочитанное поле не совпало с заявкой и уверенность от этого порога — «Отказ с причиной»;
                  ниже — документ уходит на ручную проверку. Не может быть ниже порога перезагрузки.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Label htmlFor="slider-auto">Порог автопринятия</Label>
                  <span className="text-sm font-bold text-slate-900">{fmtConf(draft.confAuto)}</span>
                </div>
                <Slider
                  id="slider-auto"
                  value={[draft.confAuto]}
                  min={0.55}
                  max={0.999}
                  step={0.01}
                  onValueChange={(v) => setDraft((d) => (d ? { ...d, confAuto: v[0] } : d))}
                  aria-label="Порог автопринятия поля"
                />
                <p className="text-xs text-muted-foreground">
                  От порога — принято автоматически, если правила пройдены.
                </p>
              </div>

              {/* цветовая полоса зон уверенности */}
              <div>
                <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label="Зоны уверенности: перезагрузка, подтверждения, автопринятие">
                  <div className="bg-amber-400" style={{ width: `${a}%` }} />
                  <div className="bg-blue-500" style={{ width: `${b}%` }} />
                  <div className="bg-emerald-500" style={{ width: `${c}%` }} />
                </div>
                <div className="mt-1.5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[11px] text-slate-600">
                  <span className="max-w-full truncate sm:max-w-[33%]">
                    ниже {draft ? fmtConf(draft.confReupload) : '—'} — перезагрузить
                  </span>
                  <span className="max-w-full truncate text-center sm:max-w-[33%]">
                    решают подтверждения
                  </span>
                  <span className="max-w-full truncate text-right sm:max-w-[33%]">
                    от {draft ? fmtConf(draft.confAuto) : '—'} — принято
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 border-t border-slate-100 pt-4">
                <Button onClick={() => void save()} disabled={saving}>
                  <Save className="h-4 w-4" aria-hidden />
                  {saving ? 'Сохранение…' : 'Сохранить пороги'}
                </Button>
                {dirty && <span className="text-xs text-amber-600">Есть несохранённые изменения</span>}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 2. Правила проверки полей */}
      <Card className="mt-6 border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-slate-900">Правила проверки полей</CardTitle>
          <CardDescription>Детерминированные правила поверх нейросети — их видно и можно объяснить</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="w-[26%]">Поле</TableHead>
                  <TableHead>Правило проверки</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(rules).map(([key, text]) => (
                  <TableRow key={key}>
                    <TableCell className="whitespace-nowrap font-medium text-slate-800">
                      {RULE_LABELS[key] ?? key}
                    </TableCell>
                    <TableCell className="text-slate-600">{text}</TableCell>
                  </TableRow>
                ))}
                {Object.keys(rules).length === 0 && (
                  <TableRow><TableCell colSpan={2} className="text-center text-slate-400">Правила не заданы</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Правила — код проверки: тип документа по ключевым словам, поля по шаблону, сверка с заявкой.
          </p>
        </CardContent>
      </Card>

      {/* 3. Безопасность */}
      <Card className="mt-6 border-[#0E1B2C] bg-[#0E1B2C] text-blue-100 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <ShieldCheck className="h-5 w-5 text-blue-300" aria-hidden />
            Безопасность
          </CardTitle>
          <CardDescription className="text-blue-300">
            Документы перевозчиков остаются внутри контура завода
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            <li className="flex items-start gap-3 text-sm">
              <Server className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" aria-hidden />
              Нейросеть работает на сервере завода — документы не уходят во внешние сервисы
            </li>
            <li className="flex items-start gap-3 text-sm">
              <UserCog className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" aria-hidden />
              При низкой уверенности документ не принимается и не отклоняется автоматически
            </li>
            <li className="flex items-start gap-3 text-sm">
              <History className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" aria-hidden />
              Журнал действий по заявкам ведётся автоматически
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
