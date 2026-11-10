package ru.azmz.logistics.sync

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate
import ru.azmz.logistics.chat.ChatApplier
import ru.azmz.logistics.mark.MarkApplier
import ru.azmz.logistics.shared.ApplyOutcome
import ru.azmz.logistics.shared.OpStatus
import ru.azmz.logistics.trip.TripEventApplier
import java.sql.Timestamp
import java.util.UUID

/**
 * Оркестрация синхронизации: push (идемпотентное применение outbox),
 * pull (дельта журнала), marks (снимок по bbox).
 */
@Service
class SyncService(
    private val jdbc: JdbcTemplate,
    private val tx: TransactionTemplate,
    private val objectMapper: ObjectMapper,
    private val tripEventApplier: TripEventApplier,
    private val markApplier: MarkApplier,
    private val chatApplier: ChatApplier,
) {

    fun push(driverIdHeader: String, body: PushRequest): PushResponse {
        val driverId = UUID.fromString(driverIdHeader)
        val results = (body.operations ?: emptyList()).map { op ->
            // каждая операция — отдельная транзакция: одна плохая не откатывает батч
            val outcome = tx.execute { applyOp(driverId, body.deviceId, op) }!!
            PushOpResult(op.opId, outcome.status.name, outcome.rejectReason)
        }
        return PushResponse(results)
    }

    /**
     * Внутри транзакции: «замок» op_id → применение → фиксация статуса.
     * Повтор батча: INSERT ... ON CONFLICT DO NOTHING не вставит строку,
     * статус возьмётся из sync_operation. Исключение в applier — откат
     * вместе со строкой замка, клиент честно повторит (Result.retry).
     */
    private fun applyOp(driverId: UUID, deviceId: String?, op: PushOp): ApplyOutcome {
        val opId = UUID.fromString(op.opId)
        val deviceUuid = deviceId?.let { runCatching(UUID::fromString).getOrNull() }
        val inserted = jdbc.update(
            """
            INSERT INTO sync_operation (op_id, driver_id, device_id, type, status)
            VALUES (?, ?, ?, ?, 'APPLIED')
            ON CONFLICT (op_id) DO NOTHING
            """.trimIndent(),
            opId, driverId, deviceUuid, op.type,
        )
        if (inserted == 0) {
            val row = jdbc.queryForMap("SELECT status, reject_reason FROM sync_operation WHERE op_id = ?", opId)
            return ApplyOutcome(
                OpStatus.valueOf(row.getValue("status") as String),
                row.getValue("reject_reason") as String?,
            )
        }
        val outcome = when (op.type) {
            "TRIP_EVENT_CREATE" -> tripEventApplier.apply(opId, driverId, op.payload)
            "MARK_PUBLISH" -> markApplier.publish(driverId, op.payload)
            "MARK_VOTE" -> markApplier.vote(driverId, op.payload)
            "CHAT_SEND" -> chatApplier.apply(driverId, op.payload)
            else -> ApplyOutcome(OpStatus.REJECTED, "UNKNOWN_OP_TYPE")
        }
        jdbc.update(
            "UPDATE sync_operation SET status = ?, reject_reason = ? WHERE op_id = ?",
            outcome.status.name, outcome.rejectReason, opId,
        )
        return outcome
    }

    fun pull(driverIdHeader: String, cursor: Long, limit: Int): PullResponse {
        val driverId = UUID.fromString(driverIdHeader)
        val capped = limit.coerceIn(1, 1000)
        val rows = jdbc.queryForList(
            """
            SELECT seq, entity, op, payload::text AS payload
            FROM sync_journal
            WHERE driver_id = ? AND seq > ?
            ORDER BY seq
            LIMIT ?
            """.trimIndent(),
            driverId, cursor, capped + 1,
        )
        val hasMore = rows.size > capped
        val page = rows.take(capped)
        val entries = page.map {
            JournalEntry(
                seq = (it.getValue("seq") as Number).toLong(),
                entity = it.getValue("entity") as String,
                op = it.getValue("op") as String,
                payload = objectMapper.readTree(it.getValue("payload") as String),
            )
        }
        val newCursor = (page.lastOrNull()?.getValue("seq") as? Number)?.toLong() ?: cursor
        return PullResponse(entries, newCursor, hasMore)
    }

    fun marksSnapshot(
        minLat: Double, minLon: Double, maxLat: Double, maxLon: Double, sinceMs: Long?,
    ): MarksSnapshot {
        val args = mutableListOf<Any>(minLon, minLat, maxLon, maxLat)
        val sinceCond = if (sinceMs != null) {
            args.add(Timestamp(sinceMs))
            "AND updated_at > ?"
        } else {
            ""
        }
        val rows = jdbc.queryForList(
            """
            SELECT id::text, category, ST_AsGeoJSON(geom) AS geometry, comment, ttl_hours,
                   confirm_count, outdated_count,
                   (extract(epoch FROM created_at) * 1000)::bigint AS created_ms,
                   (extract(epoch FROM expires_at) * 1000)::bigint AS expires_ms
            FROM road_mark
            WHERE expires_at > now()
              AND geom && ST_MakeEnvelope(?, ?, ?, ?, 4326)
              $sinceCond
            ORDER BY confirm_count - outdated_count DESC, created_at DESC
            LIMIT 2000
            """.trimIndent(),
            *args.toTypedArray(),
        )
        val marks = rows.map {
            MarkDto(
                id = it.getValue("id") as String,
                category = it.getValue("category") as String,
                geometry = it.getValue("geometry") as String,
                comment = it.getValue("comment") as String?,
                ttlHours = (it.getValue("ttl_hours") as Number).toInt(),
                confirmCount = (it.getValue("confirm_count") as Number).toInt(),
                outdatedCount = (it.getValue("outdated_count") as Number).toInt(),
                createdAt = (it.getValue("created_ms") as Number).toLong(),
                expiresAt = (it.getValue("expires_ms") as Number).toLong(),
            )
        }
        return MarksSnapshot(System.currentTimeMillis(), marks)
    }
}
