package ru.azmz.logistics.sync

import org.springframework.web.bind.annotation.*

/**
 * API приложения водителя. База — /api/driver/v1.
 *
 * Каркас: водитель определяется заголовком X-Driver-Id.
 * Этап MVP (п.2 плана): JWT access/refresh по смене (driver_shift),
 * привязка device → vehicle из MDM.
 */
@RestController
@RequestMapping("/api/driver/v1/sync")
class SyncController(private val syncService: SyncService) {

    /** Сброс outbox-очереди: батч UUID-операций, применение идемпотентно. */
    @PostMapping("/push")
    fun push(
        @RequestHeader("X-Driver-Id") driverId: String,
        @RequestBody body: PushRequest,
    ): PushResponse = syncService.push(driverId, body)

    /** Дельта личного журнала (канал 1). Курсор — последний полученный seq. */
    @GetMapping("/pull")
    fun pull(
        @RequestHeader("X-Driver-Id") driverId: String,
        @RequestParam(defaultValue = "0") cursor: Long,
        @RequestParam(defaultValue = "500") limit: Int,
    ): PullResponse = syncService.pull(driverId, cursor, limit)

    /**
     * Снимок активных пометок по bbox (канал 2).
     * since — epoch millis последнего snapshotAt (инкрементальная оптимизация).
     * NB: при рейсах за 180° (Чукотка) клиент присылает два bbox.
     */
    @GetMapping("/marks")
    fun marks(
        @RequestParam minLat: Double, @RequestParam minLon: Double,
        @RequestParam maxLat: Double, @RequestParam maxLon: Double,
        @RequestParam(required = false) since: Long?,
    ): MarksSnapshot = syncService.marksSnapshot(minLat, minLon, maxLat, maxLon, since)
}
