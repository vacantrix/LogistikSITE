'use client'

/**
 * Экран «Офис» — чат с диспетчером (мокап 3) + системные уведомления
 * (system_note). Отправка через outbox: без сети сообщение встаёт в очередь
 * и уходит при появлении связи. Диспетчерская часть демо-сервера отвечает
 * через sync_journal (интеграционная точка №3 каркаса).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Info, Paperclip, Send } from 'lucide-react'
import { useAzmz } from '@/lib/store'
import { fmtClock } from '@/lib/format'
import { DISPATCHER_NAME } from '@/lib/demo/route-data'

type Row =
  | { kind: 'msg'; id: string; sender: 'DRIVER' | 'DISPATCHER'; body: string; createdAt: number }
  | { kind: 'note'; id: string; body: string; createdAt: number }

export function ChatScreen() {
  const chat = useAzmz((s) => s.chat)
  const notes = useAzmz((s) => s.notes)
  const outbox = useAzmz((s) => s.outbox)
  const trip = useAzmz((s) => s.trip)
  const enqueueChatMessage = useAzmz((s) => s.enqueueChatMessage)
  const markNotesRead = useAzmz((s) => s.markNotesRead)
  const showToast = useAzmz((s) => s.showToast)
  const [text, setText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // открыть экран = прочитать уведомления (чтение уходит через outbox)
  useEffect(() => {
    markNotesRead()
  }, [markNotesRead])

  const rows = useMemo<Row[]>(() => {
    const msgs: Row[] = chat.map((m) => ({ kind: 'msg', id: m.id, sender: m.sender, body: m.body, createdAt: m.createdAt }))
    const ns: Row[] = notes.map((n) => ({ kind: 'note', id: n.id, body: n.body, createdAt: n.createdAt }))
    return [...msgs, ...ns].sort((a, b) => a.createdAt - b.createdAt)
  }, [chat, notes])

  const queuedIds = useMemo(
    () => new Set(outbox.filter((o) => o.type === 'CHAT_SEND').map((o) => (o.payload as { id: string }).id)),
    [outbox],
  )

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [rows.length])

  const send = () => {
    const body = text.trim()
    if (!body) return
    enqueueChatMessage({
      id: crypto.randomUUID(),
      driverId: useAzmz.getState().notes[0]?.driverId ?? '',
      tripId: trip?.id,
      sender: 'DRIVER',
      body,
      createdAt: Date.now(),
    })
    setText('')
  }

  return (
    <div className="absolute inset-0 bg-[#F5F7FA] flex flex-col">
      {/* шапка чата */}
      <div className="bg-[#101E2E] px-4 pt-3 pb-3 shrink-0 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-[#1B2E44] border border-white/10 flex items-center justify-center text-white font-bold text-[14px]">
          СД
        </div>
        <div className="flex-1">
          <div className="text-white font-bold text-[16px] leading-tight">Офис</div>
          <div className="text-[11px] text-white/55 flex items-center gap-1.5">
            {DISPATCHER_NAME} · диспетчер
            <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E] inline-block" />
            онлайн
          </div>
        </div>
        {queuedIds.size > 0 && (
          <span className="text-[10px] bg-[#FACC15]/20 text-[#FACC15] rounded-full px-2 py-1 font-semibold">
            в очереди: {queuedIds.size}
          </span>
        )}
      </div>

      {/* лента */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
        {rows.map((r) => {
          if (r.kind === 'note') {
            return (
              <div key={r.id} className="flex justify-center">
                <div className="bg-[#EEF2F7] text-[#64748B] text-[11px] rounded-full px-3 py-1.5 flex items-center gap-1.5 max-w-[90%]">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  {r.body}
                </div>
              </div>
            )
          }
          const mine = r.sender === 'DRIVER'
          const queued = mine && queuedIds.has(r.id)
          return (
            <div key={r.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-snug shadow-sm ${
                  mine
                    ? 'bg-[#101E2E] text-white rounded-br-md'
                    : 'bg-white text-[#15202B] border border-[#E2E8F0] rounded-bl-md'
                } ${queued ? 'opacity-80' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <span>{r.body}</span>
                  <span className={`text-[10px] mt-1 shrink-0 tabular-nums ${mine ? 'text-white/45' : 'text-[#94A3B8]'}`}>
                    {fmtClock(r.createdAt)}
                  </span>
                  {queued && <Clock className="h-3.5 w-3.5 text-[#FACC15] mt-1 shrink-0" />}
                </div>
              </div>
            </div>
          )
        })}
        {rows.length === 0 && <div className="text-center text-[#64748B] text-sm py-10">Сообщений нет</div>}
      </div>

      {/* ввод */}
      <div className="px-3 py-3 bg-white border-t border-[#E2E8F0] shrink-0 flex items-center gap-2">
        <button
          onClick={() => showToast('Вложения в чате появятся на этапе MVP')}
          className="h-10 w-10 rounded-xl border border-[#E2E8F0] flex items-center justify-center text-[#64748B] shrink-0"
          aria-label="Прикрепить"
        >
          <Paperclip className="h-4.5 w-4.5" />
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Сообщение…"
          className="flex-1 h-11 rounded-xl border border-[#E2E8F0] px-3 text-[14px] outline-none focus:border-[#F97316]"
        />
        <button
          onClick={send}
          className="h-11 w-11 rounded-xl bg-[#F97316] text-white flex items-center justify-center shrink-0 active:scale-95 transition-transform"
          aria-label="Отправить"
        >
          <Send className="h-4.5 w-4.5" />
        </button>
      </div>
    </div>
  )
}
