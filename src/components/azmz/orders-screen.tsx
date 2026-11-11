'use client'

/**
 * Экран «Главная» — стартовый экран водителя (поток 1С).
 *
 * Алгоритм (тестовый режим, заявки — из /api/1c/orders, в проде — HTTP-сервис 1С):
 *   1. Приложение открывается сразу на заявке: пока заявка не пришла — экран
 *      ожидания, доступы закрыты (только Главная / История / Настройки).
 *   2. Заявка назначена → «Взять заявку» → POST ACCEPT в 1С → строится маршрут
 *      (в проде — 2ГИС Routing API: грузовик, пробки, альтернативы).
 *   3. Предрейсовая фотофиксация: ТС бок/голова/сзади, документы по заявке,
 *      ВУ и паспорт. Каждый шаг уходит в 1С (POST PRETRIP_STEP).
 *   4. Все шаги закрыты → кнопка «Начать маршрут» → навигация и остальное
 *      приложение (пометки, офис, 2ГИС) открывается.
 *
 * Фото: <input capture> открывает камеру телефона; на десктопе — выбор файла;
 * кнопка «Демо-снимок» позволяет пройти флоу без камеры. Превью сжимается
 * до 360px (квота localStorage), полные кадры в проде уходят в файловое
 * хранилище 1С/системы, в клиенте остаётся только ссылка.
 */

import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  FileText,
  IdCard,
  LoaderCircle,
  MapPin,
  Play,
  Radar,
  Truck,
} from 'lucide-react'
import { useAzmz } from '@/lib/store'
import { PRETRIP_STEPS, type Order1C, type PretripStepDef } from '@/lib/demo/orders-data'

const fmtDT = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/** POST в 1С (обратный канал статусов). Демо: журнал в /api/1c/orders. */
function postTo1C(action: 'ACCEPT' | 'PRETRIP_STEP' | 'START_ROUTE', orderId: string, stepId?: string): void {
  void fetch('/api/1c/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, action, stepId }),
  }).catch(() => {
    /* тестовый режим: ответ 1С не блокирует водительский флоу */
  })
}

/** Файл → превью-п dataURL (360px, JPEG) — для карточки шага. */
function fileToThumb(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, 360 / img.width)
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.width * scale))
      c.height = Math.max(1, Math.round(img.height * scale))
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.72))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('bad image'))
    }
    img.src = url
  })
}

