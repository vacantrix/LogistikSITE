import type { Metadata } from 'next'

// Диспетчерский контур теперь живёт внутри единой платформы: /kontur — старый адрес,
// который ведёт на нижний уровень «Собственный транспорт». API остаётся под /kontur/api.
export const metadata: Metadata = {
  title: 'АЭМЗ Поток — собственный транспорт',
}

export default function KonturLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children
}
