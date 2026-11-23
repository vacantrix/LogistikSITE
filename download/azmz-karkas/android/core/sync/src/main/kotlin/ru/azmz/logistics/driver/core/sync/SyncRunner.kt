package ru.azmz.logistics.driver.core.sync

import ru.azmz.logistics.driver.core.data.db.SyncStateEntity
import ru.azmz.logistics.driver.core.data.net.IdOnly
import ru.azmz.logistics.driver.core.data.net.JournalEntry
import ru.azmz.logistics.driver.core.data.net.PushOp
import ru.azmz.logistics.driver.core.data.net.PushRequest
import ru.azmz.logistics.driver.core.data.net.toEntity
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.decodeFromJsonElement

/**
 * Один цикл обмена с сервером «АЭМЗ Поток» — без WorkManager.
 *
 * Логика вынесена из воркеров, чтобы foreground-цикл (SyncEngine) и фоновая
 * периодика (PushWorker/PullWorker) делали ровно одно и то же и не расходились.
 * Все операции идемпотентны: повтор после обрыва безопасен.
 */
object SyncRunner {

    /**
     * Сброс outbox-очереди: батч до 100 PENDING-операций.
     * true — очередь пуста (все APPLIED/DUPLICATE/REJECTED), false — остались
     * PENDING из-за сети/5xx и нужен повтор.
     */
    suspend fun push(): Boolean {
        val outbox = AppGraph.db.outboxDao()
        val batch = outbox.pendingBatch(limit = 100)
        if (batch.isEmpty()) return true

        val response = AppGraph.api.push(
            PushRequest(
                deviceId = AppGraph.deviceId,
                operations = batch.map {
                    PushOp(it.opId, it.type, AppGraph.json.parseToJsonElement(it.payload))
                },
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
        return outbox.pendingCountOnce() == 0
    }

    /** Входящие: журнал до исчерпания + снимок пометок + гигиена локальной базы. */
    suspend fun pull() {
        pullJournal()
        pullMarks()
        val now = System.currentTimeMillis()
        AppGraph.db.markDao().purgeExpired(now)
        AppGraph.db.outboxDao().purgeOld(now - TimeUnit.DAYS.toMillis(7))
    }

    /** Текущий курсор личного журнала (seq последней применённой записи). */
    suspend fun journalCursor(): Long =
        AppGraph.db.syncStateDao().get("journal")?.toLongOrNull() ?: 0L

    private suspend fun pullJournal() {
        val db = AppGraph.db
        var cursor = journalCursor()

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
