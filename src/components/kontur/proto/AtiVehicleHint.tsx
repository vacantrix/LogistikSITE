'use client'

// Подсказка «кому из парка отдать груз с ATI.SU» — модальное окно по кнопке
// «Подбор водителя» прямо на карточке заявки/груза. Расчёт НЕ запускается сам
// при открытии окна: пользователь кликает «Произвести расчёт» → один POST
// /api/atisu/vehicle-hint → сервер считает математику по базе парка
// (территория освобождения машины, дата, режим 500–600 км/день с ночным
// отстоем). Никаких форм ввода. Типы зеркалят контракт сервера
// (src/lib/atisu/vehicle-hint.ts).

import { useEffect, useState } from 'react'
import { Calculator, CircleCheck, Phone, RefreshCw, Truck, TriangleAlert, X } from 'lucide-react'
import { CallButton } from './CallButton'
import { Pill } from './bits'
import { MONITOR_STATUSES } from '@/lib/kontur/constants'
import { authFetch } from '@/lib/kontur/session-token'

// ——— запрос (что клиент знает из карточки груза/заявки) ———

export type VehicleHintRequest = {
  from: string
  to: string
  dateFrom?: string | null
  dateTo?: string | null
  weightT?: number | null
  volumeM3?: number | null
  rate?: number | null
  perKm?: number | null
  km?: number | null
  cargo?: string | null
}

// ——— ответ сервера (зеркало контракта) ———

type HintReason = { kind: 'plus' | 'warn'; text: string }
type HintGrade = 'optimal' | 'good' | 'risky'
type HintTiming = 'early' | 'in_window' | 'edge'

export type HintCandidate = {
  score: number
  grade: HintGrade
  driver: { fullName: string; phone: string }
  vehicle: { brand: string; plate: string; capacityT: number | null; volumeM3: number | null }
  trailer: { plate: string; type: string } | null
  pinned: boolean
  freeKind: 'base' | 'trip'
  freesAt: string | null
  freesAtPoint: string
  nowRoute: string | null
  nowStatus: string | null
  deadheadKm: number | null
  deadheadDaysFast: number
  deadheadDaysSlow: number
  arriveFast: string
  arriveSlow: string
  timing: HintTiming
  idleDays: number
  tripKm: number
  tripDaysFast: number
  tripDaysSlow: number
  unloadEta: string
  homeAfterKm: number | null
  homeDetourKm: number | null
  totalKm: number
  rate: number | null
  revPerKm: number | null
  revRatio: number | null
  reasons: HintReason[]
}

type HintResult = {
  load: {
    from: string; to: string; km: number; weightT: number | null; volumeM3: number | null
    rate: number | null; perKm: number | null; dateFrom: string; dateTo: string
  }
  candidates: HintCandidate[]
  excluded: { driver: string; vehicle: string; reason: string }[]
  meta: { generatedAt: string; considered: number; activeTrips: number; freeOnBase: number; notes: string[] }
}

const RUB = (n: number) => n.toLocaleString('ru-RU')
const d = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

// Грейд кандидата — в языке статусов платформы (LogistikSITE): смысл несёт
// цветная точка, плашка нейтральная
const GRADE_META: Record<HintGrade, { label: string; cls: string; dot: string }> = {
  optimal: { label: 'Оптимум', cls: 'bg-slate-100 text-slate-700', dot: 'bg-emerald-500' },
  good: { label: 'Хорошо', cls: 'bg-slate-100 text-slate-700', dot: 'bg-sky-500' },
  risky: { label: 'Запасной', cls: 'bg-slate-100 text-slate-700', dot: 'bg-amber-500' },
}

const TIMING_LABEL: Record<HintTiming, string> = {
  early: 'к началу окна',
  in_window: 'в окно погрузки',
  edge: 'впритык (600 км/день)',
}

/** Оценка 0..100 → рейтинг по шкале 1–10 (с одной десятой: 8,4 из 10) */
const score10 = (score: number) =>
  (score / 10).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

// Цвет рейтинга на диаграммах — как статусные цвета платформы:
// оптимум — зелёный, хорошо — синий, запасной — янтарный
const RATING_BAR: Record<HintGrade, string> = {
  optimal: 'bg-emerald-500',
  good: 'bg-sky-500',
  risky: 'bg-amber-500',
}

