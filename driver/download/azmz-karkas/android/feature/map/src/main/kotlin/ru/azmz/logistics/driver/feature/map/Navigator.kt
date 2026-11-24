package ru.azmz.logistics.driver.feature.map

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import ru.azmz.logistics.driver.core.common.Geo

/**
 * Навигатор рейса: следит за GPS-позицией водителя и держит актуальный
 * маршрут до точки выгрузки.
 *
 * Поведение — как у карт:
 *  1) маршрут строится ОТ ТЕКУЩЕЙ позиции водителя (OsrmRouting.variants);
 *  2) при построении показываются варианты изначальной поездки:
 *     основной — оранжевый, альтернативы — серые;
 *  3) если водитель отклонился от активного маршрута больше чем на
 *    REROUTE_THRESHOLD_M — маршрут перестраивается от нового места
 *    (не чаще одного раза в REROUTE_COOLDOWN_MS, чтобы не дёргалось);
 *  4) сеть недоступна / OSRM молчит — остаётся прежний маршрут.
 */
class Navigator(
    private val scope: CoroutineScope,
    private val tracker: LocationTracker,
) {

    data class State(
        val variants: List<OsrmRouting.Variant> = emptyList(),
        /** Индекс активного варианта (по умолчанию рекомендованный — 0). */
        val activeIndex: Int = 0,
        /** Метка перестроения: показываем плашку «Маршрут перестроен». */
        val reroutedAt: Long = 0,
        val building: Boolean = false,
        /** Маршрут построен по сохранённой геометрии рейса, а не живым OSRM. */
        val fallback: Boolean = false,
        /** Показана точная геометрия офиса из Яндекс.Карт. */
        val exact: Boolean = false,
    ) {
        val active: OsrmRouting.Variant? get() = variants.getOrNull(activeIndex)
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    private var destination: Pair<Double, Double>? = null
    private var job: Job? = null
    private var lastRerouteAt = 0L

    /** Точки офисного маршрута (Яндекс.Карты) — в порядке движения. */
    private var waypoints: List<Pair<Double, Double>> = emptyList()

    /**
     * Индекс ближайшей ещё не пройденной точки. Промежуточные точки офиса
     * (погрузка, перецепка, промежуточная выгрузка) снимаем с маршрута,
     * когда водитель к ним подъехал, иначе навигатор разворачивал бы назад.
     * Последняя точка не снимается никогда — это пункт назначения.
     */
    private var nextWaypoint = 0

    /** Сохранённая геометрия рейса — маршрут, если OSRM недоступен. */
    private var fallbackCoords: List<List<Double>> = emptyList()
    private var fallbackDistanceM: Double? = null
    private var fallbackDurationS: Double? = null

    /**
     * Показывать точную офисную линию, а не пересчёт OSRM. Выключается,
     * когда водитель отклонился от маршрута: тогда нужен объезд по дорогам.
     */
    private var preferOffice = false

    /**
     * Задаёт точку назначения (lat, lon) — конец маршрута рейса.
     * fallbackGeoJson — LineString из Room: он уже на устройстве и позволяет
     * показать маршрут, даже когда OSRM не ответил.
     */
    fun setDestination(
        lat: Double,
        lon: Double,
        fallbackGeoJson: String? = null,
        routeDistanceM: Int? = null,
        routeDurationS: Long? = null,
        routeWaypointsJson: String? = null,
    ) {
        destination = lat to lon
        waypoints = parseWaypoints(routeWaypointsJson)
        nextWaypoint = 0
        fallbackCoords = parseCoords(fallbackGeoJson)
        fallbackDistanceM = routeDistanceM?.toDouble()
        fallbackDurationS = routeDurationS?.toDouble()
        // Офис прислал точную линию Яндекса — показываем её, а не OSRM.
        preferOffice = fallbackCoords.size >= 2
        rebuild(force = true)
    }

    fun clear() {
        destination = null
        waypoints = emptyList()
        nextWaypoint = 0
        fallbackCoords = emptyList()
        preferOffice = false
        fallbackDistanceM = null
        fallbackDurationS = null
        job?.cancel()
        _state.value = State()
    }

    /** Выбор варианта поездки водителем (тап по варианту — этап MVP). */
    fun selectVariant(index: Int) {
        if (_state.value.variants.getOrNull(index) != null) {
            _state.value = _state.value.copy(activeIndex = index)
        }
    }

    /**
     * Подписка на фиксы GPS: первый фикс строит маршрут, отклонение —
     * перестраивает. Одна активная задача: новый фикс отменяет прошлую.
     */
    fun start() {
        if (job != null) return
        job = scope.launch {
            tracker.fix.collect { f ->
                if (f == null || destination == null) return@collect
                val st = _state.value
                val route = st.active
                val now = System.currentTimeMillis()

                val deviation = route?.let {
                    LocationTracker.distanceToPolylineM(f.lat, f.lon, it.coords)
                } ?: Double.MAX_VALUE

                // Доехали до промежуточной точки офиса — снимаем её с маршрута
                // и сразу перестраиваемся на следующую.
                var advanced = false
                while (nextWaypoint < waypoints.size - 1) {
                    val (wLat, wLon) = waypoints[nextWaypoint]
                    if (Geo.distanceM(f.lat, f.lon, wLat, wLon) > WAYPOINT_REACHED_M) break
                    nextWaypoint++
                    advanced = true
                }

                // Отклонение от офисной линии: дальше ведём живым OSRM через
                // оставшиеся точки — так водитель вернётся на маршрут.
                val deviated = route != null && deviation > REROUTE_THRESHOLD_M
                if (deviated) preferOffice = false

                // Запасной маршрут периодически пробуем заменить живым OSRM:
                // связь могла появиться, пока водитель ехал по сохранённой линии.
                val staleFallback = !preferOffice && st.fallback && now - lastRerouteAt > FALLBACK_RETRY_MS
                val needBuild = advanced || route == null || staleFallback ||
                    (deviated && now - lastRerouteAt > REROUTE_COOLDOWN_MS)

                if (needBuild) rebuild(force = advanced || route == null || deviated)
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    private fun rebuild(force: Boolean = false) {
        val dest = destination ?: return
        val now = System.currentTimeMillis()
        if (!force && now - lastRerouteAt < REROUTE_COOLDOWN_MS) return
        // фикс может быть null (разрешение не дано) — тогда ждём первый
        val f = tracker.fix.value ?: return

        lastRerouteAt = now
        val rerouted = _state.value.active != null
        _state.value = _state.value.copy(building = true)

        scope.launch {
            // Точная линия офиса из Яндекс.Карт: показываем её как есть.
            val office = if (preferOffice) officeVariant(f.lat, f.lon) else null
            val variants = if (office != null) {
                listOf(office)
            } else {
                // Офисные точки Яндекс.Карт: ведём через все ещё не пройденные
                // точки по порядку. Пройденные промежуточные точки уже сняты.
                val remaining = waypoints.drop(nextWaypoint)
                if (remaining.isNotEmpty()) {
                    OsrmRouting.through(f.lat, f.lon, remaining)
                } else {
                    OsrmRouting.variants(f.lat, f.lon, dest.first, dest.second)
                }
            }
            val fallback = if (variants.isEmpty()) fallbackVariant(f.lat, f.lon) else null
            val shown = if (variants.isNotEmpty()) variants else listOfNotNull(fallback)
            _state.value = State(
                variants = shown,
                activeIndex = 0,
                reroutedAt = if (rerouted && shown.isNotEmpty()) now else _state.value.reroutedAt,
                building = false,
                // Живой OSRM не ответил — показываем сохранённую геометрию,
                // но не выдаём её за актуальный маршрут с пробками.
                fallback = variants.isEmpty() && shown.isNotEmpty(),
                exact = office != null,
            )
        }
    }

    /**
     * Точная офисная линия: водитель видит тот же путь, что построил офис в
     * Яндекс.Картах. Если водитель уже на линии — обрезаем пройденную часть
     * по ближайшей вершине; если далеко — добавляем подъезд к началу линии
     * по дорогам OSRM.
     */
    private suspend fun officeVariant(fixLat: Double, fixLon: Double): OsrmRouting.Variant? {
        val coords = fallbackCoords
        if (coords.size < 2) return null

        var nearest = 0
        var best = Double.MAX_VALUE
        for (i in coords.indices) {
            val c = coords[i]
            if (c.size < 2) continue
            val d = Geo.distanceM(fixLat, fixLon, c[1], c[0])
            if (d < best) {
                best = d
                nearest = i
            }
        }

        val officeLength = polylineLengthM(coords)
        val officeDistance = fallbackDistanceM?.takeIf { it > 0 } ?: officeLength
        val officeDuration = fallbackDurationS?.takeIf { it > 0 }
            ?: (officeLength / AVG_SPEED_MPS)

        if (best <= JOIN_RADIUS_M) {
            val tail = coords.drop(nearest)
            if (tail.size < 2) return null
            val line = listOf(listOf(fixLon, fixLat)) + tail
            val tailLength = polylineLengthM(tail)
            val ratio = if (officeLength > 0) (tailLength / officeLength).coerceIn(0.0, 1.0) else 1.0
            return OsrmRouting.Variant(
                coords = line,
                distanceM = tailLength,
                durationS = (officeDuration * ratio).coerceAtLeast(60.0),
            )
        }

        // Водитель далеко от офисной линии: подъезд к её первой точке по
        // дорогам, затем сама офисная линия без изменений.
        val first = coords[0]
        val approach = OsrmRouting.through(fixLat, fixLon, listOf(first[1] to first[0])).firstOrNull()
        if (approach != null && approach.coords.size >= 2) {
            val line = approach.coords.dropLast(1) + coords
            return OsrmRouting.Variant(
                coords = line,
                distanceM = approach.distanceM + officeDistance,
                durationS = approach.durationS + officeDuration,
            )
        }

        // OSRM недоступен — показываем точную линию офиса как есть.
        return OsrmRouting.Variant(coords, officeDistance, officeDuration)
    }

    private fun polylineLengthM(coords: List<List<Double>>): Double {
        var distanceM = 0.0
        for (i in 1 until coords.size) {
            val a = coords[i - 1]
            val b = coords[i]
            if (a.size < 2 || b.size < 2) continue
            distanceM += Geo.distanceM(a[1], a[0], b[1], b[0])
        }
        return distanceM
    }

    /**
     * Маршрут из сохранённой геометрии рейса: обрезаем её по ближайшей
     * к водителю вершине и оцениваем остаток. Это не замена OSRM, а
     * страховка: лучше линия и ETA, чем «маршрут недоступен».
     */
    private fun fallbackVariant(fixLat: Double, fixLon: Double): OsrmRouting.Variant? {
        val coords = fallbackCoords
        if (coords.size < 2) return null

        var nearest = 0
        var best = Double.MAX_VALUE
        for (i in coords.indices) {
            val c = coords[i]
            if (c.size < 2) continue
            val d = Geo.distanceM(fixLat, fixLon, c[1], c[0])
            if (d < best) {
                best = d
                nearest = i
            }
        }

        val tail = coords.drop(nearest)
        if (tail.size < 2) return null
        val line = listOf(listOf(fixLon, fixLat)) + tail

        var distanceM = 0.0
        for (i in 1 until line.size) {
            val a = line[i - 1]
            val b = line[i]
            distanceM += Geo.distanceM(a[1], a[0], b[1], b[0])
        }

        // Средняя скорость рейса из плана; иначе 55 км/ч.
        val avgSpeedMps = fallbackDistanceM?.takeIf { it > 0 }?.let { totalM ->
            fallbackDurationS?.takeIf { it > 0 }?.let { totalS -> totalM / totalS }
                ?: (55_000.0 / 3600.0)
        } ?: (55_000.0 / 3600.0)

        return OsrmRouting.Variant(
            coords = line,
            distanceM = distanceM,
            durationS = (distanceM / avgSpeedMps).coerceAtLeast(60.0),
        )
    }

    /** «[[lat,lng],…]» из снимка рейса → точки маршрута; битые пропускаем. */
    private fun parseWaypoints(json: String?): List<Pair<Double, Double>> {
        if (json.isNullOrBlank()) return emptyList()
        return runCatching {
            Json.parseToJsonElement(json).jsonArray.mapNotNull { el ->
                val pair = runCatching { el.jsonArray }.getOrNull() ?: return@mapNotNull null
                if (pair.size < 2) return@mapNotNull null
                val lat = pair[0].jsonPrimitive.double
                val lng = pair[1].jsonPrimitive.double
                if (lat in -90.0..90.0 && lng in -180.0..180.0) lat to lng else null
            }
        }.getOrDefault(emptyList())
    }

    /** LineString GeoJSON → [[lon,lat],…]; битые точки пропускаем. */
    private fun parseCoords(geoJson: String?): List<List<Double>> {
        if (geoJson.isNullOrBlank()) return emptyList()
        return runCatching {
            val obj = Json.parseToJsonElement(geoJson).jsonObject
            val coords = obj["coordinates"]?.jsonArray ?: return emptyList()
            coords.mapNotNull { el ->
                val c = runCatching { el.jsonArray }.getOrNull() ?: return@mapNotNull null
                if (c.size < 2) return@mapNotNull null
                listOf(c[0].jsonPrimitive.double, c[1].jsonPrimitive.double)
            }
        }.getOrDefault(emptyList())
    }

    companion object {
        /** Порог отклонения от маршрута, м. */
        const val REROUTE_THRESHOLD_M = 150.0

        /** Радиус, в котором промежуточная точка офиса считается пройденной. */
        const val WAYPOINT_REACHED_M = 300.0

        /** Если водитель ближе этого радиуса к офисной линии — обрезаем её. */
        const val JOIN_RADIUS_M = 500.0

        /** Средняя скорость для оценки ETA, когда офис не дал время. */
        const val AVG_SPEED_MPS = 55_000.0 / 3600.0

        /** Минимальная пауза между перестроениями, мс. */
        const val REROUTE_COOLDOWN_MS = 15_000L

        /** Как часто пробовать заменить сохранённый маршрут живым OSRM. */
        const val FALLBACK_RETRY_MS = 60_000L
    }
}