/** Заглушка «снимка» для прохождения флоу на десктопе, без камеры. */
function demoPhoto(label: string): string {
  const t = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240">` +
    `<rect width="100%" height="100%" fill="#0F1D2E"/>` +
    `<rect x="10" y="10" width="340" height="220" fill="none" stroke="#F97316" stroke-width="3" stroke-dasharray="12 7"/>` +
    `<text x="180" y="106" font-family="Arial" font-size="21" font-weight="bold" fill="#FFFFFF" text-anchor="middle">ДЕМО-СНИМОК</text>` +
    `<text x="180" y="134" font-family="Arial" font-size="15" fill="#F97316" text-anchor="middle">${label}</text>` +
    `<text x="180" y="210" font-family="Arial" font-size="12" fill="#94A3B8" text-anchor="middle">${t}</text>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function stepIcon(kind: PretripStepDef['kind'], cls: string) {
  if (kind === 'vehicle') return <Truck className={cls} />
  if (kind === 'order_docs') return <FileText className={cls} />
  return <IdCard className={cls} />
}

export function OrdersScreen() {
  const orders = useAzmz((s) => s.orders)
  const setOrders = useAzmz((s) => s.setOrders)
  const activeOrderNumber = useAzmz((s) => s.activeOrderNumber)
  const orderStage = useAzmz((s) => s.orderStage)
  const pretrip = useAzmz((s) => s.pretrip)
  const acceptOrder = useAzmz((s) => s.acceptOrder)
  const beginPretrip = useAzmz((s) => s.beginPretrip)
  const completePretripStep = useAzmz((s) => s.completePretripStep)
  const startRoute = useAzmz((s) => s.startRoute)
  const refetchRealRoute = useAzmz((s) => s.refetchRealRoute)
  const realRoute = useAzmz((s) => s.realRoute)
  const realRouteStatus = useAzmz((s) => s.realRouteStatus)
  const setView = useAzmz((s) => s.setView)
  const showToast = useAzmz((s) => s.showToast)
  const trip = useAzmz((s) => s.trip)
  const simProgressF = useAzmz((s) => s.simProgressF)
  const offlineMode = useAzmz((s) => s.offlineMode)

  const [selected, setSelected] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const photoStepRef = useRef<string | null>(null)
  const fetchOnceRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // подтягиваем заявки с «1С» (в офлайне остаётся локальный сид)
  useEffect(() => {
    if (fetchOnceRef.current) return
    fetchOnceRef.current = true
    fetch('/api/1c/orders')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { orders?: Order1C[] } | null) => {
        if (d?.orders?.length) {
          useAzmz.getState().setOrders(d.orders)
          setRefreshedAt(Date.now())
        }
      })
      .catch(() => {})
  }, [])

  // смена стадии воркфлоу — показываем новый экран сверху
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [orderStage])

  const active = orders.find((o) => o.number === activeOrderNumber) ?? null
  const doneCount = pretrip.filter((p) => p.done).length
  const allDone = pretrip.length > 0 && doneCount === pretrip.length

  const take = (o: Order1C) => {
    acceptOrder(o.number)
    postTo1C('ACCEPT', o.number)
  }

  const openCamera = (stepId: string) => {
    photoStepRef.current = stepId
    fileRef.current?.click()
  }

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    const stepId = photoStepRef.current
    e.target.value = ''
    if (!f || !stepId) return
    try {
      const thumb = await fileToThumb(f)
      completePretripStep(stepId, thumb)
      const n = active?.number ?? ''
      postTo1C('PRETRIP_STEP', n, stepId)
    } catch {
      showToast('Не удалось прочитать снимок — попробуйте ещё раз')
    }
  }

  const demoShot = (stepId: string) => {
    const def = PRETRIP_STEPS.find((d) => d.id === stepId)
    completePretripStep(stepId, demoPhoto(def?.label ?? 'шаг'))
    const n = active?.number ?? ''
    postTo1C('PRETRIP_STEP', n, stepId)
  }

  const start = () => {
    if (!active) return
    postTo1C('START_ROUTE', active.number)
    startRoute()
  }

  // --- активная заявка: воркфлоу --------------------------------------------
  let activeFlow: React.ReactNode = null
  if (active) {
    if (orderStage === 'routing') {
      activeFlow = (
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 flex flex-col items-center gap-3 text-center">
          <LoaderCircle className="h-9 w-9 text-[#F97316] animate-spin" />
          <div>
            <div className="text-[14px] font-bold text-[#15202B]">Строим маршрут…</div>
            <div className="text-[12px] text-[#64748B] mt-1">
              2ГИС Routing API · грузовик {active.weightT.toFixed(1)} т · пробки · выбор наилучшего варианта
            </div>
          </div>
        </div>
      )
    } else if (orderStage === 'route_ready') {
      // цифры — из реального ответа 2ГИС; при сбое — плановые из заявки
      const km = realRoute ? Math.round(realRoute.lengthM / 1000) : active.distanceKm
      const durMin = realRoute ? Math.max(1, Math.round(realRoute.durationS / 60)) : active.durationMin
      activeFlow = (
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-6 w-6 text-[#22C55E] shrink-0" />
            <div>
              <div className="text-[14px] font-bold text-[#15202B]">Маршрут построен</div>
              <div className="text-[12px] text-[#64748B]">Рейс {active.number.replace('ЗК', 'Z')}</div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[13px] text-[#15202B] font-medium">
            <MapPin className="h-4 w-4 text-[#3B82F6] shrink-0" />
            {active.fromLabel} <span className="text-[#94A3B8]">→</span> {active.toLabel}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[#64748B]">
            <span className="font-bold text-[#15202B]">{km} км</span>
            <span>≈ {Math.floor(durMin / 60)} ч {durMin % 60} мин</span>
            <span>с учётом пробок</span>
          </div>
          <div
            className={`mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2 py-1 ${
              realRouteStatus === 'ready' ? 'bg-[#22C55E]/12 text-[#15803D]' : 'bg-[#FACC15]/20 text-[#A16207]'
            }`}
          >
            {realRouteStatus === 'ready'
              ? '2ГИС Routing API · грузовик 28 т · пробки · реальные манёвры'
              : 'Демо-геометрия А-146 — 2ГИС недоступен'}
          </div>
          <button
            onClick={beginPretrip}
            className="mt-3.5 w-full h-11 bg-[#F97316] text-white rounded-xl text-[14px] font-bold shadow-lg active:scale-[0.99] transition-transform"
          >
            К подготовке к рейсу
          </button>
          {realRouteStatus === 'failed' && (
            <button
              onClick={refetchRealRoute}
              className="mt-2 w-full h-9 text-[12px] font-semibold text-[#C2410C] bg-[#F97316]/10 rounded-xl"
            >
              Повторить запрос 2ГИС
            </button>
          )}
        </div>
      )
    } else if (orderStage === 'prep') {
      activeFlow = (
        <div>
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
            <div className="flex items-center justify-between">
              <div className="text-[14px] font-bold text-[#15202B]">Подготовка к рейсу</div>
              <div
                className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${
                  allDone ? 'bg-[#22C55E] text-white' : 'bg-[#101E2E] text-white/80'
                }`}
              >
                {doneCount} из {pretrip.length}
              </div>
            </div>
            <div className="text-[11.5px] text-[#64748B] mt-1 leading-snug">
              Фотофиксация перед выездом. Снимки уходят в 1С вместе со статусами заявки.
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-[#E2E8F0] overflow-hidden">
              <div
                className="h-full bg-[#F97316] rounded-full transition-all duration-300"
                style={{ width: `${(doneCount / pretrip.length) * 100}%` }}
              />
            </div>
            <div className="mt-3 divide-y divide-[#EEF1F5]">
              {PRETRIP_STEPS.map((def) => {
                const st = pretrip.find((p) => p.id === def.id)
                const done = !!st?.done
                return (
                  <div key={def.id} className="py-2.5 flex items-center gap-3">
                    <div
                      className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                        done ? 'bg-[#22C55E]/15 text-[#22C55E]' : 'bg-[#101E2E]/5 text-[#64748B]'
                      }`}
                    >
                      {done ? <CheckCircle2 className="h-5 w-5" /> : stepIcon(def.kind, 'h-5 w-5')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-[#15202B] leading-tight">{def.label}</div>
                      <div className="text-[11px] text-[#64748B] leading-tight mt-0.5 truncate">{def.hint}</div>
                    </div>
                    {done ? (
                      st?.photo ? (
                        <img src={st.photo} alt={def.label} className="h-9 w-12 rounded-lg object-cover border border-black/10" />
                      ) : (
                        <span className="text-[11px] font-semibold text-[#22C55E]">готово</span>
                      )
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openCamera(def.id)}
                          className="h-8 w-8 rounded-lg bg-[#F97316] text-white flex items-center justify-center shadow"
                          aria-label={`Сделать фото: ${def.label}`}
                        >
                          <Camera className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => demoShot(def.id)}
                          className="text-[10.5px] font-semibold text-[#64748B] bg-[#101E2E]/5 rounded-lg px-2 h-8"
                          title="Пройти шаг без камеры (тестовый режим)"
                        >
                          демо
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {allDone ? (
            <button
              onClick={start}
              className="mt-3 w-full h-12 bg-[#22C55E] text-white rounded-xl text-[15px] font-bold shadow-lg flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
            >
              <Play className="h-5 w-5" />
              Начать маршрут
            </button>
          ) : (
            <div className="mt-3 h-12 rounded-xl bg-[#101E2E]/5 text-[#64748B] text-[13px] font-semibold flex items-center justify-center text-center px-4">
              «Начать маршрут» откроется после всех шагов
            </div>
          )}
        </div>
      )
    } else {
      // in_progress: рейс идёт
      const progress = Math.round(simProgressF * 100)
      const remainKm = trip?.routeDistanceM ? Math.round((trip.routeDistanceM * (1 - simProgressF)) / 1000) : active.distanceKm
      activeFlow = (
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-[#F97316] text-white flex items-center justify-center shrink-0">
              <Truck className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold text-[#15202B]">Рейс {active.number.replace('ЗК', 'Z')} в пути</div>
              <div className="text-[12px] text-[#64748B]">
                {active.fromLabel} → {active.toLabel}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[16px] font-black text-[#15202B] tabular-nums leading-none">{progress}%</div>
              <div className="text-[10px] text-[#64748B] mt-0.5">осталось {remainKm} км</div>
            </div>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-[#E2E8F0] overflow-hidden">
            <div className="h-full bg-[#F97316] rounded-full" style={{ width: `${progress}%` }} />
          </div>
          <button
            onClick={() => setView('map')}
            className="mt-3 w-full h-11 bg-[#101E2E] text-white rounded-xl text-[14px] font-bold shadow-lg flex items-center justify-center gap-2"
          >
            <MapPin className="h-4.5 w-4.5" />
            Открыть навигацию
          </button>
        </div>
      )
    }
  }

  // --- список «новых» заявок --------------------------------------------------
  const anyAssigned = orders.some((o) => o.status === 'ASSIGNED')
  const listOrders = orders.filter((o) => o.number !== activeOrderNumber && o.status !== 'DONE')
  const detail = selected ? orders.find((o) => o.number === selected) : null

  const orderCard = (o: Order1C, clickable: boolean) => {
    const assigned = o.status === 'ASSIGNED'
    return (
      <button
        key={o.number}
        onClick={() => (clickable ? setSelected(o.number) : showToast('Заявка ещё в диспетчерской — ожидает ТС'))}
        className={`w-full text-left bg-white rounded-2xl border border-black/5 shadow-sm p-3.5 ${clickable ? '' : 'opacity-70'}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-black text-[#15202B]">{o.number}</span>
          <span
            className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${
              assigned ? 'bg-[#F97316]/15 text-[#C2410C]' : 'bg-[#101E2E]/5 text-[#64748B]'
            }`}
          >
            {assigned ? 'Назначена вам' : 'В диспетчерской'}
          </span>
        </div>
        <div className="text-[13px] font-semibold text-[#15202B] mt-1 flex items-center gap-1.5">
          <Building2Icon />
          {o.client}
        </div>
        <div className="text-[12px] text-[#64748B] mt-0.5">
          {o.cargo} · {o.weightT.toFixed(1)} т
        </div>
        <div className="mt-2 flex items-start gap-1.5 text-[12px] text-[#15202B] font-medium">
          <MapPin className="h-3.5 w-3.5 text-[#3B82F6] mt-0.5 shrink-0" />
          <span>
            {o.fromLabel} <span className="text-[#94A3B8]">→</span> {o.toLabel}
          </span>
        </div>
        <div className="mt-1.5 text-[11px] text-[#64748B]">
          Погрузка: {fmtDT(o.loadingAt)} · выгрузка {o.unloadingWindow}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#64748B]">
          <Truck className="h-3.5 w-3.5 shrink-0" />
          {o.vehicle}
          {o.trailer !== '—' ? ` · прицеп ${o.trailer}` : ''}
        </div>
      </button>
    )
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto bg-[#F5F7FA]">
      {/* шапка */}
      <div className="sticky top-0 z-10 bg-[#F5F7FA]/95 backdrop-blur px-4 pt-1 pb-2.5 border-b border-[#E2E8F0]">
        <div className="flex items-center gap-2">
          {detail && !activeOrderNumber ? (
            <button
              onClick={() => setSelected(null)}
              className="h-8 w-8 rounded-full bg-[#101E2E]/5 flex items-center justify-center"
              aria-label="Назад к списку"
            >
              <ArrowLeft className="h-4.5 w-4.5 text-[#15202B]" />
            </button>
          ) : null}
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-black text-[#15202B] leading-tight">Главная</div>
            <div className="text-[10.5px] text-[#64748B] leading-tight">
              Заявки из 1С: Сбыт → ТС и готовность → Диспетчерская
              {refreshedAt ? ' · обновлено' : offlineMode ? ' · офлайн: локальные данные' : ''}
            </div>
          </div>
          {activeOrderNumber && (
            <span className="text-[10px] font-bold rounded-full px-2 py-1 bg-[#F97316] text-white">
              {activeOrderNumber}
            </span>
          )}
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFilePicked} />

      <div className="px-3 py-3 flex flex-col gap-2.5 pb-6">
        {/* детали новой заявки (до взятия) */}
        {detail && !activeOrderNumber ? (
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
            <div className="flex items-center justify-between">
              <div className="text-[15px] font-black text-[#15202B]">{detail.number}</div>
              <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-[#F97316]/15 text-[#C2410C]">
                Назначена вам
              </span>
            </div>
            <div className="text-[13px] font-semibold text-[#15202B] mt-1.5">{detail.client}</div>
            <div className="text-[12px] text-[#64748B]">
              {detail.cargo} · {detail.weightT.toFixed(1)} т
            </div>

            <div className="mt-3 rounded-xl bg-[#101E2E]/4 p-3 flex flex-col gap-1.5 text-[12.5px] text-[#15202B]">
              <div className="flex items-start gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-[#3B82F6] mt-0.5 shrink-0" />
                <span>
                  <b>Погрузка:</b> {detail.fromLabel}, {fmtDT(detail.loadingAt)}
                </span>
              </div>
              <div className="flex items-start gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-[#EF4444] mt-0.5 shrink-0" />
                <span>
                  <b>Выгрузка:</b> {detail.toLabel}, {detail.unloadingWindow}
                </span>
              </div>
              <div className="flex items-start gap-1.5">
                <Truck className="h-3.5 w-3.5 text-[#64748B] mt-0.5 shrink-0" />
                <span>
                  <b>ТС:</b> {detail.vehicle}
                  {detail.trailer !== '—' ? `, прицеп ${detail.trailer}` : ''}
                </span>
              </div>
            </div>

            <div className="mt-3">
              <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wide">Документы по заявке</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {detail.docs.map((d) => (
                  <span key={d} className="text-[11px] font-medium bg-[#101E2E]/5 rounded-lg px-2 py-1 text-[#15202B]">
                    {d}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-3 text-[11px] text-[#64748B]">
              Назначил: {detail.assignedBy} · дистанция ≈ {detail.distanceKm} км
            </div>

            <button
              onClick={() => take(detail)}
              className="mt-3.5 w-full h-12 bg-[#F97316] text-white rounded-xl text-[15px] font-bold shadow-lg active:scale-[0.99] transition-transform"
            >
              Взять заявку
            </button>
            <div className="mt-1.5 text-center text-[10.5px] text-[#64748B]">
              Далее: построение маршрута → фотофиксация ТС и документов → старт
            </div>
          </div>
        ) : null}

        {/* активный воркфлоу */}
        {activeFlow}

        {/* рейс завершён: заявка ушла в «Историю», ждём новую из 1С */}
        {!active && orderStage === 'completed' && !anyAssigned && (
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 flex flex-col items-center gap-2 text-center">
            <CheckCircle2 className="h-9 w-9 text-[#22C55E]" />
            <div className="text-[14px] font-bold text-[#15202B]">Рейс завершён</div>
            <div className="text-[12px] text-[#64748B] leading-snug">
              Заявка сохранена в «Истории». Как только диспетчерская назначит следующую — она появится здесь.
            </div>
          </div>
        )}

        {/* заявки ещё нет: стартовый экран ожидания — доступы закрыты */}
        {!active && orderStage !== 'completed' && !anyAssigned && (
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 flex flex-col items-center gap-2 text-center">
            <div className="h-12 w-12 rounded-full bg-[#F97316]/12 flex items-center justify-center">
              <Radar className="h-6 w-6 text-[#F97316] animate-pulse" />
            </div>
            <div className="text-[14px] font-bold text-[#15202B]">Ожидание заявки из 1С…</div>
            <div className="text-[12px] text-[#64748B] leading-snug">
              Доступы откроются, когда придёт заявка: план рейса, маршрут, фотофиксация и навигация.
            </div>
          </div>
        )}

        {/* заголовок списка */}
        {!detail && !activeOrderNumber && (
          <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wide px-1">
            Заявки диспетчерской ({listOrders.filter((o) => o.status === 'ASSIGNED').length} назначены)
          </div>
        )}

        {/* список остальных заявок */}
        {listOrders.map((o) => orderCard(o, o.status === 'ASSIGNED' && !activeOrderNumber))}

        {activeOrderNumber && listOrders.length > 0 && (
          <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wide px-1 mt-1">
            Другие заявки диспетчерской
          </div>
        )}
      </div>
    </div>
  )
}

function Building2Icon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
      <path d="M10 18h4" />
    </svg>
  )
}
