package ru.azmz.logistics.traffic

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.bind.annotation.*
import java.sql.Timestamp

/**
 * Канал 3 — пробки: снимок активных сегментов по bbox (V7__traffic.sql).
 *
 * Архитектура та же, что у пометок (канал 2): данные общие для всех,
 * в sync_journal НЕ пишутся, клиент тянет снимок по коридору своего рейса.
 * Периодичность опроса на клиенте — 60 с (PullWorker), офлайн — остаёмся
 * на прошлом снимке (Room) плюс слой «водители для водителей» (road_mark).
 *
 * Наполнение таблицы — джоба TrafficAggregationJob (этап MVP):
 *   position_ping (окно 15 мин) → map-matching на сегменты OSRM
 *   → медиана скорости на сегмент при ≥ 3 разных ТС
 *   → level = скорость / free_flow (0.85+ | 0.55+ | 0.3+ | ниже).
 *
 * 152-ФЗ: сегмент — агрегат ≥3 машин без идентификаторов, ПДн нет.
 */
@RestController
@RequestMapping("/api/driver/v1/traffic")
class TrafficController(private val jdbc: JdbcTemplate) {

    data class TrafficSegmentDto(
        val id: String,
        val title: String?,
        val geometry: String,          // GeoJSON LineString
        val level: Int,                // 0..3
        val speedKmh: Int,
        val onRoute: Boolean,
        val updatedAt: Long,           // epoch millis
    )

    data class TrafficSnapshot(
        val snapshotAt: Long,
        val segments: List<TrafficSegmentDto>,
    )

    /**
     * since — epoch millis последнего snapshotAt (инкрементальная оптимизация:
     * не изменилось — пустой список, клиент держит прошлый снимок).
     * NB: как у пометок, при рейсах за 180° клиент присылает два bbox.
     */
    @GetMapping
    fun snapshot(
        @RequestParam minLat: Double, @RequestParam minLon: Double,
        @RequestParam maxLat: Double, @RequestParam maxLon: Double,
        @RequestParam(required = false) since: Long?,
    ): TrafficSnapshot {
        val sinceCond = if (since != null) "AND updated_at > ?" else ""
        val args = mutableListOf<Any>(minLon, minLat, maxLon, maxLat)
        if (since != null) args.add(Timestamp(since))

        val rows = jdbc.queryForList(
            """
            SELECT id, title, ST_AsGeoJSON(geom) AS geometry, level, speed_kmh, on_route,
                   (extract(epoch FROM updated_at) * 1000)::bigint AS updated_ms
            FROM traffic_segment
            WHERE geom && ST_MakeEnvelope(?, ?, ?, ?, 4326)
              AND updated_at > now() - interval '2 hours'   -- retention среза
              $sinceCond
            LIMIT 5000
            """.trimIndent(),
            *args.toTypedArray(),
        )
        val segments = rows.map {
            TrafficSegmentDto(
                id = it.getValue("id") as String,
                title = it.getValue("title") as String?,
                geometry = it.getValue("geometry") as String,
                level = (it.getValue("level") as Number).toInt(),
                speedKmh = (it.getValue("speed_kmh") as Number).toInt(),
                onRoute = it.getValue("on_route") as Boolean,
                updatedAt = (it.getValue("updated_ms") as Number).toLong(),
            )
        }
        return TrafficSnapshot(System.currentTimeMillis(), segments)
    }
}
