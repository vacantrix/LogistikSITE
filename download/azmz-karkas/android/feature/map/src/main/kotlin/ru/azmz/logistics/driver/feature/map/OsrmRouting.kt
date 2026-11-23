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

    /**
     * Сначала наш домен: Caddy проксирует префикс /osrm/ на публичный OSRM.
     * С мобильных сетей РФ router.project-osrm.org часто недоступен, а
     * vacantrix.ru доступен всегда. Публичный OSRM оставлен запасным
     * адресом — если прокси когда-нибудь отключат, маршрут всё равно
     * построится там, где прямой доступ работает.
     */
    private val BASES = listOf(
        "https://vacantrix.ru/osrm/route/v1/driving/",
        "https://router.project-osrm.org/route/v1/driving/",
    )
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
        val path = "${lon(fromLon)},${fromLat};" + "${lon(toLon)},${toLat}" +
            "?overview=full&geometries=geojson&alternatives=true&steps=false"
        // Перебираем адреса по очереди: наш прокси, затем публичный OSRM.
        // Первый успешный ответ и есть маршрут; пустой/ошибочный — следующий.
        for (base in BASES) {
            val parsed = request(base + path) ?: continue
            if (parsed.routes.isNotEmpty()) {
                return@withContext parsed.routes.map { r ->
                    Variant(r.geometry.coordinates, r.distance, r.duration)
                }
            }
        }
        emptyList()
    }

    /**
     * Маршрут от текущей позиции через все точки офиса по порядку.
     *
     * Офис строит маршрут в Яндекс.Картах и присылает точки (`rtext`).
     * Строим дорожную линию через них, поэтому приложение ведёт водителя
     * тем же путём, а не только до последней точки. alternatives=false:
     * с промежуточными точками нужен ровно один маршрут — офисный.
     */
    suspend fun through(
        fromLat: Double, fromLon: Double,
        waypoints: List<Pair<Double, Double>>,
    ): List<Variant> = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val points = buildList {
            add("${lon(fromLon)},${fromLat}")
            waypoints.forEach { (lat, lng) -> add("${lon(lng)},${lat}") }
        }.joinToString(";")
        val path = "$points?overview=full&geometries=geojson&alternatives=false&steps=false"
        for (base in BASES) {
            val parsed = request(base + path) ?: continue
            if (parsed.routes.isNotEmpty()) {
                return@withContext parsed.routes.map { r ->
                    Variant(r.geometry.coordinates, r.distance, r.duration)
                }
            }
        }
        emptyList()
    }

    /** Один запрос к OSRM; null — сеть/HTTP/JSON подвели. */
    private fun request(url: String): OsrmResponse? {
        val conn = URL(url).openConnection() as HttpURLConnection
        return try {
            conn.connectTimeout = 6_000
            conn.readTimeout = 10_000
            conn.setRequestProperty("User-Agent", "azmz-driver/0.2")
            if (conn.responseCode != 200) return null
            val body = conn.inputStream.bufferedReader().readText()
            runCatching { json.decodeFromString<OsrmResponse>(body) }.getOrNull()
        } catch (_: Exception) {
            null
        } finally {
            conn.disconnect()
        }
    }

    /** URLEncoder для координат не нужен, но точку не портим на всякий случай. */
    private fun lon(v: Double) = URLEncoder.encode(v.toString(), "UTF-8")
}
