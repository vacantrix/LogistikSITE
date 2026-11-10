package ru.azmz.logistics.dev

import org.springframework.boot.CommandLineRunner
import org.springframework.context.annotation.Profile
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import ru.azmz.logistics.sync.Snapshots
import ru.azmz.logistics.sync.SyncJournalWriter
import java.util.UUID

/**
 * Демо-данные для локальной разработки (профиль demo): водитель, машина,
 * рейс Z-1001 Химки → Тула с геометрией и манёврами. Печатает в консоль
 * готовые curl-примеры для ручной проверки синхронизации.
 */
@Component
@Profile("demo")
class DemoDataRunner(
    private val jdbc: JdbcTemplate,
    private val journal: SyncJournalWriter,
    private val snapshots: Snapshots,
) : CommandLineRunner {

    override fun run(vararg args: String) {
        if ((jdbc.queryForObject("SELECT count(*) FROM trip", Int::class.java) ?: 0) > 0) return

        val driverId = UUID.randomUUID()
        val vehicleId = UUID.randomUUID()
        val tripId = UUID.randomUUID()
        val loadingId = UUID.randomUUID()
        val unloadingId = UUID.randomUUID()

        jdbc.update(
            "INSERT INTO driver (id, full_name, phone) VALUES (?, ?, ?)",
            driverId, "Иван Петров", "+7 900 000-00-00",
        )
        jdbc.update(
            "INSERT INTO vehicle (id, plate, model) VALUES (?, ?, ?)",
            vehicleId, "А123ВС77", "MAN TGX",
        )
        jdbc.update(
            "INSERT INTO device (id, vehicle_id, app_version) VALUES (?, ?, ?)",
            UUID.randomUUID(), vehicleId, "0.1.0-karkas",
        )
        jdbc.update(
            """
            INSERT INTO trip (id, trip_code, status, driver_id, vehicle_id,
                              planned_start_at, planned_finish_at, route_geom, route_steps,
                              route_distance_m, route_duration_s)
            VALUES (?, 'Z-1001', 'assigned', ?, ?,
                    now() + interval '1 day', now() + interval '1 day 8 hours',
                    ST_GeogFromText('LINESTRING(37.615 55.752, 37.618 54.196)', 4326),
                    ?::jsonb, 183000, 9000)
            """.trimIndent(),
            tripId, driverId, vehicleId,
            """
            [{"instruction":"Направляйтесь на юг по трассе М-2 «Крым»","name":"М-2 «Крым»","distanceM":165000,"durationS":7200,"lat":55.6,"lon":37.7},
             {"instruction":"Сверните к терминалу","name":"ул. Пржевальского","distanceM":18000,"durationS":1800,"lat":54.2,"lon":37.62}]
            """.trimIndent(),
        )
        jdbc.update(
            """
            INSERT INTO trip_point (id, trip_id, seq_no, kind, name, address, geom, geofence_radius_m)
            VALUES (?, ?, 1, 'loading', 'Склад Химки', 'Московская обл., Химки',
                    ST_SetSRID(ST_MakePoint(37.615, 55.752), 4326)::geography, 300)
            """.trimIndent(), loadingId, tripId,
        )
        jdbc.update(
            """
            INSERT INTO trip_point (id, trip_id, seq_no, kind, name, address, geom, geofence_radius_m)
            VALUES (?, ?, 2, 'unloading', 'Терминал Тула', 'Тула, ул. Пржевальского, 10',
                    ST_SetSRID(ST_MakePoint(37.618, 54.196), 4326)::geography, 400)
            """.trimIndent(), unloadingId, tripId,
        )

        // канал 1: рейс и точки — в личный журнал водителя
        journal.upsert(driverId, "TRIP", snapshots.trip(tripId)!!)
        journal.upsert(driverId, "TRIP_POINT", snapshots.tripPoint(loadingId)!!)
        journal.upsert(driverId, "TRIP_POINT", snapshots.tripPoint(unloadingId)!!)

        println("=== Демо-данные каркаса АЗМЗ Логистика ===")
        println("driverId = $driverId")
        println("tripId   = $tripId")
        println()
        println("1) Дельта журнала:")
        println("   curl -H \"X-Driver-Id: $driverId\" 'http://localhost:8080/api/driver/v1/sync/pull?cursor=0'")
        println("2) Отметить событие (Выезд):")
        println("   curl -X POST -H 'Content-Type: application/json' -H 'X-Driver-Id: $driverId' \\")
        println("     -d '{\"deviceId\":null,\"operations\":[{\"opId\":\"<uuid>\",\"type\":\"TRIP_EVENT_CREATE\",\"payload\":{\"id\":\"<uuid>\",\"tripId\":\"$tripId\",\"tripPointId\":null,\"vehicleId\":\"$vehicleId\",\"deviceId\":null,\"type\":\"DEPARTURE\",\"occurredAt\":1730000000000,\"source\":\"MANUAL\",\"lat\":null,\"lon\":null,\"note\":\"демо\"}}]}' \\")
        println("     http://localhost:8080/api/driver/v1/sync/push")
        println("3) Пометки по bbox (Москва — Тула):")
        println("   curl 'http://localhost:8080/api/driver/v1/sync/marks?minLat=54&minLon=37&maxLat=56&maxLon=38'")
    }
}
