package ru.azmz.logistics.driver.core.common

/**
 * Индикатор связи (на всех экранах, переходы анимированы):
 *  * зелёный «На связи»;
 *  * оранжевый анимированный «Отправка: N» — очередь outbox тает на глазах;
 *  * красный «Офлайн. В очереди: N».
 */
sealed interface ConnectionState {
    /** Первый кадр до ответа ConnectivityManager — не врём красным «Офлайн». */
    data object Checking : ConnectionState
    data object Online : ConnectionState
    data class Sending(val queued: Int) : ConnectionState
    data class Offline(val queued: Int) : ConnectionState

    companion object {
        fun of(online: Boolean, queued: Int): ConnectionState = when {
            !online -> Offline(queued)
            queued > 0 -> Sending(queued)
            else -> Online
        }
    }
}

/** Время, мс. Инжектится, чтобы UI и тесты не зависели от System.currentTimeMillis. */
fun interface Clock {
    fun now(): Long
}

val SystemClock: Clock = Clock { System.currentTimeMillis() }
