package ru.azmz.logistics.driver.core.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Единый стиль водителя и веба (дизайн-система платформы):
 * тёмно-синий #101E2E + оранжевый акцент #F97316, белый карточки,
 * фон #F5F7FA, Inter-подобный шрифт (каркас: системная гарнитура,
 * подключение файлов Inter — этап MVP), чёрные основные кнопки.
 */

val AzmzNavy = Color(0xFF101E2E)      // шапка веба / нижняя панель приложения
val AzmzNavySoft = Color(0xFF1B2E44)
val AzmzOrange = Color(0xFFF97316)    // акцент, лого-квадрат с галочкой
val AzmzBg = Color(0xFFF5F7FA)
val AzmzInk = Color(0xFF15202B)       // чёрные основные кнопки / текст
val AzmzGray = Color(0xFF64748B)      // подписи статусов
val AzmzGreen = Color(0xFF22C55E)     // «На связи»
val AzmzRed = Color(0xFFEF4444)       // «Офлайн» / ошибки
val AzmzYellow = Color(0xFFFACC15)

private val LightScheme = lightColorScheme(
    primary = AzmzOrange,
    onPrimary = Color.White,
    secondary = AzmzNavy,
    onSecondary = Color.White,
    background = AzmzBg,
    onBackground = AzmzInk,
    surface = Color.White,
    onSurface = AzmzInk,
    surfaceVariant = Color(0xFFEEF2F7),
    onSurfaceVariant = AzmzGray,
    error = AzmzRed,
)

@Composable
fun AzmzTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = LightScheme, content = content)
}

/** Цвет категории пометки — цветной участок поверх дороги. */
fun markCategoryColor(category: String): Color = when (category) {
    "POTHOLE" -> Color(0xFFF59E0B)
    "ROADWORKS" -> AzmzOrange
    "POLICE" -> Color(0xFF3B82F6)
    "ACCIDENT" -> AzmzRed
    "CLOSED" -> Color(0xFF6B7280)
    else -> AzmzGray
}

/** HEX для MapLibre-слоёв. */
fun markCategoryHex(category: String): String = when (category) {
    "POTHOLE" -> "#F59E0B"
    "ROADWORKS" -> "#F97316"
    "POLICE" -> "#3B82F6"
    "ACCIDENT" -> "#EF4444"
    "CLOSED" -> "#6B7280"
    else -> "#64748B"
}

fun markCategoryTitle(category: String): String = when (category) {
    "POTHOLE" -> "Яма"
    "ROADWORKS" -> "Ремонт"
    "POLICE" -> "ДПС"
    "ACCIDENT" -> "Авария"
    "CLOSED" -> "Перекрыто"
    else -> category
}
