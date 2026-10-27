'use client'

/**
 * Оверлей работы нейросети над карточками (Task 83).
 *
 * Пока нейросеть читает документы, экран перевозчика «замыливается»:
 * поверх всего окна — размытый фон (backdrop-blur) с мягкой виньеткой,
 * в центре — лупа со сканирующей полосой и сменяющиеся сообщения
 * («Проверяем…», «Читаем документ…», «Сверяем поля…»).
 *
 * Используется кнопками «Автозаполнение», «Проверить» и панелью «Проверить все».
 */
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ScanSearch } from 'lucide-react'

const DEFAULT_STEPS = ['Проверяем…', 'Читаем документ…', 'Распознаём поля…', 'Сверяем данные…']

/** Сменяющиеся сообщения: монтируется заново при каждом открытии — состояние всегда с нуля */
function ScanMessages({ list, title, sub }: { list: string[]; title?: string; sub?: string }) {
  const [idx, setIdx] = useState(0)

  // сообщения меняются каждые ~1.9 с, пока оверлей открыт
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => i + 1), 1900)
    return () => clearInterval(t)
  }, [])

  const message = list[idx % list.length]

  return (
    <motion.div
      className="relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white/90 p-6 text-center shadow-xl shadow-slate-900/10"
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
    >
      {/* лупа со сканирующей полосой */}
      <div className="relative mx-auto flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-blue-50">
        <ScanSearch className="h-9 w-9 text-blue-700" aria-hidden />
        <motion.div
          className="absolute inset-x-0 h-6 bg-gradient-to-b from-transparent via-blue-500/30 to-transparent"
          initial={{ y: -28 }}
          animate={{ y: 72 }}
          transition={{ duration: 1.35, repeat: Infinity, ease: 'linear' }}
          aria-hidden
        />
      </div>

      {title && (
        <div className="mt-3 text-sm font-medium text-slate-700">{title}</div>
      )}

      {/* сменяющиеся сообщения */}
      <div className="mt-1 h-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={message}
            className="text-base font-semibold text-slate-900"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            {message}
          </motion.div>
        </AnimatePresence>
      </div>

      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}

      {/* пульс-точки прогресса */}
      <div className="mt-3 flex items-center justify-center gap-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-blue-600/70"
            animate={{ opacity: [0.25, 1, 0.25] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
    </motion.div>
  )
}

export interface ScanOverlayProps {
  open: boolean
  /** заголовок над сообщениями, например «Автозаполнение» */
  title?: string
  /** сменяющиеся сообщения; по умолчанию — универсальный набор */
  steps?: string[]
  /** строка под сообщениями, например «Карточка 2 из 5» */
  sub?: string
}

export default function ScanOverlay({ open, title, steps, sub }: ScanOverlayProps) {
  const list = steps && steps.length > 0 ? steps : DEFAULT_STEPS

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="scan-overlay"
          role="status"
          aria-live="polite"
          aria-label={title ?? 'Нейросеть работает'}
          className="fixed inset-0 z-[80] flex items-center justify-center px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* «замыливание» экрана: размытие всего под оверлеем */}
          <div className="absolute inset-0 bg-white/45 backdrop-blur-md" aria-hidden />
          {/* мягкая виньетка, чтобы центр читался */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_25%,rgba(148,163,184,0.25)_100%)]" aria-hidden />

          <ScanMessages list={list} title={title} sub={sub} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
