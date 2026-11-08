/**
 * Аудит привязки ошибок нейросети к фотографиям (Task 86).
 * Прогоняет реальные фото через боевой путь intake:
 *   ocrServiceOcr (gateway :3020 → PaddleOCR :3031) → applyRules (verify.ts)
 * и печатает: распознанные поля с уверенности/подтверждениями и итоговые
 * предупреждения по каждому документу — то, что показывается на карточке фото.
 * Запуск: bun scripts/audit-ocr.ts upload/"файл1" upload/"файл2" ...
 */
import { readFile } from 'fs/promises'
import { ocrServiceOcr } from '@/lib/ocr-service'
import { loadVerifySettings } from '@/lib/settings'
import { applyRules, DOC_FIELDS, type DocType } from '@/lib/verify'

const toDataUri = async (p: string): Promise<string> => {
  const buf = await readFile(p)
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}

const TYPES: DocType[] = ['PASSPORT_PHOTO', 'PASSPORT_REG']

async function main() {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error('usage: bun scripts/audit-ocr.ts <photo1> <photo2> ...')
    process.exit(1)
  }
  const settings = await loadVerifySettings()
  for (const [i, file] of files.entries()) {
    const type = TYPES[i] ?? 'PASSPORT_PHOTO'
    console.log(`\n===== ${file} → слот ${type} =====`)
    const t0 = Date.now()
    const res = await ocrServiceOcr(await toDataUri(file), type, true)
    if (res.kind !== 'ok') {
      console.log('OCR не выполнен:', JSON.stringify(res))
      continue
    }
    const ocr = res.ocr
    console.log(`движок: ${ocr.engine}, качество: ${ocr.quality}, detectedType: ${ocr.detectedType ?? '—'}, ${((Date.now() - t0) / 1000).toFixed(1)} с`)
    console.log('— поля движка (уверенность | подтверждения):')
    for (const f of DOC_FIELDS[type]) {
      const v = (ocr.fields[f.label] ?? '').trim()
      const c = ocr.confidences[f.label] ?? 0
      const conf = ocr.confirmations?.[f.label] ?? []
      console.log(`   ${v ? '✓' : '✗'} ${f.label}${f.optional ? ' (необяз.)' : ''}: ${v ? `«${v}»` : '—'} | ${c.toFixed(2)}${conf.length ? ` | подтверждения: ${conf.join(', ')}` : ''}`)
    }
    const verdict = applyRules(ocr, type, {}, settings)
    console.log(`— вердикт: ${verdict.status} — ${verdict.message}`)
    console.log('— предупреждения на карточке фото:')
    for (const it of verdict.issues) console.log(`   • ${it}`)
  }
}

void main()
