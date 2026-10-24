'use client'

/**
 * «Подписать ЭДО» (Task 76) — подписание электронных документов рейсов.
 *
 * Наш случай — цепочка АЭМЗ (грузоотправитель) → экспедитор → перевозчик:
 *  — комплект экспедитора: Доверенность + Поручение экспедитору. По правилам
 *    транспортно-экспедиционной деятельности эти документы создаёт грузоотправитель,
 *    поэтому у логиста есть кнопка «Сформировать для экспедитора»;
 *  — комплект перевозчика: Транспортная накладная (ЭТрН, создаётся автоматически
 *    при подтверждении рейса) и Акт оказанных услуг (после закрытия рейса).
 * Каждая сторона подписывает своей КЭП: логист — за АЭМЗ, перевозчик-победитель —
 * за экспедитора (подписант: водитель-экспедитор) и за перевозчика. Статусы
 * подписания, предосмотр сканов с факсимиле — в карточке каждого рейса.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Eye, FileSignature, Info, PenLine, RefreshCw, ScrollText, Send, UserRound } from 'lucide-react'
import {
  EmptyState, ErrorBlock, LoadingBlock, SectionHeader, type TabProps,
} from '@/components/platform/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { EtrnSendDialog, EtrnStatus } from '@/components/platform/etrn-dialog'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/api'
import { fmtDateTime } from '@/lib/status'
import type { DiadocInfoDTO, EdoDocDTO, EdoDocPayloadDTO, EdoKind, EdoPackageDTO } from '@/lib/types'

/** Перенос длинной строки реквизитов на несколько строк скана */
function wrapLine(l: string, max = 56): string[] {
  const words = l.split(' ')
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    if (cur && `${cur} ${w}`.length > max) {
      out.push(cur)
      cur = w
    } else {
      cur = cur ? `${cur} ${w}` : w
    }
  }
  if (cur) out.push(cur)
  return out
}

