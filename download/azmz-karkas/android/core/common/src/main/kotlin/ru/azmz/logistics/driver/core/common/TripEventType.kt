package ru.azmz.logistics.driver.core.common

/**
 * События рейса — слой данных №1 (привязаны ко времени, отмечает водитель).
 *
 * Точечные: DEPARTURE, TRIP_DONE.
 * Интервальные — пары «открывашка → закрывашка», длительность считается
 * автоматически (intervalClosedAt - occurredAt).
 */
enum class TripEventType(val code: String, val title: String, val opensInterval: Boolean) {
    DEPARTURE("DEPARTURE", "Выезд", false),
    ARRIVAL_LOADING("ARRIVAL_LOADING", "Прибытие на погрузку", true),
    LOADING_DONE("LOADING_DONE", "Погрузка завершена", false),
    REST_START("REST_START", "Начать стоянку по тахографу", true),
    REST_END("REST_END", "Завершить стоянку", false),
    ARRIVAL_UNLOADING("ARRIVAL_UNLOADING", "Прибытие на выгрузку", true),
    UNLOADING_DONE("UNLOADING_DONE", "Выгрузка завершена", false),
    TRIP_DONE("TRIP_DONE", "Рейс завершён", false);

    companion object {
        fun byCode(code: String): TripEventType? = entries.firstOrNull { it.code == code }
    }
}

/**
 * Правила пар событий и авто-закрытия. ОБЯЗАНЫ совпадать с сервером
 * (TripEventApplier). Дубль — плата за простоту каркаса; вынос в общий
 * KMP-модуль — этап MVP.
 */
object TripEventRules {

    /** Явная закрывашка для каждой открывашки. */
    val EXPLICIT_CLOSER = mapOf(
        TripEventType.ARRIVAL_LOADING to TripEventType.LOADING_DONE,
        TripEventType.REST_START to TripEventType.REST_END,
        TripEventType.ARRIVAL_UNLOADING to TripEventType.UNLOADING_DONE,
    )

    val OPENERS = EXPLICIT_CLOSER.keys

    fun closesExplicitly(opener: TripEventType, newEvent: TripEventType): Boolean =
        EXPLICIT_CLOSER[opener] == newEvent

    /**
     * Авто-закрытие (решение сессии): «Рейс завершён» закрывает всё,
     * любое другое событие закрывает открывашки старше себя.
     */
    fun shouldClose(openedAt: Long, newEventType: TripEventType, newEventAt: Long): Boolean =
        newEventType == TripEventType.TRIP_DONE || openedAt <= newEventAt

    /** Этап для героя «Сейчас» на табе «Рейс». */
    fun stageLabel(lastType: TripEventType?): String = when (lastType) {
        null -> "Рейс назначен"
        TripEventType.DEPARTURE -> "В пути"
        TripEventType.ARRIVAL_LOADING -> "На погрузке"
        TripEventType.LOADING_DONE -> "Погрузка завершена — в пути"
        TripEventType.REST_START -> "Стоянка по тахографу"
        TripEventType.REST_END -> "Стоянка завершена — в пути"
        TripEventType.ARRIVAL_UNLOADING -> "На выгрузке"
        TripEventType.UNLOADING_DONE -> "Выгрузка завершена"
        TripEventType.TRIP_DONE -> "Рейс завершён"
    }
}
