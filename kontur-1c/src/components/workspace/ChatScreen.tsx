'use client'

// Обсуждение с водителями (чат диспетчерской) — двухпанельная форма 1С

import { useEffect, useRef, useState } from 'react'
import { C1Button, C1Input, FormTitleBar } from '@/components/1c/kit'
import { apiPost, fmtTime } from './api'
import { usePoll } from './usePoll'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

type Thread = { driverId: string; fullName: string; lastMessage: { body: string; sender: string; at: string } | null }
type Message = { id: string; sender: string; body: string; at: string }

export function ChatScreen({ onClose }: { onClose?: () => void }) {
  const [driverId, setDriverId] = useState<string | null>(null)
  const { data } = usePoll<{ threads: Thread[]; messages: Message[] }>(
    `/api/office/chat${driverId ? `?driverId=${driverId}` : ''}`,
  )
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [data?.messages.length, driverId])

  async function send() {
    if (!driverId || !text.trim()) return
    setSending(true)
    try {
      await apiPost('/api/office/chat', { driverId, body: text.trim(), actor: 'Диспетчер Е. Крылова' })
      setText('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка отправки')
    } finally {
      setSending(false)
    }
  }

  const activeName = (data?.threads ?? []).find((t) => t.driverId === driverId)?.fullName ?? ''

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <FormTitleBar title="Обсуждение" onClose={onClose} />

      <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2">
        <span className="text-[12px] text-[#5c5c5c]">Переписка с водителями; сообщения уходят водителю через SyncJournal (план обмена)</span>
        {driverId && <span className="ml-auto text-[12px] font-semibold text-[#1c1c1c]">{activeName}</span>}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Список водителей */}
        <div className="c1-scroll w-[280px] shrink-0 overflow-y-auto border-r border-[#d4d4d4] bg-white">
          <table className="c1-table">
            <thead>
              <tr><th>Водитель</th><th className="w-[60px]">Время</th></tr>
            </thead>
            <tbody>
              {(data?.threads ?? []).map((t) => (
                <tr key={t.driverId} className={cn(driverId === t.driverId && 'c1-row-sel')} onClick={() => setDriverId(t.driverId)}>
                  <td className="max-w-[210px]">
                    <div className="truncate">{t.fullName}</div>
                    <div className="truncate text-[11px] text-[#8a8a8a]">
                      {t.lastMessage ? `${t.lastMessage.sender === 'DRIVER' ? 'Водитель' : 'Диспетчер'}: ${t.lastMessage.body}` : 'нет сообщений'}
                    </div>
                  </td>
                  <td className="text-[11px] text-[#8a8a8a]">{t.lastMessage ? fmtTime(t.lastMessage.at) : ''}</td>
                </tr>
              ))}
              {(data?.threads ?? []).length === 0 && (
                <tr><td colSpan={2} className="py-6 text-center text-[12px] text-[#8a8a8a]">Диалогов нет</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Переписка */}
        <div className="flex min-w-0 flex-1 flex-col bg-white">
          <div className="c1-scroll flex-1 overflow-y-auto px-4 py-3" style={{ maxHeight: 'none' }}>
            {!driverId ? (
              <div className="flex h-56 items-center justify-center text-[12px] text-[#8a8a8a]">Выберите водителя в списке слева</div>
            ) : (
              <div className="space-y-2">
                {(data?.messages ?? []).map((m) => (
                  <div key={m.id} className={cn('flex', m.sender === 'DISPATCHER' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[75%] rounded-[4px] border px-2.5 py-1.5 text-[12px]',
                        m.sender === 'DISPATCHER' ? 'border-[#bcd2ea] bg-[#e8f1fb]' : 'border-[#d9d9d9] bg-[#f7f7f7]',
                      )}
                    >
                      <div className="whitespace-pre-wrap">{m.body}</div>
                      <div className="mt-0.5 text-[10px] text-[#8a8a8a]">
                        {m.sender === 'DRIVER' ? 'водитель · ' : 'диспетчер · '}{fmtTime(m.at)}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={bottom} />
              </div>
            )}
          </div>
          {driverId && (
            <div className="flex items-center gap-2 border-t border-[#d4d4d4] bg-[#f2f2f2] p-2">
              <C1Input
                className="flex-1"
                value={text}
                onChange={setText}
                placeholder="Сообщение водителю (уйдёт через SyncJournal)…"
              />
              <C1Button accent disabled={sending || !text.trim()} onClick={() => void send()}>
                <svg width="11" height="10" viewBox="0 0 12 11"><path d="M0 5.5L12 0 8 11 5.5 6.5z" fill="#4a2f00" /></svg>
                Отправить
              </C1Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
