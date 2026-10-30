import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const dynamic = 'force-dynamic'

/**
 * Файловый проводник раздела «Архитектура» (только администратор).
 *
 * GET  ?op=tree           — дерево проекта (папки/файлы с размером и датой)
 * GET  ?op=read&path=…    — содержимое текстового файла
 * PUT  { path, content }  — сохранить файл (файл должен уже существовать)
 *
 * Границы безопасности:
 *   — корень = папка проекта (process.cwd()), выход за неё невозможен;
 *   — служебные папки (node_modules, .next, .git, tool-results) скрыты полностью;
 *   — бинарные файлы отдаются только метаданными (предпросмотр и правка запрещены);
 *   — .env* помечены sensitive: админ видит их содержимое, интерфейс показывает пометку.
 */

const ROOT = process.cwd()

const EXCLUDED_DIRS = new Set([
  'node_modules', '.next', '.git', 'tool-results', '.turbo', 'coverage', '.vercel', '.output', '.bun',
  // системные папки стенда, не относящиеся к коду платформы
  'skills', '.zscripts',
  // рантайм-данные: загруженные сканы пользователей (персональные данные)
  'upload',
])

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'ico', 'icns', 'pdf', 'db', 'db-wal', 'db-shm',
  'lockb', 'zip', 'gz', 'tgz', 'xlsx', 'docx', 'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp4', 'mp3', 'wav', 'wasm', 'exe', 'dll', 'pyd',
])

const MAX_DEPTH = 10
const MAX_NODES = 4000
const MAX_READ = 512 * 1024
const MAX_WRITE = 1024 * 1024

/** Служебные файлы рантайма — в проводнике не показываем */
const EXCLUDED_FILES = new Set(['.DS_Store', 'dev.log', 'server.log', 'tsconfig.tsbuildinfo'])

interface FileNode {
  n: string // имя
  p: string // путь от корня ('' — корень; для файлов — полный относительный путь)
  d: boolean // папка
  s?: number // размер, байт
  m?: string // изменён
  b?: boolean // бинарный (предпросмотр недоступен)
  v?: boolean // чувствительный (.env*)
  c?: FileNode[]
}

/** Относительный путь → абсолютный внутри ROOT; null — путь вне корня или в служебной папке */
function safeResolve(rel: string): string | null {
  if (typeof rel !== 'string') return null
  if (rel.includes('\0')) return null
  const clean = rel.replaceAll('\\', '/').replaceAll(/^\/+|\/+$/g, '')
  const abs = path.resolve(ROOT, clean || '.')
  const relFromRoot = path.relative(ROOT, abs)
  if (!relFromRoot || relFromRoot === '.' || relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) return null
  const first = relFromRoot.split(path.sep)[0]
  if (EXCLUDED_DIRS.has(first)) return null
  return abs
}

const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')
const isBinary = (name: string) => BINARY_EXT.has(extOf(name))
const isSensitive = (rel: string) => /(^|\/)\.env/.test(rel)
const sortEntries = (a: FileNode, b: FileNode): number =>
  a.d === b.d ? a.n.localeCompare(b.n, 'ru', { numeric: true }) : a.d ? -1 : 1

let nodeBudget = MAX_NODES

