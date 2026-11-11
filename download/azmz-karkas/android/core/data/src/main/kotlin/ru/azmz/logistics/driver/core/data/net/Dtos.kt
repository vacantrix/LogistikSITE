package ru.azmz.logistics.driver.core.data.net

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query
import ru.azmz.logistics.driver.core.common.Geo
import ru.azmz.logistics.driver.core.data.db.ChatMessageEntity
import ru.azmz.logistics.driver.core.data.db.RoadMarkEntity
import ru.azmz.logistics.driver.core.data.db.TripEventEntity

/**
 * Контракты синхронизации (зеркало SyncDtos бэкенда).
 * Время — epoch millis, идентификаторы — строки UUID.
 */

// --- push ----------------------------------------------------------------

@Serializable
data class PushRequest(val deviceId: String? = null, val operations: List<PushOp>)

@Serializable
data class PushOp(val opId: String, val type: String, val payload: JsonElement)

@Serializable
data class PushResponse(val results: List<PushOpResult> = emptyList())

@Serializable
data class PushOpResult(val opId: String, val status: String, val rejectReason: String? = null)

// --- pull (канал 1: личный журнал водителя) -------------------------------

@Serializable
data class PullResponse(
    val entries: List<JournalEntry> = emptyList(),
    val cursor: Long = 0,
    val hasMore: Boolean = false,
)

@Serializable
data class JournalEntry(val seq: Long, val entity: String, val op: String, val payload: JsonElement)

@Serializable
data class IdOnly(val id: String)

// --- marks (канал 2: снимок активных по bbox) ------------------------------

@Serializable
data class MarksSnapshot(val snapshotAt: Long = 0, val marks: List<MarkDto> = emptyList())

@Serializable
data class MarkDto(
    val id: String,
    val category: String,
    val geometry: String,
    val comment: String? = null,
    val ttlHours: Int = 6,
    val confirmCount: Int = 0,
    val outdatedCount: Int = 0,
    val createdAt: Long = 0,
    val expiresAt: Long = 0,
)

fun MarkDto.toEntity(): RoadMarkEntity? {
    val bbox = Geo.bboxOfLineString(geometry) ?: return null
    return RoadMarkEntity(
        id = id,
        category = category,
        polylineGeoJson = geometry,
        comment = comment,
        ttlHours = ttlHours,
        confirmCount = confirmCount,
        outdatedCount = outdatedCount,
        createdAt = createdAt,
        expiresAt = expiresAt,
        minLat = bbox[0], minLon = bbox[1], maxLat = bbox[2], maxLon = bbox[3],
    )
}

// --- манёвры маршрута (routeStepsJson) ------------------------------------

@Serializable
data class RouteStepDto(
    val instruction: String? = null,
    val name: String? = null,          // улица / трасса для плашки манёвра
    val distanceM: Long? = null,
    val durationS: Long? = null,
    val lat: Double? = null,
    val lon: Double? = null,
)

// --- полезные нагрузки операций outbox (форма — как на сервере) ------------

@Serializable
data class TripEventOp(
    val id: String,
    val tripId: String,
    val tripPointId: String? = null,
    val vehicleId: String,
    val deviceId: String? = null,
    val type: String,
    val occurredAt: Long,
    val source: String,
    val lat: Double? = null,
    val lon: Double? = null,
    val note: String? = null,
)

fun TripEventEntity.toOp() = TripEventOp(
    id, tripId, tripPointId, vehicleId, deviceId, type, occurredAt, source, lat, lon, note,
)

@Serializable
data class MarkPublishOp(
    val id: String,
    val category: String,
    val geometry: String,
    val comment: String? = null,
    val ttlHours: Int,
    val clientCreatedAt: Long,
)

fun RoadMarkEntity.toOp() = MarkPublishOp(id, category, polylineGeoJson, comment, ttlHours, createdAt)

@Serializable
data class MarkVoteOp(val markId: String, val vote: Int)

@Serializable
data class ChatSendOp(val id: String, val tripId: String? = null, val body: String, val createdAt: Long)

fun ChatMessageEntity.toOp() = ChatSendOp(id, tripId, body, createdAt)

// --- API -------------------------------------------------------------------

interface DriverApi {

    /** Сброс outbox: батч UUID-операций, применение идемпотентно. */
    @POST("sync/push")
    suspend fun push(@Body body: PushRequest): PushResponse

    /** Дельта личного журнала: GET /sync/pull?cursor=... */
    @GET("sync/pull")
    suspend fun pull(
        @Query("cursor") cursor: Long,
        @Query("limit") limit: Int = 500,
    ): PullResponse

    /** Снимок активных пометок по bbox коридора (+ since-оптимизация). */
    @GET("sync/marks")
    suspend fun marks(
        @Query("minLat") minLat: Double,
        @Query("minLon") minLon: Double,
        @Query("maxLat") maxLat: Double,
        @Query("maxLon") maxLon: Double,
        @Query("since") since: Long? = null,
    ): MarksSnapshot
}
