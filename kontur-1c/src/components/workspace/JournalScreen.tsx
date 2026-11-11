'use client'

// Журнал регистрации — аналог журнала 1С: кто, что, когда, уровень

import { useState } from 'react'
import { C1Button, C1Input, C1Select, FormTitleBar } from '@/components/1c/kit'
import { fmtDateTime, fmtTime } from './api'
import { usePoll } from './usePoll'

type Row = { id: number; user: string; action: string; entity: string; entityId: string | null; level: string; at: string }

const LEVEL_DOT: Record<string, string> = { info: '#8a8a8a', warning: '#e8a000', error: '#c43e1c' }
const LEVEL_RU: Record<string, string> = { info: 'Информация', warning: 'Предупреждение', error: 'Ошибка' }

export function JournalScreen({ onClose }: { onClose?: () => void }) {
  const [user, setUser] = useState('')
  const [action, setAction] = useState('')
  const [level, setLevel] = useState('ALL')
  const qs = new URLSearchParams({ limit: '300', ...(user ? { user } : {}), ...(action ? { action } : {}), ...(level !== 'ALL' ? { level } : {}) })
  const { data } = usePoll<{ rows: Row[] }>(`/api/office/journal?${qs.toString()}`)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <FormTitleBar title="Журнал регистрации" onClose={onClose} />

      {/* Отбор журнала */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2.5 py-1.5">
        <span className="c1-label">Пользователь:</span>
        <C1Input className="w-[220px]" value={user} onChange={setUser} placeholder="Логист, Диспетчер…, driver:" />
        <span className="c1-label">Действие:</span>
        <C1Input className="w-[160px]" value={action} onChange={setAction} placeholder="ASSIGN, CANCEL…" />
        <span className="c1-label">Уровень:</span>
        <C1Select
          className="w-[150px]"
          value={level}
          onChange={setLevel}
          options={[
            { value: 'ALL', label: 'Все уровни' },
            { value: 'info', label: 'Информация' },
            { value: 'warning', label: 'Предупреждение' },
            { value: 'error', label: 'Ошибка' },
          ]}
        />
        <span className="ml-auto text-[11px] text-[#8a8a8a]">Записей: {data?.rows.length ?? 0} · периодические события и все действия над документами</span>
      </div>

      <div className="c1-scroll min-h-0 flex-1 overflow-auto">
        <table className="c1-table">
          <thead>
            <tr>
              <th className="w-[140px]">Дата, время</th>
              <th className="w-[170px]">Пользователь</th>
              <th className="w-[160px]">Событие</th>
              <th className="w-[170px]">Объект</th>
              <th className="w-[150px]">Уровень</th>
              <th>Комментарий / идентификатор</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r) => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.at).split(' ')[0]} <span className="text-[#8a8a8a]">{fmtTime(r.at)}</span></td>
                <td>{r.user}</td>
                <td>{r.action}</td>
                <td>{r.entity}</td>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-[8px] w-[8px] rounded-full" style={{ background: LEVEL_DOT[r.level] ?? '#8a8a8a' }} />
                    {LEVEL_RU[r.level] ?? r.level}
                  </span>
                </td>
                <td className="text-[#5c5c5c]">{r.entityId ?? ''}</td>
              </tr>
            ))}
            {(data?.rows ?? []).length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-[12px] text-[#8a8a8a]">Записей нет</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex h-[30px] shrink-0 items-center gap-2 border-t border-[#d4d4d4] bg-[#f2f2f2] px-2">
        <C1Button className="!h-[24px]" onClick={() => { setUser(''); setAction(''); setLevel('ALL') }}>Сбросить отбор</C1Button>
        <span className="text-[11px] text-[#8a8a8a]">Аналог журнала регистрации 1С: кто, что, когда, уровень (152-ФЗ — просмотры фото тоже фиксируются)</span>
      </div>
    </div>
  )
}
