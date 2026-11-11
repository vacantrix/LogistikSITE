package ru.azmz.logistics.driver.feature.map

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Построение маршрута по дорогам: публичный OSRM-демо-сервер
 * (основан на данных OpenStreetMap, без API-ключей).
 *
 *  * alternatives=true — сервер возвращает варианты поездки (основной +
 *    альтернативы): водитель видит разные варианты изначальной поездки;
 *  * geometries=geojson&overview=full — полная ломаная для линии на карте;
 *  * перестроение: если водитель отклонился от активного маршрута больше
 *    чем на REROUTE_THRESHOLD_M, навигатор строит новый маршрут от текущей
 *    позиции (см. Navigator).
 *
 * Демо-сервер OSRM — для пилота. В проде поднимаем свой экземпляр
 * (карта России из OSM-выгрузки) рядом с бэкендом каркаса: контракт не меняется.
 */
object OsrmRouting {

    private const val BASE = "https://router.project-osrm.org/route/v1/driving/"
    private val json = Json { ignoreUnknownKeys = true }

    @Serializable
    data class Variant(
        val coords: List<List<Double>>,   // [[lon,lat],…] — порядок GeoJSON
        val distanceM: Double,
        val durationS: Double,
    )

    @Serializable
    private data class OsrmResponse(val code: String, val routes: List<OsrmRoute> = emptyList())

    @Serializable
    private data class OsrmRoute(val distance: Double, val duration: Double, val geometry: OsrmGeometry)

    @Serializable
    private data class OsrmGeometry(val coordinates: List<List<Double>> = emptyList())

    /** Варианты маршрута from→to: [0] — рекомендованный, дальше — альтернативы. */
    suspend fun variants(
        fromLat: Double, fromLon: Double,
        toLat: Double, toLon: Double,
    ): List<Variant> = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val url = BASE + "${lon(fromLon)},${fromLat};" + "${lon(toLon)},${toLat}" +
            "?overview=full&geometries=geojson&alternatives=true&steps=false"
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 8_000
            conn.readTimeout = 12_000
            conn.setRequestProperty("User-Agent", "azmz-driver/0.2")
            if (conn.responseCode != 200) return@withContext emptyList()
            val body = conn.inputStream.bufferedReader().readText()
            val parsed = runCatching { json.decodeFromString<OsrmResponse>(body) }.getOrNull()
                ?: return@withContext emptyList()
            parsed.routes.map { r ->
                Variant(r.geometry.coordinates, r.distance, r.duration)
            }
        } catch (_: Exception) {
            emptyList()
        } finally {
            conn.disconnect()
        }
    }

    /** URLEncoder для координат не нужен, но точку не портим на всякий случай. */
    private fun lon(v: Double) = URLEncoder.encode(v.toString(), "UTF-8")
}
