package ru.azmz.logistics.driver.feature.trip

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.launch
import ru.azmz.logistics.driver.core.common.TripEventType
import ru.azmz.logistics.driver.core.data.db.TripEntity
import ru.azmz.logistics.driver.core.data.db.TripEventEntity
import ru.azmz.logistics.driver.core.data.db.TripPointEntity
import ru.azmz.logistics.driver.core.sync.AppGraph
import ru.azmz.logistics.driver.core.ui.AzmzInk
import ru.azmz.logistics.driver.core.ui.AzmzOrange
import ru.azmz.logistics.driver.core.ui.AzmzRed

/**
 * Ручная кнопка «Отметить событие» — работает всегда: без сети и GPS.
 * «Указать время» — для поздних отметок; такие события уходят с
 * source = MANUAL_BACKDATED и помечаются «вручную» (см. EventTimeline).
 */
@Composable
fun MarkEventDialog(
    trip: TripEntity,
    points: List<TripPointEntity>,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var selected by remember { mutableStateOf<TripEventType?>(null) }
    var pointId by remember { mutableStateOf<String?>(null) }
    var backdated by remember { mutableStateOf(false) }
    var timeText by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    val needsPoint = selected?.let { it.needsPoint() } ?: false

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Отметить событие") },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // события рейса — 8 типов из брифа
                TripEventType.entries.forEach { type ->
                    FilterChip(
                        selected = selected == type,
                        onClick = {
                            selected = type
                            pointId = defaultPointFor(type, points)?.id
                        },
                        label = { Text(type.title) },
                    )
                }

                if (needsPoint && points.isNotEmpty()) {
                    Text("Точка маршрута", fontSize = 12.sp, color = AzmzInk.copy(alpha = 0.6f))
                    points.forEach { p ->
                        FilterChip(
                            selected = pointId == p.id,
                            onClick = { pointId = p.id },
                            label = { Text(p.name ?: p.address ?: p.kind) },
                        )
                    }
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(checked = backdated, onCheckedChange = { backdated = it })
                    Text("Указать время (для поздних отметок)", fontSize = 13.sp)
                }
                if (backdated) {
                    OutlinedTextField(
                        value = timeText,
                        onValueChange = { timeText = it },
                        label = { Text("дд.мм.гггг чч:мм") },
                        isError = error != null,
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it },
                    label = { Text("Комментарий (необязательно)") },
                    modifier = Modifier.fillMaxWidth(),
                )
                error?.let { Text(it, color = AzmzRed, fontSize = 12.sp) }
                Text(
                    "Отметка сохраняется локально и уходит в очередь — индикатор связи покажет отправку.",
                    fontSize = 11.sp, color = AzmzInk.copy(alpha = 0.5f),
                )
            }
        },
        confirmButton = {
            Button(
                colors = ButtonDefaults.buttonColors(containerColor = AzmzInk),
                onClick = {
                    val type = selected
                    if (type == null) {
                        error = "Выберите тип события"
                        return@Button
                    }
                    val occurredAt = if (backdated) {
                        parseTime(timeText) ?: run {
                            error = "Формат времени: дд.мм.гггг чч:мм"
                            return@Button
                        }
                    } else {
                        System.currentTimeMillis()
                    }
                    val event = TripEventEntity(
                        id = UUID.randomUUID().toString(),
                        tripId = trip.id,
                        tripPointId = pointId,
                        driverId = AppGraph.driverId.orEmpty(),
                        vehicleId = trip.vehicleId.orEmpty(),
                        deviceId = AppGraph.deviceId,
                        type = type.code,
                        occurredAt = occurredAt,
                        source = if (backdated) "MANUAL_BACKDATED" else "MANUAL",
                        note = note.ifBlank { null },
                        createdAt = System.currentTimeMillis(),
                    )
                    scope.launch { AppGraph.outbox.markTripEvent(event) }
                    onDismiss()
                },
            ) { Text("Отметить") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Отмена", color = AzmzOrange) }
        },
    )
}

private fun TripEventType.needsPoint(): Boolean = this in listOf(
    TripEventType.ARRIVAL_LOADING,
    TripEventType.LOADING_DONE,
    TripEventType.ARRIVAL_UNLOADING,
    TripEventType.UNLOADING_DONE,
)

private fun defaultPointFor(type: TripEventType, points: List<TripPointEntity>): TripPointEntity? {
    val wantedKind = when (type) {
        TripEventType.ARRIVAL_LOADING, TripEventType.LOADING_DONE -> "loading"
        TripEventType.ARRIVAL_UNLOADING, TripEventType.UNLOADING_DONE -> "unloading"
        else -> return null
    }
    return points.firstOrNull { it.kind == wantedKind }
}

private fun parseTime(text: String): Long? = runCatching {
    val fmt = SimpleDateFormat("dd.MM.yyyy HH:mm", Locale("ru"))
    fmt.isLenient = false
    fmt.parse(text.trim())?.time
}.getOrNull()
