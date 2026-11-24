package ru.azmz.logistics.driver.feature.trip

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.azmz.logistics.driver.core.common.TripEventRules
import ru.azmz.logistics.driver.core.common.TripEventType
import ru.azmz.logistics.driver.core.data.db.TripEntity
import ru.azmz.logistics.driver.core.data.db.TripEventEntity
import ru.azmz.logistics.driver.core.data.db.TripPointEntity
import ru.azmz.logistics.driver.core.sync.AppGraph
import ru.azmz.logistics.driver.core.ui.AzmzGray
import ru.azmz.logistics.driver.core.ui.AzmzInk
import ru.azmz.logistics.driver.core.ui.AzmzNavy
import ru.azmz.logistics.driver.core.ui.AzmzOrange
import ru.azmz.logistics.driver.core.ui.EventTimeline
import ru.azmz.logistics.driver.core.ui.TimeFmt

/**
 * Таб «Рейс»: графический степпер (Погрузка ✓ → грузовик «сейчас» → Выгрузка),
 * герой-блок «Сейчас» (этап + таймер), плитки 2×2, чёрная кнопка
 * «Отметить событие», вертикальный таймлайн.
 */
@Composable
fun TripScreen() {
    val scope = rememberCoroutineScope()
    val driverId = AppGraph.driverId.orEmpty()

    val trip by remember(driverId) { AppGraph.db.tripDao().flowActiveTrip(driverId) }
        .collectAsStateWithLifecycle(initialValue = null)
    val points by remember(trip?.id) {
        AppGraph.db.tripPointDao().flowForTrip(trip?.id.orEmpty())
    }.collectAsStateWithLifecycle(initialValue = emptyList())
    val events by remember(trip?.id) {
        AppGraph.db.tripEventDao().flowForTrip(trip?.id.orEmpty())
    }.collectAsStateWithLifecycle(initialValue = emptyList())
    var showEventDialog by remember { mutableStateOf(false) }

    val t = trip
    if (t == null) {
        EmptyTripState()
        return
    }

    Column(
        modifier = Modifier
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(t.tripCode, fontSize = 22.sp, fontWeight = FontWeight.Bold)

        TripStepper(points = points, events = events)
        NowHero(events = events)
        TilesGrid(trip = t, events = events)

        // чёрная основная кнопка — дизайн-система платформы
        Button(
            onClick = { showEventDialog = true },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = AzmzInk),
        ) {
            Text("Отметить событие", fontSize = 16.sp)
        }
        Text(
            "Работает без сети и GPS. Для поздних отметок включите «Указать время» — " +
                "такие отметки помечаются «вручную».",
            fontSize = 11.sp, color = AzmzGray,
        )

        Text("Лента событий", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        if (events.isEmpty()) {
            Text("Событий пока нет — отметьте «Выезд» перед началом движения", color = AzmzGray, fontSize = 13.sp)
        } else {
            EventTimeline(events)
        }
    }

    if (showEventDialog) {
        MarkEventDialog(
            trip = t,
            points = points,
            onDismiss = { showEventDialog = false },
        )
    }
}

@Composable
private fun EmptyTripState() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Icons.Filled.LocalShipping, contentDescription = null, tint = AzmzGray, modifier = Modifier.size(56.dp))
        Text("Нет активного рейса", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        Text(
            "Новый рейс придёт от офиса автоматически — индикатор связи покажет доставку",
            color = AzmzGray, fontSize = 13.sp,
        )
    }
}

/** Погрузка ✓ → грузовик «сейчас» → Выгрузка. */
@Composable
private fun TripStepper(points: List<TripPointEntity>, events: List<TripEventEntity>) {
    val stopPoints = points.filter { it.kind != "waypoint" }
    val currentIdx = stopPoints.indexOfFirst { p -> !isPointDone(p, events) }
        .let { if (it < 0) stopPoints.size else it }

    Surface(shape = RoundedCornerShape(16.dp), color = Color.White) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            stopPoints.forEachIndexed { idx, point ->
                if (idx == currentIdx && currentIdx < stopPoints.size) {
                    TruckNow()
                    Connector()
                }
                PointNode(point = point, done = idx < currentIdx)
                if (idx < stopPoints.lastIndex) Connector()
            }
        }
    }
}

