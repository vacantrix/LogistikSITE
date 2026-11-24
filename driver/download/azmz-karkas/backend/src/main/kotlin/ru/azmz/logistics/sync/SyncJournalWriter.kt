package ru.azmz.logistics.sync

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import java.util.UUID

/**
 * Писатель личного журнала водителя (канал 1).
 *
 * Вызывается В ТОЙ ЖЕ ТРАНЗАКЦИИ, что и изменение данных, — дельта не теряется.
 * Это публичная точка для офисных модулей платформы: изменили рейс, написали
 * в чат, создали системную строку — обязаны оставить запись в журнале
 * водителя (интеграционная точка №3, см. README).
 */
@Service
class SyncJournalWriter(
    private val jdbc: JdbcTemplate,
    private val objectMapper: ObjectMapper,
) {

    fun upsert(driverId: UUID, entity: String, payload: Any) {
        jdbc.update(
            "INSERT INTO sync_journal (driver_id, entity, op, payload) VALUES (?, ?, 'UPSERT', ?::jsonb)",
            driverId, entity, objectMapper.writeValueAsString(payload),
        )
    }

    fun delete(driverId: UUID, entity: String, id: UUID) {
        jdbc.update(
            "INSERT INTO sync_journal (driver_id, entity, op, payload) VALUES (?, ?, 'DELETE', ?::jsonb)",
            driverId, entity, """{"id":"$id"}""",
        )
    }
}
