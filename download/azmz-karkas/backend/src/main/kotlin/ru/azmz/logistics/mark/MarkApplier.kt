package ru.azmz.logistics.mark

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import ru.azmz.logistics.shared.ApplyOutcome
import ru.azmz.logistics.shared.OpStatus
import ru.azmz.logistics.sync.MarkPublishOpPayload
import ru.azmz.logistics.sync.MarkVoteOpPayload
import java.sql.Timestamp
import java.util.UUID

/**
 * Пометки «водители для водителей» (слой 2).
 *
 * Решения сессии:
 *  * TTL автора: expires_at = момент применения на сервере + ttl (6 ч / 12 ч / 30 дней),
 *    голоса ничего не продлевают и не скрывают — только счётчики и порядок показа;
 *  * автора не храним: анти-спам — счётчик публикаций по аккаунту (mark_publication_log),
 *    дефолт 10/час, без привязки к пометке;
 *  * в sync_journal пометки НЕ пишутся: рассылка всем — снимком активных по bbox.
 */
@Service
class MarkApplier(
    private val jdbc: JdbcTemplate,
    private val objectMapper: ObjectMapper,
) {

    fun publish(driverId: UUID, payloadNode: JsonNode): ApplyOutcome {
        val p = objectMapper.treeToValue(payloadNode, MarkPublishOpPayload::class.java)

        val lastHour = jdbc.queryForObject(
            """
            SELECT count(*) FROM mark_publication_log
            WHERE driver_id = ? AND published_at > now() - interval '1 hour'
            """.trimIndent(), Int::class.java, driverId,
        )!!
        if (lastHour >= 10) return ApplyOutcome(OpStatus.REJECTED, "RATE_LIMIT")

        val inserted = jdbc.update(
            """
            INSERT INTO road_mark (id, category, geom, comment, ttl_hours, client_created_at, expires_at)
            VALUES (?, ?, ST_SetSRID(ST_GeomFromGeoJSON(?), 4326), ?, ?, ?, now() + make_interval(hours => ?))
            ON CONFLICT (id) DO NOTHING
            """.trimIndent(),
            UUID.fromString(p.id), p.category, p.geometry, p.comment,
            p.ttlHours, Timestamp(p.clientCreatedAt), p.ttlHours,
        )
        if (inserted == 0) return ApplyOutcome(OpStatus.DUPLICATE)

        jdbc.update("INSERT INTO mark_publication_log (driver_id) VALUES (?)", driverId)
        return ApplyOutcome(OpStatus.APPLIED)
    }

    fun vote(driverId: UUID, payloadNode: JsonNode): ApplyOutcome {
        val p = objectMapper.treeToValue(payloadNode, MarkVoteOpPayload::class.java)
        val markId = UUID.fromString(p.markId)

        val active = jdbc.queryForObject(
            "SELECT count(*) FROM road_mark WHERE id = ? AND expires_at > now()",
            Int::class.java, markId,
        )!!
        if (active == 0) return ApplyOutcome(OpStatus.REJECTED, "MARK_EXPIRED")

        val prev = jdbc.queryForList(
            "SELECT vote FROM mark_vote WHERE mark_id = ? AND voter_driver_id = ?", markId, driverId,
        )
        if (prev.isNotEmpty()) {
            val old = (prev[0].getValue("vote") as Number).toInt()
            if (old == p.vote) return ApplyOutcome(OpStatus.DUPLICATE)
            // смена голоса: перекладываем счётчики в противоположную сторону
            jdbc.update(
                "UPDATE mark_vote SET vote = ?, created_at = now() WHERE mark_id = ? AND voter_driver_id = ?",
                p.vote, markId, driverId,
            )
            jdbc.update(
                """
                UPDATE road_mark SET
                    confirm_count   = confirm_count + ?,
                    outdated_count  = outdated_count + ?,
                    updated_at = now()
                WHERE id = ?
                """.trimIndent(),
                if (p.vote == 1) 1 else -1, if (p.vote == 1) -1 else 1, markId,
            )
            return ApplyOutcome(OpStatus.APPLIED)
        }

        jdbc.update(
            "INSERT INTO mark_vote (mark_id, voter_driver_id, vote) VALUES (?, ?, ?)",
            markId, driverId, p.vote,
        )
        jdbc.update(
            """
            UPDATE road_mark SET
                confirm_count  = confirm_count + ?,
                outdated_count = outdated_count + ?,
                updated_at = now()
            WHERE id = ?
            """.trimIndent(),
            if (p.vote == 1) 1 else 0, if (p.vote == -1) 1 else 0, markId,
        )
        return ApplyOutcome(OpStatus.APPLIED)
    }
}
