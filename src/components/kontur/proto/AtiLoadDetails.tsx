'use client'

// Окно «Подробнее о грузе» — полная карточка груза биржи ATI.SU в общем стиле
// платформы (LogistikSITE): маршрут и груз, расчёт расстояния (время в пути,
// топливо, «Платон»), тип транспорта, ставка и оплата, карточка фирмы с
// контактами. Открывается кнопкой «Подробнее о грузе» на карточке выдачи.
// Здесь же живут общие мелочи карточек ATI.SU: звёзды рейтинга, строка значков
// участника и открытие маршрута в Яндекс.Картах — чтобы код не дублировался.

import { useEffect } from 'react'
import { Button } from '@/components/kontur/ui/button'
import { Pill } from './bits'
import { CallButton } from './CallButton'
import type { AtiDealDto } from '@/lib/kontur/client-types'
import { fmtDateTime } from '@/lib/kontur/client-types'
import { marketCityGeo, PAYMENTS, type CarrierBadges, type MarketLoad } from '@/lib/kontur/atisu/market-stubs'
import { useToast } from '@/hooks/use-toast'
import {
  BadgeCheck, Building2, Calculator, FileSignature, Handshake, Landmark, Mail, MapPin, Medal, MessageSquare,
  Package, Phone, Route as RouteIcon, ShieldCheck, Star, Stamp, ThumbsUp, Truck, Wallet, X,
} from 'lucide-react'

const RUB = (n: number) => n.toLocaleString('ru-RU')
const shortDate = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '—')
const perKmFmt = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
const PAY_LABEL: Record<string, string> = Object.fromEntries(PAYMENTS.map((p) => [p.id, p.label]))

/** «19 ч 59 мин» из десятков часа (0,5 ч → «30 мин») */
function hoursFmt(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  if (hh === 0) return `${mm} мин`
  return mm > 0 ? `${hh} ч ${mm} мин` : `${hh} ч`
}

/**
 * Открыть маршрут на Яндекс.Картах в новой вкладке браузера (грузовой профиль
 * rtt=truck): линия пути, расстояние и время в пути — цифры самого Яндекса.
 * Точки задаются координатами городов из гео-справочника витрины; без
 * координат — названием города.
 */
export function openRouteTab(from: string, to: string) {
  const pt = (name: string) => {
    const geo = marketCityGeo(name)
    return geo ? `${geo[0]},${geo[1]}` : encodeURIComponent(name)
  }
  const url = `https://yandex.ru/maps/?rtext=${pt(from)}~${pt(to)}&rtt=truck`
  window.open(url, '_blank', 'noopener')
}

/** Маленькие звёзды рейтинга (шапка перевозчика, отзывы) */
export function MiniStars({ rating }: { rating: number }) {
  return (
    <span className="flex" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`h-3.5 w-3.5 ${i <= rating ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'}`} />
      ))}
    </span>
  )
}

/** Отметки участника ATI.SU (ГосЛог, ЭТрН и др.) — значение раскрывает подсказка при наведении */
export function CarrierBadgesRow({ b, goslogRef }: { b: CarrierBadges; goslogRef: string | null }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {b.goslog && (
        <span
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700"
          title={`Фирма в «белом списке» ГосЛога (реестр Минтранса)${goslogRef ? `, запись ${goslogRef}` : ''} — демо-заглушка`}
        >
          <Landmark className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
          БГ Гослог{goslogRef ? ` ${goslogRef}` : ''}
        </span>
      )}
      {b.etrn && (
        <Pill className="bg-slate-100 text-slate-600" title={`Готов к работе с электронными транспортными накладными (ЭТрН), степень ${b.etrn}`}>
          <Stamp className="h-3 w-3" />ЭТрН {b.etrn}
        </Pill>
      )}
      {b.real_carrier && (
        <Pill className="bg-slate-100 text-slate-600" title="Собственный транспорт — работает напрямую, без посредников">
          <Truck className="h-3 w-3" />Реальный перевозчик
        </Pill>
      )}
      {b.contact_confirmed && (
        <Pill className="bg-slate-100 text-slate-600" title="Личность контактного лица подтверждена на ATI.SU">
          <BadgeCheck className="h-3 w-3" />Контакт подтверждён
        </Pill>
      )}
      {b.edo && (
        <Pill className="bg-slate-100 text-slate-600" title="Участник ЭДО «АТИ-Доки» с электронной подписью — документы онлайн">
          <FileSignature className="h-3 w-3" />АТИ-Доки
        </Pill>
      )}
    </span>
  )
}

