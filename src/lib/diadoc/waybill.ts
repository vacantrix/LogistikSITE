/**
 * ЭТрН (электронная транспортная накладная) — титул грузоотправителя Т1.
 *
 * Формат утверждён приказом ФНС России от 09.12.2021 № ЕД-7-26/1065@. В Диадоке:
 * TypeNamedId = LogisticsWaybill, Function = reception, Version = kl_trn_mt_05_01, titleIndex = 0.
 * Платформа собирает упрощённый XML (UserDataXml по схеме ON_TRNACLGROT_MT_05_01_UserContract.xsd),
 * Диадок по нему генерирует титул по формату ФНС (метод GenerateTitleXml) — реквизиты
 * организаций (ИНН, КПП, наименование, адрес) он подставляет сам по BoxId.
 * https://developer.kontur.ru/docs/diadoc-api/logistic/waybill/waybill.html
 *
 * Модуль без зависимостей от базы — сборку XML проверяем отдельно по XSD.
 */

export const ETRN_TYPE = { typeNamedId: 'LogisticsWaybill', func: 'reception', version: 'kl_trn_mt_05_01', titleIndex: 0 } as const

export interface EtrnAddress {
  zip: string
  /** код субъекта РФ: 23 — Краснодарский край, 78 — Санкт-Петербург */
  region: string
  city: string
  street: string
  building: string
}

export interface EtrnVehicle {
  number: string
  /** ТипВлад: 1 — собственность, 3 — аренда, 4 — лизинг (коды формата ФНС) */
  ownership: string
  type: string
  model: string
  /** грузоподъёмность, т */
  maxWeight: string
  /** вместимость, м³ */
  capacity: string
  sts: string
  vin: string
}

/** Данные ЭТрН, которые логист видит и подтверждает перед отправкой Т1 */
export interface EtrnT1Input {
  number: string
  /** ДД.ММ.ГГГГ */
  date: string
  orderNumber: string
  orderDate: string
  consignee: { inn: string; kpp: string; name: string; phone: string }
  delivery: EtrnAddress
  cargo: {
    name: string
    condition: string
    packageMethod: string
    /** ВидТар — код вида тары */
    containerType: string
    places: string
    /** масса брутто, кг */
    grossWeightKg: string
    marks: string
  }
  carrierPhone: string
  driver: {
    lastName: string
    firstName: string
    middleName: string
    phone: string
  }
  vehicle: EtrnVehicle
  trailer: EtrnVehicle | null
  loading: {
    /** ДД.ММ.ГГГГTчч:мм:сс+03:00 — заявленные и фактические дата и время */
    statedArrival: string
    actualArrival: string
    actualDeparture: string
    /** МетОпрМасс: 01, 02 или 03 */
    weighingMethod: string
  }
}

/** Всё, что подставляется при отправке: ящики Диадока и реквизиты АЭМЗ из настроек */
export interface EtrnT1Context {
  shipperBoxId: string
  shipperInn: string
  shipperPhone: string
  consigneeBoxId: string
  carrierBoxId: string
  loadingAddress: EtrnAddress
  loader: { position: string; lastName: string; firstName: string; middleName: string }
  signer: { position: string; lastName: string; firstName: string; middleName: string }
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Атрибуты XML: пустые значения не выводим — необязательные поля схемы просто отсутствуют */
function attrs(a: Record<string, string | undefined>): string {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined && v.trim() !== '')
    .map(([k, v]) => ` ${k}="${esc(v!.trim())}"`)
    .join('')
}

const phones = (...list: string[]): string => {
  const items = list.map((p) => p.trim()).filter(Boolean)
  return items.length ? `<Phones>${items.map((p) => `<Phone>${esc(p)}</Phone>`).join('')}</Phones>` : ''
}

const address = (a: EtrnAddress): string =>
  `<AddressLogisticsWaybill><RussianAddress${attrs({
    ZipCode: a.zip, Region: a.region, City: a.city, Street: a.street, Building: a.building,
  })} /></AddressLogisticsWaybill>`

