package ru.azmz.logistics.driver.core.sync

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Передний план: пока приложение открыто, обмен идёт непрерывно.
 *
 * Схема — long-poll «АЭМЗ Поток»:
 *   push outbox → pull журнала → ждём /sync/wait до 20 с.
 * Сервер отвечает мгновенно, как только диспетчер назначил рейс или написал
 * в офис; тишина по таймауту просто открывает следующее ожидание. Полный
 * pull каждый цикл — страховка от пропущенного события и дешёвый запрос.
 *
 * В фоне (экран выключен, приложение свёрнуто) цикл останавливается, а
 * WorkManager продолжает периодическую синхронизацию. При возврате в
 * приложение цикл поднимается сразу — без ожидания 15-минутного воркера.
 */
object SyncEngine {
    private var job: Job? = null

    /** Идемпотентно: повторный onStart не плодит второй цикл. */
    @Synchronized
    fun start(context: Context) {
        if (job?.isActive == true) return
        val appContext = context.applicationContext
        job = CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            while (isActive) {
                try {
                    // 1. отдать действия водителя, 2. забрать входящие
                    SyncRunner.push()
                    SyncRunner.pull()
                    // 3. ждать следующее изменение журнала
                    AppGraph.api.wait(SyncRunner.journalCursor(), timeoutSeconds = 20)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // сеть пропала или сервер перезапускается — короткая пауза,
                    // затем повтор; данные в Room и outbox не теряются
                    delay(2500)
                }
            }
        }
        // стартовый добор: накопленное за время в фоне уходит сразу
        SyncScheduler.kick(appContext)
    }

    @Synchronized
    fun stop() {
        job?.cancel()
        job = null
    }
}
