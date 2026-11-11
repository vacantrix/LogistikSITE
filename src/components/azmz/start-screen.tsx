'use client'

/**
 * Стартовый экран приложения водителя — БЕЗ карты.
 *
 * Алгоритм заказчика: водитель кликнул на приложение → открывается этот экран
 * (логотип АЭМЗ + большая кнопка «Взять заявку»). Пока заявка не пришла —
 * режим ожидания. Далее шаги воркфлоу на этом же экране:
 *   Взять заявку → маршрут 2ГИС → фотофиксация (ТС, документы, ВУ, паспорт)
 *   → «Начать маршрут» — и только тогда открываются карта и всё остальное.
 */

import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  CheckCircle2,
  FileText,
  IdCard,
  LoaderCircle,
  MapPin,
  Play,
  Radar,
  Truck,
  Zap,
} from 'lucide-react'
import { useAzmz } from '@/lib/store'
import { PRETRIP_STEPS, type Order1C, type PretripStepDef } from '@/lib/demo/orders-data'
import { ConnectionChip } from '@/components/azmz/connection-chip'
import { InstallAppButton } from '@/components/pwa/install-button'

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

/** Файл → превью-dataURL (360px, JPEG) — для карточки шага. */
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

/** Логотип АЭМЗ: оранжевый бейдж с молнией (электрометаллургия) + словесный знак. */
function AemzLogo() {
  return (
    <div className="flex items-center gap-3.5">
      <div className="h-[68px] w-[68px] rounded-[20px] bg-gradient-to-b from-[#FB923C] to-[#EA580C] border border-white/25 shadow-[0_14px_36px_rgba(249,115,22,0.45)] flex flex-col items-center justify-center gap-0.5 shrink-0">
        <Zap className="h-[18px] w-[18px] text-white" fill="currentColor" strokeWidth={1} />
        <span className="text-white font-black text-[16px] leading-none tracking-tight">АЭМЗ</span>
      </div>
      <div>
        <div className="text-white font-black text-[21px] leading-tight">АЭМЗ Логистика</div>
        <div className="text-white/55 text-[12px] leading-tight mt-0.5">Приложение водителя · заявки из 1С</div>
      </div>
    </div>
  )
}

