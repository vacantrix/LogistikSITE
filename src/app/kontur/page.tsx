import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

/**
 * Старый адрес диспетчерской. Полное объединение: отдельного кабинета больше нет —
 * /kontur ведёт в единую платформу на нижний уровень «Собственный транспорт».
 * API диспетчерской остаётся по адресам /kontur/api/* и используется рабочим
 * пространством внутри платформы.
 *
 * На основном домене vacantrix.ru платформа живёт на поддомене /demo, поэтому
 * старую публичную ссылку уводим туда; локально и на поддомене хватает «/».
 */
export default async function KonturPage() {
  const host = (await headers()).get('host') ?? ''
  if (host === 'vacantrix.ru' || host === 'www.vacantrix.ru') {
    redirect('https://logistiksite.vacantrix.ru/demo/?tab=own-requests')
  }
  redirect('/?tab=own-requests')
}
