package ru.azmz.logistics.chat

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import ru.azmz.logistics.shared.ApplyOutcome
import ru.azmz.logistics.shared.OpStatus
import ru.azmz.logistics.sync.ChatSendOpPayload
import ru.azmz.logistics.sync.Snapshots
import ru.azmz.logistics.sync.SyncJournalWriter
import java.sql.Timestamp
import java.util.UUID

/**
 * Чат с диспетчером (таб «Офис»). Сообщения диспетчера создаёт веб-часть
 * платформы и ОБЯЗАНА продублировать их в журнал водителя через
 * SyncJournalWriter (интеграционная точка №3, см. README).
 */
@Service
class ChatApplier(
    private val jdbc: JdbcTemplate,
    private val objectMapper: ObjectMapper,
    private val journal: SyncJournalWriter,
    private val snapshots: Snapshots,
) {

    fun apply(driverId: UUID, payloadNode: JsonNode): ApplyOutcome {
        val p = objectMapper.treeToValue(payloadNode, ChatSendOpPayload::class.java)
        val messageId = UUID.fromString(p.id)

        val inserted = jdbc.update(
            """
            INSERT INTO chat_message (id, driver_id, trip_id, sender, body, created_at)
            VALUES (?, ?, ?, 'DRIVER', ?, ?)
            ON CONFLICT (id) DO NOTHING
            """.trimIndent(),
            messageId, driverId, p.tripId?.let(UUID::fromString), p.body, Timestamp(p.createdAt),
        )
        if (inserted == 0) return ApplyOutcome(OpStatus.DUPLICATE)

        journal.upsert(driverId, "CHAT_MESSAGE", snapshots.chatMessage(messageId)!!)
        return ApplyOutcome(OpStatus.APPLIED)
    }
}
