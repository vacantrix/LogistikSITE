'use client'

/**
 * Стор клиента — аналог Room-базы каркаса: единственный источник правды UI.
 * Прямых обращений к сети из UI нет: запись через outbox (та же транзакция,
 * как OutboxRepository.kt), чтение — прямо из стора. Синхронизация — движок
 * src/lib/sync.ts (аналог PushWorker / PullWorker).
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  ChatMessageSnapshot,
  JournalEntry,
  MarkDto,
  MarkPublishOpPayload,
  MarksSnapshot,
  SystemNoteSnapshot,
  TrafficSnapshot,
  TripEventSnapshot,
  TripPointSnapshot,
  TripSnapshot,
} from '@/lib/protocol'
import { START_F, routeLengthM } from '@/lib/demo/route-data'
import { DEMO_HISTORY, DEMO_ORDERS, PRETRIP_STEPS, type HistoryEntry, type Order1C } from '@/lib/demo/orders-data'
import { fetchRealRoute, type RealRoute } from '@/lib/demo/real-route'

/** Реальная длина дорожной ломаной, м (63 км А-146) — для пересчёта f. */
const ROUTE_TOTAL_M = routeLengthM()

export type View = 'orders' | 'history' | 'map' | 'trip' | 'marks' | 'chat' | 'settings' | 'traffic' | 'gis2'
export type ConnectionState = 'online' | 'syncing' | 'offline'

/**
 * Воркфлоу заявки (поток 1С → диспетчерская → водитель):
 *   idle — заявка получена, водитель ещё не принял;
 *   routing — заявку приняли, строим маршрут (OSRM по дорогам OSM);
 *   route_ready — маршрут построен, можно переходить к фотофиксации;
 *   prep — предрейсовые фото (ТС × 3, документы заявки, ВУ, паспорт);
 *   in_progress — «Начать маршрут» нажата, рейс идёт (открываются все доступы);
 *   completed — рейс завершён, заявка в «Истории», ждём новую из 1С.
 */
export type OrderStage = 'idle' | 'routing' | 'route_ready' | 'prep' | 'in_progress' | 'completed'

export interface PretripStepState {
  id: string
  done: boolean
  photoAt?: number
  /** Превью снимка (dataURL, уменьшенный до 360px) — НЕ персистится (квота localStorage). */
  photo?: string
}

export interface OutboxOp {
  opId: string
  type: string
  payload: unknown
  state: 'PENDING' | 'DONE' | 'REJECTED'
  rejectReason?: string
  attempts: number
  createdAt: number
}

export interface PendingMark extends MarkDto {
  pending: true
}

interface Toast {
  id: number
  text: string
}

interface WizardState {
  step: 0 | 1 | 2 | 3 // 0 — закрыт; 1 точка старта; 2 точка конца; 3 форма
  start?: { lng: number; lat: number }
  end?: { lng: number; lat: number }
  category: string
  ttlHours: 6 | 12 | 720
  comment: string
}

interface AzmzState {
  hydrated: boolean
  view: View
  connection: ConnectionState
  offlineMode: boolean
  /** Идёт ли сетевой цикл прямо сейчас (для спиннера «Синхронизация…»). */
  syncActive: boolean
  cursor: number
  marksSince: number
  lastSyncAt: number | null

  trip: TripSnapshot | null
  points: TripPointSnapshot[]
  events: TripEventSnapshot[]
  chat: ChatMessageSnapshot[]
  notes: SystemNoteSnapshot[]
  marks: MarkDto[]
  pendingMarks: PendingMark[]
  outbox: OutboxOp[]
  /** Канал 3: последний снимок пробок (работает офлайн — «стухнет» сам). */
  traffic: TrafficSnapshot | null
  trafficSince: number

  /** Заявки из 1С (демо-сид + refresh с /api/1c/orders). */
  orders: Order1C[]
  /** Номер активной заявки (взятой водителем). */
  activeOrderNumber: string | null
  /** Стадия воркфлоу заявки. */
  orderStage: OrderStage
  /** Шаги фотофиксации активной заявки. */
  pretrip: PretripStepState[]
  /** Выполненные заявки — вкладка «История» (этап 1; далее переедет в настройки). */
  orderHistory: HistoryEntry[]

