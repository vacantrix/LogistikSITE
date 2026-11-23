package ru.azmz.logistics.driver.core.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.azmz.logistics.driver.core.common.ConnectionState

/**
 * Индикатор связи — на всех экранах, переходы анимированы:
 * зелёный «На связи» / оранжевый пульсирующий «Отправка: N» /
 * красный «Офлайн. В очереди: N». Очередь тает на глазах —
 * счётчик обновляется из Flow глубины outbox.
 */
@Composable
fun ConnectionBadge(state: ConnectionState, modifier: Modifier = Modifier) {
    val color = when (state) {
        is ConnectionState.Checking -> AzmzGray
        is ConnectionState.Online -> AzmzGreen
        is ConnectionState.Sending -> AzmzOrange
        is ConnectionState.Offline -> AzmzRed
    }
    val text = when (state) {
        is ConnectionState.Checking -> "Проверка связи…"
        is ConnectionState.Online -> "На связи"
        is ConnectionState.Sending -> "Отправка: ${state.queued}"
        is ConnectionState.Offline -> "Офлайн. В очереди: ${state.queued}"
    }

    val alpha = if (state is ConnectionState.Sending) {
        val transition = rememberInfiniteTransition(label = "sending-pulse")
        transition.animateFloat(
            initialValue = 0.55f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(600), RepeatMode.Reverse),
            label = "pulse-alpha",
        ).value
    } else {
        1f
    }

    Surface(
        modifier = modifier,
        color = color.copy(alpha = alpha),
        shape = RoundedCornerShape(50),
        shadowElevation = 3.dp,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .background(Color.White, CircleShape),
            )
            AnimatedContent(
                targetState = text,
                transitionSpec = { fadeIn(tween(200)) togetherWith fadeOut(tween(200)) },
                label = "connection-text",
            ) { value ->
                Text(
                    value,
                    color = Color.White,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}
