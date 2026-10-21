'use client'

/**
 * «Подать документы» (Task 29/30/32/33/35/48) — единственное место пополнения базы
 * аккаунта. Три вида карточек (Task 48): линия водителя (проформы водитель|тягач|
 * прицеп в одну строку, фотографии ниже линии), одиночное ТС и одиночный прицеп —
 * когда нужно добавить не всё сразу, а лишь часть. Внизу — три кнопки добавления:
 * «Добавить водителя», «Добавить ТС», «Добавить прицеп».
 * Excel из одной таблицы создаёт линии водителей с подставленными данными,
 * ничего не записывая в базу. Кнопка «Проверить все» последовательно прогоняет
 * ВСЕ карточки: сначала проверяет обязательные поля (незаполненное подсвечивается
 * красным), затем для линий водителей нейросеть читает фото, заполняет пустые
 * поля и сама допускает карточки в базу (или отклоняет с причинами); одиночные
 * ТС/прицепы допускаются сразу после валидации полей.
 */
import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import * as XLSX from 'xlsx'
import {
  ArrowRight, CarFront, CheckCircle2, FileSpreadsheet, ScanLine, Truck, Upload, UserPlus,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SectionHeader, type TabProps } from '@/components/platform/common'
import { useToast } from '@/hooks/use-toast'
import DriverLine, {
  TrailerLine, TruckLine, TRAILER_TYPES, type DriverLineInitial,
} from '@/components/platform/driver-intake'

type LineState = { id: string; initial?: DriverLineInitial; fromExcel: boolean }
type SoloState = { id: string }

let lineSeq = 0
const newLineId = () => {
  lineSeq += 1
  return `line-${Date.now()}-${lineSeq}`
}

// ——— единый Excel-шаблон: 15 водитель + 5 «Тягач: …» + 5 «Прицеп: …» ———
const DRIVER_COLS = [
  'ФИО', 'Дата рождения', 'Гражданство', 'Телефон', 'Адрес регистрации',
  'Паспорт', 'Кем выдан', 'Дата выдачи паспорта', 'Должность',
  'ВУ номер', 'ВУ действует до', 'Категории',
]
const TRUCK_COLS = ['Тягач: марка', 'Тягач: госномер', 'Тягач: СТС', 'Тягач: цвет', 'Тягач: собственник']
const TRAILER_COLS = ['Прицеп: тип', 'Прицеп: госномер', 'Прицеп: СТС', 'Прицеп: цвет', 'Прицеп: собственник']

const HEADER_ROW = [...DRIVER_COLS, ...TRUCK_COLS, ...TRAILER_COLS]

const SAMPLE_ROWS = [
  ['Дорошенко Игорь Валерьевич', '03.08.1987', 'РФ', '+7 903 415-22-08', 'г. Краснодар, ул. Дзержинского, д. 100', '52 07 223344', 'ОВМ УМВД России по г. Краснодару', '12.03.2010', 'Водитель-экспедитор', '52 12 909090', '15.08.2032', 'C, CE', 'MAN TGX 18.470', 'В344ТН152', '99 15 121212', 'белый', 'ООО «Перевозчик Б»', TRAILER_TYPES[0], 'АТ5546152', '52 19 777777', 'серый', 'ООО «Перевозчик Б»'],
  ['Захарова Ольга Ивановна', '17.11.1990', 'РФ', '+7 918 220-11-45', 'г. Абинск, ул. Мира, д. 12', '52 11 556677', 'ОВМ УМВД России по Краснодарскому краю', '05.09.2012', 'Водитель', '52 16 343434', '01.10.2033', 'C', '', '', '', '', '', '', '', '', '', ''],
]

const cellStr = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim()