private fun isPointDone(point: TripPointEntity, events: List<TripEventEntity>): Boolean {
    val doneType = if (point.kind == "loading") "LOADING_DONE" else "UNLOADING_DONE"
    return events.any { it.tripPointId == point.id && it.type == doneType }
}

@Composable
private fun TruckNow() {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(shape = CircleShape, color = AzmzNavy) {
            Icon(
                Icons.Filled.LocalShipping,
                contentDescription = "сейчас",
                tint = Color.White,
                modifier = Modifier
                    .padding(6.dp)
                    .size(22.dp),
            )
        }
        Text("сейчас", fontSize = 10.sp, color = AzmzGray)
    }
}

@Composable
private fun PointNode(point: TripPointEntity, done: Boolean) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(
            shape = CircleShape,
            color = if (done) AzmzOrange else Color.White,
            border = androidx.compose.foundation.BorderStroke(2.dp, if (done) AzmzOrange else AzmzGray),
        ) {
            if (done) {
                Icon(
                    Icons.Filled.Check, contentDescription = null, tint = Color.White,
                    modifier = Modifier
                        .padding(6.dp)
                        .size(18.dp),
                )
            } else {
                Box(Modifier.size(30.dp))
            }
        }
        Text(
            point.name ?: point.address ?: point.kind,
            fontSize = 11.sp,
            color = if (done) AzmzInk else AzmzGray,
            fontWeight = if (done) FontWeight.SemiBold else FontWeight.Normal,
        )
    }
}

@Composable
private fun Connector() {
    Box(
        Modifier
            .width(22.dp)
            .height(2.dp)
            .background(AzmzGray.copy(alpha = 0.4f)),
    )
}

/** Герой-блок «Сейчас»: этап + таймер (интервал — по открытой стоянке/погрузке). */
@Composable
private fun NowHero(events: List<TripEventEntity>) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1_000)
        }
    }
    val last = events.lastOrNull()
    val stage = TripEventRules.stageLabel(last?.let { TripEventType.byCode(it.type) })
    val openInterval = events.lastOrNull {
        it.intervalClosedAt == null && TripEventType.byCode(it.type)?.opensInterval == true
    }

    Surface(shape = RoundedCornerShape(16.dp), color = AzmzNavy) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Сейчас", color = Color(0xB3FFFFFF), fontSize = 12.sp)
            Text(stage, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            (openInterval?.occurredAt ?: last?.occurredAt)?.let { anchor ->
                Text(
                    "прошло ${TimeFmt.duration(now - anchor)}",
                    color = AzmzOrange, fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

/** Плитки 2×2: Осталось / Прибытие / Проехано / Отдых по тахографу. */
@Composable
private fun TilesGrid(trip: TripEntity, events: List<TripEventEntity>) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(30_000)
        }
    }
    val restMs = events.filter { it.type == "REST_START" }.sumOf { e ->
        (e.intervalClosedAt ?: now) - e.occurredAt
    }.coerceAtLeast(0)

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Tile(
                title = "Осталось",
                value = "${(trip.routeDistanceM ?: 0) / 1000} км",
                sub = "по плану маршрута",
                modifier = Modifier.weight(1f),
            )
            Tile(
                title = "Прибытие",
                value = TimeFmt.t(trip.plannedFinishAt ?: 0L),
                sub = "плановое",
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Tile(
                title = "Проехано",
                value = "—",
                sub = "расчёт по GPS-позиции · этап MVP",
                modifier = Modifier.weight(1f),
            )
            Tile(
                title = "Отдых по тахографу",
                value = if (restMs > 0) TimeFmt.duration(restMs) else "—",
                sub = "сумма стоянок рейса",
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun Tile(title: String, value: String, sub: String, modifier: Modifier = Modifier) {
    Surface(shape = RoundedCornerShape(16.dp), color = Color.White, modifier = modifier) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, color = AzmzGray, fontSize = 12.sp)
            Text(value, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text(sub, color = AzmzGray, fontSize = 10.sp)
        }
    }
}