/** Скан документа ЭДО: SVG из реквизитов + факсимиле подписанных сторон */
function edoScanSvg(p: EdoDocPayloadDTO, doc: EdoDocDTO): string {
  const wrapped = p.lines.flatMap((l) => wrapLine(l))
  const bodyTop = 150
  const rowH = 38
  const validY = bodyTop + wrapped.length * rowH + 12
  const height = Math.max(460, validY + 92)
  const rows = wrapped
    .map((l, i) => `<text x="44" y="${bodyTop + i * rowH}" font-family="Arial" font-size="21" fill="#1f2937">${escapeXml(l)}</text>`)
    .join('')
  const orgLine = `<text x="44" y="112" font-family="Arial" font-size="19" fill="#475569">${escapeXml(p.org)}</text>`
  const numLine = `<text x="44" y="84" font-family="Arial" font-size="23" font-weight="bold" fill="#0f172a">№ ${escapeXml(doc.number)}</text><text x="470" y="84" font-family="Arial" font-size="20" fill="#475569">от ${escapeXml(p.dateRu)}</text>`
  const validTill = p.validTill
    ? `<text x="44" y="${validY}" font-family="Arial" font-size="19" font-weight="bold" fill="#b45309">Действительна до: ${escapeXml(p.validTill)}</text>`
    : ''
  const stampY = height - 66
  const stampAemz = doc.aemzSigned
    ? `<g transform="rotate(-7 170 ${stampY + 21})"><rect x="60" y="${stampY}" width="230" height="42" rx="8" fill="none" stroke="#059669" stroke-width="3"/><text x="175" y="${stampY + 27}" text-anchor="middle" font-family="Arial" font-size="16" font-weight="bold" fill="#059669">ПОДПИСАНО · КЭП АЭМЗ</text></g>`
    : ''
  const stampParty = doc.partySigned
    ? `<g transform="rotate(5 465 ${stampY + 21})"><rect x="350" y="${stampY}" width="230" height="42" rx="8" fill="none" stroke="#059669" stroke-width="3"/><text x="465" y="${stampY + 18}" text-anchor="middle" font-family="Arial" font-size="14" font-weight="bold" fill="#059669">ПОДПИСАНО · ${escapeXml(doc.partyRole.toUpperCase())}</text><text x="465" y="${stampY + 33}" text-anchor="middle" font-family="Arial" font-size="9" fill="#059669">оператор ЭДО</text></g>`
    : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${height}"><rect width="640" height="${height}" rx="14" fill="#f8fafc" stroke="#cbd5e1"/><rect width="640" height="64" rx="14" fill="${p.accent}"/><text x="40" y="42" font-family="Arial" font-size="24" font-weight="bold" fill="#fff">${escapeXml(p.title.toUpperCase())}</text>${numLine}${orgLine}${rows}${validTill}${stampAemz}${stampParty}</svg>`
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Пузырь статуса подписания стороны (яркие, стиль реестров) */
function SignBadge({ signed, label }: { signed: boolean; label: string }) {
  return signed ? (
    <Badge variant="outline" className="whitespace-nowrap bg-emerald-500 text-white border-emerald-600 shadow-sm">
      ✓ {label}
    </Badge>
  ) : (
    <Badge variant="outline" className="whitespace-nowrap bg-amber-100 text-amber-800 border-amber-300">
      Ожидает · {label}
    </Badge>
  )
}

/** Порядок комплектов и документов в карточке рейса */
const DOC_ORDER: EdoKind[] = ['POA', 'ORDER', 'ETRN', 'ACT']

export default function EdoTab({ role, liveTick }: TabProps) {
  const { toast } = useToast()
  const [packages, setPackages] = useState<EdoPackageDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [previewDoc, setPreviewDoc] = useState<{ doc: EdoDocDTO; pack: EdoPackageDTO } | null>(null)
  // Диадок: состояние интеграции и окно отправки ЭТрН
  const [diadoc, setDiadoc] = useState<DiadocInfoDTO | null>(null)
  const [etrnFor, setEtrnFor] = useState<{ requestId: string; requestNumber: string; doc: EdoDocDTO } | null>(null)
  const [syncing, setSyncing] = useState(false)

  const isLogist = role === 'logist'

  const load = useCallback(async () => {
    try {
      const res = await api.edoList()
      setPackages(res.packages)
      setDiadoc(res.diadoc)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (liveTick > 0) void load()
  }, [liveTick, load])

  const counters = useMemo(() => {
    let awaiting = 0
    let signed = 0
    for (const p of packages ?? []) {
      for (const d of p.docs) {
        if (d.aemzSigned && d.partySigned) signed += 1
        else awaiting += 1
      }
    }
    return { awaiting, signed }
  }, [packages])

  const createPack = async (pack: EdoPackageDTO) => {
    setBusy(pack.request.id)
    try {
      await api.edoAction({ requestId: pack.request.id, action: 'create-expeditor-pack' })
      toast({ title: 'Комплект сформирован', description: `№${pack.request.number}: доверенность и поручение экспедитору отправлены на подписание` })
      await load()
    } catch (e) {
      toast({ title: 'Не удалось сформировать комплект', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const sign = async (pack: EdoPackageDTO, doc: EdoDocDTO) => {
    setBusy(doc.id)
    try {
      await api.edoAction({ requestId: pack.request.id, action: 'sign', docId: doc.id })
      toast({ title: 'Документ подписан', description: `${doc.title} №${doc.number} — подпись отправлена в ЭДО` })
      await load()
    } catch (e) {
      toast({ title: 'Не удалось подписать', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const syncDiadoc = async () => {
    setSyncing(true)
    try {
      const r = await api.diadocSync()
      toast({ title: 'Статусы ЭТрН сверены с Диадоком', description: r.changed ? `Обновлено документов: ${r.changed}` : 'Изменений нет' })
      await load()
    } catch (e) {
      toast({ title: 'Не удалось сверить статусы', description: e instanceof Error ? e.message : 'Попробуйте ещё раз', variant: 'destructive' })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div>
      <SectionHeader
        eyebrow={isLogist ? 'Внутренний контур АЭМЗ' : 'Кабинет перевозчика'}
        title="Подписать ЭДО"
        desc="Электронный документооборот рейсов: доверенность и поручение экспедитору, транспортная накладная и акт — каждая сторона подписывает своей КЭП через оператора ЭДО."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Ожидают подписи: {counters.awaiting}</Badge>
          <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">Подписано: {counters.signed}</Badge>
          {diadoc?.enabled && (
            <>
              <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-800">Диадок · {diadoc.stand}</Badge>
              <Button size="sm" variant="outline" disabled={syncing} onClick={() => void syncDiadoc()} className="h-7 gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} aria-hidden />
                Обновить статусы
              </Button>
            </>
          )}
        </div>
      </SectionHeader>
      {diadoc?.enabled && (diadoc.lastError || diadoc.lastSyncAt) && (
        <p className={`-mt-3 mb-4 text-xs ${diadoc.lastError ? 'text-red-600' : 'text-slate-500'}`}>
          {diadoc.lastError
            ? `Последняя сверка с Диадоком не удалась: ${diadoc.lastError}`
            : `Статусы ЭТрН сверены с Диадоком ${fmtDateTime(diadoc.lastSyncAt!)}`}
        </p>
      )}

      {packages === null && !error && <LoadingBlock label="Загружаем документы ЭДО…" />}
      {error && <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />}

      {packages !== null && !error && (
        <div className="space-y-4">
          {/* Схема документооборота — наш случай */}
          <Card className="border-slate-200 bg-slate-50/60 shadow-sm">
            <CardContent className="flex flex-col gap-2 p-4 text-sm text-slate-700">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <Info className="h-4 w-4 text-slate-500" aria-hidden />
                Как устроен документооборот
              </div>
              <ul className="ml-5 list-disc space-y-1">
                <li><span className="font-medium">Схема: АЭМЗ (грузоотправитель) → экспедитор → перевозчик.</span> Экспедитор организует доставку от имени завода, его представитель — водитель-экспедитор.</li>
                <li><span className="font-medium">От нас экспедитору</span> — доверенность (ДОВ) и поручение экспедитору (ПОР): эти документы создаёт логист АЭМЗ.</li>
                <li><span className="font-medium">Между АЭМЗ и перевозчиком</span> — транспортная накладная (ЭТрН, формируется при подтверждении рейса) и акт оказанных услуг (после выполнения).</li>
                <li><span className="font-medium">Подписание</span> — КЭП каждой стороны через оператора ЭДО: АЭМЗ подписывает у себя, экспедитор и перевозчик — со своей стороны.</li>
              </ul>
            </CardContent>
          </Card>

          {packages.length === 0 ? (
            <EmptyState
              icon={<FileSignature className="h-10 w-10" aria-hidden />}
              title="Пока нет рейсов для подписания"
              hint="Комплекты документов появятся здесь после подтверждения заявки на сверке — рейсы в работе и закрытые"
            />
          ) : (
            packages.map((pack) => {
              const expeditorDocs = DOC_ORDER
                .map((kind) => pack.docs.find((d) => d.kind === kind))
                .filter((d): d is EdoDocDTO => Boolean(d) && ['POA', 'ORDER'].includes(d!.kind))
              const carrierDocs = DOC_ORDER
                .map((kind) => pack.docs.find((d) => d.kind === kind))
                .filter((d): d is EdoDocDTO => Boolean(d) && ['ETRN', 'ACT'].includes(d!.kind))
              const r = pack.request
              const inWork = r.status === 'CONFIRMED'
              return (
                <Card key={pack.request.id} className="border-slate-200 shadow-sm">
                  <CardContent className="space-y-4 p-4 sm:p-5">
                    {/* шапка рейса */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="text-base font-bold text-blue-700">№{r.number}</span>
                      <Badge variant="outline" className={inWork
                        ? 'bg-violet-500 text-white border-violet-600 shadow-sm'
                        : 'bg-emerald-500 text-white border-emerald-600 shadow-sm'}
                      >
                        {inWork ? 'В работе' : 'Завершён'}
                      </Badge>
                      <span className="text-sm text-slate-700">{r.route}</span>
                      <span className="text-sm text-slate-500">· {r.cargo}, {new Intl.NumberFormat('ru-RU').format(r.tonnage)} т</span>
                      <span className="text-sm text-slate-500">· погрузка {r.loadDate}</span>
                      <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5 text-slate-400" aria-hidden />{r.winnerName ?? '—'}</span>
                        <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden />{r.driverName ?? '—'}</span>
                        <span className="font-mono">{r.truckLabel ?? '—'}</span>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {/* комплект экспедитора */}
                      <DocKit
                        title="Комплект экспедитора"
                        hint="Документы создаёт АЭМЗ (грузоотправитель) — обязанность перед экспедитором"
                        docs={expeditorDocs}
                        pack={pack}
                        role={role}
                        busy={busy}
                        onSign={sign}
                        onPreview={setPreviewDoc}
                        footer={expeditorDocs.length === 0 ? (
                          isLogist ? (
                            <Button size="sm" disabled={busy === pack.request.id || !inWork} onClick={() => void createPack(pack)}>
                              <FileSignature className="mr-1.5 h-4 w-4" aria-hidden />
                              Сформировать для экспедитора
                            </Button>
                          ) : (
                            <p className="text-xs text-slate-500">Комплект ещё не сформирован — его готовит АЭМЗ и пришлёт в этот раздел.</p>
                          )
                        ) : undefined}
                        emptyHint={isLogist
                          ? 'Сформируйте комплект — без доверенности и поручения экспедитор не сможет принять груз'
                          : undefined}
                      />

                      {/* комплект перевозчика */}
                      <DocKit
                        title="Комплект перевозчика"
                        hint="ЭТрН формируется автоматически при подтверждении рейса, акт — после закрытия"
                        docs={carrierDocs}
                        pack={pack}
                        role={role}
                        busy={busy}
                        onSign={sign}
                        onPreview={setPreviewDoc}
                        diadocEnabled={Boolean(diadoc?.enabled)}
                        onEtrnSend={(doc) => setEtrnFor({ requestId: pack.request.id, requestNumber: pack.request.number, doc })}
                        emptyHint={isLogist
                          ? 'Накладная появится после подтверждения заявки, акт — после закрытия рейса'
                          : 'Накладная появится, когда АЭМЗ подтвердит рейс'}
                      />
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>
      )}

      {/* отправка ЭТрН в Диадок */}
      {diadoc?.enabled && (
        <EtrnSendDialog
          key={etrnFor?.doc.id ?? 'none'}
          open={!!etrnFor}
          onOpenChange={(o) => { if (!o) setEtrnFor(null) }}
          target={etrnFor}
          diadoc={diadoc}
          onSent={() => void load()}
        />
      )}

      {/* предосмотр скана документа */}
      <Dialog open={!!previewDoc} onOpenChange={(o) => { if (!o) setPreviewDoc(null) }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {previewDoc && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {previewDoc.doc.title}
                  <span className="text-blue-700">№{previewDoc.doc.number}</span>
                </DialogTitle>
                <DialogDescription>
                  Рейс №{previewDoc.pack.request.number} · {previewDoc.doc.partyRole}. Подписи сторон — с факсимиле КЭП через оператора ЭДО.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <img
                  src={edoScanSvg(previewDoc.doc.payload, previewDoc.doc)}
                  alt={`${previewDoc.doc.title} №${previewDoc.doc.number}`}
                  className="w-full rounded-xl border border-slate-200"
                />
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <SignBadge signed={previewDoc.doc.aemzSigned} label="КЭП АЭМЗ" />
                  <SignBadge signed={previewDoc.doc.partySigned} label={previewDoc.doc.partyRole} />
                  {previewDoc.doc.aemzSigner && <span>АЭМЗ: {previewDoc.doc.aemzSigner}{previewDoc.doc.aemzSignedAt ? ` · ${fmtDateTime(previewDoc.doc.aemzSignedAt)}` : ''}</span>}
                  {previewDoc.doc.partySigner && <span>{previewDoc.doc.partyRole}: {previewDoc.doc.partySigner}{previewDoc.doc.partySignedAt ? ` · ${fmtDateTime(previewDoc.doc.partySignedAt)}` : ''}</span>}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Блок одного комплекта документов (экспедиторского или перевозчика) */
function DocKit({ title, hint, docs, pack, role, busy, onSign, onPreview, footer, emptyHint, diadocEnabled = false, onEtrnSend }: {
  title: string
  hint: string
  docs: EdoDocDTO[]
  pack: EdoPackageDTO
  role: 'logist' | 'carrier'
  busy: string | null
  onSign: (pack: EdoPackageDTO, doc: EdoDocDTO) => Promise<void>
  onPreview: (v: { doc: EdoDocDTO; pack: EdoPackageDTO }) => void
  footer?: React.ReactNode
  emptyHint?: string
  /** ЭТрН идёт через Диадок: подпись — у оператора ЭДО, в карточке — статусы Т1–Т4 */
  diadocEnabled?: boolean
  onEtrnSend?: (doc: EdoDocDTO) => void
}) {
  const isLogist = role === 'logist'
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <ScrollText className="h-4 w-4 text-slate-400" aria-hidden />
          {title}
        </div>
        <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
      </div>
      <div className="space-y-2 px-4 py-3">
        {docs.length === 0 ? (
          <div className="py-2 text-sm text-slate-400">{emptyHint ?? 'Документов пока нет'}</div>
        ) : (
          docs.map((doc) => {
            const mySideDone = isLogist ? doc.aemzSigned : doc.partySigned
            const viaDiadoc = diadocEnabled && doc.kind === 'ETRN'
            const canSign = !viaDiadoc && !mySideDone && !(doc.aemzSigned && doc.partySigned)
            return (
              <div key={doc.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onPreview({ doc, pack })}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-blue-700"
                    title="Предосмотр документа"
                  >
                    <Eye className="h-4 w-4 text-slate-400" aria-hidden />
                    {doc.title}
                    <span className="font-mono text-xs text-blue-700">№{doc.number}</span>
                  </button>
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    <SignBadge signed={doc.aemzSigned} label="КЭП АЭМЗ" />
                    <SignBadge signed={doc.partySigned} label={doc.partyRole} />
                  </span>
                </div>
                {/* кто подписал — подписи со временем */}
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
                  {doc.aemzSigner && <span>АЭМЗ: {doc.aemzSigner}{doc.aemzSignedAt ? ` · ${fmtDateTime(doc.aemzSignedAt)}` : ''}</span>}
                  {doc.partySigner && <span>{doc.partyRole}: {doc.partySigner}{doc.partySignedAt ? ` · ${fmtDateTime(doc.partySignedAt)}` : ''}</span>}
                </div>
                {viaDiadoc && <EtrnStatus doc={doc} />}
                {viaDiadoc && !doc.diadoc && isLogist && pack.request.status === 'CONFIRMED' && onEtrnSend && (
                  <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={() => onEtrnSend(doc)} className="h-8 border-blue-200 text-blue-700 hover:bg-blue-50">
                      <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      Отправить ЭТрН в Диадок (Т1)
                    </Button>
                  </div>
                )}
                {viaDiadoc && doc.diadoc && !doc.partySigned && !isLogist && (
                  <p className="mt-2 text-xs text-blue-800">Подпишите титул перевозчика Т2 в своём Диадоке — платформа увидит подпись автоматически.</p>
                )}
                {viaDiadoc && !doc.diadoc && !isLogist && (
                  <p className="mt-2 text-xs text-slate-500">АЭМЗ ещё не отправило накладную — она придёт в ваш Диадок.</p>
                )}
                {canSign && (
                  <div className="mt-2">
                    {isLogist ? (
                      <Button size="sm" variant="outline" disabled={busy === doc.id} onClick={() => void onSign(pack, doc)} className="h-8 border-blue-200 text-blue-700 hover:bg-blue-50">
                        <PenLine className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        Подписать (КЭП АЭМЗ)
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled={busy === doc.id} onClick={() => void onSign(pack, doc)} className="h-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                        <PenLine className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        {doc.party === 'EXPEDITOR' ? 'Подписать за экспедитора' : 'Подписать за перевозчика'}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
        {footer}
      </div>
    </div>
  )
}