/** Разбор Excel: колонки по заголовкам с приставками «Тягач:/Прицеп:» (fallback — позиционно) */
export function parseLineRows(rows: unknown[][]): DriverLineInitial[] {
  if (rows.length === 0) return []
  const header = rows[0].map(cellStr)
  const findCol = (name: string): number => {
    const exact = header.findIndex((h) => h.toLowerCase() === name.toLowerCase())
    if (exact >= 0) return exact
    // допускаем старые шаблоны: «Место рождения» = «Адрес регистрации»
    if (/адрес регистрац|место рожден|пребыван/i.test(name)) {
      return header.findIndex((h) => /адрес регистрац|место рожден|пребыван/i.test(h))
    }
    return header.findIndex((h) => h.toLowerCase().includes(name.toLowerCase()))
  }
  const idx = {
    fullName: findCol('ФИО'), birthDate: findCol('Дата рождения'), citizenship: findCol('Гражданство'),
    phone: findCol('Телефон'), birthPlace: findCol('Адрес регистрации'), passport: findCol('Паспорт'),
    passportIssuedBy: findCol('Кем выдан'), passportIssuedDate: findCol('Дата выдачи паспорта'),
    position: findCol('Должность'), license: findCol('ВУ номер'), licenseTill: findCol('ВУ действует до'),
    categories: findCol('Категории'),
    tBrand: findCol('Тягач: марка'), tPlate: findCol('Тягач: госномер'), tSts: findCol('Тягач: СТС'),
    tColor: findCol('Тягач: цвет'), tOwner: findCol('Тягач: собственник'),
    trType: findCol('Прицеп: тип'), trPlate: findCol('Прицеп: госномер'), trSts: findCol('Прицеп: СТС'),
    trColor: findCol('Прицеп: цвет'), trOwner: findCol('Прицеп: собственник'),
  }
  const at = (row: unknown[], i: number): string => (i >= 0 ? cellStr(row[i]) : '')
  const out: DriverLineInitial[] = []
  for (const row of rows.slice(1)) {
    if (row.every((c) => cellStr(c) === '')) continue // пустые строки пропускаются
    const fullName = at(row, idx.fullName)
    const license = at(row, idx.license)
    if (!fullName && !license) continue
    const line: DriverLineInitial = {
      driver: {
        fullName, license,
        birthDate: at(row, idx.birthDate), citizenship: at(row, idx.citizenship), phone: at(row, idx.phone),
        birthPlace: at(row, idx.birthPlace), passport: at(row, idx.passport),
        passportIssuedBy: at(row, idx.passportIssuedBy), passportIssuedDate: at(row, idx.passportIssuedDate),
        position: at(row, idx.position), licenseTill: at(row, idx.licenseTill), categories: at(row, idx.categories),
      },
    }
    const tPlate = at(row, idx.tPlate)
    if (tPlate) {
      line.truck = {
        brand: at(row, idx.tBrand), plate: tPlate, sts: at(row, idx.tSts),
        color: at(row, idx.tColor), owner: at(row, idx.tOwner),
      }
    }
    const trPlate = at(row, idx.trPlate)
    const trType = at(row, idx.trType)
    if (trPlate || trType) {
      line.trailer = {
        type: trType, plate: trPlate, sts: at(row, idx.trSts),
        color: at(row, idx.trColor), owner: at(row, idx.trOwner),
      }
    }
    out.push(line)
  }
  return out
}