/** Заголовок блока внутри окна: фирменный тёмно-синий текст + значок */
function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-sm font-bold text-[#0E1B2C]">
      <span className="text-slate-400" aria-hidden>{icon}</span>
      {children}
    </div>
  )
}

/** Плитка расчёта расстояния: подпись, значение, пояснение мелким шрифтом */
function Tile({ label, value, hint, sub }: { label: string; value: string; hint?: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2" title={hint}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="whitespace-nowrap text-sm font-bold text-[#0E1B2C]">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] leading-snug text-slate-400">{sub}</div>}
    </div>
  )
}

/** Пункт раздела «Ставка и оплата»: слева подпись, справа значение */
function RateRow({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-slate-100 pb-1.5" title={hint}>
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  )
}

/**
 * Модальное окно «Подробнее о грузе»: левая колонка — маршрут, расчёт
 * расстояния, транспорт, груз, ставка; правая — фирма-заказчик с контактами;
 * футер — действия логиста. Закрывается по Escape и клику в фон.
 */
export function LoadDetailsModal({ l, deal, dealBusy, onMatch, onDeal, onClose }: {
  l: MarketLoad
  deal: AtiDealDto | null
  dealBusy: boolean
  onMatch: (l: MarketLoad) => void
  onDeal: (l: MarketLoad) => void
  onClose: () => void
}) {
  const { toast } = useToast()
  const activeDeal = deal && deal.status === 'active' ? deal : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Оценки расхода и «Платона» — константы демо-расчёта прототипа
  const fuelL = Math.round((l.km * 28) / 100)
  const platonR = Math.round(l.km * 1.53)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Подробнее о грузе ${l.from} → ${l.to}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="my-6 w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Шапка — фирменный тёмно-синий, как в скриншоте карточки груза */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-[#0E1B2C] px-5 py-4 text-white">
          <div className="text-base font-bold">Подробнее о грузе</div>
          <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-xs font-semibold" title="Код груза на бирже ATI.SU">#{l.code}</span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-blue-100" title="Страна перевозки">RUS</span>
          {l.adr && <Pill className="bg-red-500/90 text-white" title="Опасный груз (ADR)">ADR</Pill>}
          <span className="ml-auto text-[11px] text-blue-100">обновлено {l.updated_min_ago} мин назад</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть подробности груза"
            className="rounded-lg p-1.5 text-blue-100 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-5 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* ===================== Левая колонка ===================== */}
          <div className="min-w-0 space-y-5">
            {/* Маршрут: погрузка / выгрузка */}
            <section className="space-y-2.5">
              <SectionTitle icon={<MapPin className="h-4 w-4" />}>Маршрут и груз</SectionTitle>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Погрузка</div>
                  <div className="mt-0.5 text-[15px] font-bold leading-tight text-slate-900">{l.from}</div>
                  <div className="text-xs italic text-slate-400">{l.from_region}</div>
                  {l.from_ref && (
                    <div className="mt-0.5 text-xs text-slate-500" title="Расстояние до ближайшего крупного города — как в выдаче ATI.SU">
                      {l.from_ref_km} км от {l.from_ref}
                    </div>
                  )}
                  <div className="mt-1.5 text-xs font-semibold text-slate-700">
                    Готов к погрузке: {shortDate(l.date_from)}–{shortDate(l.date_to)}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">загрузка: {l.loading}</div>
                  {l.load_extras.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {l.load_extras.map((x) => <Pill key={x} className="bg-slate-100 text-slate-600">{x}</Pill>)}
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Выгрузка</div>
                  <div className="mt-0.5 text-[15px] font-bold leading-tight text-slate-900">{l.to}</div>
                  <div className="text-xs italic text-slate-400">{l.to_region}</div>
                  {l.to_ref && (
                    <div className="mt-0.5 text-xs text-slate-500" title="Расстояние до ближайшего крупного города — как в выдаче ATI.SU">
                      {l.to_ref_km} км от {l.to_ref}
                    </div>
                  )}
                  <div className="mt-1.5 text-xs text-slate-500" title="Оценка времени в пути — уточняется кнопкой «Маршрут» (Яндекс.Карты)">
                    ~{hoursFmt(l.hours_est)} в пути от начала окна погрузки
                  </div>
                </div>
              </div>
            </section>

            {/* Тип транспорта */}
            <section className="space-y-2">
              <SectionTitle icon={<Truck className="h-4 w-4" />}>Тип транспорта</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {l.bodies.map((b) => (
                  <span key={b} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                    <Truck className="h-3 w-3 text-slate-400" aria-hidden />
                    {b}
                  </span>
                ))}
                {l.adr && <Pill className="bg-red-50 font-semibold text-red-700" title="Требуется допуск ADR">опасный груз (ADR)</Pill>}
              </div>
            </section>

            {/* Груз */}
            <section className="space-y-2">
              <SectionTitle icon={<Package className="h-4 w-4" />}>Груз</SectionTitle>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-sm font-semibold text-slate-900">{l.cargo}</div>
                <div className="mt-0.5 text-xs text-slate-600">
                  {l.weight_t} т / {l.volume_m3} м³
                  {l.dims_m ? ` · Д×Ш×В: ${l.dims_m} м` : ' · габариты не указаны'}
                </div>
                {l.note && (
                  <div className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
                    <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />
                    <span className="italic">{l.note}</span>
                  </div>
                )}
              </div>
            </section>

            {/* Расчёт расстояния */}
            <section className="space-y-2">
              <SectionTitle icon={<RouteIcon className="h-4 w-4" />}>Расчёт расстояния</SectionTitle>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile
                  label="Плечо"
                  value={`~${RUB(l.km)} км`}
                  hint="Плечо по дорогам, расчёт ATI.SU (у АЭМЗ — OSRM + Яндекс.Карты, поэтому «примерно»)"
                  sub={l.km_owner != null && l.km_owner !== l.km ? `грузовладелец: ${RUB(l.km_owner)} км` : undefined}
                />
                <Tile label="Время в пути" value={`~${hoursFmt(l.hours_est)}`} hint="Оценка плеча при 80 км/ч без учёта отдыха" sub="расчёт 80 км/ч" />
                <Tile label="Топливо ~" value={`${RUB(fuelL)} л`} hint="Демо-оценка прототипа: 28 л на 100 км, дизель" sub="28 л/100 км — оценка" />
                <Tile label="«Платон» ~" value={`${RUB(platonR)} ₽`} hint="Демо-оценка прототипа: тариф 1,53 ₽ за км по дорогам" sub="1,53 ₽/км — оценка" />
              </div>
              <div className="text-[10px] leading-relaxed text-slate-400">
                Топливо и «Платон» — оценки демо-расчёта прототипа; точный маршрут с картой, расстоянием и временем строит
                кнопка «Маршрут» (Яндекс.Карты, грузовой профиль) в новой вкладке.
              </div>
            </section>

            {/* Ставка и оплата */}
            <section className="space-y-2">
              <SectionTitle icon={<Wallet className="h-4 w-4" />}>Ставка и оплата</SectionTitle>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-slate-100 pb-1.5">
                  <span className="text-xs text-slate-500">с НДС {l.nds_pct}%</span>
                  <span className="text-[15px] font-bold leading-none text-[#0E1B2C]">
                    {RUB(l.rate)} ₽ <span className="text-[11px] font-semibold text-slate-400">· {perKmFmt(l.per_km)} ₽/км</span>
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-slate-100 pb-1.5">
                  <span className="text-xs text-slate-500">без НДС</span>
                  <span className="text-sm font-bold leading-none text-slate-800">
                    {RUB(l.rate_no_vat)} ₽ <span className="text-[11px] font-semibold text-slate-400">· {perKmFmt(l.per_km_no_vat)} ₽/км</span>
                  </span>
                </div>
                <RateRow label="Форма оплаты" value={PAY_LABEL[l.payment] ?? l.payment} />
                <RateRow label="Предоплата" value={l.prepay_pct != null ? `${l.prepay_pct}%` : 'не указана'} />
                <RateRow label="Торг" value={l.bargain ? 'возможен' : 'без торга'} />
                {l.fuel_note && <RateRow label="Горючее" value={l.fuel_note} />}
                <RateRow
                  label="Ориентир ТрейРадар"
                  value={`${RUB(l.radar_rate)} ₽ за погрузку`}
                  hint="Демо-заглушка «ТрейРадар»: рекомендованная ставка по направлению и дате погрузки"
                />
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {l.guaranteed && (
                    <Pill className="bg-emerald-100 text-emerald-700" title="Оплата по сделке гарантирована">
                      <ShieldCheck className="h-3 w-3" />оплата защищена
                    </Pill>
                  )}
                  {l.contest && (
                    <Pill className="bg-violet-100 text-violet-700" title="По грузу идёт конкурс ставок">
                      <ThumbsUp className="h-3 w-3" />идёт конкурс
                    </Pill>
                  )}
                  {l.regular && <Pill className="bg-slate-100 text-slate-600" title="Постоянный заказчик по этому направлению">постоянный заказчик</Pill>}
                </div>
              </div>
            </section>
          </div>

          {/* ===================== Правая колонка: фирма ===================== */}
          <div className="min-w-0 space-y-3">
            <section className="space-y-2">
              <SectionTitle icon={<Building2 className="h-4 w-4" />}>Заказчик перевозки</SectionTitle>
              <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                <div className="text-[15px] font-bold leading-tight text-[#0E1B2C]">{l.carrier.firm}</div>
                <div className="text-[11px] text-slate-500">
                  <span className="font-mono">Код:{l.carrier.firm_ati}</span> · {l.carrier.city}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill className="bg-slate-100 text-slate-600">{l.carrier.role}</Pill>
                  <span className="text-[11px] text-slate-400">на АТИ с {l.carrier.on_ati_since} г.</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <MiniStars rating={Math.round(l.carrier.rating)} />
                  <span className="text-xs font-semibold text-slate-700">
                    {l.carrier.rating.toFixed(1).replace('.', ',')} · {l.carrier.reviews} отз.
                  </span>
                </div>
                {l.medals > 0 && (
                  <span className="flex items-center gap-0.5" title={`Медали ATI.SU за активность и отзывы (демо-заглушка): ${l.medals}`}>
                    {Array.from({ length: l.medals }).map((_, i) => (
                      <Medal key={i} className="h-3.5 w-3.5 fill-amber-300 text-amber-500" aria-hidden />
                    ))}
                  </span>
                )}
                <CarrierBadgesRow b={l.carrier.badges} goslogRef={l.goslog_ref} />
                <div className="border-t border-slate-100 pt-2">
                  <div className="text-xs text-slate-500">
                    Контакт: <span className="font-semibold text-slate-700">{l.contact_name}</span>
                  </div>
                  <a
                    href={`tel:${l.contact_phone.replace(/[^\d+]/g, '')}`}
                    className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-500 transition-colors hover:text-red-700"
                    title={`Позвонить ${l.contact_name} (${l.carrier.firm})`}
                  >
                    <Phone className="h-3.5 w-3.5 text-red-600" aria-hidden />
                    <span className="font-mono font-semibold text-red-700">{l.contact_phone}</span>
                  </a>
                  {l.contact2_phone && (
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      Второй контакт: {l.contact2_name} · <a href={`tel:${l.contact2_phone.replace(/[^\d+]/g, '')}`} className="font-mono font-semibold text-red-700 hover:text-red-700">{l.contact2_phone}</a>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <CallButton phone={l.contact_phone} name={`${l.contact_name} (${l.carrier.firm})`} label="Позвонить" />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => toast({ title: 'Демо-заглушка', description: 'Мессенджер ATI.SU «Написать» — после подключения API выполняется реально' })}
                      title="Демо-заглушка: сообщение через мессенджер ATI.SU"
                    >
                      <Mail className="mr-1 h-3 w-3" aria-hidden />Написать
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            {activeDeal && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-700">
                <span className="inline-flex items-center gap-1.5 font-bold">
                  <span className={`h-2 w-2 rounded-full ${activeDeal.stage === 'full' ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden />
                  Заявка АЭМЗ · {activeDeal.stage === 'full' ? 'в силе' : 'предварительное согласование'}
                </span>
                <div className="mt-0.5 opacity-80">с {fmtDateTime(activeDeal.agreedAt)}</div>
              </div>
            )}
          </div>
        </div>

        {/* Футер: действия логиста */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <Button
            type="button"
            size="sm"
            className="h-8 bg-[#0E1B2C] text-white hover:bg-[#16304f]"
            onClick={() => { onClose(); onMatch(l) }}
            title="Откроется подбор водителя под этот груз — расчёт запустится по кнопке «Произвести расчёт» в открывшемся окне"
          >
            <Calculator className="mr-1 h-3.5 w-3.5" />
            Подбор водителя
          </Button>
          {!activeDeal && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => { onClose(); onDeal(l) }}
              disabled={dealBusy}
              title="Договорились с грузовладельцем — заявка АЭМЗ уходит в «Мои заявки» со стадией «предварительное согласование»"
            >
              {dealBusy ? (
                <span className="mr-1 h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" aria-hidden />
              ) : (
                <Handshake className="mr-1 h-3.5 w-3.5" />
              )}
              Договорились
            </Button>
          )}
          <button
            type="button"
            onClick={() => openRouteTab(l.from, l.to)}
            title="Открыть маршрут в Яндекс.Картах в новой вкладке — линия пути, расстояние и время в пути (грузовой профиль)"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            <RouteIcon className="h-3 w-3" aria-hidden />
            Маршрут в Яндекс.Картах
          </button>
          <Button type="button" size="sm" variant="ghost" className="ml-auto h-8 text-slate-500 hover:text-slate-800" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </div>
    </div>
  )
}
