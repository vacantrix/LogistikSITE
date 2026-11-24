'use client'

/**
 * «Избранное» ИИ-помощника — варианты, отобранные человеком из списков
 * ai-best. Здесь видно, что именно выбрали, по какому запросу и с каким
 * контактом; можно позвонить, скопировать карточку или убрать вариант.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Copy,
  Loader2,
  Phone,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react'
import {
  EmptyState,
  ErrorBlock,
  KpiCard,
  LoadingBlock,
  SectionHeader,
  type TabProps,
} from '@/components/platform/common'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { aiFetch } from '@/components/platform/ai-shared'

interface FavoriteDTO {
  id: string
  key: string
  query: string
  rank: number
  title: string
  route: string
  rate: string
  date: string
  company: string
  contact: string
  note: string
  engine: string | null
  createdAt: string
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Телефон из свободного контакта: «Иван, +7 900 000-00-00» → tel:+79000000000 */
function phoneHref(contact: string): string | null {
  const match = contact.match(/\+?\d[\d\s\-()]{8,}\d/)
  if (!match) return null
  const digits = match[0].replace(/[^\d+]/g, '')
  return digits.replace(/\D/g, '').length >= 10 ? `tel:${digits}` : null
}

function favoriteText(f: FavoriteDTO): string {
  return [
    f.title,
    f.route && `Маршрут: ${f.route}`,
    f.rate && `Ставка: ${f.rate}`,
    f.date && `Дата: ${f.date}`,
    f.company && `Компания: ${f.company}`,
    f.contact && `Контакт: ${f.contact}`,
    f.note && `Примечание: ${f.note}`,
    f.query && `Запрос: ${f.query}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export default function FavoritesTab({ onNavigate }: TabProps) {
  const { toast } = useToast()
  const [items, setItems] = useState<FavoriteDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await aiFetch('/api/ai/favorites')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setItems(Array.isArray(json?.favorites) ? (json.favorites as FavoriteDTO[]) : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remove = useCallback(
    async (id: string) => {
      setBusy(id)
      try {
        const res = await aiFetch(`/api/ai/favorites?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
        setItems((prev) => (prev ? prev.filter((f) => f.id !== id) : prev))
        toast({ title: 'Убрано из избранного' })
      } catch (e) {
        toast({
          title: 'Не удалось убрать',
          description: e instanceof Error ? e.message : String(e),
          variant: 'destructive',
        })
      } finally {
        setBusy(null)
      }
    },
    [toast],
  )

  const copy = useCallback(
    async (f: FavoriteDTO) => {
      try {
        await navigator.clipboard.writeText(favoriteText(f))
        toast({ title: 'Карточка скопирована', description: f.title })
      } catch {
        toast({ title: 'Браузер не дал доступ к буферу', variant: 'destructive' })
      }
    },
    [toast],
  )

  const kpi = useMemo(() => {
    const list = items ?? []
    return {
      total: list.length,
      companies: new Set(list.map((f) => f.company.trim()).filter(Boolean)).size,
      withContact: list.filter((f) => f.contact.trim()).length,
    }
  }, [items])

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="ИИ-помощник"
        title="Избранное"
        desc="Варианты, которые вы отобрали из списков нейросети: маршрут, ставка, компания и контакт. Отсюда можно позвонить, скопировать карточку или вернуться к поиску."
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-9" onClick={() => void load()}>
            <RefreshCw aria-hidden className="mr-1 h-3.5 w-3.5" />
            Обновить
          </Button>
          <Button size="sm" className="h-9" onClick={() => onNavigate('ai')}>
            <ArrowLeft aria-hidden className="mr-1 h-3.5 w-3.5" />
            К ИИ-помощнику
          </Button>
        </div>
      </SectionHeader>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard icon={<Star className="h-5 w-5" aria-hidden />} label="В избранном" value={kpi.total} tone="violet" />
        <KpiCard icon={<Building2 className="h-5 w-5" aria-hidden />} label="Компаний" value={kpi.companies} tone="blue" />
        <KpiCard icon={<Phone className="h-5 w-5" aria-hidden />} label="С контактом" value={kpi.withContact} tone="green" />
      </div>

      {error && <ErrorBlock message={error} onRetry={() => void load()} />}
      {items === null && !error && <LoadingBlock label="Загружаем избранное…" />}

      {items !== null && items.length === 0 && (
        <div className="space-y-4">
          <EmptyState
            icon={<Star className="h-10 w-10" aria-hidden />}
            title="Пока пусто"
            hint="В чате ИИ-помощника нажмите «В избранное» у подходящего варианта — он появится здесь."
          />
          <div className="flex justify-center">
            <Button onClick={() => onNavigate('ai')}>Открыть ИИ-помощник</Button>
          </div>
        </div>
      )}

      {items !== null && items.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((f) => {
            const tel = phoneHref(f.contact)
            return (
              <Card key={f.id} className="border-slate-200 shadow-sm">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-violet-50 px-2 text-xs font-bold text-violet-700">
                      #{f.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold leading-snug text-slate-900">{f.title}</div>
                      {f.route && <div className="mt-0.5 text-sm text-slate-600">{f.route}</div>}
                    </div>
                    <div className="shrink-0 text-right">
                      {f.rate && <div className="text-lg font-bold text-emerald-700">{f.rate}</div>}
                      <div className="text-[11px] text-slate-400">{fmtDate(f.createdAt)}</div>
                    </div>
                  </div>

                  {(f.date || f.company || f.contact || f.engine) && (
                    <div className="flex flex-wrap gap-1.5">
                      {f.date && (
                        <Badge variant="outline" className="gap-1 border-slate-300 font-normal text-slate-600">
                          <CalendarDays className="h-3 w-3" aria-hidden />
                          {f.date}
                        </Badge>
                      )}
                      {f.company && (
                        <Badge variant="outline" className="gap-1 border-slate-300 font-normal text-slate-600">
                          <Building2 className="h-3 w-3" aria-hidden />
                          {f.company}
                        </Badge>
                      )}
                      {f.contact && (
                        <Badge variant="outline" className="gap-1 border-slate-300 font-normal text-slate-600">
                          <Phone className="h-3 w-3" aria-hidden />
                          {f.contact}
                        </Badge>
                      )}
                      {f.engine && (
                        <Badge variant="outline" className="border-slate-300 font-normal text-slate-500">
                          {f.engine}
                        </Badge>
                      )}
                    </div>
                  )}

                  {f.note && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      {f.note}
                    </div>
                  )}

                  {f.query && (
                    <div className="text-xs text-slate-500">
                      <span className="font-medium text-slate-600">Запрос:</span> {f.query}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {tel && (
                      <Button size="sm" className="h-9" onClick={() => { window.location.href = tel }}>
                        <Phone aria-hidden className="mr-1 h-3.5 w-3.5" />
                        Позвонить
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-9" onClick={() => void copy(f)}>
                      <Copy aria-hidden className="mr-1 h-3.5 w-3.5" />
                      Скопировать
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-9 text-slate-500 hover:text-red-600"
                          disabled={busy === f.id}
                        >
                          {busy === f.id ? (
                            <Loader2 aria-hidden className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 aria-hidden className="mr-1 h-3.5 w-3.5" />
                          )}
                          Убрать
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Убрать вариант из избранного?</AlertDialogTitle>
                          <AlertDialogDescription>
                            «{f.title}» и переговоры по нему будут удалены. Список ИИ и журнал нейросети не изменятся.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Отмена</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void remove(f.id)}>Убрать</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
