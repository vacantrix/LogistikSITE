'use client'

/**
 * Раздел «Архитектура» (только администратор) — карта всей системы в виде
 * разворачивающегося дерева: разделы интерфейса, API-маршруты, серверные
 * правила, база, мини-сервисы и внешние интеграции — что от чего зависит.
 *
 * Сверху — живые статусы сервисов (/api/architecture/status): платформа сама
 * опрашивает БД, шину WS, OCR-шлюз, нейросеть на ПК перевозчика и шину 1С.
 * Поиск фильтрует узлы и сам разворачивает ветки; кнопки «Развернуть/Свернуть».
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Box, ChevronRight, Circle, Database, FileCode2, Globe, Layers, Loader2, Plug, RefreshCw, Search, Server,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InfoTip, SectionHeader, type TabProps } from '@/components/platform/common'
import { ARCH_SERVICES, ARCH_TREE, archCounts, type ArchKind, type ArchNode } from '@/lib/architecture'

interface StatusItem { id: string; ok: boolean; ms: number; detail: string }

/** Стиль и иконка типа узла — единая легенда дерева */
const KIND_META: Record<ArchKind, { label: string; cls: string; Icon: typeof Box }> = {
  root: { label: 'Контур', cls: 'border-slate-300 bg-slate-100 text-slate-700', Icon: Layers },
  ui: { label: 'Раздел', cls: 'border-slate-200 bg-white text-slate-600', Icon: Globe },
  api: { label: 'API', cls: 'border-violet-200 bg-violet-50 text-violet-700', Icon: FileCode2 },
  lib: { label: 'Логика', cls: 'border-amber-200 bg-amber-50 text-amber-700', Icon: Box },
  service: { label: 'Сервис', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', Icon: Server },
  db: { label: 'База', cls: 'border-teal-200 bg-teal-50 text-teal-700', Icon: Database },
  integration: { label: 'Интеграция', cls: 'border-orange-200 bg-orange-50 text-orange-700', Icon: Plug },
}

/** Собрать id всех узлов, подходящих под запрос (вместе с предками) */
function matchIds(nodes: ArchNode[], q: string, acc: { hit: Set<string>; open: Set<string> }): void {
  const walk = (n: ArchNode, ancestors: string[]): boolean => {
    const self = !q ||
      n.label.toLowerCase().includes(q) ||
      (n.desc ?? '').toLowerCase().includes(q) ||
      (n.tech ?? '').toLowerCase().includes(q) ||
      (n.path ?? '').toLowerCase().includes(q)
    let childHit = false
    for (const c of n.children ?? []) childHit = walk(c, [...ancestors, n.id]) || childHit
    if (self || childHit) {
      acc.hit.add(n.id)
      for (const a of ancestors) acc.open.add(a)
      if (childHit) acc.open.add(n.id)
      return true
    }
    return false
  }
  for (const n of nodes) walk(n, [])
}

/** Собрать id всех узлов с детьми (для «развернуть всё») */
function allOpenIds(nodes: ArchNode[], acc: Set<string> = new Set()): Set<string> {
  for (const n of nodes) {
    if (n.children?.length) {
      acc.add(n.id)
      allOpenIds(n.children, acc)
    }
  }
  return acc
}

/** Строка живого статуса сервиса */
function StatusChip({ item }: { item: StatusItem | undefined }) {
  const meta = ARCH_SERVICES.find((s) => s.id === item?.id)
  if (!meta) return null
  const ok = item?.ok
  return (
    <div
      className="flex min-w-0 items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
      title={item?.detail ?? 'Статус ещё не проверялся'}
    >
      <Circle
        className={`mt-1 h-2.5 w-2.5 shrink-0 ${item === undefined ? 'fill-slate-300 text-slate-300' : ok ? 'fill-emerald-500 text-emerald-500' : 'fill-red-500 text-red-500'}`}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-xs font-semibold text-slate-900">{meta.label}</span>
          {item !== undefined && (
            <span className={`shrink-0 font-mono text-[10px] ${ok ? 'text-slate-400' : 'text-red-500'}`}>{item.ms} мс</span>
          )}
        </div>
        <div className="truncate text-[11px] leading-snug text-slate-500">{item?.detail ?? meta.desc}</div>
      </div>
    </div>
  )
}

/** Один узел дерева */
function TreeNode({ node, depth, open, hit, onToggle, statusOf }: {
  node: ArchNode
  depth: number
  open: Set<string>
  hit: Set<string>
  onToggle: (id: string) => void
  statusOf: (id: string) => StatusItem | undefined
}) {
  const meta = KIND_META[node.kind]
  const Icon = meta.Icon
  const expanded = open.has(node.id)
  const hasChildren = Boolean(node.children?.length)
  const live = node.deps?.length
    ? node.deps.map((d) => statusOf(d)).filter(Boolean)
    : []

  return (
    <li className="relative" role="treeitem" aria-selected={false} aria-expanded={hasChildren ? expanded : undefined}>
      <div
        className={`group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors ${hit.has(node.id) ? 'bg-white' : ''} hover:bg-slate-50`}
        style={{ marginLeft: depth * 18 }}
      >
        {/* линия ветки */}
        {depth > 0 && <span className="absolute left-0 top-0 h-full border-l border-slate-200" style={{ left: depth * 18 - 10 }} aria-hidden />}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-label={expanded ? `Свернуть «${node.label}»` : `Развернуть «${node.label}»`}
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
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
            <span className={`text-sm ${hit.has(node.id) ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'}`}>{node.label}</span>
            <Badge variant="outline" className={`h-4.5 border px-1.5 py-0 text-[10px] font-medium ${meta.cls}`}>{meta.label}</Badge>
            {node.method && (
              <Badge variant="outline" className="h-4.5 border-slate-300 bg-slate-50 px-1.5 py-0 font-mono text-[10px] text-slate-600">{node.method}</Badge>
            )}
            {node.path && (
              <code className="max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{node.path}</code>
            )}
            {node.tech && <span className="text-[11px] leading-snug text-slate-400">{node.tech}</span>}
          </div>
          {node.desc && <p className="mt-0.5 max-w-3xl text-xs leading-snug text-slate-500">{node.desc}</p>}
          {live.length > 0 && expanded && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              {live.map((s) => (
                <span key={s.id} className="flex items-center gap-1 text-[10px] text-slate-400">
                  <Circle className={`h-1.5 w-1.5 ${s.ok ? 'fill-emerald-500 text-emerald-500' : 'fill-red-500 text-red-500'}`} aria-hidden />
                  {ARCH_SERVICES.find((x) => x.id === s.id)?.label} · {s.ms} мс
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {hasChildren && expanded && (
        <ul role="group" className="mt-0.5 space-y-0.5">
          {(node.children ?? []).map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} open={open} hit={hit} onToggle={onToggle} statusOf={statusOf} />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function ArchitectureTab(_: TabProps) {
  const [status, setStatus] = useState<StatusItem[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [query, setQuery] = useState('')
  // по умолчанию развёрнуты только корни — дерево читается сверху вниз
  const [open, setOpen] = useState<Set<string>>(() => new Set(ARCH_TREE.map((n) => n.id)))

  const statusOf = useCallback((id: string) => status?.find((s) => s.id === id), [status])

  const check = useCallback(async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/architecture/status', { cache: 'no-store' })
      const j = (await res.json()) as { items?: StatusItem[] }
      if (j.items) setStatus(j.items)
    } catch {
      /* статусы не критичны: чипы останутся серыми */
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void check()
    const t = setInterval(() => void check(), 30_000)
    return () => clearInterval(t)
  }, [check])

  const { hit, openFiltered } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const acc = { hit: new Set<string>(), open: new Set<string>() }
    if (q) matchIds(ARCH_TREE, q, acc)
    return { hit: acc.hit, openFiltered: acc.open }
  }, [query])

  // при поиске разворачиваем ветки с совпадениями, при очистке — возвращаем как было
  const effectiveOpen = query.trim() ? openFiltered : open
  const toggle = useCallback((id: string) => {
    setOpen((cur) => {
      const n = new Set(cur)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])

  const counts = useMemo(() => archCounts(), [])
  const allOk = status !== null && status.every((s) => s.ok)

  return (
    <section aria-labelledby="arch-title" className="space-y-4">
      <SectionHeader
        title="Архитектура платформы"
        desc="Как устроена система: интерфейс, API, база, сервисы и интеграции — что от чего зависит. Статусы обновляются автоматически каждые 30 секунд."
      />

      {/* ——— живые статусы контуров ——— */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            Живые статусы
            {status !== null && (
              <Badge variant="outline" className={`border text-[10px] ${allOk ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                {status.filter((s) => s.ok).length} из {status.length} работают
              </Badge>
            )}
            <InfoTip label="Живые статусы">
              Платформа сама опрашивает каждый контур: БД (SELECT 1), шину WS, OCR-шлюз, нейросеть на ПК перевозчика (через туннель) и ключ 1С. Наведите на чип — увидите детали.
            </InfoTip>
          </span>
          <span className="flex-1" />
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void check()} disabled={checking}>
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            Проверить сейчас
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {ARCH_SERVICES.map((s) => (
            <StatusChip key={s.id} item={status?.find((i) => i.id === s.id)} />
          ))}
        </div>
      </div>

      {/* ——— панель дерева: поиск + разворачивание ——— */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск: verify, 1С, шлюз, порт…"
              aria-label="Поиск по дереву архитектуры"
              className="h-9 bg-white pl-8"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-9"
            onClick={() => setOpen(allOpenIds(ARCH_TREE))}
          >
            Развернуть всё
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9"
            onClick={() => setOpen(new Set(ARCH_TREE.map((n) => n.id)))}
          >
            Свернуть до контуров
          </Button>
          <span className="ml-auto text-[11px] text-slate-400">
            {counts.sections} разделов · {counts.api} API · {counts.services} сервисов и интеграций
          </span>
        </div>

        <div className="max-h-[68vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 [scrollbar-width:thin]">
          <ul role="tree" aria-label="Дерево архитектуры платформы" className="space-y-0.5">
            {ARCH_TREE.map((n) => (
              <TreeNode key={n.id} node={n} depth={0} open={effectiveOpen} hit={hit} onToggle={toggle} statusOf={statusOf} />
            ))}
          </ul>
        </div>

        {/* легенда */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
          {(Object.keys(KIND_META) as ArchKind[]).filter((k) => k !== 'root').map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className={`flex h-4 w-4 items-center justify-center rounded border ${KIND_META[k].cls}`} aria-hidden>
                {(() => { const I = KIND_META[k].Icon; return <I className="h-2.5 w-2.5" /> })()}
              </span>
              {KIND_META[k].label}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500" aria-hidden /> — узел зависит от работающего сервиса
          </span>
        </div>
      </div>
    </section>
  )
}
