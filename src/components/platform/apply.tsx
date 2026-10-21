'use client'

/**
 * «Подать документы» (Task 29/30/32/33/35) — единственное место пополнения базы
 * аккаунта. Одна линия = один водитель (проформы водитель|тягач|прицеп в одну
 * строку, фотографии ниже линии); «+» добавляет линию для ручного ввода.
 * Excel из одной таблицы создаёт нужное число линий с подставленными данными,
 * ничего не записывая в базу. Кнопка «Проверить все» последовательно прогоняет
 * линии: сначала проверяет обязательность всех полей и фото (незаполненное
 * подсвечивается красным), затем нейросеть читает фото, заполняет пустые поля
 * и сама допускает карточки в базу (или отклоняет с причинами).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import * as XLSX from 'xlsx'
import {
  CheckCircle2, Database, FileSpreadsheet, FolderOpen, IdCard, Plus, ScanLine, Upload,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SectionHeader, type TabProps } from '@/components/platform/common'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import DriverLine, { TRAILER_TYPES, type DriverLineInitial } from '@/components/platform/driver-intake'

type LineState = { id: string; initial?: DriverLineInitial; fromExcel: boolean }

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
  const [counts, setCounts] = useState({ drivers: 0, trucks: 0, trailers: 0 })
  const [checkingAll, setCheckingAll] = useState(false)
  const [excelName, setExcelName] = useState<string | null>(null)

  // актуальные функции проверки линий (для «Проверить все»)
  const checksRef = useRef(new Map<string, (quiet?: boolean) => Promise<boolean>>())

  const registerCheck = useCallback((id: string, fn: ((quiet?: boolean) => Promise<boolean>) | null) => {
    if (fn) checksRef.current.set(id, fn)
    else checksRef.current.delete(id)
  }, [])

  const refreshCounts = useCallback(async () => {
    if (!activeCarrierId) return
    try {
      const dir = await api.directory()
      const me = dir.carriers.find((c) => c.id === activeCarrierId)
      setCounts({ drivers: me?.drivers.length ?? 0, trucks: me?.trucks.length ?? 0, trailers: me?.trailers.length ?? 0 })
    } catch { /* счётчики не критичны */ }
  }, [activeCarrierId])

  useEffect(() => {
    void refreshCounts()
  }, [refreshCounts])

  const addLine = () => setLines((cur) => [...cur, { id: newLineId(), fromExcel: false }])
  const removeLine = (id: string) => {
    checksRef.current.delete(id)
    setLines((cur) => (cur.length > 1 ? cur.filter((l) => l.id !== id) : cur))
  }

  /** «Проверить все»: в каждой линии сначала проверка обязательных полей (незаполненное
   * подсвечивается), затем нейросеть и допуск; тихий режим — без отдельного тоста на линию */
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
          title: 'Все линии уже допущены',
          description: 'Проверять нечего — все линии уже в базе аккаунта',
        })
      } else {
        toast({
          title: `Проверка завершена: ${ok} из ${ran}`,
          description: ok === ran ? 'Все линии допущены в базу' : 'Часть линий требует внимания — незаполненное подсвечено красным',
        })
        void refreshCounts()
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

      {/* панель «Проверить все» — сама появляется при 2+ линиях (Task 33) */}
      <AnimatePresence>
        {lines.length >= 2 && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          >
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-blue-900">
                <ScanLine className="h-4 w-4" aria-hidden />
                Линий в работе: {lines.length}
              </span>
              <span className="flex-1" />
              <Button
                onClick={() => void checkAll()}
                disabled={checkingAll}
                className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {checkingAll ? 'Проверяем все линии…' : 'Проверить все'}
                <Badge variant="outline" className="ml-1 border-slate-500 bg-white/70 text-slate-900">{lines.length}</Badge>
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ——— левая колонка: линии ——— */}
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
              onAdmitted={() => void refreshCounts()}
            />
          ))}
          <button
            type="button"
            onClick={addLine}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 transition hover:border-blue-400 hover:text-blue-700"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Добавить водителя
          </button>
        </div>

        {/* ——— правая колонка: Excel + база аккаунта ——— */}
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

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Database className="h-4 w-4 text-blue-700" aria-hidden />
                Кадры и техника
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                {[
                  { label: 'Водители', value: counts.drivers, icon: IdCard },
                  { label: 'Тягачи', value: counts.trucks, icon: Database },
                  { label: 'Прицепы', value: counts.trailers, icon: FolderOpen },
                ].map((x) => (
                  <div key={x.label} className="rounded-lg border border-slate-200 bg-slate-50/60 px-2 py-2">
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{x.label}</dt>
                    <dd className="text-lg font-bold tabular-nums text-slate-900">{x.value}</dd>
                  </div>
                ))}
              </dl>
              <Button variant="ghost" className="mt-2 w-full gap-1.5 text-slate-600" onClick={() => onNavigate('directory')}>
                <FolderOpen className="h-4 w-4" aria-hidden />
                Открыть справочники
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}