export function StartScreen() {
  const orders = useAzmz((s) => s.orders)
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
  const showToast = useAzmz((s) => s.showToast)
  const offlineMode = useAzmz((s) => s.offlineMode)

  const fileRef = useRef<HTMLInputElement>(null)
  const photoStepRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fetchOnceRef = useRef(false)

  // подтягиваем заявки и статусы с «1С» (в офлайне остаётся локальный сид).
  // Это единственный refresh до старта рейса: StartScreen — стартовый экран.
  useEffect(() => {
    if (fetchOnceRef.current) return
    fetchOnceRef.current = true
    fetch('/api/1c/orders')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { orders?: Order1C[] } | null) => {
        if (d?.orders?.length) useAzmz.getState().setOrders(d.orders)
      })
      .catch(() => {})
  }, [])

  const active = orders.find((o) => o.number === activeOrderNumber) ?? null
  const assigned = orders.find((o) => o.status === 'ASSIGNED') ?? null
  const doneCount = pretrip.filter((p) => p.done).length
  const allDone = pretrip.length > 0 && doneCount === pretrip.length

  // смена стадии воркфлоу — показываем новый экран сверху
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [orderStage])

  const take = (o: NonNullable<typeof assigned>) => {
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
      postTo1C('PRETRIP_STEP', active?.number ?? '', stepId)
    } catch {
      showToast('Не удалось прочитать снимок — попробуйте ещё раз')
    }
  }

  const demoShot = (stepId: string) => {
    const def = PRETRIP_STEPS.find((d) => d.id === stepId)
    completePretripStep(stepId, demoPhoto(def?.label ?? 'шаг'))
    postTo1C('PRETRIP_STEP', active?.number ?? '', stepId)
  }

  const start = () => {
    if (!active) return
    postTo1C('START_ROUTE', active.number)
    startRoute()
  }

  // --- содержимое -------------------------------------------------------------
  let body: React.ReactNode = null

  if (active && orderStage === 'routing') {
    body = (
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-6 flex flex-col items-center gap-3 text-center">
        <LoaderCircle className="h-10 w-10 text-[#F97316] animate-spin" />
        <div>
          <div className="text-[15px] font-bold text-[#15202B]">Строим маршрут…</div>
          <div className="text-[12px] text-[#64748B] mt-1">
            2ГИС Routing API · грузовик {active.weightT.toFixed(1)} т · пробки · выбор наилучшего варианта
          </div>
        </div>
      </div>
    )
  } else if (active && orderStage === 'route_ready') {
    // цифры — из реального ответа 2ГИС; при сбое — плановые из заявки
    const km = realRoute ? Math.round(realRoute.lengthM / 1000) : active.distanceKm
    const durMin = realRoute ? Math.max(1, Math.round(realRoute.durationS / 60)) : active.durationMin
    body = (
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
          className="mt-3.5 w-full h-12 bg-[#F97316] text-white rounded-xl text-[15px] font-bold shadow-lg active:scale-[0.99] transition-transform"
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
  } else if (active && orderStage === 'prep') {
    body = (
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
            className="mt-3 w-full h-14 bg-[#22C55E] text-white rounded-2xl text-[16px] font-black shadow-lg flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
          >
            <Play className="h-5.5 w-5.5" fill="currentColor" />
            Начать маршрут
          </button>
        ) : (
          <div className="mt-3 h-14 rounded-2xl bg-[#101E2E]/5 text-[#64748B] text-[13px] font-semibold flex items-center justify-center text-center px-4">
            «Начать маршрут» откроется после всех шагов
          </div>
        )}
      </div>
    )
  } else if (assigned) {
    // заявка назначена — большая кнопка «Взять заявку»
    body = (
      <div>
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div className="text-[15px] font-black text-[#15202B]">{assigned.number}</div>
            <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-[#F97316]/15 text-[#C2410C]">
              Назначена вам
            </span>
          </div>
          <div className="text-[13px] font-semibold text-[#15202B] mt-1.5">{assigned.client}</div>
          <div className="text-[12px] text-[#64748B]">
            {assigned.cargo} · {assigned.weightT.toFixed(1)} т
          </div>

          <div className="mt-3 rounded-xl bg-[#101E2E]/4 p-3 flex flex-col gap-1.5 text-[12.5px] text-[#15202B]">
            <div className="flex items-start gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-[#3B82F6] mt-0.5 shrink-0" />
              <span>
                <b>Погрузка:</b> {assigned.fromLabel}, {fmtDT(assigned.loadingAt)}
              </span>
            </div>
            <div className="flex items-start gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-[#EF4444] mt-0.5 shrink-0" />
              <span>
                <b>Выгрузка:</b> {assigned.toLabel}, {assigned.unloadingWindow}
              </span>
            </div>
            <div className="flex items-start gap-1.5">
              <Truck className="h-3.5 w-3.5 text-[#64748B] mt-0.5 shrink-0" />
              <span>
                <b>ТС:</b> {assigned.vehicle}
                {assigned.trailer !== '—' ? `, прицеп ${assigned.trailer}` : ''}
              </span>
            </div>
          </div>

          <div className="mt-3">
            <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wide">Документы по заявке</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {assigned.docs.map((d) => (
                <span key={d} className="text-[11px] font-medium bg-[#101E2E]/5 rounded-lg px-2 py-1 text-[#15202B]">
                  {d}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-3 text-[11px] text-[#64748B]">
            Назначил: {assigned.assignedBy} · дистанция ≈ {assigned.distanceKm} км
          </div>
        </div>

        <button
          onClick={() => take(assigned)}
          className="mt-4 w-full h-16 bg-[#F97316] text-white rounded-2xl text-[17px] font-black shadow-[0_14px_36px_rgba(249,115,22,0.45)] flex items-center justify-center gap-2.5 active:scale-[0.99] transition-transform"
        >
          <Truck className="h-6 w-6" />
          Взять заявку
        </button>
        <div className="mt-2 text-center text-[10.5px] text-[#64748B]">
          Далее: построение маршрута → фотофиксация ТС и документов → старт
        </div>
      </div>
    )
  } else {
    // заявки нет: ожидание (или рейс только что завершён)
    const justCompleted = orderStage === 'completed'
    body = (
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-6 flex flex-col items-center gap-2.5 text-center">
        {justCompleted ? (
          <CheckCircle2 className="h-10 w-10 text-[#22C55E]" />
        ) : (
          <div className="h-14 w-14 rounded-full bg-[#F97316]/12 flex items-center justify-center">
            <Radar className="h-7 w-7 text-[#F97316] animate-pulse" />
          </div>
        )}
        <div className="text-[15px] font-bold text-[#15202B]">
          {justCompleted ? 'Рейс завершён' : 'Ожидание заявки из 1С…'}
        </div>
        <div className="text-[12px] text-[#64748B] leading-snug">
          {justCompleted
            ? 'Заявка сохранена в «Истории». Как только диспетчерская назначит следующую — кнопка «Взять заявку» появится здесь.'
            : 'Доступы откроются, когда придёт заявка: план рейса, маршрут, фотофиксация и навигация.'}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#F5F7FA]">
      {/* шапка с логотипом */}
      <div className="bg-[#101E2E] px-5 pt-6 pb-10 shrink-0 relative overflow-hidden">
        <div
          className="absolute -right-10 -top-14 h-44 w-44 rounded-full bg-[#F97316]/15 blur-2xl pointer-events-none"
          aria-hidden
        />
        <div
          className="absolute -left-12 bottom-[-70px] h-40 w-40 rounded-full bg-[#2563EB]/15 blur-2xl pointer-events-none"
          aria-hidden
        />
        <div className="flex items-start justify-between gap-2 relative">
          <AemzLogo />
          <ConnectionChip />
        </div>
        <div className="relative mt-3 flex">
          <InstallAppButton />
        </div>
        {offlineMode && (
          <div className="relative mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#FDBA74] bg-[#F97316]/15 rounded-full px-2.5 py-1">
            <span className="h-2 w-2 rounded-full bg-[#F97316]" />
            Офлайн-режим: операции уйдут при появлении сети
          </div>
        )}
        {activeOrderNumber && (
          <div className="relative mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold text-white bg-[#F97316] rounded-full px-2.5 py-1">
            <Truck className="h-3.5 w-3.5" />
            Заявка {activeOrderNumber} в работе
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFilePicked} />

      {/* контент поверх тёмной шапки */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 -mt-6 pb-6 relative z-10">
        {body}
      </div>
    </div>
  )
}
