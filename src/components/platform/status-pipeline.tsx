'use client'

/**
 * Плашка этапов заявки: Выбор рейса → Согласование ставки → Подтверждено →
 * Документы → Подготовка к рейсу → Всё готово.
 *
 * Живёт в «Моих заявках»: при выборе заявки подсвечивает этап, на котором
 * она находится (текущий этап пульсирует, пройденные отмечены «Готово»).
 * Цвета и подписи этапов также используются в фильтре списка заявок.
 */

import { Fragment } from 'react'
import {
  BadgeCheck,
  CheckCircle2,
  FileCheck2,
  Handshake,
  MousePointerClick,
  PackageCheck,
  Truck,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AgentStatusBadge } from '@/components/platform/common'
import type { RequestDTO, RequestStatus } from '@/lib/types'

interface PipelineStage {
  label: string
  icon: typeof MousePointerClick
  circle: string
  ring: string
  countCls: string
  line: string
  tip: string
}

export const PIPELINE_STAGES: PipelineStage[] = [
  {
    label: 'Выбор рейса',
    icon: MousePointerClick,
    circle: 'bg-sky-500',
    ring: 'ring-sky-100',
    countCls: 'text-sky-700',
    line: 'from-sky-200 to-teal-200',
    tip: 'Всё начинается здесь: вы выбираете рейс на «Площадке заявок» (статусы «Торги» или «Закрытые ставки») и подаёте свою ставку.',
  },
  {
    label: 'Согласование ставки',
    icon: Handshake,
    circle: 'bg-teal-500',
    ring: 'ring-teal-100',
    countCls: 'text-teal-700',
    line: 'from-teal-200 to-violet-200',
    tip: 'Ваша ставка на согласовании у отдела сбыта АЭМЗ: цена идёт вниз — побеждает лучшая ставка на понижение.',
  },
  {
    label: 'Подтверждено',
    icon: CheckCircle2,
    circle: 'bg-violet-500',
    ring: 'ring-violet-100',
    countCls: 'text-violet-700',
    line: 'from-violet-200 to-amber-200',
    tip: 'Вас согласовали — вы победили в торгах! Рейс закреплён за вами: можно подавать заявку — назначить водителя и загрузить документы.',
  },
  {
    label: 'Документы',
    icon: FileCheck2,
    circle: 'bg-amber-500',
    ring: 'ring-amber-100',
    countCls: 'text-amber-700',
    line: 'from-amber-200 to-blue-200',
    tip: 'Вы подаёте заявку: загрузите паспорт, ВУ, СТС, скан заявки и доверенность — нейросеть проверит каждый документ сразу при загрузке.',
  },
  {
    label: 'Подготовка к рейсу',
    icon: PackageCheck,
    circle: 'bg-blue-600',
    ring: 'ring-blue-100',
    countCls: 'text-blue-700',
    line: 'from-blue-200 to-emerald-200',
    tip: 'Мы готовим рейс к выезду: проверяем ваши документы, оформляем ЭДО с заводом и пропуск на погрузку — от вас ничего не требуется.',
  },
  {
    label: 'Готово',
    icon: Truck,
    circle: 'bg-emerald-500',
    ring: 'ring-emerald-100',
    countCls: 'text-emerald-700',
    line: 'from-emerald-200 to-emerald-300',
    tip: 'Вас оформили: рейс готов — можно отправлять водителя на погрузку и начинать выполнение.',
  },
  {
    label: 'Завершено',
    icon: BadgeCheck,
    circle: 'bg-emerald-600',
    ring: 'ring-emerald-100',
    countCls: 'text-emerald-700',
    line: '',
    tip: 'Водитель выполнил рейс — логист закрыл заявку. Заявка переехала в папку «Завершенные» ниже.',
  },
]

