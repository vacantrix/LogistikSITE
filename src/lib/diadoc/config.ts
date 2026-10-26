/**
 * Настройки интеграции с Диадоком (ЭТрН через API оператора ЭДО).
 *
 * Доступ выдаёт Контур: заявка на diadoc.ru/integrations/api → Кабинет интегратора →
 * client_id и client_secret, refresh_token выпускается там же (Refresh Token Flow).
 * Документация: https://developer.kontur.ru/docs/diadoc-api/
 *
 * Без DIADOC_CLIENT_ID интеграция выключена — раздел «Подписать ЭДО» работает
 * в прежнем режиме (подписи отмечаются в платформе).
 */

const env = (name: string, fallback = ''): string => (process.env[name] ?? fallback).trim()

export interface DiadocConfig {
  /** https://diadoc-api-staging.kontur.ru — тестовая площадка, https://diadoc-api.kontur.ru — боевая */
  apiUrl: string
  /** OpenID-провайдер Контура: токены выдаёт он, а не API Диадока */
  oidcUrl: string
  clientId: string
  clientSecret: string
  /** первый refresh_token из Кабинета интегратора; дальше актуальный хранится в DiadocState */
  refreshToken: string
  /** ящик АЭМЗ; пусто — первый ящик из GetMyOrganizations */
  boxId: string
  /** подписывать тестовой подписью Диадока (SignedContent.SignWithTestSignature) — только тестовые ящики */
  testSignature: boolean
  /** период фоновой сверки статусов, секунд; 0 — только по кнопке «Обновить» */
  syncIntervalSec: number
}

export function diadocConfig(): DiadocConfig {
  const apiUrl = env('DIADOC_API_URL', 'https://diadoc-api-staging.kontur.ru').replace(/\/+$/, '')
  return {
    apiUrl,
    oidcUrl: env('DIADOC_OIDC_URL', 'https://identity.kontur.ru').replace(/\/+$/, ''),
    clientId: env('DIADOC_CLIENT_ID'),
    clientSecret: env('DIADOC_CLIENT_SECRET'),
    refreshToken: env('DIADOC_REFRESH_TOKEN'),
    boxId: env('DIADOC_BOX_ID'),
    // на тестовой площадке по умолчанию тестовая подпись; на боевой — только явно
    testSignature: env('DIADOC_TEST_SIGNATURE', apiUrl.includes('staging') ? '1' : '0') === '1',
    syncIntervalSec: Number(env('DIADOC_SYNC_INTERVAL_SEC', '180')) || 0,
  }
}

export const diadocEnabled = (): boolean => Boolean(env('DIADOC_CLIENT_ID'))

/** Площадка для подписи в интерфейсе — без технических адресов: тестовая, рабочая или имитация */
export function diadocStandLabel(c = diadocConfig()): string {
  if (c.apiUrl.includes('diadoc-api-staging.kontur.ru')) return 'тестовая площадка Диадока'
  if (c.apiUrl.includes('diadoc-api.kontur.ru')) return 'Диадок'
  if (/\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(c.apiUrl)) return 'имитация Диадока'
  return 'свой стенд Диадока'
}

/**
 * Реквизиты АЭМЗ для титула Т1, которых нет в ящике Диадока: адрес погрузки (склад),
 * телефон, подписант и работник, отпускающий груз. Организацию (ИНН, КПП, адрес)
 * Диадок подставляет сам по ящику.
 */
export interface ShipperSettings {
  phone: string
  loading: { zip: string; region: string; city: string; street: string; building: string }
  signer: { position: string; lastName: string; firstName: string; middleName: string }
  loader: { position: string; lastName: string; firstName: string; middleName: string }
}

export function shipperSettings(): ShipperSettings {
  const signer = {
    position: env('EDO_SIGNER_POSITION', 'Начальник отдела логистики'),
    lastName: env('EDO_SIGNER_LAST_NAME'),
    firstName: env('EDO_SIGNER_FIRST_NAME'),
    middleName: env('EDO_SIGNER_MIDDLE_NAME'),
  }
  return {
    phone: env('EDO_SHIPPER_PHONE'),
    // склад отгрузки: г. Абинск, ул. Промышленная, д. 4 (Краснодарский край — код 23)
    loading: {
      zip: env('EDO_LOADING_ZIP', '353320'),
      region: env('EDO_LOADING_REGION', '23'),
      city: env('EDO_LOADING_CITY', 'Абинск'),
      street: env('EDO_LOADING_STREET', 'Промышленная'),
      building: env('EDO_LOADING_BUILDING', '4'),
    },
    signer,
    // кто отпускает груз со склада; по умолчанию — тот же сотрудник, что подписывает Т1
    loader: {
      position: env('EDO_LOADER_POSITION', signer.position),
      lastName: env('EDO_LOADER_LAST_NAME', signer.lastName),
      firstName: env('EDO_LOADER_FIRST_NAME', signer.firstName),
      middleName: env('EDO_LOADER_MIDDLE_NAME', signer.middleName),
    },
  }
}
