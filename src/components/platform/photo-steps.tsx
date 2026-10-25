'use client'

/**
 * Пошаговая загрузка фото документов: шаги открываются по порядку — пока не загружен
 * шаг 1, шаг 2 закрыт. Пока файл читается, на шаге заполняется кружок с процентами.
 * Карточка водителя: 1 — страница паспорта с фото, 2 — регистрация; техника: 1 — машина, 2 — СТС.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ImagePlus, Lock, X } from 'lucide-react'
import { fileToCompressedDataUri, sleep } from '@/lib/demo-media'

export type StepFile = { fileName: string; dataUri: string }
export type StepLoading<K extends string> = { key: K; progress: number } | null

/** Кружок заполняется не быстрее этого — загрузку видно даже у мгновенно прочитанного файла */
const MIN_RING_MS = 900

/** Файлы шагов и загрузка одного файла с прогрессом; onError — файл не прочитался */
export function useStepUploads<K extends string>(onError: () => void) {
  const [files, setFiles] = useState<Partial<Record<K, StepFile>>>({})
  const [loading, setLoading] = useState<StepLoading<K>>(null)
  const busy = useRef(false)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  })

  /** Загружает файл в шаг; null — файл не прочитан или идёт другая загрузка */
  const load = useCallback(async (key: K, file: File): Promise<StepFile | null> => {
    if (busy.current) return null
    busy.current = true
    const t0 = Date.now()
    let real = 0
    setLoading({ key, progress: 0 })
    // показываем меньшее из настоящего прогресса и «не быстрее MIN_RING_MS»
    const tick = setInterval(() => setLoading({ key, progress: Math.min(real, (Date.now() - t0) / MIN_RING_MS) }), 40)
    try {
      const dataUri = await fileToCompressedDataUri(file, (share) => { real = share })
      real = 1
      const rest = MIN_RING_MS - (Date.now() - t0)
      if (rest > 0) await sleep(rest + 80)
      const up = { fileName: file.name || 'Фото', dataUri }
      setFiles((cur) => ({ ...cur, [key]: up }))
      return up
    } catch {
      onErrorRef.current()
      return null
    } finally {
      clearInterval(tick)
      setLoading(null)
      busy.current = false
    }
  }, [])

  const remove = useCallback((key: K) => {
    setFiles((cur) => {
      const next = { ...cur }
      delete next[key]
      return next
    })
  }, [])

  return { files, setFiles, loading, load, remove }
}

/** Кружок загрузки файла с процентами */
export function UploadRing({ progress }: { progress: number }) {
  const r = 18
  const c = 2 * Math.PI * r
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100)
  return (
    <div role="progressbar" aria-label="Загрузка файла" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="relative h-11 w-11">
      <svg viewBox="0 0 44 44" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" className="stroke-slate-200" />
        <circle
          cx="22" cy="22" r={r} fill="none" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
          className="stroke-blue-600 transition-[stroke-dashoffset] duration-100 ease-out"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums text-blue-700">{pct}%</span>
    </div>
  )
}

