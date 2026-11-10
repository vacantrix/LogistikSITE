package ru.azmz.logistics.driver.core.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import ru.azmz.logistics.driver.core.data.db.SyncStateEntity
import ru.azmz.logistics.driver.core.data.net.IdOnly
import ru.azmz.logistics.driver.core.data.net.JournalEntry
import ru.azmz.logistics.driver.core.data.net.toEntity
import java.util.concurrent.TimeUnit

/**
 * Дельта-синхронизация входящих:
 *  1) канал 1 — личный журнал: страницы до исчерпания, upsert/delete по id,
 *     курсор сохраняется после каждой страницы (обрыв связи не теряет прогресс);
 *  2) канал 2 — снимок активных пометок по bbox активного рейса;
 *  3) гигиена: чистка истёкших пометок и старых подтверждённых операций.
 */
class PullWorker(appContext: Context, params: WorkerParameters) :
    CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        if (!AppGraph.isInitialized) return Result.failure()
        return try {
            pullJournal()
            pullMarks()
            val now = System.currentTimeMillis()
            AppGraph.db.markDao().purgeExpired(now)
            AppGraph.db.outboxDao().purgeOld(now - TimeUnit.DAYS.toMillis(7))
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }

    private suspend fun pullJournal() {
        val db = AppGraph.db
        var cursor = db.syncStateDao().get("journal")?.toLongOrNull() ?: 0L

        while (true) {
            val page = AppGraph.api.pull(cursor)
            applyEntries(page.entries)
            cursor = page.cursor
            // курсор — после каждой страницы: 2–8 часов офлайна не заставляют
            // качать всё заново после обрыва на середине
            db.syncStateDao().put(SyncStateEntity("journal", cursor.toString(), System.currentTimeMillis()))
            if (!page.hasMore) break
        }
    }

    private suspend fun applyEntries(entries: List<JournalEntry>) {
        val db = AppGraph.db
        val json = AppGraph.json
        entries.forEach { entry ->
            when (entry.entity) {
                "TRIP" -> if (entry.op == "UPSERT") {
                    db.tripDao().upsert(json.decodeFromJsonElement(entry.payload))
                } else {
                    db.tripDao().delete(json.decodeFromJsonElement<IdOnly>(entry.payload).id)
                }
                "TRIP_POINT" -> if (entry.op == "UPSERT") {
                    db.tripPointDao().upsertAll(listOf(json.decodeFromJsonElement(entry.payload)))
                } else {
                    db.tripPointDao().delete(json.decodeFromJsonElement<IdOnly>(entry.payload).id)
                }
                "TRIP_EVENT" -> if (entry.op == "UPSERT") {
                    db.tripEventDao().upsert(json.decodeFromJsonElement(entry.payload))
                } else {
                    db.tripEventDao().delete(json.decodeFromJsonElement<IdOnly>(entry.payload).id)
                }
                "CHAT_MESSAGE" -> if (entry.op == "UPSERT") {
                    db.chatDao().upsertAll(listOf(json.decodeFromJsonElement(entry.payload)))
                } else {
                    db.chatDao().delete(json.decodeFromJsonElement<IdOnly>(entry.payload).id)
                }
                "SYSTEM_NOTE" -> if (entry.op == "UPSERT") {
                    db.systemNoteDao().upsertAll(listOf(json.decodeFromJsonElement(entry.payload)))
                } else {
                    db.systemNoteDao().delete(json.decodeFromJsonElement<IdOnly>(entry.payload).id)
                }
            }
        }
    }

    private suspend fun pullMarks() {
        val db = AppGraph.db
        val driverId = AppGraph.driverId ?: return

        // коридор активного рейса: пометки вокруг маршрута видны офлайн
        val trip = db.tripDao().activeTrip(driverId) ?: return
        val minLat = trip.routeMinLat ?: return
        val minLon = trip.routeMinLon ?: return
        val maxLat = trip.routeMaxLat ?: return
        val maxLon = trip.routeMaxLon ?: return

        val since = db.syncStateDao().get("marks")?.toLongOrNull()
        val snapshot = AppGraph.api.marks(minLat, minLon, maxLat, maxLon, since)
        db.markDao().upsertAll(snapshot.marks.mapNotNull { it.toEntity() })
        db.syncStateDao().put(
            SyncStateEntity("marks", snapshot.snapshotAt.toString(), System.currentTimeMillis()),
        )
    }
}
