package ru.azmz.logistics.driver.feature.history

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.foundation.background
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.azmz.logistics.driver.core.common.TripEventType
import ru.azmz.logistics.driver.core.sync.AppGraph
import ru.azmz.logistics.driver.core.sync.SyncScheduler
import ru.azmz.logistics.driver.core.ui.AzmzGray
import ru.azmz.logistics.driver.core.ui.AzmzOrange
import ru.azmz.logistics.driver.core.ui.EventTimeline
import ru.azmz.logistics.driver.core.ui.TimeFmt

/**
 * Таб «История»: завершённые рейсы; у карточки — развёрнутая лента событий.
 * Статус и «последнее событие» заполняются автоматически из отметок водителя.
 *
 * «Шторка»: потянул список вниз — принудительный цикл синхронизации
 * (push outbox + pull журнала), свежие завершённые рейсы приезжают сразу.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryScreen() {
    val context = LocalContext.current
    val driverId = AppGraph.driverId.orEmpty()
    val trips by remember(driverId) { AppGraph.db.tripDao().flowHistory(driverId) }
        .collectAsStateWithLifecycle(initialValue = emptyList())

    PullToRefreshBox(
        isRefreshing = false,
        onRefresh = { SyncScheduler.kick(context) },
    ) {
        if (trips.isEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("История пуста", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    "Завершённые рейсы появятся здесь после синхронизации",
                    color = AzmzGray, fontSize = 13.sp,
                )
            }
            return@PullToRefreshBox
        }

        LazyColumn(
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(trips, key = { it.id }) { trip ->
            var expanded by rememberSaveable(trip.id) { mutableStateOf(false) }
            val events by remember(trip.id) {
                AppGraph.db.tripEventDao().flowForTrip(trip.id)
            }.collectAsStateWithLifecycle(initialValue = emptyList())

            Surface(shape = RoundedCornerShape(16.dp), color = Color.White) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(trip.tripCode, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Box(
                            Modifier
                                .size(10.dp)
                                .background(AzmzOrange, CircleShape),
                        )
                        Text(
                            TripEventType.byCode(trip.lastEventType.orEmpty())?.title
                                ?: trip.lastEventType ?: "—",
                            color = AzmzGray, fontSize = 13.sp,
                        )
                        Box(Modifier.weight(1f))
                        Text(
                            trip.lastEventAt?.let { TimeFmt.dt(it) } ?: "",
                            color = AzmzGray, fontSize = 12.sp,
                        )
                    }

                    AnimatedVisibility(visible = expanded) {
                        EventTimeline(events)
                    }

                    TextButton(onClick = { expanded = !expanded }) {
                        Text(
                            if (expanded) "Свернуть" else "Лента событий",
                            color = AzmzOrange, fontSize = 13.sp,
                        )
                    }
                }
            }
        }
    }
}
}
