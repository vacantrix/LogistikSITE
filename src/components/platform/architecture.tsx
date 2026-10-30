'use client'

/**
 * Раздел «Архитектура» (только администратор).
 *
 * Проводник проекта: слева — реальное дерево файлов платформы (как в IDE),
 * справа — содержимое файла; текстовые файлы можно открыть и отредактировать
 * прямо на платформе (сохранение — через /api/admin/files, только админ).
 * Папка с README.md при открытии сразу показывает его — у каждого блока проекта
 * своё описание в README.
 *
 * Второй вид — «Карта»: потоковая схема (что и куда течёт — стрелки между контурами)
 * с живыми статусами контуров. Описания и легенда — в README.md и README каждого блока.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowUp, Box, Brain, BrainCircuit, Braces, Building2, ChevronRight, Circle, Cpu, Database,
  FileCode2, FileCog, FileText, FileWarning, Folder, FolderOpen, Gauge, Globe, Hash, History, Hourglass,
  Image as ImageIcon, Layers, Loader2, Lock, MessagesSquare, Monitor, Network, Pencil, Plug, RefreshCw, Save,
  Search, Server, ShieldAlert, Users, Waypoints, X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SectionHeader, type TabProps } from '@/components/platform/common'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { ARCH_SERVICES, ARCH_TREE, type ArchKind, type ArchNode } from '@/lib/architecture'
import type { FileNodeDTO, FileReadDTO } from '@/lib/types'

interface StatusItem { id: string; ok: boolean; ms: number; detail: string }

// ——— иконки файлов ———

const MD_ICON = { Icon: Hash, cls: 'text-sky-600 bg-sky-50 border-sky-200' }
const codeIcon = { Icon: FileCode2, cls: 'text-violet-700 bg-violet-50 border-violet-200' }
const jsonIcon = { Icon: Braces, cls: 'text-amber-700 bg-amber-50 border-amber-200' }
const imgIcon = { Icon: ImageIcon, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' }
const dbIcon = { Icon: Database, cls: 'text-teal-700 bg-teal-50 border-teal-200' }
const envIcon = { Icon: ShieldAlert, cls: 'text-red-700 bg-red-50 border-red-200' }
const cfgIcon = { Icon: FileCog, cls: 'text-slate-600 bg-slate-100 border-slate-200' }
const textIcon = { Icon: FileText, cls: 'text-slate-600 bg-white border-slate-200' }
const binIcon = { Icon: FileWarning, cls: 'text-orange-700 bg-orange-50 border-orange-200' }

function iconFor(node: FileNodeDTO) {
  const n = node.n.toLowerCase()
  if (node.d) return null
  if (node.v) return envIcon
  if (n.endsWith('.md')) return MD_ICON
  if (n.endsWith('.json') || n.endsWith('.lock')) return jsonIcon
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|bsl|sh|css)$/.test(n)) return codeIcon
  if (node.b && /\.(png|jpe?g|webp|gif|ico)$/.test(n)) return imgIcon
  if (/\.(db|db-wal|db-shm|lockb)$/.test(n)) return dbIcon
  if (/^(package\.json|tsconfig|components\.json)$/.test(n) || n.endsWith('.config.') || n.startsWith('.env')) return cfgIcon
  if (node.b) return binIcon
  return textIcon
}

const fmtSize = (b?: number): string => {
  if (b === undefined) return ''
  if (b < 1024) return `${b} Б`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`
  return `${(b / 1024 / 1024).toFixed(2)} МБ`
}

const fmtDate = (iso?: string): string => {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** Собрать id папок, содержащих совпадение (вместе с самими совпавшими файлами) */
function matchedPaths(nodes: FileNodeDTO[], q: string, acc: Set<string>): boolean {
  let any = false
  for (const n of nodes) {
    const self = !q || n.n.toLowerCase().includes(q)
    const child = n.c ? matchedPaths(n.c, q, acc) : false
    if (self || child) {
      acc.add(n.p)
      any = true
    }
  }
  return any
}