/** Какому этапу линии соответствует каждый статус рейса */
export const STAGE_OF_STATUS: Record<RequestStatus, number> = {
  PUBLISHED: 0,   // ещё на площадке — «Выбор рейса»
  AWARDED: 2,     // ставка согласована — «Подтверждено»
  DOCS_REVIEW: 3, // комплект загружается — «Документы»
  AT_LOGIST: 4,   // «Подготовка к рейсу»
  CONFIRMED: 5,   // «Готово» — можно отправлять водителя
  CLOSED: 6,      // логист закрыл рейс — «Завершено»
}

/**
 * Плашка положения заявки на линии этапов. Без заявки — вся линия серая;
 * с заявкой — подсвечены текущий этап и все пройденные, остальные серые.
 * Проигранная заявка (lost) — вся линия серая без подсветки этапов.
 */
export function StatusPipeline({ activeIdx, request, lost = false }: { activeIdx: number; request: RequestDTO | null; lost?: boolean }) {
  const hasRequest = request !== null && !lost
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="px-3 py-4 sm:px-6">
        {request === null ? (
          <div className="mb-3 text-xs text-slate-400">Выберите заявку — и здесь отразится, на каком этапе она находится</div>
        ) : lost ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-600">Рейс забрал другой перевозчик</span>
            <span className="text-slate-400">· заявка остаётся в полной истории</span>
          </div>
        ) : (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <AgentStatusBadge status={request.status} />
            <span className="text-slate-400">· этап {activeIdx + 1} из {PIPELINE_STAGES.length}</span>
          </div>
        )}
        <div className="flex items-start overflow-x-auto pb-1" aria-label="Этапы заявки">
          {PIPELINE_STAGES.map((st, i) => {
            const Icon = st.icon
            const colored = hasRequest && i <= activeIdx
            const isCurrent = hasRequest && i === activeIdx
            const isDone = hasRequest && i < activeIdx
            const stateWord = lost
              ? ' — забран другим перевозчиком'
              : isCurrent
                ? ' — текущий этап'
                : isDone
                  ? ' — готово'
                  : hasRequest ? ' — ожидает' : ''
            return (
              <Fragment key={st.label}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`${st.label}${stateWord}`}
                      className="flex w-24 shrink-0 cursor-default flex-col items-center gap-1 rounded-lg px-1 py-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:w-auto sm:flex-1"
                    >
                      <span className={`relative flex h-11 w-11 items-center justify-center rounded-full text-white shadow-sm ring-4 ${colored ? st.circle : 'bg-slate-200'} ${colored ? st.ring : 'ring-slate-100'}`} aria-hidden>
                        <Icon className="h-5 w-5" />
                        {isCurrent && (
                          <span className="absolute -right-1 -top-1 flex h-3 w-3">
                            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${st.circle}`} />
                            <span className={`relative inline-flex h-3 w-3 rounded-full ring-2 ring-white ${st.circle}`} />
                          </span>
                        )}
                      </span>
                      <span className={`whitespace-nowrap text-sm font-bold leading-none ${isDone ? 'text-emerald-600' : isCurrent ? st.countCls : 'text-slate-400'}`}>
                        {hasRequest ? (isDone ? 'Готово' : isCurrent ? 'Текущий этап' : 'Ожидает') : '\u00A0'}
                      </span>
                      <span className={`text-[11px] leading-tight sm:text-xs ${isCurrent ? 'font-semibold text-slate-900' : colored ? 'font-medium text-slate-600' : 'font-medium text-slate-400'}`}>
                        {st.label}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-64">
                    <span className="font-semibold">{st.label}. </span>{st.tip}
                    {isCurrent && <div className="mt-1 font-semibold">Заявка сейчас на этом этапе</div>}
                  </TooltipContent>
                </Tooltip>
                {i < PIPELINE_STAGES.length - 1 && (
                  <div aria-hidden className={`mt-5 h-1 w-7 shrink-0 rounded-full sm:w-10 ${hasRequest && i < activeIdx ? `bg-gradient-to-r ${st.line}` : 'bg-slate-200'}`} />
                )}
              </Fragment>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
