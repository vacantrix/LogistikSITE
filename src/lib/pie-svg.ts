/**
 * Круговые (кольцевые) диаграммы проформ — единый источник для страницы и DOCX.
 * Строит самодостаточную SVG-строку: на странице она вставляется как разметка,
 * в DOCX растеризуется через @resvg/resvg-js в PNG (кириллица — шрифты DejaVu).
 *
 * Разработано в рамках Task 99: диаграммы должны выглядеть одинаково на экране
 * и в скачанной бумажной проформе.
 */

export interface PieInput {
  label: string
  value: number
}

const PALETTE = [
  '#0d9488', // бирюзовый
  '#059669', // изумрудный
  '#ca8a04', // охра
  '#7c3aed', // фиолетовый
  '#e11d48', // гранатовый
  '#65a30d', // оливковый
  '#0891b2', // циан
  '#64748b', // графит
]

/** Дополнительные оттенки, если долек больше восьми */
const PALETTE_EXTRA = ['#b45309', '#4d7c0f', '#9333ea', '#be123c', '#0e7490', '#475569', '#15803d', '#a16207']

// DejaVu — на Linux-сервере (кириллица и ₽ для DOCX); на Windows его нет — без запасных
// шрифтов браузер и resvg рисовали подписи шрифтом с засечками
const FONT = "'DejaVu Sans', Arial, 'Segoe UI', sans-serif"
const W = 680
const H = 340
const CX = 158
const CY = 192
const R_OUT = 118
const R_IN = 68

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 1234567.8 → «1 234 568» */
function fmtInt(v: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(v))
}

/** компактная сумма для центра кольца: 4 250 000 → «4,25 млн» */
function fmtCompact(v: number, unit: string): string {
  if (Math.abs(v) >= 1_000_000) return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(v / 1_000_000)} млн ${unit}`
  return `${fmtInt(v)} ${unit}`
}

function point(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

/** Дуга кольца от угла a0 до a1 (по часовой), между R_IN и R_OUT */
function ringSegment(a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0
  const [x1, y1] = point(CX, CY, R_OUT, a0)
  const [x2, y2] = point(CX, CY, R_OUT, a1)
  const [x3, y3] = point(CX, CY, R_IN, a1)
  const [x4, y4] = point(CX, CY, R_IN, a0)
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R_OUT} ${R_OUT} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${R_IN} ${R_IN} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`
}

export interface PieOptions {
  /** заголовок диаграммы (верхний левый угол) */
  title: string
  /** дольки; суммарное значение должно быть > 0 — иначе рисуется пустое состояние */
  slices: PieInput[]
  /** единица измерения: «₽», «шт», «₽/т» */
  unit?: string
  /** подпись центра («всего», «заявок»…) */
  centerHint?: string
}

/**
 * Собрать SVG-строку кольцевой диаграммы с легендой.
 * Возвращает строку, пригодную и для dangerouslySetInnerHTML (страница),
 * и для Resvg (DOCX-PNG).
 */
export function buildPieSvg({ title, slices, unit = '₽', centerHint = 'всего' }: PieOptions): string {
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="${esc(title)}">` +
    `<rect width="${W}" height="${H}" rx="14" fill="#ffffff" stroke="#e2e8f0"/>` +
    `<text x="26" y="42" font-family="${FONT}" font-size="19" font-weight="bold" fill="#0f172a">${esc(title)}</text>`

  const valid = slices.filter((s) => Number.isFinite(s.value) && s.value > 0)
  const total = valid.reduce((sum, s) => sum + s.value, 0)

  if (valid.length === 0 || total <= 0) {
    return (
      head +
      `<circle cx="${CX}" cy="${CY}" r="${(R_OUT + R_IN) / 2}" fill="none" stroke="#e2e8f0" stroke-width="${R_OUT - R_IN}"/>` +
      `<text x="${CX}" y="${CY - 4}" font-family="${FONT}" font-size="17" font-weight="bold" fill="#94a3b8" text-anchor="middle">Нет данных</text>` +
      `<text x="${CX}" y="${CY + 20}" font-family="${FONT}" font-size="12" fill="#94a3b8" text-anchor="middle">за выбранный период</text>` +
      `</svg>`
    )
  }

  // дольки: накапливаем углы от 0° (12 часов) по часовой
  let angle = 0
  const segs: string[] = []
  for (let i = 0; i < valid.length; i++) {
    const sweep = (valid[i].value / total) * 360
    const a0 = angle
    const a1 = i === valid.length - 1 ? 360 : angle + sweep // последняя долька закрывает круг точно
    angle = a1
    const color = (valid.length <= PALETTE.length ? PALETTE : [...PALETTE, ...PALETTE_EXTRA])[i % PALETTE.length]
    if (a1 - a0 >= 359.9) {
      // единственная долька — сплошное кольцо
      segs.push(`<circle cx="${CX}" cy="${CY}" r="${(R_OUT + R_IN) / 2}" fill="none" stroke="${color}" stroke-width="${R_OUT - R_IN}"/>`)
    } else {
      segs.push(`<path d="${ringSegment(a0, a1)}" fill="${color}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>`)
    }
  }

  // легенда
  const rows: string[] = []
  const rowH = Math.min(38, Math.floor(250 / Math.max(valid.length, 1)))
  let ly = 86 + Math.max(0, (250 - rowH * valid.length) / 2)
  for (let i = 0; i < valid.length; i++) {
    const s = valid[i]
    const color = (valid.length <= PALETTE.length ? PALETTE : [...PALETTE, ...PALETTE_EXTRA])[i % PALETTE.length]
    const share = Math.round((s.value / total) * 1000) / 10
    const label = s.label.length > 26 ? `${s.label.slice(0, 25)}…` : s.label
    rows.push(
      `<rect x="336" y="${ly}" width="15" height="15" rx="4" fill="${color}"/>` +
      `<text x="360" y="${ly + 12}" font-family="${FONT}" font-size="14" fill="#334155">${esc(label)}</text>` +
      `<text x="${W - 26}" y="${ly + 12}" font-family="${FONT}" font-size="14" font-weight="bold" fill="#0f172a" text-anchor="end">${esc(fmtInt(s.value))} ${esc(unit)}</text>` +
      `<text x="${W - 26}" y="${ly + 28}" font-family="${FONT}" font-size="11.5" fill="#94a3b8" text-anchor="end">${share.toFixed(1).replace('.', ',')}%</text>`,
    )
    ly += rowH
  }

  return (
    head +
    segs.join('') +
    `<text x="${CX}" y="${CY - 2}" font-family="${FONT}" font-size="21" font-weight="bold" fill="#0f172a" text-anchor="middle">${esc(fmtCompact(total, unit))}</text>` +
    `<text x="${CX}" y="${CY + 20}" font-family="${FONT}" font-size="12" fill="#94a3b8" text-anchor="middle">${esc(centerHint)}</text>` +
    rows.join('') +
    `</svg>`
  )
}
