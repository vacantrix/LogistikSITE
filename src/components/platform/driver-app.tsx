'use client'

/**
 * «Приложение водителя» — административный раздел платформы.
 *
 * Модуль живёт на том же домене, что и «АЭМЗ Поток»: веб-версия /driver/,
 * API /api/driver/v1/* через шлюз, APK /dl/Drivemobile.apk. Панель показывает
 * состояние сервиса, журнала и последнюю GPS-точку, чтобы администратор видел,
 * что телефон водителя действительно на связи, а не просто «должен работать».
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Activity, Check, Copy, Download, ExternalLink, MapPin, RefreshCw, Server, Smartphone, Wifi, WifiOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { authFetch } from '@/lib/kontur/session-token'

type DriverStatus = {
  ok?: boolean
  service?: string
  version?: string
  driverId?: string
  trips?: number
  activeTrips?: number
  events?: number
  journalSeq?: number
  pendingOutbox?: number
  position?: {
    lat: number
    lon: number
    speedKmh?: number
    heading?: number
    tripCode?: string
    ts?: number
    receivedAt?: number
  } | null
}

type StatusResponse = {
  service: 'online' | 'offline'
  error: string
  status: DriverStatus | null
  links: { web: string; api: string; apk: string }
  apk: { url: string; size: number; updatedAt: number | null }
  now: number
}

function fmtTime(ts?: number | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function fmtAge(ts?: number | null): string {
  if (!ts) return 'ещё не было'
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (sec < 60) return `${sec} с назад`
  if (sec < 3600) return `${Math.round(sec / 60)} мин назад`
  if (sec < 86400) return `${Math.round(sec / 3600)} ч назад`
  return `${Math.round(sec / 86400)} дн назад`
}

function fmtSize(size: number): string {
  if (!size) return '—'
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-right text-sm font-medium text-slate-900">{value}</span>
    </div>
  )
}

export function DriverAppTab({ liveTick = 0 }: { liveTick?: number }) {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/driver-app/status', { cache: 'no-store' })
      const json = (await res.json().catch(() => null)) as StatusResponse | { error?: string } | null
      if (!res.ok) throw new Error((json as { error?: string } | null)?.error ?? `HTTP ${res.status}`)
      setData(json as StatusResponse)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 10_000)
    return () => clearInterval(timer)
  }, [load, liveTick])

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const webUrl = `${origin}/driver`
  const apkUrl = `${origin}${data?.links.apk ?? '/dl/Drivemobile.apk'}`
  const status = data?.status
  const online = data?.service === 'online'
  const lastFix = status?.position?.receivedAt ?? status?.position?.ts

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(webUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* буфер недоступен — ссылка видна на экране */ }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
            <Smartphone className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Приложение водителя</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Модуль платформы «АЭМЗ Поток» для телефона водителя. Та же база, тот же домен:
              веб-версия открывается по <span className="font-medium text-slate-700">/driver</span>,
              APK — по <span className="font-medium text-slate-700">/dl/Drivemobile.apk</span>.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
            data?.service === 'online'
              ? 'bg-emerald-50 text-emerald-700'
              : data
                ? 'bg-red-50 text-red-700'
                : 'bg-slate-100 text-slate-600'
          }`}>
            {data?.service === 'online' ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {data?.service === 'online' ? 'Сервер на связи' : data ? 'Сервер недоступен' : 'Проверка…'}
          </span>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Не удалось получить состояние модуля: {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ExternalLink className="h-4 w-4 text-orange-500" />
              Веб-версия
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-500">
              Открывается на телефоне как обычный сайт и устанавливается на главный экран.
              Работает офлайн, очередь действий досылается сама.
            </p>
            <div className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 break-all">
              {webUrl}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => window.open(webUrl, '_blank', 'noopener')}>
                <ExternalLink className="mr-1.5 h-4 w-4" />
                Открыть
              </Button>
              <Button variant="outline" size="sm" onClick={() => void copy()}>
                {copied ? <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> : <Copy className="mr-1.5 h-4 w-4" />}
                {copied ? 'Скопировано' : 'Скопировать'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="h-4 w-4 text-orange-500" />
              Android APK
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-500">
              Нативное приложение с картой, рейсом и офлайн-очередью. Привязано к серверу
              «АЭМЗ Поток» — отдельный адрес вводить не нужно.
            </p>
            <Row label="Версия" value={status?.version ?? '0.3.0'} />
            <Row label="Размер" value={fmtSize(data?.apk.size ?? 0)} />
            <Row label="Опубликован" value={fmtTime(data?.apk.updatedAt)} />
            <Button className="w-full bg-orange-600 hover:bg-orange-700" onClick={() => window.open(apkUrl, '_blank', 'noopener')}>
              <Download className="mr-1.5 h-4 w-4" />
              Скачать APK
            </Button>
            {!data?.apk.size && !loading && (
              <p className="text-xs text-amber-700">Файл ещё не опубликован на этом стенде.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4 text-orange-500" />
              Состояние сервиса
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <Row label="Статус" value={online ? 'на связи' : 'не отвечает'} />
            <Row label="Водитель" value={status?.driverId ? `${status.driverId.slice(0, 8)}…` : '—'} />
            <Row label="Рейсы" value={status ? `${status.activeTrips ?? 0} активн. / ${status.trips ?? 0} всего` : '—'} />
            <Row label="Журнал" value={status ? `seq ${status.journalSeq ?? 0}` : '—'} />
            <Row label="Очередь outbox" value={status ? `${status.pendingOutbox ?? 0}` : '—'} />
            <Row
              label="GPS"
              value={status?.position
                ? `${status.position.lat.toFixed(4)}, ${status.position.lon.toFixed(4)} · ${fmtAge(lastFix)}`
                : 'нет данных'}
            />
            {data?.error && online === false && (
              <p className="pt-1 text-xs text-red-600">{data.error}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-orange-500" />
              Как подключить телефон
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm text-slate-600">
              <li><span className="font-semibold text-slate-900">1.</span> Откройте ссылку веб-версии на телефоне водителя.</li>
              <li><span className="font-semibold text-slate-900">2.</span> Для нативного приложения скачайте APK и разрешите установку из браузера.</li>
              <li><span className="font-semibold text-slate-900">3.</span> Войдите в рейс: назначение и ответы офиса приходят сразу, без кнопки «Обновить».</li>
              <li><span className="font-semibold text-slate-900">4.</span> В офлайне действия копятся в очереди и уходят автоматически при возврате сети.</li>
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4 text-orange-500" />
              Последняя точка
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-600">
            {status?.position ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">Широта</div>
                    <div className="font-mono text-slate-900">{status.position.lat.toFixed(5)}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">Долгота</div>
                    <div className="font-mono text-slate-900">{status.position.lon.toFixed(5)}</div>
                  </div>
                </div>
                <Row label="Скорость" value={status.position.speedKmh != null ? `${status.position.speedKmh} км/ч` : '—'} />
                <Row label="Рейс" value={status.position.tripCode ?? '—'} />
                <Row label="Получена" value={fmtAge(lastFix)} />
              </>
            ) : (
              <p className="text-slate-500">
                Позиция появится, когда водитель начнёт рейс: приложение отправляет GPS-фикс
                каждые 5 секунд, диспетчер видит машину в «Мониторинге».
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-slate-400">
        Модуль обслуживается тем же процессом, что и API водителя; веб-версия и APK используют
        один журнал синхронизации. Панель обновляется автоматически раз в 10 секунд.
      </p>
    </div>
  )
}