// ——— дерево проводника ———

function TreeRow({ node, depth, open, selected, hit, onToggle, onSelect }: {
  node: FileNodeDTO
  depth: number
  open: Set<string>
  selected: string
  hit: Set<string>
  onToggle: (p: string) => void
  onSelect: (n: FileNodeDTO) => void
}) {
  const meta = iconFor(node)
  const Icon = meta?.Icon ?? (node.d ? (open.has(node.p) ? FolderOpen : Folder) : FileText)
  const expanded = open.has(node.p)
  const isSelected = selected === node.p
  const matched = hit.size === 0 || hit.has(node.p)
  return (
    <li role="treeitem" aria-expanded={node.d ? expanded : undefined} aria-selected={isSelected} className={matched ? '' : 'hidden'}>
      <div
        className={`group flex items-center gap-1 rounded-md px-1.5 py-1 ${isSelected ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'hover:bg-slate-100'}`}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        {node.d ? (
          <button
            type="button"
            onClick={() => onToggle(node.p)}
            aria-label={expanded ? `Свернуть ${node.n}` : `Развернуть ${node.n}`}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden />
          </button>
        ) : (
          <span className="w-4 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => onSelect(node)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          title={node.p}
        >
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${node.d ? 'border-slate-200 bg-slate-100 text-slate-500' : meta?.cls ?? textIcon.cls}`} aria-hidden>
            <Icon className="h-3 w-3" />
          </span>
          <span className={`truncate text-[13px] ${node.d ? 'font-medium text-slate-800' : isSelected ? 'font-semibold text-emerald-900' : 'text-slate-700'}`}>
            {node.n}
          </span>
          {node.v && <Lock className="h-3 w-3 shrink-0 text-red-500" aria-label="Содержит секреты" />}
          {!node.d && node.s !== undefined && (
            <span className="ml-auto shrink-0 pl-2 font-mono text-[10px] text-slate-400 group-hover:inline">{fmtSize(node.s)}</span>
          )}
        </button>
      </div>
      {node.d && expanded && node.c && (
        <ul role="group" className="space-y-px">
          {node.c.map((c) => (
            <TreeRow key={c.p} node={c} depth={depth + 1} open={open} selected={selected} hit={hit} onToggle={onToggle} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  )
}

// ——— просмотр/редактирование файла ———

function FileViewer({ file, onSaved, onReloadTree }: {
  file: FileReadDTO
  onSaved: (p: string, content: string) => void
  onReloadTree: () => void
}) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEditing(false)
    setDraft(file.content ?? '')
  }, [file.path, file.content])

  const dirty = editing && draft !== (file.content ?? '')

  const save = async () => {
    setSaving(true)
    try {
      await api.fileSave(file.path, draft)
      toast({ title: 'Файл сохранён', description: file.path })
      setEditing(false)
      onSaved(file.path, draft)
      onReloadTree()
    } catch (e) {
      toast({
        title: 'Не удалось сохранить файл',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const isMd = file.name.toLowerCase().endsWith('.md')

  return (
    <div className="flex min-h-0 flex-col">
      {/* шапка файла */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <code className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700" title={file.path}>
          {file.path}
        </code>
        {file.sensitive && (
          <Badge variant="outline" className="gap-1 border-red-200 bg-red-50 text-[10px] text-red-700">
            <ShieldAlert className="h-3 w-3" aria-hidden /> секреты
          </Badge>
        )}
        {file.binary && (
          <Badge variant="outline" className="border-orange-200 bg-orange-50 text-[10px] text-orange-700">бинарный</Badge>
        )}
        {file.truncated && (
          <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-[10px] text-amber-700">
            <AlertTriangle className="h-3 w-3" aria-hidden /> показан частично
          </Badge>
        )}
        <span className="font-mono text-[10px] text-slate-400">{fmtSize(file.size)} · {fmtDate(file.mtime)}</span>
        {!file.binary && !file.truncated && (
          editing ? (
            <>
              <Button size="sm" className="h-7 gap-1" onClick={() => void save()} disabled={saving || !dirty}>
                {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Save className="h-3 w-3" aria-hidden />}
                Сохранить
              </Button>
              <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => { setEditing(false); setDraft(file.content ?? '') }}>
                <X className="h-3 w-3" aria-hidden /> Отмена
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setEditing(true)}>
              <Pencil className="h-3 w-3" aria-hidden /> Редактировать
            </Button>
          )
        )}
      </div>

      {dirty && (
        <div className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          Есть несохранённые изменения — не забудьте нажать «Сохранить»
        </div>
      )}

      {/* содержимое */}
      {file.binary ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-500">
          Бинарный файл ({fmtSize(file.size)}) — предпросмотр и правка недоступны
        </div>
      ) : editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          aria-label={`Редактирование ${file.path}`}
          className="min-h-[54vh] w-full flex-1 resize-y bg-white p-4 font-mono text-xs leading-relaxed text-slate-800 outline-none"
        />
      ) : isMd && file.content !== null ? (
        <div className="markdown-view max-h-[68vh] flex-1 overflow-y-auto p-4 text-sm text-slate-800" style={{ scrollbarWidth: 'thin' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{file.content}</ReactMarkdown>
        </div>
      ) : (
        <pre className="max-h-[68vh] flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-800" style={{ scrollbarWidth: 'thin' }}>
          {file.content ?? ''}
        </pre>
      )}
    </div>
  )
}

// ——— карта архитектуры (второй вид) ———

const KIND_META: Record<ArchKind, { label: string; cls: string; Icon: typeof Box }> = {
  root: { label: 'Контур', cls: 'border-slate-300 bg-slate-100 text-slate-700', Icon: Layers },
  ui: { label: 'Раздел', cls: 'border-slate-200 bg-white text-slate-600', Icon: Globe },
  api: { label: 'API', cls: 'border-violet-200 bg-violet-50 text-violet-700', Icon: FileCode2 },
  lib: { label: 'Логика', cls: 'border-amber-200 bg-amber-50 text-amber-700', Icon: Brain },
  service: { label: 'Сервис', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', Icon: Server },
  db: { label: 'База', cls: 'border-teal-200 bg-teal-50 text-teal-700', Icon: Database },
  integration: { label: 'Интеграция', cls: 'border-orange-200 bg-orange-50 text-orange-700', Icon: Plug },
}

function MapNode({ node, depth, open, onToggle }: { node: ArchNode; depth: number; open: Set<string>; onToggle: (id: string) => void }) {
  const meta = KIND_META[node.kind]
  const Icon = meta.Icon
  const expanded = open.has(node.id)
  const hasChildren = Boolean(node.children?.length)
  return (
    <li role="treeitem" aria-selected={false} aria-expanded={hasChildren ? expanded : undefined}>
      <div className="flex items-start gap-2 rounded-lg px-2 py-1 hover:bg-slate-50" style={{ marginLeft: depth * 16 }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-label={expanded ? `Свернуть «${node.label}»` : `Развернуть «${node.label}»`}
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          >
            <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden />
          </button>
        ) : (
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-300" aria-hidden />
          </span>
        )}
        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${meta.cls}`} aria-hidden>
          <Icon className="h-3 w-3" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-slate-800">{node.label}</span>
            <Badge variant="outline" className={`h-4.5 border px-1.5 py-0 text-[10px] font-medium ${meta.cls}`}>{meta.label}</Badge>
            {node.path && <code className="max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{node.path}</code>}
            {node.tech && <span className="text-[11px] text-slate-400">{node.tech}</span>}
          </div>
          {node.desc && <p className="mt-0.5 max-w-3xl text-xs leading-snug text-slate-500">{node.desc}</p>}
        </div>
      </div>
      {hasChildren && expanded && (
        <ul role="group" className="mt-0.5 space-y-0.5">
          {(node.children ?? []).map((c) => (
            <MapNode key={c.id} node={c} depth={depth + 1} open={open} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  )
}

// ——— визуальная схема системы (карта, верхний уровень) ———

const TONE_CLS: Record<'slate' | 'emerald' | 'amber', { box: string; icon: string }> = {
  slate: { box: 'border-slate-200 bg-white', icon: 'border-slate-200 bg-slate-50 text-slate-500' },
  emerald: { box: 'border-emerald-200 bg-white', icon: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  amber: { box: 'border-amber-200 bg-white', icon: 'border-amber-200 bg-amber-50 text-amber-700' },
}

/** Блок схемы: живой статус (точка из опроса), заголовок, подпись и деталь последнего опроса */
function SchemeBox({ status, statusId, icon: Icon, label, sub, tone = 'slate' }: {
  status: StatusItem[] | null
  statusId?: string
  icon: typeof Server
  label: string
  sub?: string
  tone?: 'slate' | 'emerald' | 'amber'
}) {
  const item = statusId ? status?.find((s) => s.id === statusId) : undefined
  const ok = item?.ok
  return (
    <div className={`flex min-w-0 items-start gap-2.5 rounded-lg border px-3 py-2.5 shadow-sm ${TONE_CLS[tone].box}`} title={item?.detail}>
      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${TONE_CLS[tone].icon}`} aria-hidden>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold leading-tight text-slate-900">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${item === undefined ? 'bg-slate-300' : ok ? 'bg-emerald-500' : 'bg-red-500'}`}
            aria-hidden
          />
          <span className="truncate">{label}</span>
        </p>
        {sub && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{sub}</p>}
        {item && (
          <p className={`mt-0.5 truncate font-mono text-[10px] ${ok ? 'text-slate-400' : 'text-red-500'}`}>{item.detail}</p>
        )}
      </div>
    </div>
  )
}

/**
 * Пара потоков между контурами: слева — что уходит вниз (к следующему контуру),
 * справа — что возвращается наверх. Подписи краткие, по одной строке на поток.
 */
function FlowArrows({ down, up }: { down: string[]; up: string[] }) {
  return (
    <div className="grid gap-2 py-1.5 sm:grid-cols-2" role="img" aria-label="Потоки данных между контурами">
      <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-600" aria-hidden>
          <ArrowDown className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Вниз — запросы и данные</p>
          <ul className="mt-0.5 space-y-0.5">
            {down.map((d) => (
              <li key={d} className="flex gap-1.5 text-[11px] leading-snug text-slate-600">
                <ArrowDown className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" aria-hidden />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500" aria-hidden>
          <ArrowUp className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Наверх — ответы и события</p>
          <ul className="mt-0.5 space-y-0.5">
            {up.map((u) => (
              <li key={u} className="flex gap-1.5 text-[11px] leading-snug text-slate-600">
                <ArrowUp className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                <span>{u}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

/**
 * Потоковая карта: что и куда течёт между контурами. Три контура — пользователи
 * и 1С, сервер АЭМЗ, узел нейросети. Между ними — пары стрелок: что уходит вниз
 * и что возвращается наверх. Живые точки — из /api/architecture/status.
 */
function SchematicMap({ status }: { status: StatusItem[] | null }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 shadow-sm sm:p-4">
      {/* уровень 1 — пользователи и 1С */}
      <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <Users className="h-3.5 w-3.5" aria-hidden />
          Пользователи и системы — работают одновременно
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <SchemeBox status={status} icon={Monitor} label="Перевозчик" sub="браузер: заявки, документы, обращения" />
          <SchemeBox status={status} icon={Monitor} label="Логист / администрация" sub="браузер: торги, сверка, чаты, настройки" />
          <SchemeBox status={status} statusId="onec" icon={Building2} label="1С:ERP грузоотправителя" sub="заказы и статусы по X-API-Key" />
        </div>
      </div>

      <FlowArrows
        down={[
          'заявки, ставки, фото и сканы документов (до 20 фото за подачу)',
          'обращения и чаты: перевозчик ↔ логист/администрация',
          '1С: заказы на перевозку → черновики заявок, подтверждения ЭТрН',
        ]}
        up={[
          'статусы, уведомления и события в реальном времени',
          'вердикты проверок, документы и печатные формы',
          '1С: реестр рейсов, статусы, ЭТрН',
        ]}
      />

      {/* уровень 2 — сервер АЭМЗ */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
          <Building2 className="h-3.5 w-3.5" aria-hidden />
          Сервер АЭМЗ — веб-платформа; фото и файлы хранятся здесь
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <SchemeBox status={status} statusId="web" icon={Globe} label="Веб-платформа" sub="Next.js · порт 3000 · UI + REST API" tone="emerald" />
          <SchemeBox status={status} statusId="db" icon={Database} label="База данных" sub="SQLite · заявки, сканы, чаты, настройки" tone="emerald" />
          <SchemeBox status={status} statusId="ws" icon={Waypoints} label="Real-time шина" sub="socket.io · порт 3003" tone="emerald" />
          <SchemeBox icon={MessagesSquare} label="Обращения и чаты" sub="перевозчик ↔ логист/админ · вложения до 10 МБ" tone="emerald" />
          <SchemeBox status={status} statusId="ocr-gateway" icon={Server} label="OCR-шлюз" sub="bun · порт 3020 · общая очередь фото" tone="emerald" />
        </div>
      </div>

      <FlowArrows
        down={[
          'фото из общей очереди — не больше «максимума фото в обработке» (настройка под VRAM)',
          'X-OCR-Token · шлюз слушает только 127.0.0.1',
        ]}
        up={[
          'распознанные поля + уверенности по каждому фото',
          'качество фото и вид документа',
        ]}
      />

      {/* уровень 3 — узел нейросети */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
          <Cpu className="h-3.5 w-3.5" aria-hidden />
          Нейросеть на серверах АЭМЗ — сейчас показательно на отдельном GPU-ПК (временный стенд)
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <SchemeBox status={status} statusId="neural" icon={BrainCircuit} label="PaddleOCR · порт 3031" sub="детекция + чтение документов" tone="amber" />
          <div className="flex min-w-0 items-start gap-2.5 rounded-lg border border-amber-200 bg-white px-3 py-2.5 shadow-sm">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-700" aria-hidden>
              <Gauge className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold leading-tight text-slate-900">Слоты под VRAM</p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                Одновременно обрабатывается столько фото, сколько позволяет видеопамять («максимум фото в обработке»).
              </p>
            </div>
          </div>
          <div className="flex min-w-0 items-start gap-2.5 rounded-lg border border-amber-200 bg-white px-3 py-2.5 shadow-sm">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-700" aria-hidden>
              <Hourglass className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold leading-tight text-slate-900">Общая очередь ожидания</p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                Фото сверх слотов честно ждут своего хода — неважно, сколько перевозчиков подали единовременно.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ——— вкладка ———

export default function ArchitectureTab(_: TabProps) {
  // проводник
  const [tree, setTree] = useState<FileNodeDTO[] | null>(null)
  const [rootName, setRootName] = useState('')
  const [truncatedTree, setTruncatedTree] = useState(false)
  const [open, setOpen] = useState<Set<string>>(() => new Set(['src']))
  const [selected, setSelected] = useState<FileNodeDTO | null>(null)
  const [file, setFile] = useState<FileReadDTO | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [query, setQuery] = useState('')
  // статусы
  const [status, setStatus] = useState<StatusItem[] | null>(null)
  // карта
  const [view, setView] = useState<'files' | 'map'>('files')
  const [mapOpen, setMapOpen] = useState<Set<string>>(() => new Set(ARCH_TREE.map((n) => n.id)))
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const loadTree = useCallback(async () => {
    try {
      const res = await api.fileTree()
      if (!alive.current) return
      setTree(res.tree)
      setRootName(res.root)
      setTruncatedTree(res.truncated)
    } catch {
      if (alive.current) setTree([])
    }
  }, [])

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/architecture/status', { cache: 'no-store' })
      const j = (await res.json()) as { items?: StatusItem[] }
      if (alive.current && j.items) setStatus(j.items)
    } catch { /* статусы не критичны */ }
  }, [])

  useEffect(() => {
    void loadTree()
    void check()
    const t = setInterval(() => void check(), 30_000)
    return () => clearInterval(t)
  }, [loadTree, check])

  const openFile = useCallback(async (node: FileNodeDTO) => {
    if (node.d) {
      // папка: раскрыть; если есть README.md — показать его
      setOpen((cur) => {
        const n = new Set(cur)
        if (n.has(node.p)) { if (!selected || !selected.p.startsWith(`${node.p}/`)) n.delete(node.p) } else n.add(node.p)
        return n
      })
      const readme = node.c?.find((c) => !c.d && c.n.toLowerCase() === 'readme.md')
      if (readme) {
        setSelected(readme)
        setLoadingFile(true)
        try {
          const f = await api.fileRead(readme.p)
          if (alive.current) { setFile(f); setFileError(null) }
        } catch {
          if (alive.current) setFileError('Не удалось прочитать файл')
        } finally {
          if (alive.current) setLoadingFile(false)
        }
      }
      return
    }
    setSelected(node)
    setLoadingFile(true)
    setFile(null)
    try {
      const f = await api.fileRead(node.p)
      if (alive.current) { setFile(f); setFileError(null) }
    } catch (e) {
      if (alive.current) setFileError(e instanceof Error ? e.message : 'Не удалось прочитать файл')
    } finally {
      if (alive.current) setLoadingFile(false)
    }
  }, [selected])

  const toggle = useCallback((p: string) => {
    setOpen((cur) => {
      const n = new Set(cur)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })
  }, [])

  const hit = useMemo(() => {
    const q = query.trim().toLowerCase()
    const acc = new Set<string>()
    if (q && tree) matchedPaths(tree, q, acc)
    return acc
  }, [query, tree])

  // при поиске раскрываем всё с совпадениями
  useEffect(() => {
    if (query.trim() && tree) {
      const all = new Set<string>()
      const walk = (nodes: FileNodeDTO[]): void => {
        for (const n of nodes) {
          if (n.d && (hit.has(n.p) || n.n.toLowerCase().includes(query.trim().toLowerCase()))) {
            all.add(n.p)
            walk(n.c ?? [])
          } else if (n.d) walk(n.c ?? [])
        }
      }
      walk(tree)
      setOpen(all)
    }
  }, [query, tree, hit])

  const counts = useMemo(() => {
    let dirs = 0
    let files = 0
    const walk = (nodes: FileNodeDTO[]): void => {
      for (const n of nodes) {
        if (n.d) { dirs += 1; walk(n.c ?? []) } else files += 1
      }
    }
    if (tree) walk(tree)
    return { dirs, files }
  }, [tree])

  const allOk = status !== null && status.every((s) => s.ok)

  return (
    <section aria-labelledby="arch-title">
      <SectionHeader title="Архитектура платформы" />

      {/* ——— компактная строка живых статусов ——— */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
          <Network className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          Контуры
        </span>
        {ARCH_SERVICES.map((s) => {
          const item = status?.find((i) => i.id === s.id)
          const ok = item?.ok
          return (
            <span key={s.id} className="flex min-w-0 items-center gap-1.5" title={item?.detail ?? s.desc}>
              <Circle className={`h-2 w-2 shrink-0 ${item === undefined ? 'fill-slate-300 text-slate-300' : ok ? 'fill-emerald-500 text-emerald-500' : 'fill-red-500 text-red-500'}`} aria-hidden />
              <span className="truncate text-[11px] text-slate-600">{s.label}</span>
              {item !== undefined && <span className={`font-mono text-[10px] ${ok ? 'text-slate-400' : 'text-red-500'}`}>{item.ms}мс</span>}
            </span>
          )
        })}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void check()}>
          {status === null ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
          Обновить
        </Button>
        {status !== null && (
          <Badge variant="outline" className={`text-[10px] ${allOk ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
            {status.filter((s) => s.ok).length}/{status.length}
          </Badge>
        )}
      </div>

      {/* ——— переключатель видов ——— */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5" role="tablist" aria-label="Вид раздела">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'files'}
            onClick={() => setView('files')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${view === 'files' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <FolderOpen className="h-3.5 w-3.5" aria-hidden /> Проводник
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'map'}
            onClick={() => setView('map')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${view === 'map' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <Network className="h-3.5 w-3.5" aria-hidden /> Карта
          </button>
        </div>
        <span className="flex-1" />
        {view === 'files' && (
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск файла: verify, ocr, readme…"
              aria-label="Поиск по файлам проекта"
              className="h-8 bg-white pl-8 text-xs"
            />
          </div>
        )}
      </div>

      {view === 'map' ? (
        <div className="space-y-3">
          <SchematicMap status={status} />
          <details className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <summary className="cursor-pointer select-none text-xs font-semibold text-slate-700">
              Детали по узлам — полное дерево системы
            </summary>
            <div className="mt-3 max-h-[60vh] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              <ul role="tree" aria-label="Карта архитектуры платформы" className="space-y-0.5">
                {ARCH_TREE.map((n) => (
                  <MapNode key={n.id} node={n} depth={0} open={mapOpen} onToggle={(id) => setMapOpen((cur) => {
                    const s = new Set(cur)
                    if (s.has(id)) s.delete(id)
                    else s.add(id)
                    return s
                  })} />
                ))}
              </ul>
            </div>
          </details>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[320px_1fr]">
          {/* дерево файлов */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-900">
                <Server className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                <span className="truncate">{rootName || 'проект'}</span>
              </span>
              <span className="shrink-0 text-[10px] text-slate-400">{counts.dirs} папок · {counts.files} файлов</span>
            </div>
            <div className="max-h-[72vh] overflow-y-auto p-1.5" style={{ scrollbarWidth: 'thin' }}>
              {tree === null ? (
                <div className="flex items-center justify-center py-10 text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                </div>
              ) : tree.length === 0 ? (
                <p className="p-4 text-xs text-slate-400">Дерево пусто или недоступно</p>
              ) : (
                <ul role="tree" aria-label="Файлы проекта" className="space-y-px">
                  {tree.map((n) => (
                    <TreeRow key={n.p} node={n} depth={0} open={open} selected={selected?.p ?? ''} hit={hit} onToggle={toggle} onSelect={(x) => void openFile(x)} />
                  ))}
                </ul>
              )}
            </div>
            {truncatedTree && (
              <div className="border-t border-amber-100 bg-amber-50 px-3 py-1.5 text-[10px] text-amber-700">
                Дерево показано не полностью — достигнут лимит узлов
              </div>
            )}
          </div>

          {/* просмотр/редактирование */}
          <div className="flex min-h-[300px] flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
            {loadingFile ? (
              <div className="flex flex-1 items-center justify-center py-16 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              </div>
            ) : fileError ? (
              <div className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-red-600">
                <FileWarning className="h-4 w-4" aria-hidden /> {fileError}
              </div>
            ) : file ? (
              <FileViewer
                key={file.path}
                file={file}
                onSaved={(p, content) => setFile((f) => (f && f.path === p ? { ...f, content, mtime: new Date().toISOString() } : f))}
                onReloadTree={() => void loadTree()}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                <FolderOpen className="h-8 w-8 text-slate-300" aria-hidden />
                <p className="text-sm font-medium text-slate-600">Выберите файл в дереве слева</p>
                <p className="max-w-sm text-xs text-slate-400">
                  Текстовые файлы можно открыть и отредактировать прямо здесь. Папка с README.md сразу покажет его содержимое.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* история изменений проекта */}
      <p className="mt-3 flex items-center gap-1.5 px-1 text-[11px] text-slate-400">
        <History className="h-3 w-3" aria-hidden />
        Хронология разработки — в worklog.md; описание блоков — в README каждого раздела.
      </p>
    </section>
  )
}