/** Номер шага: готово — галочка, текущий — синий, закрытый — серый */
function StepNumber({ n, state }: { n: number; state: 'done' | 'active' | 'locked' }) {
  const cls = state === 'done'
    ? 'bg-emerald-600 text-white'
    : state === 'active'
      ? 'bg-blue-600 text-white ring-2 ring-blue-200'
      : 'bg-slate-200 text-slate-500'
  return (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${cls}`} aria-hidden>
      {state === 'done' ? <Check className="h-3 w-3" /> : n}
    </span>
  )
}

export interface PhotoStep<K extends string> {
  key: K
  label: string
}

/** Шаги загрузки фото по порядку: текущий открыт, следующие ждут, готовые — с превью */
export function PhotoSteps<K extends string>({
  steps, files, loading, lock, showMiss, onPick, onRemove, badge, extra, tone,
}: {
  steps: PhotoStep<K>[]
  files: Partial<Record<K, StepFile>>
  loading: StepLoading<K>
  /** карточка допущена или занята нейросетью — фото не меняются */
  lock: boolean
  /** подсветка пустых шагов — после «Проверить» или «Автозаполнения» */
  showMiss: boolean
  onPick: (key: K, file: File) => void
  onRemove: (key: K) => void
  /** значок статуса в шапке шага (вердикт нейросети) */
  badge?: (key: K) => ReactNode
  /** строки под превью: качество, замечания */
  extra?: (key: K) => ReactNode
  /** рамка готового шага по вердикту */
  tone?: (key: K) => 'ok' | 'bad' | null
}) {
  // открыт первый незагруженный шаг; пустые шаги после него закрыты
  const current = steps.findIndex((s) => !files[s.key])
  const blocked = lock || loading !== null

  const input = (key: K) => (
    <input
      type="file"
      accept="image/*"
      className="sr-only"
      disabled={blocked}
      onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) onPick(key, f)
      }}
    />
  )

  return (
    <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Фотографии по шагам">
      {steps.map((s, i) => {
        const file = files[s.key]
        const isLoading = loading?.key === s.key
        const active = !file && !isLoading && i === current
        const locked = !file && !isLoading && i > current
        const miss = showMiss && !file && !isLoading
        const t = file ? tone?.(s.key) ?? null : null
        const frame = file
          ? t === 'ok' ? 'border-emerald-200 bg-emerald-50/40' : t === 'bad' ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-slate-50/40'
          : isLoading
            ? 'border-blue-300 bg-blue-50/40'
            : miss && !locked
              ? 'border-dashed border-red-400 bg-red-50/40'
              : active
                ? 'border-dashed border-blue-400 bg-blue-50/30'
                : 'border-dashed border-slate-200 bg-slate-50/40'
        return (
          <li key={s.key} className={`rounded-lg border p-2 ${frame}`} aria-current={active || isLoading ? 'step' : undefined}>
            <div className="flex items-center justify-between gap-1">
              <span className={`flex min-w-0 items-center gap-1.5 text-[11px] font-semibold ${miss && !locked ? 'text-red-600' : locked ? 'text-slate-400' : 'text-slate-700'}`}>
                <StepNumber n={i + 1} state={file ? 'done' : locked ? 'locked' : 'active'} />
                <span className="truncate">
                  {s.label}
                  {miss && !locked && <span aria-hidden> — добавьте фото</span>}
                </span>
              </span>
              {file && badge?.(s.key)}
            </div>

            {file ? (
              <>
                <img src={file.dataUri} alt={`Фото: ${s.label}`} className="mt-1.5 h-16 w-full rounded border border-slate-200 bg-white object-contain" />
                <div className="mt-1 flex items-center justify-between gap-1">
                  <span className="truncate text-[10px] text-muted-foreground" title={file.fileName}>{file.fileName}</span>
                  {!lock && (
                    <>
                      <label className={`text-[10px] font-medium text-blue-700 ${blocked ? 'pointer-events-none opacity-50' : 'cursor-pointer hover:underline'}`}>
                        Заменить
                        {input(s.key)}
                      </label>
                      <button type="button" disabled={blocked} className="text-[10px] text-slate-400 hover:text-red-600 disabled:opacity-50" aria-label={`Убрать ${s.label}`} onClick={() => onRemove(s.key)}>
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </>
                  )}
                </div>
                {extra?.(s.key)}
              </>
            ) : isLoading ? (
              <div className="mt-1 flex h-16 items-center justify-center gap-2 rounded border border-blue-200 bg-white/70">
                <UploadRing progress={loading.progress} />
                <span className="text-[10px] font-medium text-blue-700">Загружаем…</span>
              </div>
            ) : locked ? (
              <div
                title={`Сначала загрузите шаг ${current + 1}`}
                className="mt-1 flex h-16 flex-col items-center justify-center gap-0.5 rounded border border-dashed border-slate-200 bg-white/40 text-slate-400"
              >
                <Lock className="h-3.5 w-3.5" aria-hidden />
                <span className="text-[10px] font-medium">Шаг {i + 1}</span>
              </div>
            ) : (
              <label
                title="JPG или PNG"
                className={`mt-1 flex h-16 flex-col items-center justify-center gap-0.5 rounded border border-dashed bg-white/70 text-center ${blocked ? 'pointer-events-none opacity-60' : 'cursor-pointer'} ${miss ? 'border-red-300 hover:border-red-400' : 'border-blue-300 hover:border-blue-500 hover:bg-blue-50/60'}`}
              >
                <ImagePlus className={`h-4 w-4 ${miss ? 'text-red-500' : 'text-blue-600'}`} aria-hidden />
                <span className={`text-[10px] font-medium ${miss ? 'text-red-600' : 'text-blue-700'}`}>Загрузить фото</span>
                {input(s.key)}
              </label>
            )}
          </li>
        )
      })}
    </ol>
  )
}
