package ru.azmz.logistics.driver.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.azmz.logistics.driver.core.common.TripEventType
import ru.azmz.logistics.driver.core.data.db.TripEventEntity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Форматирование времени/длительностей. */
object TimeFmt {
    private val dateTime = SimpleDateFormat("dd.MM HH:mm", Locale("ru"))
    private val timeOnly = SimpleDateFormat("HH:mm", Locale("ru"))

    fun dt(ms: Long): String = dateTime.format(Date(ms))
    fun t(ms: Long): String = timeOnly.format(Date(ms))

    fun duration(ms: Long): String {
        val hours = ms / 3_600_000
        val minutes = (ms % 3_600_000) / 60_000
        return if (hours > 0) "$hours ч $minutes мин" else "$minutes мин"
    }
}

/**
 * Вертикальный таймлайн событий рейса (табы «Рейс» и «История»).
 * Ручные отметки помечаются «вручную», автозакрытые интервалы —
 * «закрыто автоматически», длительность интервала считается автоматически.
 */
@Composable
fun EventTimeline(events: List<TripEventEntity>, modifier: Modifier = Modifier) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        events.forEachIndexed { index, event ->
            Row {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.width(20.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(12.dp)
                            .background(AzmzOrange, CircleShape),
                    )
                    if (index < events.lastIndex) {
                        Box(
                            modifier = Modifier
                                .width(2.dp)
                                .fillMaxHeight()
                                .height(28.dp)
                                .background(AzmzOrange.copy(alpha = 0.3f)),
                        )
                    }
                }
                Column(
                    modifier = Modifier
                        .padding(start = 10.dp)
                        .fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            TripEventType.byCode(event.type)?.title ?: event.type,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 15.sp,
                        )
                        if (event.isManual) ManualBadge()
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(TimeFmt.dt(event.occurredAt), color = AzmzGray, fontSize = 12.sp)
                        event.intervalClosedAt?.let { closed ->
                            Text(
                                "длительность ${TimeFmt.duration(closed - event.occurredAt)}",
                                color = AzmzOrange,
                                fontSize = 12.sp,
                            )
                        }
                        if (event.intervalAutoClosed == true) {
                            Text(
                                "закрыто автоматически",
                                color = AzmzGray,
                                fontSize = 12.sp,
                            )
                        }
                    }
                    event.note?.takeIf { it.isNotBlank() }?.let {
                        Text(it, color = AzmzGray, fontSize = 13.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun ManualBadge() {
    Text(
        "вручную",
        modifier = Modifier
            .background(AzmzOrange.copy(alpha = 0.12f), RoundedCornerShape(4.dp))
            .padding(horizontal = 6.dp, vertical = 1.dp),
        color = AzmzOrange,
        fontSize = 10.sp,
    )
}
