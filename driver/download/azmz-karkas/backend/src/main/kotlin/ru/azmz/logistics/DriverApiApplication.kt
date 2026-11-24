package ru.azmz.logistics

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

/**
 * Модульный монолит: границы модулей — пакеты (reference/trip/mark/chat/sync).
 * Вынос в сборочные модули — после стабилизации границ (см. README).
 */
@SpringBootApplication
class DriverApiApplication

fun main(args: Array<String>) {
    runApplication<DriverApiApplication>(*args)
}
