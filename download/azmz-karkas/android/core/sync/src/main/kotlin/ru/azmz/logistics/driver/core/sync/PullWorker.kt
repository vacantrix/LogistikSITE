package ru.azmz.logistics.driver.core.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * Дельта-синхронизация входящих: журнал водителя, пометки, гигиена базы.
 * Логика — в SyncRunner, общая с foreground-циклом.
 */
class PullWorker(appContext: Context, params: WorkerParameters) :
    CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        if (!AppGraph.isInitialized) return Result.failure()
        return try {
            SyncRunner.pull()
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
