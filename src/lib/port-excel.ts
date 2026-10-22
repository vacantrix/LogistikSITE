/**
 * Excel «Авто в порт» — форма заявки на пропуск в порт (19 колонок, как в файле порта).
 *
 * Используется в обе стороны:
 *  — загрузка: перевозчик присылает свой файл «Авто в порт» → карточки водителей, тягачей
 *    и прицепов в «Подать документы» (раньше такой файл не распознавался: ФИО в трёх
 *    колонках, серия и номер паспорта раздельно, даты — числами Excel);
 *  — выгрузка: логист формирует этот же файл по рейсам из «Реестра рейсов».
 *
 * Модуль без зависимостей от React/Next — проверяется отдельно (node).
 */

/** Заголовки ровно как в форме порта (порядок колонок важен) */
export const PORT_HEADERS = [
  'Фамилия(Только русские,английские буквы, тире)',
  'Имя(Только русские,английские буквы, тире)',
  'Отчество(Только русские,английские буквы, тире)',
  'Должность(Только русские и английские буквы, тире)',
  'Телефон(Только цифры)',
  'Дата рождения(Формат даты 01.01.2016)',
  'Место рождения(Только цифры, русские и английские буквы,символы:  -.?!)(,:;№ )',
  'Гражданство(Только цифры, русские и английские буквы,символы:  -.?!)(,: )',
  'Серия паспорта(Только цифры, русские и английские буквы,символы: -.)(,: )',
  'Номер паспорта(Только цифры, русские и английские буквы,символы: -.)(,: )',
  'Место выдачи(Только цифры, русские и английские буквы,символы:  -.?!)(,:;№ )',
  'Дата выдачи(Формат даты 01.01.2016)',
  'Место жительства (пребывания) (Только цифры, русские и английские буквы,символы:  -.?!)(,:;№ )',
  'Вид, марка, модель а/м (Только русские и английские буквы,символы:  -.?!)(,:)',
  'Гос.№ а/м, регион (Только цифры, русские и английские буквы)',
  'Гос.№ п/прицепа, регион (Только цифры, русские и английские буквы)',
  'Цвет (Только русские и английские буквы,символы:  -.?!)(,:)',
  'Собственник автомобиля',
  'Собственник прицепа',
] as const

/** Ширины колонок как в файле порта */
export const PORT_COL_WIDTHS = [18, 18, 22, 18, 21, 17, 27, 14, 17, 10, 30, 14, 23, 12, 14, 13, 14, 13, 13]

const cell = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim()
/** Название колонки без подсказки в скобках, нижним регистром: «Серия паспорта(Только…)» → «серия паспорта» */
const headKey = (h: unknown): string => cell(h).replace(/\(.*$/, '').trim().toLowerCase()

/** Это файл в форме порта? Узнаём по раздельным ФИО и колонке госномера автомобиля */
export function isPortSheet(header: unknown[]): boolean {
  const keys = header.map(headKey)
  return keys.includes('фамилия') && keys.includes('имя') && keys.some((k) => k.startsWith('гос.№ а/м'))
}

/** Дата из Excel: число (дни с 30.12.1899), Date или строка «ДД.ММ.ГГГГ» → «ДД.ММ.ГГГГ» */
export function excelDateToRu(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${String(v.getDate()).padStart(2, '0')}.${String(v.getMonth() + 1).padStart(2, '0')}.${v.getFullYear()}`
  }
  const n = typeof v === 'number' ? v : /^\d{4,5}(\.\d+)?$/.test(cell(v)) ? Number(cell(v)) : NaN
  if (Number.isFinite(n) && n > 1000 && n < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000)
    return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`
  }
  const s = cell(v)
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  return m ? `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}` : s
}

/** Серия + номер паспорта РФ: числа из Excel теряют ведущий ноль («0412» → 412) — восстанавливаем */
export function portPassport(series: unknown, number: unknown): string {
  const s = cell(series).replace(/\s/g, '')
  const n = cell(number).replace(/\s/g, '')
  if (!s && !n) return ''
  if (/^\d+$/.test(s) && /^\d+$/.test(n) && s.length <= 4 && n.length <= 6) {
    const ss = s.padStart(4, '0')
    return `${ss.slice(0, 2)} ${ss.slice(2)} ${n.padStart(6, '0')}`
  }
  return [s, n].filter(Boolean).join(' ') // иностранный паспорт: «AB 1234567»
}

/** Телефон: из Excel приходит числом без «+» — приводим к виду +7… для РФ */
function portPhone(v: unknown): string {
  const digits = cell(v).replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) return `+7${digits.slice(1)}`
  return digits.length >= 10 ? `+${digits}` : digits
}

