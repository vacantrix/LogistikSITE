package ru.azmz.logistics.trip

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import ru.azmz.logistics.shared.ApplyOutcome
import ru.azmz.logistics.shared.OpStatus
import ru.azmz.logistics.sync.Snapshots
import ru.azmz.logistics.sync.SyncJournalWriter
import ru.azmz.logistics.sync.TripEventOpPayload
import java.sql.Timestamp
import java.util.UUID

/**
 * Идемпотентное применение события рейса из outbox водителя.
 *
 * Правила (решения сессии, общие с клиентом — :core:common / TripEventRules):
 *  1) id события — клиентский UUID; повтор → DUPLICATE;
 *  2) авто-закрытие: новое событие закрывает открытые открывашки с более ранним
 *     occurred_at; явная закрывашка → interval_auto_closed = false, иначе — true;
 *     TRIP_DONE закрывает все открытые безусловно;
 *  3) «последнее событие» и статус рейса пересчитываются транзакционно —
 *     автостатусы реестра офиса («не звоним где ты»);
 *  4) снимки изменённых строк уходят в журнал водителя рейса тем же tx.
 */
@Service
class TripEventApplier(
    private val jdbc: JdbcTemplate,
    private val objectMapper: ObjectMapper,
    private val journal: SyncJournalWriter,
    private val snapshots: Snapshots,
) {
    companion object {
        /** Явная закрывашка для каждой открывашки. */
        val EXPLICIT_CLOSER = mapOf(
            "ARRIVAL_LOADING" to "LOADING_DONE",
            "REST_START" to "REST_END",
            "ARRIVAL_UNLOADING" to "UNLOADING_DONE",
        )
        private val OPENERS_IN = "('ARRIVAL_LOADING', 'REST_START', 'ARRIVAL_UNLOADING')"
    }

    fun apply(opId: UUID, driverId: UUID, payloadNode: JsonNode): ApplyOutcome {
        val p = objectMapper.treeToValue(payloadNode, TripEventOpPayload::class.java)

        // 1) идемпотентность по UUID события — страховка поверх sync_operation
        val eventId = UUID.fromString(p.id)
        val exists = jdbc.queryForObject(
            "SELECT count(*) FROM trip_event WHERE id = ?", Int::class.java, eventId,
        )!!
        if (exists > 0) return ApplyOutcome(OpStatus.DUPLICATE)

        val tripId = UUID.fromString(p.tripId)

        // 2) вставка события
        jdbc.update(
            """
            INSERT INTO trip_event (id, trip_id, trip_point_id, driver_id, vehicle_id, device_id,
                                    type, occurred_at, source, lat, lon, note, applied_op_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            eventId, tripId, p.tripPointId?.let(UUID::fromString),
            driverId, UUID.fromString(p.vehicleId), p.deviceId?.let(UUID::fromString),
            p.type, Timestamp(p.occurredAt), p.source, p.lat, p.lon, p.note, opId,
        )

        // 3) авто-закрытие открытых интервалов
        val closesAll = p.type == "TRIP_DONE"
        val openRows = if (closesAll) {
            jdbc.queryForList(
                """
                SELECT id::text AS id, type, trip_point_id::text AS point_id
                FROM trip_event
                WHERE trip_id = ? AND interval_closed_at IS NULL AND type IN $OPENERS_IN
                ORDER BY occurred_at
                """.trimIndent(), tripId,
            )
        } else {
            jdbc.queryForList(
                """
                SELECT id::text AS id, type, trip_point_id::text AS point_id
                FROM trip_event
                WHERE trip_id = ? AND interval_closed_at IS NULL AND type IN $OPENERS_IN
                  AND occurred_at <= ?
                ORDER BY occurred_at
                """.trimIndent(), tripId, Timestamp(p.occurredAt),
            )
        }
        for (row in openRows) {
            val openerId = UUID.fromString(row.getValue("id") as String)
            val openerType = row.getValue("type") as String
            val openerPoint = row.getValue("point_id") as String?
            val explicit = EXPLICIT_CLOSER[openerType] == p.type && openerPoint == p.tripPointId
            jdbc.update(
                """
                UPDATE trip_event
                SET interval_closed_at = GREATEST(occurred_at, ?),
                    interval_closed_by = ?,
                    interval_auto_closed = ?
                WHERE id = ?
                """.trimIndent(),
                Timestamp(p.occurredAt), eventId, !explicit, openerId,
            )
            journal.upsert(driverId, "TRIP_EVENT", snapshots.tripEvent(openerId)!!)
        }

        // 4) «последнее событие» + статус рейса — автостатусы реестра офиса
        jdbc.update(
            """
            UPDATE trip t SET
                last_event_type = e.type,
                last_event_at   = e.occurred_at,
                status = CASE
                    WHEN e.type = 'TRIP_DONE' THEN 'completed'
                    WHEN t.status = 'assigned' AND e.type = 'DEPARTURE' THEN 'in_progress'
                    ELSE t.status END,
                updated_at = now()
            FROM (SELECT type, occurred_at FROM trip_event
                  WHERE trip_id = ? ORDER BY occurred_at DESC, created_at DESC LIMIT 1) e
            WHERE t.id = ?
            """.trimIndent(), tripId, tripId,
        )

        // 5) журнал водителю рейса: новое событие + обновлённый рейс
        val audience = tripAudience(tripId)
        if (audience != null) {
            journal.upsert(audience, "TRIP_EVENT", snapshots.tripEvent(eventId)!!)
            journal.upsert(audience, "TRIP", snapshots.trip(tripId)!!)
        }
        return ApplyOutcome(OpStatus.APPLIED)
    }

    private fun tripAudience(tripId: UUID): UUID? {
        val rows = jdbc.queryForList("SELECT driver_id::text AS d FROM trip WHERE id = ?", tripId)
        return (rows.firstOrNull()?.getValue("d") as String?)?.let(UUID::fromString)
    }
}
