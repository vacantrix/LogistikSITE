'use client'

/**
 * «Подписать ЭДО» (Task 76) — подписание электронных документов рейсов.
 *
 * Документы зависят от роли исполнителя рейса (справочник перевозчиков):
 *  — перевозчик: заказ (заявка) на перевозку груза;
 *  — экспедитор: поручение экспедитору по договору транспортной экспедиции;
 *  — у обоих: транспортная накладная (ЭТрН — через Диадок, если он подключён)
 *    и акт оказанных услуг после закрытия рейса.
 * Все документы появляются сами — логист и исполнитель только подписывают своей КЭП.
 * Статусы подписания, предосмотр сканов с факсимиле — в карточке каждого рейса.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Eye, FileSignature, PenLine, RefreshCw, ScrollText, Send, UserRound } from 'lucide-react'
import {
  EmptyState, ErrorBlock, InfoTip, LoadingBlock, SectionHeader, StatusDot, WithTip, type TabProps,
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

/** Подпись стороны точкой и словом: подписано — зелёная точка, ждёт — янтарная */
function SignBadge({ signed, label }: { signed: boolean; label: string }) {
  return signed
    ? <StatusDot dot="bg-emerald-500">{label}</StatusDot>
    : <StatusDot dot="bg-amber-500" tone="warning">Ожидает · {label}</StatusDot>
}

