package ru.azmz.logistics.driver.feature.map

import android.content.Context
import org.maplibre.android.maps.MapView
import org.maplibre.android.offline.OfflineManager

/**
 * Предзагрузка коридора маршрута до выезда — пункт чек-листа «всё скачано»
 * (MDM/пилот). Решение сессии: PMTiles.
 *
 * Как это работает на этапе MVP (п.2):
 *  1. свой tile-сервер отдаёт векторные тайлы из выгрузки OSM РФ
 *     (pmtiles serve или tileserver-gl, файлы в S3 / Yandex Object Storage);
 *  2. карта качает зумы до 14, MapLibre дорисовывает до z17 оверзумом —
 *     коридор межгорода укладывается в десятки МБ;
 *  3. коридор аппроксимируется цепочкой прямоугольных регионов вдоль
 *     маршрута (запас ~10 км) через OfflineManager.defineRegion — нативная
 *     офлайн-поддержка MapLibre;
 *  4. манёвры (route_steps) уже лежат в Room — офлайн-навигация не зависит
 *     от сети;
 *  5. альтернатива для экономии трафика — прямой PMTiles-файл коридора
 *     в кэше и кастомный source; интерфейс это допускает.
 *
 * Лицензия OSM: атрибуция «© OpenStreetMap contributors» обязательна
 * на экране карты (в стиле и в «О настройках»).
 */
class PmtilesCorridorManager(private val context: Context, private val mapView: MapView?) {

    /** Скачивает офлайн-регионы вдоль маршрута. Реализация — этап MVP (п.2). */
    fun prefetch(routePoints: List<Pair<Double, Double>>, styleUrl: String) {
        val offline = OfflineManager.getInstance(context)
        // Сегментация коридора и offlineManager.createOfflineRegions(...) — п.2.
        // Каркас фиксирует только контракт: до выезда коридор и манёвры
        // гарантированно в локальном кэше (чек-лист пилота).
        require(routePoints.size >= 2) { "Маршрут должен содержать хотя бы 2 точки" }
        require(styleUrl.isNotBlank())
    }

    /** Проверка чек-листа «всё скачано» перед выездом. */
    fun isCorridorReady(tripId: String): Boolean {
        // Сопоставление активных офлайн-регионов с коридором рейса — п.2.
        return false
    }
}
