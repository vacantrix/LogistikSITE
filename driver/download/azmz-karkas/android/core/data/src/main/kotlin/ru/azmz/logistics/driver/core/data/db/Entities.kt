package ru.azmz.logistics.driver.core.data.db

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable

/**
 * Room — единственный источник правды для UI. Прямых обращений к сети из UI нет:
 * запись через OutboxRepository (та же транзакция), чтение Flow из DAO.
 *
 * Сущности зеркалят снимки журнала синхронизации (camelCase, epoch millis,
 * id — строки UUID), поэтому upsert по id идемпотентен.
 */

@Serializable
@Entity(tableName = "trip", indices = [Index("driverId"), Index("status")])
data class TripEntity(
    @PrimaryKey val id: String,
    val tripCode: String,                    // «Z-xxxx»
    val status: String,                      // assigned | in_progress | completed | cancelled
    val driverId: String? = null,
    val vehicleId: String? = null,
    val plannedStartAt: Long? = null,
    val plannedFinishAt: Long? = null,
    val routeGeoJson: String? = null,        // LineString — отрисовка маршрута
    // Точки офиса из Яндекс.Карт: [[lat,lng],…] по порядку. Живой OSRM
    // перестраивает маршрут через них, а не только до конечной точки.
    val routeWaypointsJson: String? = null,
    val routeStepsJson: String? = null,      // манёвры OSRM — офлайн-навигация
    val routeDistanceM: Int? = null,
    val routeDurationS: Long? = null,
    // bbox маршрута: тянет пометки коридора и предзагрузку тайлов
    val routeMinLat: Double? = null,
    val routeMinLon: Double? = null,
    val routeMaxLat: Double? = null,
    val routeMaxLon: Double? = null,
    val lastEventType: String? = null,       // автостатус из отметок водителя
    val lastEventAt: Long? = null,
)

@Serializable
@Entity(
    tableName = "trip_point",
    indices = [Index("tripId")],
)
data class TripPointEntity(
    @PrimaryKey val id: String,
    val tripId: String,
    val seqNo: Int,
    val kind: String,                        // loading | unloading | waypoint
    val name: String? = null,
    val address: String? = null,
    val lat: Double,
    val lon: Double,
    val geofenceRadiusM: Int = 300,          // радиус смарт-карточки «Вы у точки»
    val plannedArrivalAt: Long? = null,
    val plannedDepartureAt: Long? = null,
)

/** Событие рейса — слой 1. Ручная отметка работает без сети и GPS. */
@Serializable
@Entity(tableName = "trip_event", indices = [Index("tripId"), Index("tripPointId"), Index("correctionOf")])
data class TripEventEntity(
    @PrimaryKey val id: String,              // UUID из outbox
    val tripId: String,
    val tripPointId: String? = null,
    val driverId: String,
    val vehicleId: String,
    val deviceId: String? = null,
    val type: String,                        // коды TripEventType
    val occurredAt: Long,                    // может быть в прошлом («Указать время»)
    val source: String,                      // GEOFENCE | MANUAL | MANUAL_BACKDATED
    val lat: Double? = null,
    val lon: Double? = null,
    val note: String? = null,
    // интервальность — на «открывашке»
    val intervalClosedAt: Long? = null,
    val intervalClosedBy: String? = null,
    val intervalAutoClosed: Boolean? = null,
    // корректировки (гибридные правки)
    val correctionOf: String? = null,
    val editedAt: Long? = null,
    val createdAt: Long,
) {
    val isManual: Boolean get() = source != "GEOFENCE"
}

/** Пометка «водители для водители» — слой 2, не смешивается с событиями. */
@Serializable
@Entity(
    tableName = "road_mark",
    indices = [Index("expiresAt"), Index("minLat", "minLon", "maxLat", "maxLon")],
)
data class RoadMarkEntity(
    @PrimaryKey val id: String,
    val category: String,                    // POTHOLE | ROADWORKS | POLICE | ACCIDENT | CLOSED
    val polylineGeoJson: String,             // LineString — цветной участок поверх дорог
    val comment: String? = null,
    val ttlHours: Int,                       // 6 | 12 | 720 (TTL автора, не продлевается)
    val confirmCount: Int = 0,
    val outdatedCount: Int = 0,
    val createdAt: Long,
    val expiresAt: Long,
    // bbox для SQL-фильтра по окну карты
    val minLat: Double,
    val minLon: Double,
    val maxLat: Double,
    val maxLon: Double,
    val isMine: Boolean = false,             // локальный флаг автора, наружу не отдаётся
)

@Serializable
@Entity(tableName = "chat_message", indices = [Index("driverId")])
data class ChatMessageEntity(
    @PrimaryKey val id: String,
    val driverId: String,
    val tripId: String? = null,
    val sender: String,                      // DRIVER | DISPATCHER
    val body: String,
    val createdAt: Long,
)

@Serializable
@Entity(tableName = "system_note", indices = [Index("driverId")])
data class SystemNoteEntity(
    @PrimaryKey val id: String,
    val driverId: String,
    val kind: String,
    val body: String,                        // «Заявка Z-1067 изменена офисом»
    val createdAt: Long,
    val readAt: Long? = null,
)

/** Outbox: исходящие операции. Каждой — свой UUID, сервер идемпотентен. */
@Entity(tableName = "outbox_op", indices = [Index("state"), Index("createdAt")])
data class OutboxOpEntity(
    @PrimaryKey val opId: String,
    val type: String,                        // TRIP_EVENT_CREATE | MARK_PUBLISH | MARK_VOTE | CHAT_SEND
    val payload: String,                     // JSON-снимок сущности
    val state: String = "PENDING",           // PENDING | DONE | REJECTED
    val rejectReason: String? = null,
    val attempts: Int = 0,
    val createdAt: Long,
    val syncedAt: Long? = null,
)

/** Курсоры каналов (journal, marks) + локальные ключи (driverId, deviceId). */
@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val channel: String,
    val value: String,
    val updatedAt: Long,
)
