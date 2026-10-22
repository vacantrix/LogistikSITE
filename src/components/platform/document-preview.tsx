'use client'

/**
 * Полноразмерный просмотр документа (скана) в модальном окне (Task 62):
 * поворот на 90°, зум колесом/кнопками/кликом, «по размеру экрана»,
 * нативный полноэкранный режим и скачивание оригинала.
 * Открывается из окна «Прикрепленные документы» в «Справочниках».
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Download, FileText, Fullscreen, Maximize, RotateCcw, RotateCw, ZoomIn, ZoomOut,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const MIN_SCALE = 0.25
const MAX_SCALE = 5
const ZOOM_STEP = 1.25
const CLICK_ZOOM = 2.2

const clampScale = (v: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))

/** Кнопка панели инструментов: иконка + русская подпись (aria-label и title) */
function ToolButton({ label, onClick, children, className }: {
  label: string
  onClick: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className={`h-9 w-9 ${className ?? ''}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

export function DocumentPreviewModal({ open, onOpenChange, src, title, fileName, downloadUrl, pdf = false }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** URL картинки (уже защищённый, secureFileUrl) */
  src: string
  /** заголовок окна */
  title: string
  /** подпись файла */
  fileName?: string
  /** ссылка скачивания оригинала (уже с ?download=1) */
  downloadUrl?: string
  /** PDF — показываем встроенным просмотрщиком браузера (у него свои зум и прокрутка) */
  pdf?: boolean
}) {
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const viewRef = useRef<HTMLDivElement>(null)

  // при открытии окна — сброс к исходному виду (во время рендера, т.к.
  // setState в эффекте запрещён правилом react-hooks/set-state-in-effect)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setScale(1)
      setRotation(0)
    }
  }

  // следим за полноэкранным режимом: Esc браузера тоже выходит из него
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const zoomBy = useCallback((factor: number) => {
    setScale((s) => clampScale(s * factor))
  }, [])

  const toggleFullscreen = useCallback(() => {
    const el = viewRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen?.()
  }, [])

  const fsLabel = isFullscreen ? 'Выйти из полноэкранного режима' : 'Во весь экран'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] max-w-[96vw] flex-col gap-3 overflow-hidden p-4 sm:max-w-[96vw]">
        <DialogHeader className="pr-10">
          <DialogTitle className="truncate text-base">{title}</DialogTitle>
          <DialogDescription className="truncate text-xs">
            {fileName || 'Просмотр документа'}
          </DialogDescription>
        </DialogHeader>

        {pdf ? (
          <>
            {downloadUrl && (
              <div className="flex justify-end">
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <a href={downloadUrl} download>
                    <Download className="h-4 w-4" aria-hidden />
                    Скачать PDF
                  </a>
                </Button>
              </div>
            )}
            <iframe src={src} title={title} className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-slate-100" />
          </>
        ) : (<>
        {/* панель инструментов просмотра */}
        <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Инструменты просмотра документа">
          <ToolButton label="Повернуть против часовой стрелки" onClick={() => setRotation((r) => r - 90)}>
            <RotateCcw className="h-4 w-4" aria-hidden />
          </ToolButton>
          <ToolButton label="Повернуть по часовой стрелке" onClick={() => setRotation((r) => r + 90)}>
            <RotateCw className="h-4 w-4" aria-hidden />
          </ToolButton>
          <ToolButton label="Уменьшить" onClick={() => zoomBy(1 / ZOOM_STEP)}>
            <ZoomOut className="h-4 w-4" aria-hidden />
          </ToolButton>
          <ToolButton label="Увеличить" onClick={() => zoomBy(ZOOM_STEP)}>
            <ZoomIn className="h-4 w-4" aria-hidden />
          </ToolButton>
          <ToolButton label="По размеру экрана" onClick={() => setScale(1)}>
            <Maximize className="h-4 w-4" aria-hidden />
          </ToolButton>
          <ToolButton label={fsLabel} onClick={toggleFullscreen}>
            <Fullscreen className="h-4 w-4" aria-hidden />
          </ToolButton>
          <span className="ml-1 w-14 text-center text-xs tabular-nums text-slate-500" aria-live="polite">
            {Math.round(scale * 100)}%
          </span>
          {downloadUrl && (
            <Button asChild size="icon" variant="outline" className="ml-auto h-9 w-9" aria-label="Скачать оригинал" title="Скачать оригинал">
              <a href={downloadUrl} download>
                <Download className="h-4 w-4" aria-hidden />
              </a>
            </Button>
          )}
        </div>

        {/* контейнер просмотра: скролл, зум колесом, клик = приблизить/вернуть */}
        <div
          ref={viewRef}
          className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-slate-100"
          onWheel={(e) => zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)}
        >
          <img
            src={src}
            alt={title}
            onClick={() => setScale((s) => (s === 1 ? CLICK_ZOOM : 1))}
            style={{ transform: `rotate(${rotation}deg) scale(${scale})`, transition: 'transform 150ms ease' }}
            className={`mx-auto my-6 max-h-full max-w-full object-contain ${scale === 1 ? 'cursor-zoom-in' : 'cursor-zoom-out'}`}
          />
        </div>
        </>)}
      </DialogContent>
    </Dialog>
  )
}

/** Миниатюра документа с zoom-курсором: клик открывает полноразмерный просмотр */
export function ZoomableThumb({ src, alt, className, onClick, pdf = false }: {
  src: string
  alt: string
  className?: string
  onClick?: () => void
  /** PDF — вместо картинки плашка «PDF», клик открывает просмотр */
  pdf?: boolean
}) {
  if (pdf) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${alt} — открыть PDF`}
        className="mx-auto flex h-40 w-full max-w-[240px] flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      >
        <FileText className="h-10 w-10 text-red-600" aria-hidden />
        <span className="text-xs font-semibold">PDF — открыть</span>
      </button>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      onClick={onClick}
      className={`cursor-zoom-in object-contain ${className ?? ''}`}
      loading="lazy"
    />
  )
}
