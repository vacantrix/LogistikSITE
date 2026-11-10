package ru.azmz.logistics.sync

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.databind.JsonNode

/**
 * Контракты синхронизации. Время — epoch millis (Long), идентификаторы — строки UUID:
 * так же выглядит модель Room на клиенте, сериализация совпадает поле-в-поле.
 */

// --- push -----------------------------------------------------------------

@JsonInclude(JsonInclude.Include.NON_NULL)
data class PushRequest(val deviceId: String?, val operations: List<PushOp>)

data class PushOp(val opId: String, val type: String, val payload: JsonNode)

data class PushResponse(val results: List<PushOpResult>)

@JsonInclude(JsonInclude.Include.NON_NULL)
data class PushOpResult(val opId: String, val status: String, val rejectReason: String?)

/** Полезные нагрузки операций outbox (проверяются applier-ами по типу). */
data class TripEventOpPayload(
    val id: String,
    val tripId: String,
    val tripPointId: String?,
    val vehicleId: String,
    val deviceId: String?,
    val type: String,
    val occurredAt: Long,
    val source: String,           // GEOFENCE | MANUAL | MANUAL_BACKDATED
    val lat: Double?,
    val lon: Double?,
    val note: String?,
)

data class MarkPublishOpPayload(
    val id: String,
    val category: String,         // POTHOLE | ROADWORKS | POLICE | ACCIDENT | CLOSED
    val geometry: String,         // GeoJSON LineString
    val comment: String?,
    val ttlHours: Int,            // 6 | 12 | 720
    val clientCreatedAt: Long,
)

data class MarkVoteOpPayload(val markId: String, val vote: Int)   // 1 | -1

data class ChatSendOpPayload(val id: String, val tripId: String?, val body: String, val createdAt: Long)

// --- pull (канал 1: личный журнал) ----------------------------------------

data class PullResponse(val entries: List<JournalEntry>, val cursor: Long, val hasMore: Boolean)

data class JournalEntry(val seq: Long, val entity: String, val op: String, val payload: JsonNode)

// --- marks (канал 2: снимок активных по bbox) ------------------------------

data class MarksSnapshot(val snapshotAt: Long, val marks: List<MarkDto>)

data class MarkDto(
    val id: String,
    val category: String,
    val geometry: String,         // GeoJSON LineString
    val comment: String?,
    val ttlHours: Int,
    val confirmCount: Int,
    val outdatedCount: Int,
    val createdAt: Long,
    val expiresAt: Long,
)

// --- снимки строк для журнала (совпадают с Room-сущностями клиента) --------

@JsonInclude(JsonInclude.Include.NON_NULL)
data class TripSnapshot(
    val id: String,
    val tripCode: String,
    val status: String,
    val driverId: String?,
    val vehicleId: String?,
    val plannedStartAt: Long?,
    val plannedFinishAt: Long?,
    val routeGeoJson: String?,
    val routeStepsJson: String?,
    val routeDistanceM: Int?,
    val routeDurationS: Long?,
    val routeMinLat: Double?,
    val routeMinLon: Double?,
    val routeMaxLat: Double?,
    val routeMaxLon: Double?,
    val lastEventType: String?,
    val lastEventAt: Long?,
)

@JsonInclude(JsonInclude.Include.NON_NULL)
data class TripPointSnapshot(
    val id: String,
    val tripId: String,
    val seqNo: Int,
    val kind: String,
    val name: String?,
    val address: String?,
    val lat: Double,
    val lon: Double,
    val geofenceRadiusM: Int,
    val plannedArrivalAt: Long?,
    val plannedDepartureAt: Long?,
)

@JsonInclude(JsonInclude.Include.NON_NULL)
data class TripEventSnapshot(
    val id: String,
    val tripId: String,
    val tripPointId: String?,
    val driverId: String,
    val vehicleId: String,
    val deviceId: String?,
    val type: String,
    val occurredAt: Long,
    val source: String,
    val lat: Double?,
    val lon: Double?,
    val note: String?,
    val intervalClosedAt: Long?,
    val intervalClosedBy: String?,
    val intervalAutoClosed: Boolean?,
    val correctionOf: String?,
    val editedAt: Long?,
    val createdAt: Long,
)

@JsonInclude(JsonInclude.Include.NON_NULL)
data class ChatMessageSnapshot(
    val id: String,
    val driverId: String,
    val tripId: String?,
    val sender: String,
    val body: String,
    val createdAt: Long,
)

@JsonInclude(JsonInclude.Include.NON_NULL)
data class SystemNoteSnapshot(
    val id: String,
    val driverId: String,
    val kind: String,
    val body: String,
    val ref: JsonNode?,
    val createdAt: Long,
    val readAt: Long?,
)
