'use client'

/**
 * Экран «Пометки» — список пометок водителей (слой 2): TTL автора,
 * голосование («подтверждаю» / «устарела», только порядок показа),
 * неопубликованные помечены «В очереди». Автор пометок не показывается
 * и не хранится (решение №7 каркаса).
 */

import { useEffect, useState } from 'react'
import { ChevronLeft, Pin, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useAzmz } from '@/lib/store'
import { MARK_CATEGORIES } from '@/lib/rules'
import { fmtTtl, timeAgo } from '@/lib/format'

export function MarksScreen() {
  const marks = useAzmz((s) => s.marks)
  const pendingMarks = useAzmz((s) => s.pendingMarks)
  const setView = useAzmz((s) => s.setView)
  const updateWizard = useAzmz((s) => s.updateWizard)
  const voteMark = useAzmz((s) => s.voteMark)
  const [, tick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const all = [...pendingMarks, ...marks].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="absolute inset-0 bg-[#F5F7FA] flex flex-col">
      <div className="bg-[#101E2E] px-4 pt-3 pb-4 shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={() => setView('map')} aria-label="Назад" className="text-white/70 hover:text-white">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <div className="flex-1">
            <div className="text-white font-bold text-[17px]">Пометки</div>
            <div className="text-[11px] text-white/50">Водители — водителям · слой 2</div>
          </div>
          <button
            onClick={() => {
              updateWizard({ step: 1, start: undefined, end: undefined })
              setView('map')
            }}
            className="bg-[#F97316] text-white text-[13px] font-bold rounded-xl px-3.5 h-9 flex items-center gap-1.5"
          >
            <Pin className="h-4 w-4" />
            Новая
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {all.map((m) => {
          const cat = MARK_CATEGORIES[m.category] ?? { title: m.category, hex: '#64748B' }
          const pending = 'pending' in m && (m as { pending?: boolean }).pending === true
          const ttlLeft = m.expiresAt - Date.now()
          return (
            <div key={m.id} className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl flex items-center justify-center text-white" style={{ background: cat.hex }}>
                  <Pin className="h-4.5 w-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[15px] text-[#15202B]">{cat.title}</span>
                    {pending && (
                      <span className="text-[10px] bg-[#FACC15]/25 text-[#B45309] rounded-full px-2 py-0.5 font-semibold">
                        В очереди
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-[#64748B] truncate">{m.comment ?? 'Без комментария'}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[11px] text-[#64748B]">{timeAgo(m.createdAt)}</div>
                  <div className={`text-[11px] font-medium ${ttlLeft < 30 * 60_000 ? 'text-[#EF4444]' : 'text-[#22C55E]'}`}>
                    {fmtTtl(ttlLeft)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2.5">
                <button
                  onClick={() => voteMark(m.id, 1)}
                  disabled={pending}
                  className="flex items-center gap-1.5 h-8 rounded-lg border border-[#E2E8F0] px-2.5 text-[12px] font-semibold text-[#15202B] disabled:opacity-40"
                  aria-label="Подтверждаю"
                >
                  <ThumbsUp className="h-3.5 w-3.5 text-[#22C55E]" />
                  {m.confirmCount}
                </button>
                <button
                  onClick={() => voteMark(m.id, -1)}
                  disabled={pending}
                  className="flex items-center gap-1.5 h-8 rounded-lg border border-[#E2E8F0] px-2.5 text-[12px] font-semibold text-[#15202B] disabled:opacity-40"
                  aria-label="Устарела"
                >
                  <ThumbsDown className="h-3.5 w-3.5 text-[#EF4444]" />
                  {m.outdatedCount}
                </button>
                <span className="text-[10px] text-[#94A3B8] ml-auto">TTL {m.ttlHours >= 720 ? '30 дней' : `${m.ttlHours} ч`} · не продлевается</span>
              </div>
            </div>
          )
        })}
        {all.length === 0 && (
          <div className="text-center text-[#64748B] text-sm py-10">
            Пометок нет — добавьте первую с карты
          </div>
        )}
        <div className="text-[10px] text-[#94A3B8] pb-2">
          Голоса влияют только на порядок показа и счётчики; TTL автора не продлевается.
        </div>
      </div>
    </div>
  )
}