export default function ApplyTab({ activeCarrierId, role, onNavigate }: TabProps) {
  const { toast } = useToast()
  const isCarrier = role === 'carrier'

  const [lines, setLines] = useState<LineState[]>([{ id: newLineId(), fromExcel: false }])
  const [trucks, setTrucks] = useState<SoloState[]>([])
  const [trailers, setTrailers] = useState<SoloState[]>([])
  const [checkingAll, setCheckingAll] = useState(false)
  const [excelName, setExcelName] = useState<string | null>(null)

  // актуальные функции проверки линий (для «Проверить все»)
  const checksRef = useRef(new Map<string, (quiet?: boolean) => Promise<boolean>>())

  const registerCheck = useCallback((id: string, fn: ((quiet?: boolean) => Promise<boolean>) | null) => {
    if (fn) checksRef.current.set(id, fn)
    else checksRef.current.delete(id)
  }, [])

  const addLine = () => setLines((cur) => [...cur, { id: newLineId(), fromExcel: false }])
  const removeLine = (id: string) => {
    checksRef.current.delete(id)
    setLines((cur) => (cur.length > 1 ? cur.filter((l) => l.id !== id) : cur))
  }

  // ——— одиночные карточки «Добавить ТС» / «Добавить прицеп» (Task 48) ———
  const addTruck = () => setTrucks((cur) => [...cur, { id: newLineId() }])
  const addTrailer = () => setTrailers((cur) => [...cur, { id: newLineId() }])
  const removeTruck = (id: string) => {
    checksRef.current.delete(id)
    setTrucks((cur) => cur.filter((t) => t.id !== id))
  }
  const removeTrailer = (id: string) => {
    checksRef.current.delete(id)
    setTrailers((cur) => cur.filter((t) => t.id !== id))
  }

  /** всего карточек в работе: линии водителей + одиночные ТС и прицепы */
  const totalCards = lines.length + trucks.length + trailers.length

  /** «Проверить все»: в каждой карточке сначала проверка обязательных полей (незаполненное
   * подсвечивается), затем допуск; у линий водителей перед допуском работает нейросеть;
   * тихий режим — без отдельного тоста на карточку */
  const checkAll = async () => {
    if (checkingAll) return
    setCheckingAll(true)
    let ran = 0
    let ok = 0
    try {
      for (const [, fn] of checksRef.current) {
        const res = await fn(true)
        ran += 1
        if (res) ok += 1
        if (!res) setLines((cur) => [...cur]) // перерисовать после ответа линии
      }
      if (ran === 0) {
        toast({
          title: 'Все карточки уже допущены',
          description: 'Проверять нечего — все карточки уже в базе аккаунта',
        })
      } else {
        toast({
          title: `Проверка завершена: ${ok} из ${ran}`,
          description: ok === ran ? 'Все карточки допущены в базу' : 'Часть карточек требует внимания — незаполненное подсвечено красным',
        })
      }
    } finally {
      setCheckingAll(false)
    }
  }

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([HEADER_ROW, ...SAMPLE_ROWS])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Проформы')
    XLSX.writeFile(wb, 'shablon-profekt.xlsx')
  }

  /** Excel → линии: данные подставляются, в базу ничего не пишется */
  const handleExcel = async (file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer())
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
      const parsed = parseLineRows(rows)
      if (parsed.length === 0) {
        toast({ title: 'В файле нет строк с ФИО или ВУ', description: 'Проверьте шаблон — первая строка должна быть заголовками', variant: 'destructive' })
        return
      }
      setLines((cur) => {
        const kept = cur.filter((l) => l.fromExcel || l.initial)
        const created = parsed.map((initial) => ({ id: newLineId(), initial, fromExcel: true }))
        return [...kept, ...created]
      })
      setExcelName(file.name)
      toast({
        title: `Создано линий проформ: ${parsed.length}`,
        description: 'Данные подставлены, в базу ничего не записано. Осталось выбрать фотографии и нажать «Проверить»',
      })
    } catch {
      toast({ title: 'Не удалось прочитать Excel', description: 'Скачайте шаблон и заполните его по образцу', variant: 'destructive' })
    }
  }

  if (!isCarrier) {
    return (
      <section aria-labelledby="apply-title">
        <SectionHeader title="Подать документы" desc="Раздел доступен агентам-перевозчикам: база водителей и техники пополняется по документам с нейропроверкой" />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Внутренний контур АЭМЗ работает со Сверкой документов — раздел «Подать документы» принадлежит агентам.
          </CardContent>
        </Card>
      </section>
    )
  }

  return (
    <section aria-labelledby="apply-title" className="space-y-4">
      <SectionHeader title="Подать документы" />

      {/* база кадров и техники теперь живёт в Справочниках — чтобы повторно не создавать */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <p className="max-w-xl text-xs leading-snug text-slate-600">
          <b className="text-slate-800">База кадров и техники</b> — в разделе «Справочники»: допущенные карточки, ручное добавление и сроки документов.
        </p>
        <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => onNavigate('directory')}>
          Открыть Справочники
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      {/* панель «Проверить все» — сама появляется при 2+ карточках (Task 33/48) */}
      <AnimatePresence>
        {totalCards >= 2 && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          >
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-blue-900">
                <ScanLine className="h-4 w-4" aria-hidden />
                Карточек в работе: {totalCards}
              </span>
              <span className="flex-1" />
              <Button
                onClick={() => void checkAll()}
                disabled={checkingAll}
                className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {checkingAll ? 'Проверяем все карточки…' : 'Проверить все'}
                <Badge variant="outline" className="ml-1 border-slate-500 bg-white/70 text-slate-900">{totalCards}</Badge>
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ——— левая колонка: карточки (линии водителей + одиночные ТС/прицепы) ——— */}
        <div className="min-w-0 space-y-3">
          {lines.map((line, i) => (
            <DriverLine
              key={line.id}
              id={line.id}
              index={i}
              carrierId={activeCarrierId ?? ''}
              initial={line.initial}
              registerCheck={registerCheck}
              onRemove={removeLine}
            />
          ))}
          {trucks.map((truck, i) => (
            <TruckLine
              key={truck.id}
              id={truck.id}
              index={i}
              carrierId={activeCarrierId ?? ''}
              registerCheck={registerCheck}
              onRemove={removeTruck}
            />
          ))}
          {trailers.map((trailer, i) => (
            <TrailerLine
              key={trailer.id}
              id={trailer.id}
              index={i}
              carrierId={activeCarrierId ?? ''}
              registerCheck={registerCheck}
              onRemove={removeTrailer}
            />
          ))}
          {/* три кнопки добавления: водитель целиком (с фото и нейросетью)
              либо только техника — без водителя (Task 48) */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={addLine}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 transition hover:border-blue-400 hover:text-blue-700"
            >
              <UserPlus className="h-4 w-4" aria-hidden />
              Добавить водителя
            </button>
            <button
              type="button"
              onClick={addTruck}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 transition hover:border-blue-400 hover:text-blue-700"
            >
              <Truck className="h-4 w-4" aria-hidden />
              Добавить ТС
            </button>
            <button
              type="button"
              onClick={addTrailer}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 transition hover:border-blue-400 hover:text-blue-700"
            >
              <CarFront className="h-4 w-4" aria-hidden />
              Добавить прицеп
            </button>
          </div>
        </div>

        {/* ——— правая колонка: Excel ——— */}
        <div className="min-w-0 space-y-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <FileSpreadsheet className="h-4 w-4 text-emerald-700" aria-hidden />
                Загрузить из Excel
              </div>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                Одна таблица — водитель, тягач и прицеп. Строки станут линиями с подставленными данными.
              </p>
              <div className="mt-3 space-y-2">
                <Button variant="outline" className="w-full gap-1.5" onClick={downloadTemplate}>
                  <FileSpreadsheet className="h-4 w-4" aria-hidden />
                  Скачать шаблон
                </Button>
                <label className="block">
                  <span className="sr-only">Загрузить Excel с проформами</span>
                  <span className="flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md bg-blue-700 px-3 text-sm font-medium text-white transition hover:bg-blue-800">
                    <Upload className="h-4 w-4" aria-hidden />
                    Загрузить Excel
                  </span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="sr-only"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleExcel(f) }}
                  />
                </label>
                {excelName && (
                  <div className="truncate text-[11px] text-muted-foreground" title={excelName}>
                    Файл: {excelName}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}
