package ru.azmz.logistics.driver.feature.map

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Трекер позиции водителя: GPS + сеть через системный LocationManager
 * (без зависимости от Google Play Services — работает на любых устройствах).
 *
 * Фиксы собираются в StateFlow: карта подписывается и рисует «синюю точку»,
 * навигатор перестраивает маршрут при отклонении (см. NavigatorState).
 * Интервал — 1 с / 3 м: для городских скоростей этого достаточно,
 * и батарея не садится.
 */
class LocationTracker(private val context: Context) {

    data class Fix(
        val lat: Double,
        val lon: Double,
        val accuracyM: Float,
        val speedMps: Float,
        val bearingDeg: Float,
        val at: Long,
    )

    private val _fix = MutableStateFlow<Fix?>(null)

    /** Последний фикс (null — разрешения нет или сигнал ещё не пришёл). */
    val fix: StateFlow<Fix?> = _fix

    private val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    private val listener = LocationListener { location -> _fix.value = location.toFix() }

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /** Идемпотентно включает слежение; false — нет разрешения или нет провайдеров. */
    fun start(): Boolean {
        if (!hasPermission()) return false
        val gpsOn = manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
        val netOn = manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        if (!gpsOn && !netOn) return false
        stop()
        if (gpsOn) {
            runCatching {
                manager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, 1_000L, 3f, listener, Looper.getMainLooper(),
                )
            }
        }
        if (netOn) {
            runCatching {
                manager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER, 1_000L, 3f, listener, Looper.getMainLooper(),
                )
            }
        }
        // мгновенный «последний известный» фикс, чтобы точка появилась сразу
        runCatching {
            val last = manager.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                ?: manager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            last?.let { _fix.value = it.toFix() }
        }
        return true
    }

    fun stop() {
        runCatching { manager.removeUpdates(listener) }
    }

    private fun Location.toFix() = Fix(
        lat = latitude,
        lon = longitude,
        accuracyM = accuracy,
        speedMps = speed,
        bearingDeg = bearing,
        at = time,
    )

    companion object {
        /** Расстояние от точки до ближайшего сегмента ломаной, м. */
        fun distanceToPolylineM(lat: Double, lon: Double, coords: List<List<Double>>): Double {
            if (coords.isEmpty()) return Double.MAX_VALUE
            val results = FloatArray(1)
            var best = Double.MAX_VALUE
            var prev = coords.first()
            for (i in 1 until coords.size) {
                val cur = coords[i]
                // грубая, но честная оценка: расстояние до вершины + середины сегмента
                Location.distanceBetween(lat, lon, prev[1], prev[0], results)
                if (results[0] < best) best = results[0].toDouble()
                Location.distanceBetween(lat, lon, cur[1], cur[0], results)
                if (results[0] < best) best = results[0].toDouble()
                Location.distanceBetween(lat, lon, (prev[1] + cur[1]) / 2, (prev[0] + cur[0]) / 2, results)
                if (results[0] < best) best = results[0].toDouble()
                prev = cur
            }
            return best
        }
    }
}
