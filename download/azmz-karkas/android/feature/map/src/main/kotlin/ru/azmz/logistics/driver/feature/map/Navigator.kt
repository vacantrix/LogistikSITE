package ru.azmz.logistics.driver.feature.map

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
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
    ) {
        val active: OsrmRouting.Variant? get() = variants.getOrNull(activeIndex)
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    private var destination: Pair<Double, Double>? = null
    private var job: Job? = null
    private var lastRerouteAt = 0L

    /** Задаёт точку назначения (lat, lon) — конец маршрута рейса. */
    fun setDestination(lat: Double, lon: Double) {
        destination = lat to lon
        rebuild(force = true)
    }

    fun clear() {
        destination = null
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

                val needBuild = route == null ||
                    deviation > REROUTE_THRESHOLD_M &&
                    now - lastRerouteAt > REROUTE_COOLDOWN_MS

                if (needBuild) rebuild()
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
            val variants = OsrmRouting.variants(f.lat, f.lon, dest.first, dest.second)
            _state.value = State(
                variants = variants,
                activeIndex = 0,
                reroutedAt = if (rerouted && variants.isNotEmpty()) now else _state.value.reroutedAt,
                building = false,
            )
        }
    }

    companion object {
        /** Порог отклонения от маршрута, м. */
        const val REROUTE_THRESHOLD_M = 150.0

        /** Минимальная пауза между перестроениями, мс. */
        const val REROUTE_COOLDOWN_MS = 15_000L
    }
}