const transport = (tag: 'Vehicle' | 'Trailer', v: EtrnVehicle): string =>
  `<${tag}${attrs({
    Number: v.number.replace(/\s+/g, ''), Ownership: v.ownership, Type: v.type, Model: v.model,
    MaxWeight: v.maxWeight.replace(',', '.'), Capacity: v.capacity.replace(',', '.'),
    RegistrationNumber: v.sts.replace(/\s+/g, ''), Vin: v.vin,
  })} />`

/** Упрощённый XML титула Т1 (UserDataXml) для метода GenerateTitleXml */
export function buildT1UserXml(input: EtrnT1Input, ctx: EtrnT1Context): string {
  const d = input
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<LogisticsWaybillConsignorTitle${attrs({ Number: d.number, Date: d.date, OrderNumber: d.orderNumber, OrderDate: d.orderDate })}>`,
    '<WaybillInfo>',
    // грузоотправитель — АЭМЗ, сам не экспедитор
    `<ShipperInfo IsFreightForwarder="0"><Shipper><OrganizationReference${attrs({ BoxId: ctx.shipperBoxId })}>${phones(ctx.shipperPhone)}</OrganizationReference></Shipper></ShipperInfo>`,
    `<ConsigneeInfo><Consignee><OrganizationReference${attrs({ BoxId: ctx.consigneeBoxId })}>${phones(d.consignee.phone)}</OrganizationReference></Consignee>`,
    `<DeliveryAddres>${address(d.delivery)}</DeliveryAddres></ConsigneeInfo>`,
    '<CargoInfo><ItemDescriptions>',
    `<ItemDescription${attrs({
      Name: d.cargo.name, Condition: d.cargo.condition, PackageMethod: d.cargo.packageMethod,
      ContainerType: d.cargo.containerType, CargoSpaceQuantity: d.cargo.places, IsForStateSystemRegistration: '0',
    })}>`,
    `<Marks><Mark>${esc(d.cargo.marks.trim() || 'Отсутствует')}</Mark></Marks>`,
    `<PlannedMass GrossWeight="${esc(d.cargo.grossWeightKg)}" />`,
    '</ItemDescription>',
    '</ItemDescriptions></CargoInfo>',
    // переадресовка — только по указанию грузоотправителя
    `<ConsignorDirectives TransportationDirectives="Отсутствует"><ReaddressDetails AccountableSide="Consignor">${phones(ctx.shipperPhone)}</ReaddressDetails></ConsignorDirectives>`,
    `<Carrier><OrganizationReference${attrs({ BoxId: ctx.carrierBoxId })}>${phones(d.carrierPhone)}</OrganizationReference></Carrier>`,
    `<Drivers><DriverInfo${attrs({
      LastName: d.driver.lastName, FirstName: d.driver.firstName, MiddleName: d.driver.middleName,
    })}>${phones(d.driver.phone)}</DriverInfo></Drivers>`,
    `<VehicleInfo>${transport('Vehicle', d.vehicle)}${d.trailer ? `<Trailers>${transport('Trailer', d.trailer)}</Trailers>` : ''}</VehicleInfo>`,
    `<LoadingInfo${attrs({
      StatedArrivalDateTime: d.loading.statedArrival, StatedArrivalDateTimeEnablingTimeZone: '1',
      ActualArrivalDateTime: d.loading.actualArrival, ActualArrivalDateTimeEnablingTimeZone: '1',
      ActualDepartureDateTime: d.loading.actualDeparture, ActualDepartureDateTimeEnablingTimeZone: '1',
      GrossWeight: d.cargo.grossWeightKg, WeighingMethod: d.loading.weighingMethod, NumberOfPlaces: d.cargo.places,
    })}>`,
    `<ActualLoadingAddress>${address(ctx.loadingAddress)}</ActualLoadingAddress>`,
    // груз отпускает сам грузоотправитель (АЭМЗ) со своего склада
    `<LoadingPartyDetails MatchingShipper="1"><LoadingPartyEmployee${attrs({ Position: ctx.loader.position })}>`,
    '<JobResponsibilities>Отпуск груза со склада грузоотправителя</JobResponsibilities>',
    `<Fio${attrs({ LastName: ctx.loader.lastName, FirstName: ctx.loader.firstName, MiddleName: ctx.loader.middleName })} />`,
    `</LoadingPartyEmployee><RequisitesShipper${attrs({ Inn: ctx.shipperInn })} /></LoadingPartyDetails>`,
    `<LoadingOwnerDetails Type="1"><RequisitesShipper${attrs({ Inn: ctx.shipperInn })} /></LoadingOwnerDetails>`,
    '</LoadingInfo>',
    '</WaybillInfo>',
    `<Signer SignerType="1"><SignerDetails${attrs({
      Position: ctx.signer.position, LastName: ctx.signer.lastName, FirstName: ctx.signer.firstName, MiddleName: ctx.signer.middleName,
    })} /></Signer>`,
    '</LogisticsWaybillConsignorTitle>',
  ].join('\n')
}

const DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/
const DATETIME_RE = /^\d{2}\.\d{2}\.\d{4}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
const NUM_RE = /^\d+([.,]\d+)?$/

/** Незаполненные или неверные поля — понятным списком до отправки в Диадок */
export function validateT1Input(d: EtrnT1Input, ctx: Pick<EtrnT1Context, 'loader' | 'signer' | 'shipperPhone'>): string[] {
  const errors: string[] = []
  const need = (v: string | undefined, label: string) => { if (!v || !v.trim()) errors.push(`${label}: не заполнено`) }
  need(d.number, 'Номер ЭТрН')
  if (!DATE_RE.test(d.date)) errors.push('Дата ЭТрН: формат ДД.ММ.ГГГГ')
  need(d.orderNumber, 'Номер заявки')
  if (!DATE_RE.test(d.orderDate)) errors.push('Дата заявки: формат ДД.ММ.ГГГГ')
  if (!/^\d{10}(\d{2})?$/.test(d.consignee.inn.trim())) errors.push('ИНН грузополучателя: 10 или 12 цифр')
  if (!/^\d{6}$/.test(d.delivery.zip.trim())) errors.push('Адрес доставки: индекс — 6 цифр')
  if (!/^\d{2}$/.test(d.delivery.region.trim())) errors.push('Адрес доставки: код региона — 2 цифры')
  need(d.delivery.city, 'Адрес доставки: город')
  need(d.cargo.name, 'Груз: наименование')
  need(d.cargo.condition, 'Груз: состояние')
  need(d.cargo.packageMethod, 'Груз: способ упаковки')
  need(d.cargo.containerType, 'Груз: вид тары')
  if (!/^\d+$/.test(d.cargo.places.trim()) || Number(d.cargo.places) < 1) errors.push('Груз: количество мест — целое число')
  if (!NUM_RE.test(d.cargo.grossWeightKg.trim())) errors.push('Груз: масса брутто, кг — число')
  need(d.driver.lastName, 'Водитель: фамилия')
  need(d.driver.firstName, 'Водитель: имя')
  if (!/\d{10}/.test(d.driver.phone.replace(/\D/g, ''))) errors.push('Водитель: телефон')
  for (const [v, label] of [[d.vehicle, 'Тягач'], ...(d.trailer ? [[d.trailer, 'Прицеп']] : [])] as [EtrnVehicle, string][]) {
    need(v.number, `${label}: госномер`)
    if (!['1', '2', '3', '4', '5'].includes(v.ownership)) errors.push(`${label}: тип владения`)
    need(v.type, `${label}: тип ТС`)
    need(v.model, `${label}: марка`)
    if (!NUM_RE.test(v.maxWeight.trim())) errors.push(`${label}: грузоподъёмность, т — число`)
    if (!NUM_RE.test(v.capacity.trim())) errors.push(`${label}: вместимость, м³ — число`)
  }
  for (const [v, label] of [
    [d.loading.statedArrival, 'Погрузка: заявленное время подачи'],
    [d.loading.actualArrival, 'Погрузка: фактическое прибытие'],
    [d.loading.actualDeparture, 'Погрузка: фактическое убытие'],
  ] as const) if (!DATETIME_RE.test(v)) errors.push(`${label} — формат ДД.ММ.ГГГГTчч:мм:сс+03:00`)
  if (!['01', '02', '03'].includes(d.loading.weighingMethod)) errors.push('Погрузка: метод определения массы')
  if (!ctx.signer.lastName || !ctx.signer.firstName) errors.push('Подписант АЭМЗ не задан (EDO_SIGNER_LAST_NAME, EDO_SIGNER_FIRST_NAME)')
  if (!ctx.loader.lastName || !ctx.loader.firstName) errors.push('Сотрудник, отпускающий груз, не задан (EDO_LOADER_* или EDO_SIGNER_*)')
  if (!ctx.shipperPhone) errors.push('Телефон АЭМЗ для ЭТрН не задан (EDO_SHIPPER_PHONE)')
  return errors
}

// ——— черновик из данных платформы ———

const REGION_CODES: [RegExp, string][] = [
  [/краснодарск/i, '23'], [/санкт-петербург|спб/i, '78'], [/ставропольск/i, '26'], [/ростовск/i, '61'],
  [/москв/i, '77'], [/ленинградск/i, '47'], [/адыге/i, '01'], [/крым/i, '91'], [/севастопол/i, '92'],
  [/волгоградск/i, '34'], [/воронежск/i, '36'],
]
const CITY_REGION: [RegExp, string][] = [
  [/новороссийск|туапсе|краснодар|сочи|тихорецк|анап|абинск|крымск/i, '23'],
  [/ставрополь|невинномысск|пятигорск/i, '26'], [/ростов/i, '61'], [/санкт-петербург/i, '78'],
]

/** «Краснодарский край, г. Новороссийск, ул. Портовая, д. 7, лит. А» → поля адреса (индекс — вручную) */
export function parseRuAddress(raw: string): EtrnAddress {
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
  const pick = (re: RegExp) => parts.find((p) => re.test(p))
  const city = (pick(/^(г\.|город)\s/i) ?? '').replace(/^(г\.|город)\s*/i, '')
  const street = (pick(/^(ул\.|улица|пр-т|проспект|пер\.|ш\.|шоссе|наб\.)/i) ?? '').replace(/^(ул\.|улица)\s*/i, '')
  const building = (pick(/^(д\.|дом)\s/i) ?? '').replace(/^(д\.|дом)\s*/i, '')
  const zip = raw.match(/\b\d{6}\b/)?.[0] ?? ''
  const region = REGION_CODES.find(([re]) => re.test(raw))?.[1] ?? CITY_REGION.find(([re]) => re.test(city || raw))?.[1] ?? ''
  return { zip, region, city: city || (parts.length === 1 ? parts[0] : ''), street, building }
}

/** «Петров Пётр Сергеевич» → части ФИО */
export function splitFio(fullName: string): { lastName: string; firstName: string; middleName: string } {
  const [lastName = '', firstName = '', ...rest] = fullName.trim().split(/\s+/)
  return { lastName, firstName, middleName: rest.join(' ') }
}

/** Принадлежность ТС в платформе → ТипВлад */
export const OWNERSHIP_CODE: Record<string, string> = { OWNED: '1', HIRED: '3', LEASE: '4' }

const pad = (n: number) => String(n).padStart(2, '0')
export const ruDate = (d: Date): string => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
/** Дата и время по Москве для полей погрузки: ДД.ММ.ГГГГTчч:мм:сс+03:00 */
export function mskDateTime(d: Date): string {
  const m = new Date(d.getTime() + 3 * 3600_000)
  return `${pad(m.getUTCDate())}.${pad(m.getUTCMonth() + 1)}.${m.getUTCFullYear()}T${pad(m.getUTCHours())}:${pad(m.getUTCMinutes())}:00+03:00`
}

/** «24.10.2026» + «08:00–12:00» → заявленная подача «24.10.2026T08:00:00+03:00» */
export function statedArrival(loadDate: string, loadWindow: string): string {
  const time = loadWindow.match(/(\d{1,2}):(\d{2})/)
  return DATE_RE.test(loadDate) ? `${loadDate}T${pad(Number(time?.[1] ?? 8))}:${time?.[2] ?? '00'}:00+03:00` : ''
}
