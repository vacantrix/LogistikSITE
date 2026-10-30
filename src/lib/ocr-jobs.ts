/**
 * Реестр долгих нейроопераций (распознавание документов) в памяти процесса.
 *
 * Зачем: распознавание одного документа занимает 5–90 с (на стенде 4 ГБ PaddleOCR
 * работает в режиме экономии памяти — модель грузится в короткоживущий процесс на
 * каждый запрос), а шлюз перед приложением обрывает «висящие» ответы примерно на
 * 30-й секунде — браузер видел «Ошибка запроса (502)», хотя сервер успешно
 * дорабатывал до конца. Теперь POST-маршруты мгновенно возвращают id задачи (202),
 * нейросеть досчитывает в фоне, а клиент опрашивает GET /api/ocr-jobs?id=… короткими
 * запросами, которые шлюз не режет.
 *
 * Задачи намеренно живут только в памяти: переживать рестарт сервера не нужно —
 * клиент в этом случае получит 404 и мягко попросит повторить операцию.
 */
export type OcrJobStatus = 'running' | 'done' | 'error'

/** владелец задачи (аудит №4): кто создал — тот и читает результат; staff видит все */
export interface OcrJobOwner {
  login: string
  staff: boolean
}

export interface OcrJob<T = unknown> {
  id: string
  status: OcrJobStatus
  /** результат операции (JSON ответа, каким он был бы в синхронном маршруте) */
  result?: T
  /** человекочитаемая ошибка, если статус error */
  error?: string
  createdAt: number
  finishedAt?: number
  /** кто создал задачу — без совпадения логина (для не-staff) результат не отдаётся */
  owner?: OcrJobOwner
}

/** результат держим 15 минут — пользователь мог уйти с вкладки и вернуться */
const JOB_TTL_MS = 15 * 60_000
/** потолок одновременно хранимых задач (защита от абузила длинным телом) */
const MAX_JOBS = 40

/**
 * Реестр живёт на globalThis: Next.js компилирует маршруты по отдельности, и каждый
 * бандл может получить СВОЙ экземпляр модуля — Map на уровне модуля в dev-режиме
 * разделяется не всегда (задача, созданная в одном маршруте, была невидима другому).
 * globalThis один на процесс — состояние общее для всех маршрутов.
 */
const G = globalThis as unknown as { __aemzOcrJobs?: Map<string, OcrJob> }
const JOBS: Map<string, OcrJob> = G.__aemzOcrJobs ?? (G.__aemzOcrJobs = new Map())

function sweep(): void {
  const now = Date.now()
  for (const [id, job] of JOBS) {
    if (now - (job.finishedAt ?? job.createdAt) > JOB_TTL_MS) JOBS.delete(id)
  }
}

/**
 * Запустить фоновую операцию и немедленно вернуть её id. Ошибки внутри run()
 * гасятся в статус задачи — маршрут уже ответил клиенту 202.
 * Возвращает null, если реестр переполнен (клиент получит просьбу подождать).
 */
export function startOcrJob<T>(run: () => Promise<T>, owner?: OcrJobOwner): { id: string } | null {
  sweep()
  if (JOBS.size >= MAX_JOBS) return null
  const id = crypto.randomUUID()
  const job: OcrJob<T> = { id, status: 'running', createdAt: Date.now(), ...(owner ? { owner } : {}) }
  JOBS.set(id, job as OcrJob)
  void (async () => {
    try {
      job.result = await run()
      job.status = 'done'
    } catch (e) {
      job.status = 'error'
      job.error = e instanceof Error ? e.message : 'Распознавание не удалось'
    } finally {
      job.finishedAt = Date.now()
    }
  })()
  return { id }
}

/**
 * Текущее состояние задачи (null — истекла, не существует или чужая).
 * Аудит №4: результат содержит распознанные персональные данные (паспорт, СТС),
 * поэтому не-staff видит только свои задачи — чужой jobId отвечает «не найдена».
 */
export function getOcrJob(id: string, viewer?: OcrJobOwner): OcrJob | null {
  sweep()
  const job = JOBS.get(id) ?? null
  if (!job) return null
  if (job.owner && viewer && !viewer.staff && job.owner.login !== viewer.login) return null
  return job
}