  /** Реальный маршрут по дорогам (OSRM/OSM, строится на стадии routing, null — демо-геометрия). */
  realRoute: RealRoute | null
  realRouteStatus: 'idle' | 'loading' | 'ready' | 'failed'

  simRunning: boolean
  simProgressF: number
  simSpeedKmh: number

  toast: Toast | null
  wizard: WizardState
  eventDialogOpen: boolean
  eventDialogPreselect: string | null

  setHydrated: () => void
  setView: (v: View) => void
  setConnection: (c: ConnectionState) => void
  setOfflineMode: (on: boolean) => void
  setSyncActive: (on: boolean) => void
  setEventDialog: (open: boolean, preselect?: string | null) => void
  showToast: (text: string) => void

  enqueueOp: (type: string, payload: unknown) => string
  pushResults: (results: { opId: string; status: string; rejectReason?: string }[]) => void

  applyJournal: (entries: JournalEntry[], cursor: number) => void
  applyMarksSnapshot: (snapshot: MarksSnapshot) => void
  applyTrafficSnapshot: (snapshot: TrafficSnapshot) => void

  enqueueTripEvent: (event: TripEventSnapshot) => void
  enqueueChatMessage: (message: ChatMessageSnapshot) => void
  markNotesRead: () => void
  voteMark: (markId: string, vote: 1 | -1) => void

  publishMarkFromWizard: () => void
  updateWizard: (patch: Partial<WizardState>) => void
  cancelWizard: () => void
  wizardTapPoint: (lng: number, lat: number) => void

  setSimRunning: (on: boolean) => void
  advanceSim: (dtSec: number) => void

  /** Воркфлоу заявки из 1С. */
  setOrders: (orders: Order1C[]) => void
  acceptOrder: (number: string) => void
  beginPretrip: () => void
  completePretripStep: (stepId: string, photo?: string) => void
  startRoute: () => void
  /** Повторный запрос маршрута (если в прошлый раз был фолбэк). */
  refetchRealRoute: () => void
  /** Рейс завершён: заявка → «История», ждём новую из 1С. */
  completeActiveTrip: () => void

  resetDemo: () => void
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id)
  if (idx === -1) return [...list, item]
  const copy = [...list]
  copy[idx] = item
  return copy
}

const emptyWizard: WizardState = { step: 0, category: 'POTHOLE', ttlHours: 6, comment: '' }

