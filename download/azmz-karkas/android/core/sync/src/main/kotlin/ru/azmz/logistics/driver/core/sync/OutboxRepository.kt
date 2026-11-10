package ru.azmz.logistics.driver.core.sync

import androidx.room.withTransaction
import ru.azmz.logistics.driver.core.common.Clock
import ru.azmz.logistics.driver.core.common.TripEventRules
import ru.azmz.logistics.driver.core.common.TripEventType
import ru.azmz.logistics.driver.core.data.db.AppDatabase
import ru.azmz.logistics.driver.core.data.db.ChatMessageEntity
import ru.azmz.logistics.driver.core.data.db.OutboxOpEntity
import ru.azmz.logistics.driver.core.data.db.RoadMarkEntity
import ru.azmz.logistics.driver.core.data.db.TripEventEntity
import ru.azmz.logistics.driver.core.data.net.MarkVoteOp
import ru.azmz.logistics.driver.core.data.net.toOp
import java.util.UUID
import kotlinx.serialization.json.Json

/**
 * Все исходящие действия — только через outbox: запись сущности и операции
 * происходят в ОДНОЙ транзакции Room. Работает без сети и GPS. Каждой
 * операции — свой UUID; сервер применяет идемпотентно.
 */
class OutboxRepository(
    private val db: AppDatabase,
    private val json: Json,
    private val clock: Clock,
) {

    /**
     * Отметка события рейса. Авто-закрытие открытых интервалов выполняется
     * локально по тем же правилам, что на сервере (TripEventRules =
     * TripEventApplier); сервер — источник истины, клиент сходится к нему
     * через upsert-ы журнала по id.
     */
    suspend fun markTripEvent(event: TripEventEntity) {
        db.withTransaction {
            db.tripEventDao().upsert(event)

            val newType = TripEventType.byCode(event.type)
            val isTripDone = newType == TripEventType.TRIP_DONE
            val open = if (isTripDone) {
                db.tripEventDao().openOpenersAll(event.tripId)
            } else {
                db.tripEventDao().openOpeners(event.tripId, event.occurredAt)
            }
            open.forEach { opener ->
                val openerType = TripEventType.byCode(opener.type)
                val explicit = openerType != null && newType != null &&
                    TripEventRules.closesExplicitly(openerType, newType) &&
                    opener.tripPointId == event.tripPointId
                db.tripEventDao().closeInterval(
                    id = opener.id,
                    closedAt = maxOf(opener.occurredAt, event.occurredAt),
                    byId = event.id,
                    auto = !explicit,
                )
            }
            enqueueOp("TRIP_EVENT_CREATE", json.encodeToString(event.toOp()))
        }
    }

    /** Публикация пометки всем водителям (TTL автора: 6 ч / 12 ч / 30 дней). */
    suspend fun publishMark(mark: RoadMarkEntity) {
        db.withTransaction {
            db.markDao().upsert(mark)
            enqueueOp("MARK_PUBLISH", json.encodeToString(mark.toOp()))
        }
    }

    /** Голос «+1 подтвердить» / «неактуально». */
    suspend fun voteMark(markId: String, vote: Int) {
        enqueueOp("MARK_VOTE", json.encodeToString(MarkVoteOp(markId, vote)))
    }

    /** Сообщение диспетчеру (таб «Офис»). */
    suspend fun sendChat(message: ChatMessageEntity) {
        db.withTransaction {
            db.chatDao().upsertAll(listOf(message))
            enqueueOp("CHAT_SEND", json.encodeToString(message.toOp()))
        }
    }

    private suspend fun enqueueOp(type: String, payloadJson: String) {
        db.outboxDao().insert(
            OutboxOpEntity(
                opId = UUID.randomUUID().toString(),
                type = type,
                payload = payloadJson,
                createdAt = clock.now(),
            )
        )
    }
}

