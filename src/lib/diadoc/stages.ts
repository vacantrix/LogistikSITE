/**
 * Этапы перевозки по ЭТрН — тег kl-status, который Диадок.Логистика пишет в CustomData титулов.
 * https://developer.kontur.ru/docs/diadoc-api/logistic/waybill/status.html
 * Значения не исправляем (в «d-consingee-singed» опечатка — так в Диадоке).
 * Модуль без серверных зависимостей: им пользуется и интерфейс.
 */

export const ETRN_STAGE_LABEL: Record<string, string> = {
  'new': 'Перевозка создана',
  'wait-mintrans-api': 'Отправлено в ГИС ЭПД — ждём УИД',
  'r-wait-storekeeper': 'Погрузка: готовится титул Т1',
  'r-wait-consignor-sign': 'Погрузка: Т1 на подписи в АЭМЗ',
  'r-consignor-signed': 'Погрузка: Т1 подписан, доставляется перевозчику',
  'r-wait-driver-approve': 'Погрузка: ждём подтверждения водителя',
  'r-wait-carrier-sign': 'Погрузка: ждём подпись перевозчика (Т2)',
  'r-carrier-signed': 'Погрузка: перевозчик подписал Т2',
  'r-rejected': 'Перевозчик отказал в приёме груза',
  'on-the-way': 'Груз в пути',
  'd-wait-storekeeper': 'Выгрузка: грузополучатель готовит Т3',
  'd-wait-consignee-sign': 'Выгрузка: Т3 на подписи у грузополучателя',
  'd-consingee-singed': 'Выгрузка: грузополучатель подписал Т3',
  'd-wait-driver-approve': 'Выгрузка: ждём подтверждения водителя',
  'd-wait-carrier-sign': 'Выгрузка: ждём подпись перевозчика (Т4)',
  'd-carrier-signed': 'Выгрузка: перевозчик подписал Т4',
  'pd-carrier-signed': 'Частичная выдача: перевозчик подписал Т4',
  'pd-wait-carrier-readdress-sign': 'Частичная выдача: ждём переадресовку (Т7)',
  'pd-on-the-way': 'Частичная выдача: остаток груза в пути',
  'pd-wait-storekeeper': 'Частичная выдача: следующий грузополучатель готовит Т3',
  'pd-wait-consignee-sign': 'Частичная выдача: Т3 на подписи у грузополучателя',
  'pd-consingee-singed': 'Частичная выдача: грузополучатель подписал Т3',
  'pd-wait-driver-approve': 'Частичная выдача: ждём подтверждения водителя',
  'pd-wait-carrier-sign': 'Частичная выдача: ждём подпись перевозчика (Т4)',
  'completed': 'Перевозка завершена',
  'revoked': 'Перевозка отозвана',
  // свои этапы платформы — до того, как Диадок прислал kl-status
  'platform-delay-send': 'Т1 создан в Диадоке — подпишите его в веб-интерфейсе Диадока',
  'platform-sent': 'Т1 отправлен перевозчику',
  'platform-delivery': 'Выгрузка: получены титулы Т3/Т4',
}

export const etrnStageLabel = (stage: string | null | undefined): string =>
  stage ? ETRN_STAGE_LABEL[stage] ?? stage : 'Не отправлена в Диадок'

/** Какие титулы уже подписаны — для полоски «Т1 → Т2 → Т3 → Т4» */
export function etrnTitlesDone(stage: string | null | undefined, t1Signed: boolean, t2Signed: boolean): { t1: boolean; t2: boolean; t3: boolean; t4: boolean } {
  const s = stage ?? ''
  const t4 = s === 'completed' || s === 'd-carrier-signed' || s === 'pd-carrier-signed'
  const t3 = t4 || /^(p?d-)(consingee-singed|wait-driver-approve|wait-carrier-sign)$/.test(s) || s === 'platform-delivery'
  const t2 = t3 || t2Signed || s === 'r-carrier-signed' || s === 'on-the-way' || s.startsWith('d-') || s.startsWith('pd-')
  return { t1: t1Signed || t2, t2, t3, t4 }
}

/** Перевозка закончилась: завершена, отклонена перевозчиком или отозвана — сверку больше не ведём */
export const etrnStageFinal = (stage: string | null | undefined): boolean =>
  stage === 'completed' || stage === 'r-rejected' || stage === 'revoked'