export const useAzmz = create<AzmzState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      view: 'orders',
      connection: 'online',
      offlineMode: false,
      syncActive: false,
      cursor: 0,
      marksSince: 0,
      lastSyncAt: null,

      trip: null,
      points: [],
      events: [],
      chat: [],
      notes: [],
      marks: [],
      pendingMarks: [],
      outbox: [],
      traffic: null,
      trafficSince: 0,

      simRunning: false,
      simProgressF: START_F,
      simSpeedKmh: 0,

      orders: DEMO_ORDERS,
      activeOrderNumber: null,
      orderStage: 'idle',
      pretrip: [],
      orderHistory: DEMO_HISTORY,

      realRoute: null,
      realRouteStatus: 'idle',

      toast: null,
      wizard: emptyWizard,
      eventDialogOpen: false,
      eventDialogPreselect: null,

      setHydrated: () => set({ hydrated: true }),
      setView: (view) => set({ view }),
      setConnection: (connection) => set({ connection }),
      setOfflineMode: (offlineMode) => set({ offlineMode }),
      setSyncActive: (syncActive) => set({ syncActive }),
      setEventDialog: (eventDialogOpen, eventDialogPreselect = null) => set({ eventDialogOpen, eventDialogPreselect }),
      showToast: (text) => {
        const id = Date.now()
        set({ toast: { id, text } })
        setTimeout(() => {
          if (get().toast?.id === id) set({ toast: null })
        }, 3800)
      },

      enqueueOp: (type, payload) => {
        const opId = uuid()
        set((s) => ({
          outbox: [...s.outbox, { opId, type, payload, state: 'PENDING', attempts: 0, createdAt: Date.now() }],
        }))
        return opId
      },

      pushResults: (results) => {
        const s = get()
        const handled = new Set(results.map((r) => r.opId))
        const rejectedRateLimitOps = results
          .filter((r) => r.status === 'REJECTED' && r.rejectReason === 'RATE_LIMIT')
          .map((r) => r.opId)
        const rejectedMarkIds = s.outbox
          .filter((op) => rejectedRateLimitOps.includes(op.opId) && op.type === 'MARK_PUBLISH')
          .map((op) => (op.payload as MarkPublishOpPayload).id)
        const confirmedMarkIds = s.outbox
          .filter(
            (op) =>
              op.type === 'MARK_PUBLISH' &&
              handled.has(op.opId) &&
              !rejectedRateLimitOps.includes(op.opId),
          )
          .map((op) => (op.payload as MarkPublishOpPayload).id)
        set((st) => ({
          outbox: st.outbox.filter((op) => !handled.has(op.opId)),
          pendingMarks: st.pendingMarks.filter((m) => !confirmedMarkIds.includes(m.id) && !rejectedMarkIds.includes(m.id)),
        }))
        if (rejectedMarkIds.length > 0) {
          get().showToast('Лимит: не более 10 пометок в час. Публикация отклонена.')
        }
      },

      applyJournal: (entries, cursor) => {
        set((s) => {
          let { trip, points, events, chat, notes } = s
          for (const e of entries) {
            if (e.entity === 'TRIP' && e.op === 'UPSERT') trip = e.payload as TripSnapshot
            else if (e.entity === 'TRIP_POINT' && e.op === 'UPSERT') points = upsertById(points, e.payload as TripPointSnapshot)
            else if (e.entity === 'TRIP_EVENT' && e.op === 'UPSERT') events = upsertById(events, e.payload as TripEventSnapshot)
            else if (e.entity === 'CHAT_MESSAGE' && e.op === 'UPSERT') chat = upsertById(chat, e.payload as ChatMessageSnapshot)
            else if (e.entity === 'SYSTEM_NOTE' && e.op === 'UPSERT') notes = upsertById(notes, e.payload as SystemNoteSnapshot)
          }
          return { trip, points, events, chat, notes, cursor, lastSyncAt: Date.now() }
        })
      },

      applyMarksSnapshot: (snapshot) => {
        set((s) => {
          // канал 2 инкрементальный (since): мержим по id, выкидываем протухшие
          const byId = new Map(s.marks.map((m) => [m.id, m]))
          for (const m of snapshot.marks) byId.set(m.id, m)
          const now = Date.now()
          return {
            marks: [...byId.values()].filter((m) => m.expiresAt > now),
            marksSince: snapshot.snapshotAt,
          }
        })
      },

      applyTrafficSnapshot: (snapshot) => {
        set((s) => {
          // пустой ответ (since не изменился) — оставляем прошлый снимок
          if (snapshot.segments.length === 0 && s.traffic) {
            return { trafficSince: snapshot.snapshotAt }
          }
          // мержим по id: боковые улицы/участки приходят только если в bbox
          const byId = new Map(s.traffic?.segments.map((x) => [x.id, x]) ?? [])
          for (const seg of snapshot.segments) byId.set(seg.id, seg)
          return {
            traffic: { ...snapshot, segments: [...byId.values()] },
            trafficSince: snapshot.snapshotAt,
          }
        })
      },

      enqueueTripEvent: (event) => {
        set((s) => ({
          events: upsertById(s.events, event),
          outbox: [
            ...s.outbox,
            { opId: uuid(), type: 'TRIP_EVENT_CREATE', payload: eventToPayload(event), state: 'PENDING', attempts: 0, createdAt: Date.now() },
          ],
        }))
      },

      enqueueChatMessage: (message) => {
        set((s) => ({
          chat: upsertById(s.chat, message),
          outbox: [
            ...s.outbox,
            {
              opId: uuid(),
              type: 'CHAT_SEND',
              payload: { id: message.id, tripId: message.tripId, body: message.body, createdAt: message.createdAt },
              state: 'PENDING',
              attempts: 0,
              createdAt: Date.now(),
            },
          ],
        }))
      },

      markNotesRead: () => {
        set((s) => {
          const unread = s.notes.filter((n) => !n.readAt)
          if (unread.length === 0) return {}
          return {
            notes: s.notes.map((n) => (n.readAt ? n : { ...n, readAt: Date.now() })),
            outbox: [
              ...s.outbox,
              ...unread.map((n) => ({
                opId: uuid(),
                type: 'NOTE_READ',
                payload: { noteId: n.id },
                state: 'PENDING' as const,
                attempts: 0,
                createdAt: Date.now(),
              })),
            ],
          }
        })
      },

      voteMark: (markId, vote) => {
        set((s) => {
          const patch = (m: MarkDto) => ({
            ...m,
            confirmCount: m.confirmCount + (vote === 1 ? 1 : 0),
            outdatedCount: m.outdatedCount + (vote === -1 ? 1 : 0),
          })
          return {
            marks: s.marks.map((m) => (m.id === markId ? patch(m) : m)),
            outbox: [
              ...s.outbox,
              { opId: uuid(), type: 'MARK_VOTE', payload: { markId, vote }, state: 'PENDING', attempts: 0, createdAt: Date.now() },
            ],
          }
        })
      },

      publishMarkFromWizard: () => {
        const { wizard } = get()
        if (!wizard.start || !wizard.end) return
        const id = uuid()
        const geometry = JSON.stringify({
          type: 'LineString',
          coordinates: [
            [wizard.start.lng, wizard.start.lat],
            [wizard.end.lng, wizard.end.lat],
          ],
        })
        const payload: MarkPublishOpPayload = {
          id,
          category: wizard.category as MarkPublishOpPayload['category'],
          geometry,
          comment: wizard.comment.trim() || undefined,
          ttlHours: wizard.ttlHours,
          clientCreatedAt: Date.now(),
        }
        set((s) => ({
          pendingMarks: [
            ...s.pendingMarks,
            {
              id,
              category: payload.category,
              geometry,
              comment: payload.comment,
              ttlHours: payload.ttlHours,
              confirmCount: 0,
              outdatedCount: 0,
              createdAt: Date.now(),
              expiresAt: Date.now() + payload.ttlHours * 3_600_000,
              pending: true,
            } as PendingMark,
          ],
          wizard: emptyWizard,
        }))
        get().enqueueOp('MARK_PUBLISH', payload)
        get().showToast('Пометка сохранена на устройстве' + (get().offlineMode ? ' — уйдёт при появлении сети' : ''))
      },

      updateWizard: (patch) => set((s) => ({ wizard: { ...s.wizard, ...patch } })),
      cancelWizard: () => set({ wizard: emptyWizard }),
      wizardTapPoint: (lng, lat) => {
        const { wizard, updateWizard } = get()
        if (wizard.step === 1) updateWizard({ start: { lng, lat }, step: 2 })
        else if (wizard.step === 2) updateWizard({ end: { lng, lat }, step: 3 })
      },

      setSimRunning: (on) =>
        set((s) => ({
          simRunning: on,
          simSpeedKmh: on ? 58 : 0,
          // повторный запуск — сначала маршрута, чтобы демо было повторяемым
          simProgressF: on ? START_F : s.simProgressF,
        })),
      advanceSim: (dtSec) => {
        const s = get()
        if (!s.simRunning || !s.trip) return
        // 20× ускорение демо: длина активной геометрии — OSRM или демо А-146
        const totalM = s.realRoute?.lengthM ?? ROUTE_TOTAL_M
        const speedMs = (s.simSpeedKmh / 3.6) * 20
        const df = (speedMs * dtSec) / totalM
        const nextF = Math.min(1, s.simProgressF + df)
        const arrived = nextF >= 1 && s.simProgressF < 1
        const jitter = Math.max(38, Math.min(66, s.simSpeedKmh + (Math.random() - 0.5) * 6))
        set({ simProgressF: nextF, simSpeedKmh: arrived ? 0 : jitter })
        if (arrived) {
          get().showToast('Вы прибыли в точку выгрузки — отметьте событие')
        }
      },

      // --- воркфлоу заявки из 1С ------------------------------------------------
      // merge, а не замена: локальный статус «выполнена» главнее демо-сида 1С,
      // иначе после рефреша выполненная заявка вернётся в список назначенных
      setOrders: (incoming) =>
        set((s) => ({
          orders: incoming.map((o) => {
            const local = s.orders.find((x) => x.number === o.number)
            return local?.status === 'DONE' ? { ...o, status: 'DONE' as const } : o
          }),
        })),
      acceptOrder: (number) => {
        if (get().activeOrderNumber) return
        set({ activeOrderNumber: number, orderStage: 'routing', realRouteStatus: 'loading' })
        get().showToast(`Заявка ${number} принята. Запрашиваем маршрут по дорогам…`)
        void (async () => {
          const t0 = Date.now()
          const rr = await fetchRealRoute()
          // пауза «Строим маршрут…» минимум 1.6 с — чтобы запрос был заметен
          const elapsed = Date.now() - t0
          if (elapsed < 1600) await new Promise((r) => setTimeout(r, 1600 - elapsed))
          const st = get()
          if (st.activeOrderNumber !== number || st.orderStage !== 'routing') return
          if (rr) {
            set({ realRoute: rr, realRouteStatus: 'ready', orderStage: 'route_ready' })
            get().showToast(`Маршрут по дорогам: ${(rr.lengthM / 1000).toFixed(0)} км · ~${Math.round(rr.durationS / 60)} мин`)
          } else {
            set({ realRouteStatus: 'failed', orderStage: 'route_ready' })
            get().showToast('Сервис маршрутов недоступен — работаем по демо-геометрии А-146')
          }
        })()
      },
      refetchRealRoute: () => {
        const number = get().activeOrderNumber
        if (!number || get().realRouteStatus === 'loading') return
        set({ orderStage: 'routing', realRouteStatus: 'loading' })
        void (async () => {
          const t0 = Date.now()
          const rr = await fetchRealRoute()
          const elapsed = Date.now() - t0
          if (elapsed < 1600) await new Promise((r) => setTimeout(r, 1600 - elapsed))
          const st = get()
          if (st.activeOrderNumber !== number || st.orderStage !== 'routing') return
          if (rr) {
            set({ realRoute: rr, realRouteStatus: 'ready', orderStage: 'route_ready' })
            get().showToast(`Маршрут по дорогам: ${(rr.lengthM / 1000).toFixed(0)} км · ~${Math.round(rr.durationS / 60)} мин`)
          } else {
            set({ realRouteStatus: 'failed', orderStage: 'route_ready' })
            get().showToast('Сервис маршрутов недоступен — работаем по демо-геометрии А-146')
          }
        })()
      },
      beginPretrip: () =>
        set({
          orderStage: 'prep',
          pretrip: PRETRIP_STEPS.map((d) => ({ id: d.id, done: false })),
        }),
      completePretripStep: (stepId, photo) =>
        set((s) => ({
          pretrip: s.pretrip.map((p) =>
            p.id === stepId ? { ...p, done: true, photoAt: Date.now(), photo: photo ?? p.photo } : p,
          ),
        })),
      startRoute: () => {
        const rr = get().realRoute
        set({ orderStage: 'in_progress', view: 'map' })
        get().setSimRunning(true)
        // старт на реальной геометрии: за ~30 м до первого манёвра (баннер, как в мокапе)
        if (rr && rr.maneuvers[0]) {
          set({ simProgressF: Math.max(0, Math.min(rr.maneuvers[0].f - 30 / rr.lengthM, 0.99)) })
        }
        get().showToast('Маршрут проложен — вы в пути. Рейс Z-1067')
      },
      completeActiveTrip: () => {
        const s = get()
        const o = s.orders.find((x) => x.number === s.activeOrderNumber)
        if (!o) return
        const entry: HistoryEntry = {
          number: o.number,
          client: o.client,
          cargo: o.cargo,
          fromLabel: o.fromLabel,
          toLabel: o.toLabel,
          distanceKm: s.realRoute ? Math.round(s.realRoute.lengthM / 1000) : o.distanceKm,
          vehicle: o.vehicle,
          completedAt: new Date().toISOString(),
          durationMin: s.realRoute ? Math.max(1, Math.round(s.realRoute.durationS / 60)) : o.durationMin,
          status: 'DONE',
        }
        set({
          orderHistory: [entry, ...s.orderHistory.filter((h) => h.number !== entry.number)],
          // заявка уходит из диспетчерского списка — помечаем выполненной
          orders: s.orders.map((x) => (x.number === o.number ? { ...x, status: 'DONE' as const } : x)),
          activeOrderNumber: null,
          orderStage: 'completed',
          pretrip: [],
          realRoute: null,
          realRouteStatus: 'idle',
          simRunning: false,
          simProgressF: START_F,
          simSpeedKmh: 0,
          view: 'orders',
        })
        get().showToast('Рейс завершён — заявка сохранена в «Истории»')
        // обратный канал в 1С: рейс закрыт (в проде — статус заявки «Выполнен»)
        void fetch('/api/1c/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: o.number, action: 'COMPLETE_TRIP' }),
        }).catch(() => {
          /* тестовый режим: ответ 1С не блокирует водительский флоу */
        })
        // имитация потока 1С: через 7 с диспетчерская назначает следующую заявку
        window.setTimeout(() => {
          const st = get()
          if (st.activeOrderNumber || st.orderStage !== 'completed') return
          const next = st.orders.find((x) => x.status === 'DISPATCH')
          if (!next) return
          set({
            orders: st.orders.map((x) =>
              x.number === next.number ? { ...x, status: 'ASSIGNED' as const, assignedBy: 'Диспетчер Е. Крылова' } : x,
            ),
          })
          // и фиксируем назначение в демо-1С, чтобы рефреш не сбросил статус
          void fetch('/api/1c/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: next.number, action: 'ASSIGN' }),
          }).catch(() => {
            /* тестовый режим */
          })
          get().showToast(`Из 1С: назначена заявка ${next.number} — откройте «Главную»`)
        }, 7_000)
      },

      resetDemo: () => {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('azmz-driver-store')
          window.location.reload()
        }
      },
    }),
    {
      name: 'azmz-driver-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        view: s.view,
        // offlineMode НЕ персистим: демо-тумблер «офлайн» не должен переживать
        // перезапуск — иначе приложение после старта выглядит «без связи»,
        // хотя сеть в порядке (опыт пилота: телефон «пишет офлайн» утром).
        cursor: s.cursor,
        marksSince: s.marksSince,
        lastSyncAt: s.lastSyncAt,
        trip: s.trip,
        points: s.points,
        events: s.events,
        chat: s.chat,
        notes: s.notes,
        marks: s.marks,
        pendingMarks: s.pendingMarks,
        outbox: s.outbox,
        traffic: s.traffic,
        trafficSince: s.trafficSince,
        simRunning: s.simRunning,
        simProgressF: s.simProgressF,
        simSpeedKmh: s.simSpeedKmh,
        orders: s.orders,
        activeOrderNumber: s.activeOrderNumber,
        orderStage: s.orderStage,
        orderHistory: s.orderHistory,
        realRoute: s.realRoute,
        realRouteStatus: s.realRouteStatus,
        // превью фото не персистим: dataURL раздувает localStorage (квота 5 МБ)
        pretrip: s.pretrip.map((p) => ({ id: p.id, done: p.done, photoAt: p.photoAt })),
      }),
      // в старых сессиях в localStorage мог остаться offlineMode=true —
      // принудительно стартуем «на связи» (симуляцию включают осознанно)
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<AzmzState>),
        offlineMode: false,
        syncActive: false,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated()
      },
    },
  ),
)

/** payload TRIP_EVENT_CREATE — та же структура, что TripEventOpPayload каркаса. */
function eventToPayload(e: TripEventSnapshot) {
  return {
    id: e.id,
    tripId: e.tripId,
    tripPointId: e.tripPointId,
    vehicleId: e.vehicleId,
    deviceId: e.deviceId,
    type: e.type,
    occurredAt: e.occurredAt,
    source: e.source,
    lat: e.lat,
    lon: e.lon,
    note: e.note,
  }
}
