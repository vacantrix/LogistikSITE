package ru.azmz.logistics.driver.core.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ru.azmz.logistics.driver.core.data.net.PushOp
import ru.azmz.logistics.driver.core.data.net.PushRequest
import java.util.concurrent.TimeUnit

/** Периодика и внеочередные циклы синхронизации. */
object SyncScheduler {
    private const val PUSH_PERIODIC = "sync-push-periodic"
    private const val PULL_PERIODIC = "sync-pull-periodic"
    private const val KICK = "sync-kick"

    fun schedulePeriodic(context: Context) {
        val wm = WorkManager.getInstance(context)
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        wm.enqueueUniquePeriodicWork(
            PUSH_PERIODIC,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<PushWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build(),
        )
        wm.enqueueUniquePeriodicWork(
            PULL_PERIODIC,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<PullWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build(),
        )
    }

    /**
     * Внеочередной цикл push → pull: старт приложения, возврат связи,
     * пуши (RuStore Push / FCM — только «будильник»).
     */
    fun kick(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val push = OneTimeWorkRequestBuilder<PushWorker>().setConstraints(constraints).build()
        val pull = OneTimeWorkRequestBuilder<PullWorker>().setConstraints(constraints).build()
        WorkManager.getInstance(context)
            .beginUniqueWork(KICK, ExistingWorkPolicy.REPLACE, push)
            .then(pull)
            .enqueue()
    }
}

/**
 * Сброс outbox-очереди: батч до 100 PENDING-операций.
 * APPLIED/DUPLICATE → DONE; REJECTED — финален (причина показывается
 * пользователю, повторов нет); сеть/5xx → Result.retry с backoff.
 */
class PushWorker(appContext: Context, params: WorkerParameters) :
    CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        if (!AppGraph.isInitialized) return Result.failure()
        val outbox = AppGraph.db.outboxDao()

        val batch = outbox.pendingBatch(limit = 100)
        if (batch.isEmpty()) return Result.success()

        return try {
            val response = AppGraph.api.push(
                PushRequest(
                    deviceId = AppGraph.deviceId,
                    operations = batch.map { PushOp(it.opId, it.type, AppGraph.json.parseToJsonElement(it.payload)) },
                )
            )
            val byOpId = response.results.associateBy { it.opId }
            val now = System.currentTimeMillis()
            batch.forEach { op ->
                when (byOpId[op.opId]?.status) {
                    "APPLIED", "DUPLICATE" -> outbox.finish(op.opId, "DONE", null, now)
                    "REJECTED" -> outbox.finish(
                        op.opId, "REJECTED", byOpId[op.opId]?.rejectReason ?: "REJECTED", now,
                    )
                    else -> outbox.bumpAttempts(op.opId)
                }
            }
            if (outbox.pendingCountOnce() > 0) Result.retry() else Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