const titleCase = (s: string): string =>
  s.toLowerCase().replace(/(^|[\s-])([а-яёa-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())

export interface PortLine {
  driver: {
    fullName: string; birthDate: string; birthPlace: string; citizenship: string; phone: string; position: string
    passport: string; passportIssuedBy: string; passportIssuedDate: string; address: string
    license: string; licenseTill: string; categories: string
  }
  truck?: { brand: string; plate: string; sts: string; color: string; owner: string }
  trailer?: { type: string; plate: string; sts: string; color: string; owner: string }
}

/** Разбор строк файла порта (первая строка — заголовки). Пустые строки пропускаются. */
export function parsePortRows(rows: unknown[][]): PortLine[] {
  if (rows.length === 0) return []
  const keys = rows[0].map(headKey)
  const col = (prefix: string): number => keys.findIndex((k) => k.startsWith(prefix))
  const idx = {
    last: col('фамилия'), first: col('имя'), middle: col('отчество'), position: col('должность'), phone: col('телефон'),
    birthDate: col('дата рождения'), birthPlace: col('место рождения'), citizenship: col('гражданство'),
    series: col('серия паспорта'), number: col('номер паспорта'), issuedBy: col('место выдачи'), issuedDate: col('дата выдачи'),
    address: col('место жительства'), brand: col('вид, марка'), plate: col('гос.№ а/м'), trailerPlate: col('гос.№ п/прицепа'),
    color: col('цвет'), truckOwner: col('собственник автомобиля'), trailerOwner: col('собственник прицепа'),
  }
  const at = (row: unknown[], i: number): unknown => (i >= 0 ? row[i] : '')
  const out: PortLine[] = []
  for (const row of rows.slice(1)) {
    const fullName = [at(row, idx.last), at(row, idx.first), at(row, idx.middle)].map(cell).filter(Boolean).map(titleCase).join(' ')
    if (!fullName) continue
    const line: PortLine = {
      driver: {
        fullName,
        birthDate: excelDateToRu(at(row, idx.birthDate)),
        birthPlace: cell(at(row, idx.birthPlace)),
        citizenship: cell(at(row, idx.citizenship)),
        phone: portPhone(at(row, idx.phone)),
        position: titleCase(cell(at(row, idx.position))),
        passport: portPassport(at(row, idx.series), at(row, idx.number)),
        passportIssuedBy: cell(at(row, idx.issuedBy)),
        passportIssuedDate: excelDateToRu(at(row, idx.issuedDate)),
        address: cell(at(row, idx.address)),
        // ВУ в форме порта нет — агент дозаполнит по фото ВУ
        license: '', licenseTill: '', categories: '',
      },
    }
    const plate = cell(at(row, idx.plate)).replace(/\s/g, '').toUpperCase()
    if (plate) {
      line.truck = { brand: cell(at(row, idx.brand)), plate, sts: '', color: cell(at(row, idx.color)), owner: cell(at(row, idx.truckOwner)) }
    }
    const trailerPlate = cell(at(row, idx.trailerPlate)).replace(/\s/g, '').toUpperCase()
    if (trailerPlate) {
      line.trailer = { type: '', plate: trailerPlate, sts: '', color: '', owner: cell(at(row, idx.trailerOwner)) }
    }
    out.push(line)
  }
  return out
}

export interface PortExportEntry {
  driver: {
    fullName: string; position: string; phone: string; birthDate: string; birthPlace: string; citizenship: string
    passport: string; passportIssuedBy: string; passportIssuedDate: string; address?: string
  }
  truck: { brand: string; plate: string; color: string; owner: string } | null
  trailer: { plate: string; owner: string } | null
}

const dash = (v: string | undefined): string => (v && v !== '—' ? v : '')

/** Строки листа «Авто в порт»: заголовки + по строке на рейс (экипаж) */
export function buildPortRows(entries: PortExportEntry[]): string[][] {
  const rows: string[][] = [[...PORT_HEADERS]]
  for (const e of entries) {
    const [last = '', first = '', ...rest] = dash(e.driver.fullName).split(/\s+/)
    const passport = dash(e.driver.passport).replace(/\s+/g, ' ').trim()
    const pm = passport.match(/^(\d{2})\s?(\d{2})\s?(\d{6})$/)
    const series = pm ? `${pm[1]}${pm[2]}` : passport.split(' ').slice(0, -1).join(' ')
    const number = pm ? pm[3] : passport.split(' ').slice(-1)[0] ?? ''
    rows.push([
      last, first, rest.join(' '),
      dash(e.driver.position) || 'Водитель',
      dash(e.driver.phone).replace(/\D/g, '').replace(/^7(\d{10})$/, '8$1'),
      dash(e.driver.birthDate), dash(e.driver.birthPlace), dash(e.driver.citizenship) || 'РФ',
      series, number, dash(e.driver.passportIssuedBy), dash(e.driver.passportIssuedDate), dash(e.driver.address),
      dash(e.truck?.brand), dash(e.truck?.plate).replace(/\s/g, ''), dash(e.trailer?.plate).replace(/\s/g, ''),
      dash(e.truck?.color), dash(e.truck?.owner), dash(e.trailer?.owner),
    ])
  }
  return rows
}