async function buildTree(absDir: string, relDir: string, depth: number): Promise<FileNode[]> {
  if (depth > MAX_DEPTH || nodeBudget <= 0) return []
  let dirents
  try {
    dirents = await readdir(absDir, { withFileTypes: true })
  } catch {
    return []
  }
  const nodes: FileNode[] = []
  for (const e of dirents) {
    if (e.name.startsWith('.DS')) continue
    if (!e.isDirectory() && EXCLUDED_FILES.has(e.name)) continue
    const rel = relDir ? `${relDir}/${e.name}` : e.name
    if (e.isDirectory()) {
      if (EXCLUDED_DIRS.has(e.name)) continue
      if (nodeBudget <= 0) break
      nodeBudget -= 1
      const children = await buildTree(path.join(absDir, e.name), rel, depth + 1)
      nodes.push({ n: e.name, p: rel, d: true, c: children })
    } else if (e.isFile()) {
      if (nodeBudget <= 0) break
      nodeBudget -= 1
      let size: number | undefined
      let mtime: string | undefined
      try {
        const st = await stat(path.join(absDir, e.name))
        size = st.size
        mtime = st.mtime.toISOString()
      } catch { /* метаданные не критичны */ }
      const node: FileNode = { n: e.name, p: rel, d: false }
      if (size !== undefined) node.s = size
      if (mtime) node.m = mtime
      if (isBinary(e.name)) node.b = true
      if (isSensitive(rel)) node.v = true
      nodes.push(node)
    }
  }
  nodes.sort(sortEntries)
  return nodes
}

/** GET /api/admin/files — дерево или содержимое файла */
export async function GET(req: NextRequest) {
  const auth = await requireUser('admin')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const op = url.searchParams.get('op') ?? 'tree'

  if (op === 'tree') {
    nodeBudget = MAX_NODES
    const tree = await buildTree(ROOT, '', 0)
    return NextResponse.json({ root: path.basename(ROOT), tree, truncated: nodeBudget <= 0 })
  }

  if (op === 'read') {
    const rel = url.searchParams.get('path') ?? ''
    const abs = safeResolve(rel)
    if (!abs) return NextResponse.json({ error: 'Путь вне проекта или в служебной папке' }, { status: 400 })
    let st
    try {
      st = await stat(abs)
    } catch {
      return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
    }
    if (!st.isFile()) return NextResponse.json({ error: 'Это не файл' }, { status: 400 })
    const name = path.basename(abs)
    const binary = isBinary(name)
    const sensitive = isSensitive(rel)
    const base = { path: rel, name, size: st.size, mtime: st.mtime.toISOString(), binary, sensitive }
    if (binary) return NextResponse.json({ ...base, content: null, truncated: false })
    try {
      const buf = await readFile(abs)
      const truncated = buf.length > MAX_READ
      const slice = truncated ? buf.subarray(0, MAX_READ) : buf
      return NextResponse.json({ ...base, content: slice.toString('utf-8'), truncated })
    } catch {
      return NextResponse.json({ error: 'Не удалось прочитать файл' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Неизвестная операция' }, { status: 400 })
}

/** PUT /api/admin/files — сохранить изменения текстового файла */
export async function PUT(req: NextRequest) {
  const auth = await requireUser('admin')
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as { path?: string; content?: string } | null
  const rel = body?.path
  const content = body?.content
  if (typeof rel !== 'string' || typeof content !== 'string') {
    return NextResponse.json({ error: 'Ожидается { path, content }' }, { status: 400 })
  }
  const abs = safeResolve(rel)
  if (!abs) return NextResponse.json({ error: 'Путь вне проекта или в служебной папке' }, { status: 400 })
  if (isBinary(path.basename(abs))) return NextResponse.json({ error: 'Бинарный файл нельзя править в проводнике' }, { status: 400 })
  if (Buffer.byteLength(content, 'utf-8') > MAX_WRITE) {
    return NextResponse.json({ error: 'Файл больше 1 МБ — правьте его вне платформы' }, { status: 413 })
  }
  let st
  try {
    st = await stat(abs)
  } catch {
    return NextResponse.json({ error: 'Файл не найден — создание файлов в проводнике отключено' }, { status: 404 })
  }
  if (!st.isFile()) return NextResponse.json({ error: 'Это не файл' }, { status: 400 })

  try {
    await writeFile(abs, content, 'utf-8')
    const after = await stat(abs)
    return NextResponse.json({ ok: true, path: rel, size: after.size, mtime: after.mtime.toISOString() })
  } catch {
    return NextResponse.json({ error: 'Не удалось записать файл' }, { status: 500 })
  }
}
