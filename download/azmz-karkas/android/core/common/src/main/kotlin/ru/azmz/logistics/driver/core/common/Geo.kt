package ru.azmz.logistics.driver.core.common

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** Гео-утилиты без Android-зависимостей. */
object Geo {

    private const val EARTH_RADIUS_M = 6_371_000.0

    /** Расстояние по гаверсинусу, м — для смарт-карточки по геозоне точки. */
    fun distanceM(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * EARTH_RADIUS_M * asin(sqrt(a.coerceIn(0.0, 1.0)))
    }

    /** bbox GeoJSON LineString: [minLat, minLon, maxLat, maxLon] или null. */
    fun bboxOfLineString(geoJson: String): DoubleArray? = runCatching {
        // GeoJSON LineString — объект {"type":"LineString","coordinates":[[lon,lat],…]}
        val obj = Json.parseToJsonElement(geoJson).jsonObject
        val coords = obj["coordinates"]?.jsonArray ?: return null
        var minLat = Double.MAX_VALUE; var minLon = Double.MAX_VALUE
        var maxLat = -Double.MAX_VALUE; var maxLon = -Double.MAX_VALUE
        for (c in coords) {
            val lon = c.jsonArray[0].jsonPrimitive.double
            val lat = c.jsonArray[1].jsonPrimitive.double
            minLat = minOf(minLat, lat); minLon = minOf(minLon, lon)
            maxLat = maxOf(maxLat, lat); maxLon = maxOf(maxLon, lon)
        }
        doubleArrayOf(minLat, minLon, maxLat, maxLon)
    }.getOrNull()

    /** GeoJSON LineString из точек (lon lat — порядок GeoJSON). */
    fun lineStringJson(points: List<Pair<Double, Double>>): String =
        points.joinToString(prefix = "{\"type\":\"LineString\",\"coordinates\":[", separator = ",", postfix = "]") { (lat, lon) ->
            "[$lon,$lat]"
        }
}
