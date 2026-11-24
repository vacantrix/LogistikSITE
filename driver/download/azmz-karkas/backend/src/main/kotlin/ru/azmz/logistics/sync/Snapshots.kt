package ru.azmz.logistics.sync

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import java.util.UUID

/**
 * Чтение снимков строк для журнала синхронизации.
 * Поля снимков совпадают с Room-сущностями клиента (camelCase, epoch millis).
 */
@Service
class Snapshots(private val jdbc: JdbcTemplate) {

    private class Row(val m: Map<String, Any?>) {
        fun str(k: String) = m[k] as? String
        fun long(k: String) = (m[k] as? Number)?.toLong()
        fun int(k: String) = (m[k] as? Number)?.toInt()
        fun dbl(k: String) = (m[k] as? Number)?.toDouble()
        fun bool(k: String) = m[k] as? Boolean
    }

    private fun one(sql: String, vararg args: Any?): Row? {
        val rows = jdbc.queryForList(sql, *args)
        return if (rows.isEmpty()) null else Row(rows[0])
    }

    fun trip(id: UUID): TripSnapshot? = one(
        """
        SELECT id::text, trip_code, status, driver_id::text AS driver_id, vehicle_id::text AS vehicle_id,
               (extract(epoch FROM planned_start_at)  * 1000)::bigint AS planned_start_ms,
               (extract(epoch FROM planned_finish_at) * 1000)::bigint AS planned_finish_ms,
               ST_AsGeoJSON(route_geom)              AS route_geojson,
               route_steps::text                     AS route_steps_json,
               ST_YMin(route_geom::geometry)         AS min_lat,
               ST_XMin(route_geom::geometry)         AS min_lon,
               ST_YMax(route_geom::geometry)         AS max_lat,
               ST_XMax(route_geom::geometry)         AS max_lon,
               route_distance_m, route_duration_s, last_event_type,
               (extract(epoch FROM last_event_at) * 1000)::bigint AS last_event_ms
        FROM trip WHERE id = ?
        """, id
    )?.let { r ->
        TripSnapshot(
            id = r.str("id")!!, tripCode = r.str("trip_code")!!, status = r.str("status")!!,
            driverId = r.str("driver_id"), vehicleId = r.str("vehicle_id"),
            plannedStartAt = r.long("planned_start_ms"), plannedFinishAt = r.long("planned_finish_ms"),
            routeGeoJson = r.str("route_geojson"), routeStepsJson = r.str("route_steps_json"),
            routeDistanceM = r.int("route_distance_m"), routeDurationS = r.long("route_duration_s"),
            routeMinLat = r.dbl("min_lat"), routeMinLon = r.dbl("min_lon"),
            routeMaxLat = r.dbl("max_lat"), routeMaxLon = r.dbl("max_lon"),
            lastEventType = r.str("last_event_type"), lastEventAt = r.long("last_event_ms"),
        )
    }

    fun tripPoint(id: UUID): TripPointSnapshot? = one(
        """
        SELECT id::text, trip_id::text AS trip_id, seq_no, kind, name, address,
               ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon,
               geofence_radius_m,
               (extract(epoch FROM planned_arrival_at)   * 1000)::bigint AS arrival_ms,
               (extract(epoch FROM planned_departure_at) * 1000)::bigint AS departure_ms
        FROM trip_point WHERE id = ?
        """, id
    )?.let { r ->
        TripPointSnapshot(
            id = r.str("id")!!, tripId = r.str("trip_id")!!, seqNo = r.int("seq_no")!!,
            kind = r.str("kind")!!, name = r.str("name"), address = r.str("address"),
            lat = r.dbl("lat")!!, lon = r.dbl("lon")!!, geofenceRadiusM = r.int("geofence_radius_m")!!,
            plannedArrivalAt = r.long("arrival_ms"), plannedDepartureAt = r.long("departure_ms"),
        )
    }

    fun tripEvent(id: UUID): TripEventSnapshot? = one(
        """
        SELECT id::text, trip_id::text AS trip_id, trip_point_id::text AS trip_point_id,
               driver_id::text AS driver_id, vehicle_id::text AS vehicle_id, device_id::text AS device_id,
               type, (extract(epoch FROM occurred_at) * 1000)::bigint AS occurred_ms, source, lat, lon, note,
               (extract(epoch FROM interval_closed_at) * 1000)::bigint AS closed_ms,
               interval_closed_by::text AS closed_by, interval_auto_closed, correction_of::text AS correction_of,
               (extract(epoch FROM edited_at) * 1000)::bigint AS edited_ms,
               (extract(epoch FROM created_at)    * 1000)::bigint AS created_ms
        FROM trip_event WHERE id = ?
        """, id
    )?.let { r ->
        TripEventSnapshot(
            id = r.str("id")!!, tripId = r.str("trip_id")!!, tripPointId = r.str("trip_point_id"),
            driverId = r.str("driver_id")!!, vehicleId = r.str("vehicle_id")!!, deviceId = r.str("device_id"),
            type = r.str("type")!!, occurredAt = r.long("occurred_ms")!!, source = r.str("source")!!,
            lat = r.dbl("lat"), lon = r.dbl("lon"), note = r.str("note"),
            intervalClosedAt = r.long("closed_ms"), intervalClosedBy = r.str("closed_by"),
            intervalAutoClosed = r.bool("interval_auto_closed"), correctionOf = r.str("correction_of"),
            editedAt = r.long("edited_ms"), createdAt = r.long("created_ms")!!,
        )
    }

    fun chatMessage(id: UUID): ChatMessageSnapshot? = one(
        """
        SELECT id::text, driver_id::text AS driver_id, trip_id::text AS trip_id, sender, body,
               (extract(epoch FROM created_at) * 1000)::bigint AS created_ms
        FROM chat_message WHERE id = ?
        """, id
    )?.let { r ->
        ChatMessageSnapshot(
            id = r.str("id")!!, driverId = r.str("driver_id")!!, tripId = r.str("trip_id"),
            sender = r.str("sender")!!, body = r.str("body")!!, createdAt = r.long("created_ms")!!,
        )
    }

    fun systemNote(id: UUID): SystemNoteSnapshot? = one(
        """
        SELECT id::text, driver_id::text AS driver_id, kind, body, ref::text AS ref_json,
               (extract(epoch FROM created_at) * 1000)::bigint AS created_ms,
               (extract(epoch FROM read_at)    * 1000)::bigint AS read_ms
        FROM system_note WHERE id = ?
        """, id
    )?.let { r ->
        SystemNoteSnapshot(
            id = r.str("id")!!, driverId = r.str("driver_id")!!, kind = r.str("kind")!!,
            body = r.str("body")!!, ref = r.str("ref_json")?.let { OBJECT_MAPPER.readTree(it) },
            createdAt = r.long("created_ms")!!, readAt = r.long("read_ms"),
        )
    }

    private companion object {
        private val OBJECT_MAPPER = com.fasterxml.jackson.databind.ObjectMapper()
    }
}
