/**
 * Демо-автозаполнение карточек «Подать документы» (перевозчик).
 *
 * Зачем: на демо-стенде нужно быстро показать цикл «карточка → нейропроверка → база»,
 * не набирать 12 полей вручную. Генератор даёт РЕАЛИСТИЧНЫЕ случайные данные, которые
 * проходят форматные правила «Авто в порт» (src/lib/port-fields.ts):
 *   госномер тягача — А123ВС777, прицепа — АВ1234 23 (буквы только из транспортного набора);
 *   СТС — 10 цифр; VIN — 17 знаков без I/O/Q; паспорт — «52 10 123456»; телефон — +7 9XX….
 *
 * Данные помечаются как демонстрационные: фото документов загрузчик приносит сам,
 * автозаполнение их не подменяет.
 */

/** Случайный элемент массива */
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]

/** Случайное целое [a, b] */
const rnd = (a: number, b: number): number => a + Math.floor(Math.random() * (b - a + 1))

/** Цифровая строка длины n */
const digits = (n: number): string => Array.from({ length: n }, () => rnd(0, 9)).join('')

/** Буквы российских госномеров (транспортный набор, как в port-fields.ts) */
const PLATE_LETTERS = 'АВЕКМНОРСТУХ'
const plateLetter = (): string => PLATE_LETTERS[rnd(0, PLATE_LETTERS.length - 1)]

// ——— имена ———
const SURNAMES = ['Ковалёв', 'Петров', 'Синицын', 'Морозов', 'Гончаров', 'Литвинов', 'Тарасов', 'Шевцов', 'Дорошенко', 'Захаренко', 'Куликов', 'Бондарев']
const NAMES = ['Игорь', 'Пётр', 'Алексей', 'Сергей', 'Андрей', 'Николай', 'Дмитрий', 'Виктор', 'Олег', 'Роман']
const PATRONYMICS = ['Сергеевич', 'Петрович', 'Владимирович', 'Анатольевич', 'Николаевич', 'Иванович', 'Юрьевич', 'Викторович']
const FEMALE_SUR = ['Захарова', 'Морозова', 'Ковалёва', 'Тарасова', 'Шевцова']
const FEMALE_NAMES = ['Ольга', 'Ирина', 'Наталья', 'Светлана']

// ——— география Краснодарского края (регион стенда) ———
const CITIES = ['Краснодар', 'Абинск', 'Новороссийск', 'Кореновск', 'Усть-Лабинск', 'Крымск', 'Тимашевск', 'Славянск-на-Кубани']
const STREETS = ['ул. Мира', 'ул. Ленина', 'ул. Промышленная', 'ул. Дзержинского', 'ул. Красная', 'ул. Интернациональная', 'ул. Кубанская', 'ул. Шоссейная']
const REGIONS = ['Краснодарскому краю', 'г. Краснодару', 'г. Новороссийску', 'г. Абинску']
const PASSPORT_REGION_CODES = ['23', '52', '61', '01']

// ——— техника ———
const TRUCK_BRANDS = ['КАМАЗ 54901-CA', 'MAN TGX 18.470', 'Scania R500 A4x2', 'Volvo FH 460', 'МАЗ 5440-M9', 'DAF XF 480', 'КАМАЗ 5490-SP']
const TRAILER_OWNERS = ['ООО «Перевозчик Б»', 'ООО «Перевозчик А»', 'ООО «Перевозчик В»', 'ООО «ТрансЛогистик»']
const COLORS = ['белый', 'серый', 'синий', 'красный', 'зелёный', 'чёрный', 'серебристый']
const TRUCK_COLORS = COLORS

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Случайная дата в формате ДД.ММ.ГГГГ между годами */
const ruDate = (fromYear: number, toYear: number): string => {
  const y = rnd(fromYear, toYear)
  const m = rnd(1, 12)
  const d = rnd(1, m === 2 ? 28 : 28)
  return `${pad2(d)}.${pad2(m)}.${y}`
}

export interface DemoDriver {
  fullName: string
  birthDate: string
  citizenship: string
  phone: string
  birthPlace: string
  address: string
  passport: string
  passportIssuedBy: string
  passportIssuedDate: string
  position: string
}

/** Водитель: ФИО, паспорт, адрес — всё в валидных форматах */
export function demoDriver(): DemoDriver {
  const female = Math.random() < 0.2
  const surname = female ? pick(FEMALE_SUR) : pick(SURNAMES)
  const name = female ? pick(FEMALE_NAMES) : pick(NAMES)
  const city = pick(CITIES)
  const regionCode = pick(PASSPORT_REGION_CODES)
  return {
    fullName: `${surname} ${name} ${pick(PATRONYMICS)}`,
    birthDate: ruDate(1970, 1998),
    citizenship: 'РФ',
    phone: `+7 9${rnd(10, 99)} ${digits(3)}-${digits(2)}-${digits(2)}`,
    birthPlace: `г. ${pick(CITIES)}`,
    address: `${city === 'Абинск' ? 'г. Абинск' : `${city}`}, ${pick(STREETS)}, д. ${rnd(1, 120)}`,
    passport: `${regionCode} ${pad2(rnd(10, 89))} ${digits(6)}`,
    passportIssuedBy: `ОУФМС / ОВМ УМВД России по ${pick(REGIONS)}`,
    passportIssuedDate: ruDate(2010, 2024),
    position: pick(['Водитель', 'Водитель-экспедитор']),
  }
}

export interface DemoTruck {
  brand: string
  plate: string
  vin: string
  sts: string
  color: string
  owner: string
}

/** Тягач: госномер А123ВС777, VIN 17 знаков без I/O/Q, СТС 10 цифр */
export function demoTruck(): DemoTruck {
  // алфавит VIN: латиница без I, O, Q (как VIN_RE в port-fields.ts)
  const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'
  const vin = Array.from({ length: 17 }, () => pick(VIN_CHARS.split(''))).join('')
  return {
    brand: pick(TRUCK_BRANDS),
    plate: `${plateLetter()}${digits(3)}${plateLetter()}${plateLetter()}${pad2(rnd(1, 99))}`,
    vin,
    sts: digits(10),
    color: pick(TRUCK_COLORS),
    owner: pick(TRAILER_OWNERS),
  }
}

export interface DemoTrailer {
  type: string
  plate: string
  sts: string
  color: string
  owner: string
}

/** Прицеп: госномер АВ1234 23, СТС 10 цифр */
export function demoTrailer(type: string): DemoTrailer {
  return {
    type,
    plate: `${plateLetter()}${plateLetter()}${digits(4)}${pad2(rnd(1, 99))}`,
    sts: digits(10),
    color: pick(COLORS),
    owner: pick(TRAILER_OWNERS),
  }
}