/** Сегментный индикатор выгодности 1–10 на карточке кандидата */
function ScoreGauge({ score, grade }: { score: number; grade: HintGrade }) {
  const filled = Math.max(1, Math.min(10, Math.round(score / 10)))
  return (
    <div
      className="flex items-center gap-1"
      title={`Оценка выгодности ${score10(score)} из 10: ставка по кругу, подача, окно погрузки, документы`}
    >
      {Array.from({ length: 10 }).map((_, i) => (
        <span key={i} className={`h-2.5 w-3.5 rounded-[3px] ${i < filled ? RATING_BAR[grade] : 'bg-slate-200'}`} aria-hidden />
      ))}
      <span className="ml-1 whitespace-nowrap text-xs font-bold text-slate-900">{score10(score)}/10</span>
    </div>
  )
}

/** Диаграмма рейтинга выгодности: все кандидаты на одной шкале 1–10 */
function RatingChart({ candidates }: { candidates: HintCandidate[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-bold text-slate-900">Рейтинг выгодности · шкала 1–10</div>
        <div className="text-[11px] text-slate-400">10 — максимально выгодно отдать груз этому составу</div>
      </div>
      <div className="mt-2.5 space-y-2">
        {candidates.map((c, i) => (
          <div key={`${c.driver.fullName}-${c.vehicle.plate}-${i}`} className="flex items-center gap-2.5">
            <span className="w-5 shrink-0 text-right text-[11px] font-bold text-slate-400" title={`Место ${i + 1} по выгодности`}>{i + 1}</span>
            <div className="w-44 min-w-0 shrink-0 sm:w-56">
              <div className="truncate text-xs font-semibold text-slate-800" title={c.driver.fullName}>{c.driver.fullName}</div>
              <div className="truncate text-[10px] text-slate-400">{c.vehicle.brand} · {c.vehicle.plate}</div>
            </div>
            <div className="relative h-3.5 min-w-0 flex-1 rounded-full bg-slate-100" title={`Выгодность ${score10(c.score)} из 10`}>
              <div className={`h-3.5 rounded-full ${RATING_BAR[c.grade]}`} style={{ width: `${c.score}%` }} />
              <div
                className="pointer-events-none absolute inset-0 rounded-full"
                style={{ backgroundImage: 'repeating-linear-gradient(to right, transparent 0, transparent calc(10% - 1px), rgba(255,255,255,0.7) calc(10% - 1px), rgba(255,255,255,0.7) 10%)' }}
                aria-hidden
              />
            </div>
            <div className="w-16 shrink-0 whitespace-nowrap text-right text-xs font-bold text-slate-900">
              {score10(c.score)} <span className="font-medium text-slate-400">/ 10</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2.5 text-[10px] leading-relaxed text-slate-400">
        Оценка показывает, насколько выгодно отдать груз составу: ставка по кругу, порожний пробег подачи, окно
        погрузки, документы и связь. Первый в списке — лучший вариант.
      </div>
    </div>
  )
}

function daysRange(fast: number, slow: number): string {
  if (fast === 0 && slow === 0) return 'без хода'
  if (fast === slow) return `${fast} дн`
  return `${fast}–${slow} дн`
}

/** Мелкая ячейка математики: подпись сверху, значение снизу */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 px-2.5 py-1.5" title={hint}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="truncate text-xs font-semibold text-slate-800">{value}</div>
    </div>
  )
}

/** Карточка кандидата: водитель + машина + вся математика круга */
function CandidateCard({ c }: { c: HintCandidate }) {
  const g = GRADE_META[c.grade]
  const monLabel = c.nowStatus ? MONITOR_STATUSES[c.nowStatus] ?? c.nowStatus : null
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
      {/* Шапка: оценка, водитель, машина, где освобождается */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${g.cls}`} title="Итоговая оценка математикой подбора: подача, окно погрузки, ставка по кругу, документы, связь">
              <span className={`h-2 w-2 shrink-0 rounded-full ${g.dot}`} aria-hidden />
              {g.label} · {score10(c.score)} из 10
            </span>
            <span className="text-sm font-bold text-slate-900">{c.driver.fullName}</span>
            <span className="font-mono text-[11px] text-slate-500">{c.driver.phone}</span>
            {c.pinned && <Pill className="bg-blue-50 text-blue-700" title="Водитель закреплён за этой машиной и прицепом">закреплён</Pill>}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <span className="font-semibold">
              <Truck className="mr-1 inline h-3 w-3 text-slate-400" aria-hidden />
              {c.vehicle.brand} · {c.vehicle.plate}
            </span>
            <span>{c.vehicle.capacityT ?? '—'} т / {c.vehicle.volumeM3 ?? '—'} м³</span>
            {c.trailer && <span className="text-slate-500">прицеп {c.trailer.type} · {c.trailer.plate}</span>}
          </div>
          <div className="text-[11px] leading-relaxed text-slate-500">
            {c.freeKind === 'base' ? (
              <>Свободна на базе · {c.freesAtPoint}</>
            ) : (
              <>
                Освобождается {c.freesAt ? new Date(c.freesAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'} · {c.freesAtPoint}
                {c.nowRoute && <> · плечо {c.nowRoute}</>}
              </>
            )}
            {monLabel && <> · по мониторингу: {monLabel.toLowerCase()}</>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <ScoreGauge score={c.score} grade={c.grade} />
          <CallButton phone={c.driver.phone} name={c.driver.fullName} label="Водителю" />
        </div>
      </div>

      {/* Математика круга */}
      <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Подача"
          value={c.deadheadKm == null ? '—' : c.deadheadKm === 0 ? '0 км · на месте' : `${c.deadheadKm} км · ${daysRange(c.deadheadDaysFast, c.deadheadDaysSlow)}`}
          hint="Порожний пробег от точки освобождения машины до пункта погрузки груза"
        />
        <Stat
          label="Приезд на погрузку"
          value={`${d(c.arriveSlow)} · ${TIMING_LABEL[c.timing]}`}
          hint={`Осторожная оценка по 500 км/день: ${d(c.arriveSlow)}; при 600 км/день: ${d(c.arriveFast)}${c.idleDays >= 2 ? `. Простой до окна: ${c.idleDays} дн.` : ''}`}
        />
        <Stat
          label="Плечо груза"
          value={`${c.tripKm} км · ${daysRange(c.tripDaysFast, c.tripDaysSlow)}`}
          hint="Ход по плечу груза в режиме парка: 500–600 км/день, ночью отстой"
        />
        <Stat label="Выгрузка ~" value={d(c.unloadEta)} hint="Ориентировочно, при осторожном темпе 500 км/день от начала окна погрузки" />
        <Stat
          label="До базы"
          value={c.homeAfterKm == null ? '—' : `${c.homeAfterKm} км`}
          hint={`От пункта выгрузки до базы АЭМЗ (Абинск). Крюк к дому против порожнего возврата: ${c.homeDetourKm == null ? '—' : `${c.homeDetourKm > 0 ? '+' : ''}${c.homeDetourKm} км`}`}
        />
        <Stat
          label="Ставка по кругу"
          value={c.revPerKm == null ? '—' : `${c.revPerKm} ₽/км${c.revRatio != null ? ` (${Math.round(c.revRatio * 100)}%)` : ''}`}
          hint={`Ставка ${c.rate != null ? RUB(c.rate) : '—'} ₽, делённая на весь круг ${c.totalKm} км (подача + плечо); в скобках — доля от ₽/км плеча груза`}
        />
      </div>

      {/* Почему такая оценка */}
      {c.reasons.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {c.reasons.map((r, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-snug ${
                r.kind === 'plus' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              }`}
            >
              {r.kind === 'plus' ? <CircleCheck className="h-3 w-3 shrink-0" aria-hidden /> : <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />}
              {r.text}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Модальное окно подбора: расчёт НЕ запускается сам — только по клику «Произвести расчёт» */
export function AtiVehicleHint({ load, onClose }: { load: VehicleHintRequest; onClose: () => void }) {
  const [data, setData] = useState<HintResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState(false) // расчёт уже запускали по клику?

  // расчёт начинается ТОЛЬКО по явному клику — сервис сам считает по данным заявки
  const run = async () => {
    if (busy) return
    setBusy(true)
    setStarted(true)
    setData(null)
    setError(null)
    try {
      const res = await authFetch('/api/atisu/vehicle-hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(load),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
      setData(json as HintResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // закрытие по Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const l = data?.load
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Подбор водителя под груз"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="my-6 w-full max-w-4xl rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl">
        {/* Шапка */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-base font-bold text-slate-900">
              <Calculator className="h-4 w-4 text-slate-500" aria-hidden />
              Подбор водителя под груз
              <span className="text-slate-400">·</span>
              {load.from} → {load.to}
            </div>
            <div className="text-xs text-slate-500">
              {load.km ? `~${load.km} км · ` : ''}
              {load.weightT ? `${load.weightT} т` : ''}
              {load.weightT && load.volumeM3 ? ' / ' : ''}
              {load.volumeM3 ? `${load.volumeM3} м³` : ''}
              {load.rate ? ` · ${RUB(load.rate)} ₽${load.perKm ? ` (${load.perKm} ₽/км)` : ''}` : ''}
              {l && l.dateFrom ? ` · окно погрузки ${d(l.dateFrom)}${l.dateTo && d(l.dateTo) !== d(l.dateFrom) ? `–${d(l.dateTo)}` : ''}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {started && (
              <button
                type="button"
                onClick={run}
                disabled={busy}
                title="Повторить расчёт по той же заявке — актуальные позиции машин на момент пересчёта"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5${busy ? ' animate-spin' : ''}`} aria-hidden />
                Пересчитать
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть подбор"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Тело */}
        <div className="space-y-3 px-5 py-4">
          {/* Расчёт ещё не запускали: окно ничего не считает само — ждём явного клика */}
          {!started && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
              <Calculator className="mx-auto h-8 w-8 text-slate-400" aria-hidden />
              <div className="mt-2 text-sm font-bold text-slate-900">Подбор водителя из парка</div>
              <p className="mx-auto mt-1.5 max-w-xl text-xs leading-relaxed text-slate-500">
                Нажмите «Произвести расчёт» — сервис подберёт водителя и посчитает выгоду по каждому составу
                (подача, сроки, отсев по весу и окну погрузки).
              </p>
              <button
                type="button"
                onClick={run}
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-6 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
              >
                <Calculator className="h-4 w-4" aria-hidden />
                Произвести расчёт
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2.5 text-xs text-red-700">
              Не удалось посчитать подбор: {error}
              <button type="button" onClick={run} disabled={busy} className="ml-2 font-semibold underline underline-offset-2 disabled:opacity-50">
                Повторить расчёт
              </button>
            </div>
          )}

          {busy && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-100 bg-white" aria-hidden />
              ))}
              <div className="text-center text-xs text-slate-400">Считаем варианты…</div>
            </div>
          )}

          {data && data.candidates.length === 0 && !error && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
              Под этот груз не нашлось машин парка: никто не проходит по весу, объёму или окну погрузки.
              Причины — в списке «Не подошли» ниже.
            </div>
          )}

          {data && data.candidates.length > 0 && (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-bold text-slate-800">
                  Кому отдать груз · {data.candidates.length}
                  <span className="ml-2 text-[11px] font-normal text-slate-500">
                    рассмотрено {data.meta.considered} составов: {data.meta.activeTrips} в рейсе + {data.meta.freeOnBase} на базе
                  </span>
                </div>
              </div>
              <RatingChart candidates={data.candidates} />
              <div className="space-y-2.5">
                {data.candidates.map((c, i) => (
                  <CandidateCard key={`${c.driver.fullName}-${c.vehicle.plate}-${i}`} c={c} />
                ))}
              </div>
            </>
          )}

          {/* Не подошли */}
          {data && data.excluded.length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                Не подошли · {data.excluded.length}
                <span className="ml-2 text-[11px] font-normal text-slate-400">отсев математикой: жёсткие запреты</span>
              </summary>
              <div className="mt-2 space-y-1">
                {data.excluded.map((x, i) => (
                  <div key={i} className="flex flex-wrap items-baseline gap-x-2 text-[11px] leading-relaxed text-slate-500">
                    <span className="font-semibold text-slate-700">{x.driver}</span>
                    <span>· {x.vehicle} —</span>
                    <span className="text-red-600">{x.reason}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Пояснения */}
          {data && data.meta.notes.length > 0 && (
            <div className="rounded-lg bg-slate-100/70 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
              {data.meta.notes.map((n, i) => (
                <div key={i}>{n}</div>
              ))}
            </div>
          )}
        </div>

        {/* Футер */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700"
          >
            <Phone className="h-3.5 w-3.5" aria-hidden />
            Закрыть и обзвонить
          </button>
        </div>
      </div>
    </div>
  )
}
