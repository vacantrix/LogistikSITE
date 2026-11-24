package ru.azmz.logistics.driver.feature.trip

import ru.azmz.logistics.driver.core.data.db.TripEntity
import ru.azmz.logistics.driver.core.data.db.TripEventEntity

/**
 * Печать — точечное действие из приложения (раздела «Документы» нет:
 * ЭДО ведут логисты, у водителя бумажный комплект).
 *
 * Реализация — библиотека DantSu ESC/POS по Bluetooth SPP, лента 80 мм,
 * этап пилота (п.3 плана). Сопряжение с принтером — в «Настройках»,
 * печать вызывается с экрана «Рейс».
 */
interface PrintingService {

    /** Печать маршрутного листа/чека по рейсу и его событиям. */
    suspend fun printTripManifest(trip: TripEntity, events: List<TripEventEntity>): Result<Unit>

    /** Проверка, что принтер сопряжён и готов. */
    suspend fun isPrinterAvailable(): Boolean
}