/** Порядок комплектов и документов в карточке рейса */
const DOC_ORDER: EdoKind[] = ['ORDER', 'ETRN', 'ACT']

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
        desc={
          <ul className="list-disc space-y-1 pl-4">
            <li><b>Перевозчик</b> (везёт сам): АЭМЗ и перевозчик подписывают заказ-заявку на перевозку.</li>
            <li><b>Экспедитор</b> (организует перевозку): вместо заказ-заявки — поручение экспедитору; перевозчика и доверенность на водителя оформляет он, а не АЭМЗ.</li>
            <li><b>Транспортная накладная</b> появляется при подтверждении рейса{diadoc?.enabled ? ' и идёт через Диадок: АЭМЗ подписывает титул грузоотправителя, остальные — у себя, статусы приходят сами' : ''}. Акт — после закрытия рейса.</li>
            <li><b>Роль компании</b> задаётся в «Справочниках» — от неё зависит договорной документ.</li>
          </ul>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusDot dot="bg-amber-500">Ожидают подписи: {counters.awaiting}</StatusDot>
          <StatusDot dot="bg-emerald-500">Подписано: {counters.signed}</StatusDot>
          {diadoc?.enabled && (
            <>
              <span className="text-sm text-slate-500">{diadoc.stand.charAt(0).toUpperCase() + diadoc.stand.slice(1)}</span>
              {/* время последней сверки — по наведению на кнопку */}
              <WithTip tip={diadoc.lastSyncAt ? `Статусы ЭТрН сверены с Диадоком ${fmtDateTime(diadoc.lastSyncAt)}` : 'Сверить статусы ЭТрН с Диадоком'}>
                <Button size="sm" variant="outline" disabled={syncing} onClick={() => void syncDiadoc()} className="h-7 gap-1.5">
                  <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} aria-hidden />
                  Обновить статусы
                </Button>
              </WithTip>
            </>
          )}
        </div>
      </SectionHeader>
      {/* ошибка сверки — не пояснение, её видно сразу */}
      {diadoc?.enabled && diadoc.lastError && (
        <p className="-mt-3 mb-4 text-xs text-red-600">Последняя сверка с Диадоком не удалась: {diadoc.lastError}</p>
      )}

      {packages === null && !error && <LoadingBlock label="Загружаем документы ЭДО…" />}
      {error && <ErrorBlock message={error} onRetry={() => { setError(null); void load() }} />}

      {packages !== null && !error && (
        <div className="space-y-4">
          {packages.length === 0 ? (
            <EmptyState
              icon={<FileSignature className="h-10 w-10" aria-hidden />}
              title="Пока нет рейсов для подписания"
              hint="Комплекты документов появятся здесь после подтверждения заявки на сверке — рейсы в работе и закрытые"
            />
          ) : (
            packages.map((pack) => {
              const orderDocs = pack.docs.filter((d) => d.kind === 'ORDER')
              const tripDocs = DOC_ORDER
                .map((kind) => pack.docs.find((d) => d.kind === kind))
                .filter((d): d is EdoDocDTO => Boolean(d) && ['ETRN', 'ACT'].includes(d!.kind))
              const r = pack.request
              const inWork = r.status === 'CONFIRMED'
              const forwarder = r.executorRole === 'FORWARDER'
              return (
                <Card key={pack.request.id} className="border-slate-200 shadow-sm">
                  <CardContent className="space-y-4 p-4 sm:p-5">
                    {/* шапка рейса */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="text-base font-bold text-slate-900">№{r.number}</span>
                      <StatusDot dot={inWork ? 'bg-violet-500' : 'bg-emerald-500'}>
                        {inWork ? 'В работе' : 'Завершён'}
                      </StatusDot>
                      <Badge variant="outline" className="border-slate-300 bg-white text-slate-700">
                        {forwarder ? 'Экспедитор' : 'Перевозчик'}
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
                      {/* договорной документ — по роли исполнителя */}
                      <DocKit
                        title={forwarder ? 'Поручение экспедитору' : 'Заказ-заявка на перевозку'}
                        hint={forwarder
                          ? 'Договор транспортной экспедиции: экспедитор организует перевозку и сам нанимает перевозчика'
                          : 'Договорной документ АЭМЗ и перевозчика по этому рейсу'}
                        docs={orderDocs}
                        pack={pack}
                        role={role}
                        busy={busy}
                        onSign={sign}
                        onPreview={setPreviewDoc}
                      />

                      {/* перевозочные документы */}
                      <DocKit
                        title="Перевозочные документы"
                        hint="ЭТрН — при подтверждении рейса, акт оказанных услуг — после закрытия"
                        docs={tripDocs}
                        pack={pack}
                        role={role}
                        busy={busy}
                        onSign={sign}
                        onPreview={setPreviewDoc}
                        diadocEnabled={Boolean(diadoc?.enabled)}
                        onEtrnSend={(doc) => setEtrnFor({ requestId: pack.request.id, requestNumber: pack.request.number, doc })}
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
                  <span className="text-slate-900">№{previewDoc.doc.number}</span>
                </DialogTitle>
                <DialogDescription>
                  Рейс №{previewDoc.pack.request.number} · {previewDoc.doc.partyRole}
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

/** Блок документов рейса: договорной документ или перевозочные документы */
function DocKit({ title, hint, docs, pack, role, busy, onSign, onPreview, footer, diadocEnabled = false, onEtrnSend }: {
  title: string
  hint: string
  docs: EdoDocDTO[]
  pack: EdoPackageDTO
  role: 'logist' | 'carrier'
  busy: string | null
  onSign: (pack: EdoPackageDTO, doc: EdoDocDTO) => Promise<void>
  onPreview: (v: { doc: EdoDocDTO; pack: EdoPackageDTO }) => void
  footer?: React.ReactNode
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
          <InfoTip label={title}>{hint}</InfoTip>
        </div>
      </div>
      <div className="space-y-2 px-4 py-3">
        {docs.length === 0 ? (
          <div className="py-2 text-sm text-slate-400">Документов пока нет</div>
        ) : (
          docs.map((doc) => {
            const mySideDone = isLogist ? doc.aemzSigned : doc.partySigned
            // через Диадок идёт накладная рейса в работе или уже отправленная; у закрытых
            // до подключения Диадока рейсов накладная подписана в платформе — показываем её подписи
            const viaDiadoc = diadocEnabled && doc.kind === 'ETRN' && (Boolean(doc.diadoc) || pack.request.status === 'CONFIRMED')
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
                    <span className="font-mono text-xs text-slate-500">№{doc.number}</span>
                  </button>
                  {/* у ЭТрН через Диадок подписи показывает полоса титулов Т1–Т4 — без дублей */}
                  {!viaDiadoc && (
                    <span className="ml-auto flex flex-wrap items-center gap-1.5">
                      <SignBadge signed={doc.aemzSigned} label="КЭП АЭМЗ" />
                      <SignBadge signed={doc.partySigned} label={doc.partyRole} />
                    </span>
                  )}
                </div>
                {/* кто подписал — подписи со временем */}
                {!viaDiadoc && (
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
                    {doc.aemzSigner && <span>АЭМЗ: {doc.aemzSigner}{doc.aemzSignedAt ? ` · ${fmtDateTime(doc.aemzSignedAt)}` : ''}</span>}
                    {doc.partySigner && <span>{doc.partyRole}: {doc.partySigner}{doc.partySignedAt ? ` · ${fmtDateTime(doc.partySignedAt)}` : ''}</span>}
                  </div>
                )}
                {viaDiadoc && <EtrnStatus doc={doc} />}
                {viaDiadoc && !doc.diadoc && isLogist && pack.request.status === 'CONFIRMED' && onEtrnSend && (
                  <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={() => onEtrnSend(doc)} className="h-8">
                      <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      Отправить ЭТрН в Диадок (Т1)
                    </Button>
                  </div>
                )}
                {viaDiadoc && doc.diadoc && !doc.partySigned && !isLogist && (
                  <WithTip tip="Подпишите титул перевозчика Т2 в своём Диадоке — платформа увидит подпись автоматически">
                    <span tabIndex={0} className="mt-2 inline-flex">
                      <StatusDot dot="bg-amber-500" tone="warning">Ждёт вашей подписи Т2 в Диадоке</StatusDot>
                    </span>
                  </WithTip>
                )}
                {canSign && (
                  <div className="mt-2">
                    {isLogist ? (
                      <Button size="sm" variant="outline" disabled={busy === doc.id} onClick={() => void onSign(pack, doc)} className="h-8">
                        <PenLine className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        Подписать (КЭП АЭМЗ)
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled={busy === doc.id} onClick={() => void onSign(pack, doc)} className="h-8">
                        <PenLine className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        {doc.party === 'EXPEDITOR' ? 'Подписать (КЭП экспедитора)' : 'Подписать (КЭП перевозчика)'}
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
