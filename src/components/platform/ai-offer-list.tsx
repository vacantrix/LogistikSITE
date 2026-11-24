'use client'

/**
 * Карточки вариантов из блоков ai-best — «список прямо на экране», вид как на
 * ATI.SU: ранг слева крупно, маршрут — заголовок карточки, ставка — цена
 * крупным шрифтом в правом углу, под маршрутом — чипы (дата, фирма, контакт),
 * примечание — обводка «совет». Кнопка «В избранное» (как отбор предложений
 * на ATI.SU) и после сохранения — «Договориться» с переходом в раздел.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  Loader2,
  Phone,
  Star,
  Building2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ToastAction } from '@/components/ui/toast'
import { useToast } from '@/hooks/use-toast'
import { aiFetch } from '@/components/platform/ai-shared'
import type { AiBestOffer } from '@/lib/ai/tools'
import type { TabKey } from '@/components/platform/common'

/** Подпись варианта — как на сервере (favoriteKey): один вариант не дублируется */
function signatureOf(offer: { title?: string; route?: string; rate?: string }): string {
  return [offer.title ?? '', offer.route ?? '', offer.rate ?? '']
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .join('|')
}

interface AiOfferListProps {
  offers: AiBestOffer[]
  /** запрос, по которому построен список — сохраняется с каждым вариантом */
  query: string
  /** движок ответа (gigachat — единственный движок; ultra/reserve — только старые записи) */
  engine?: string
  /** переход в «Избранное» — если контекст не даёт навигации, кнопка перехода скрыта */
  onNavigate?: (tab: TabKey) => void
  /** компактный режим — внутри чата */
  compact?: boolean
}

export function AiOfferList({ offers, query, engine, onNavigate, compact }: AiOfferListProps) {
  const { toast } = useToast()
  const [saved, setSaved] = useState<Set<string> | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  // уже сохранённые варианты — чтобы кнопка честно показывала «В избранном»
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await aiFetch('/api/ai/favorites')
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.ok && Array.isArray(json?.favorites)) {
          const keys = new Set<string>(
            (json.favorites as { title?: string; route?: string; rate?: string }[]).map(signatureOf),
          )
          setSaved(keys)
        } else {
          setSaved(new Set())
        }
      } catch {
        if (!cancelled) setSaved(new Set())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const save = useCallback(
    async (offer: AiBestOffer) => {
      const sig = signatureOf(offer)
      if (saved?.has(sig) || saving) return
      setSaving(sig)
      try {
        const res = await aiFetch('/api/ai/favorites', {
          method: 'POST',
          body: JSON.stringify({ offer, query, engine }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
        setSaved((prev) => {
          const next = new Set(prev ?? [])
          next.add(sig)
          return next
        })
        toast({
          title: 'Добавлено в избранное',
          description: offer.title,
          ...(onNavigate
            ? {
                action: (
                  <ToastAction altText="Перейти в избранное" onClick={() => onNavigate('favorites')}>
                    Перейти в избранное
                  </ToastAction>
                ),
              }
            : {}),
        })
      } catch (e) {
        toast({
          title: 'Не удалось сохранить',
          description: e instanceof Error ? e.message : String(e),
          variant: 'destructive',
        })
      } finally {
        setSaving(null)
      }
    },
    [engine, onNavigate, query, saving, saved, toast],
  )

  if (offers.length === 0) return null

  return (
    <div className={compact ? 'mt-2 space-y-2.5' : 'space-y-2.5'}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-500">
        <Star aria-hidden className="h-3.5 w-3.5 text-emerald-600" />
        Список по запросу — выбирай кнопкой «В избранное»:
      </div>
      {offers.map((offer) => {
        const sig = signatureOf(offer)
        const isSaved = saved?.has(sig) ?? false
        const routeParts = offer.route.split('→').map((p) => p.trim()).filter(Boolean)
        return (
          <Card key={`${offer.rank}-${offer.title}`} className="border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
            <CardContent className={compact ? 'p-3.5' : 'p-4'}>
              {/* шапка: ранг · маршрут · цена */}
              <div className="flex items-start gap-3">
                <div
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-lg bg-emerald-50 text-sm font-bold text-emerald-700"
                >
                  {offer.rank}
                </div>
                <div className="min-w-0 flex-1">
                  {routeParts.length >= 2 ? (
                    <p className="flex flex-wrap items-center gap-x-1.5 text-[15px] font-bold leading-tight text-slate-900">
                      <span>{routeParts[0]}</span>
                      <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-emerald-600" />
                      <span>{routeParts.at(-1)}</span>
                      {routeParts.length > 2 && (
                        <span className="text-xs font-medium text-slate-400">{`через ${routeParts.slice(1, -1).join(', ')}`}</span>
                      )}
                    </p>
                  ) : (
                    offer.route && <p className="text-[15px] font-bold leading-tight text-slate-900">{offer.route}</p>
                  )}
                  <p className="mt-0.5 truncate text-sm font-medium text-slate-700">{offer.title}</p>
                </div>
                {offer.rate && (
                  <div className="ml-auto shrink-0 text-right">
                    <p className="text-lg font-extrabold leading-none text-slate-900">{offer.rate}</p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">ставка</p>
                  </div>
                )}
              </div>

              {/* чипы: дата · фирма · контакт */}
              {(offer.date || offer.company || offer.contact) && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {offer.date && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
                      <CalendarDays aria-hidden className="h-3.5 w-3.5 text-slate-400" />
                      {offer.date}
                    </span>
                  )}
                  {offer.company && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
                      <Building2 aria-hidden className="h-3.5 w-3.5 text-slate-400" />
                      {offer.company}
                    </span>
                  )}
                  {offer.contact && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                      <Phone aria-hidden className="h-3.5 w-3.5 text-emerald-500" />
                      {offer.contact}
                    </span>
                  )}
                </div>
              )}

              {/* примечание — «совет» с галочкой */}
              {offer.note && (
                <p className="mt-2.5 flex gap-2 rounded-lg bg-emerald-50/60 px-3 py-2 text-xs leading-relaxed text-emerald-900">
                  <BadgeCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <span>{offer.note}</span>
                </p>
              )}

              {/* действия */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={isSaved ? 'outline' : 'default'}
                  className={isSaved ? 'h-9 text-slate-500' : 'h-9'}
                  disabled={isSaved || saving === sig}
                  onClick={() => void save(offer)}
                  aria-label={isSaved ? 'Вариант уже в избранном' : `Добавить «${offer.title}» в избранное`}
                >
                  {saving === sig ? (
                    <Loader2 aria-hidden className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : isSaved ? (
                    <Check aria-hidden className="mr-1 h-3.5 w-3.5" />
                  ) : (
                    <Star aria-hidden className="mr-1 h-3.5 w-3.5" />
                  )}
                  {isSaved ? 'В избранном' : 'В избранное'}
                </Button>
                {isSaved && onNavigate && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                    onClick={() => onNavigate('favorites')}
                  >
                    Договориться
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
