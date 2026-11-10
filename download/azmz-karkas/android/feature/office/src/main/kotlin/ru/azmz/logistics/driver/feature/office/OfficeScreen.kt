package ru.azmz.logistics.driver.feature.office

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import java.util.UUID
import kotlinx.coroutines.launch
import ru.azmz.logistics.driver.core.data.db.ChatMessageEntity
import ru.azmz.logistics.driver.core.data.db.SystemNoteEntity
import ru.azmz.logistics.driver.core.sync.AppGraph
import ru.azmz.logistics.driver.core.ui.AzmzBg
import ru.azmz.logistics.driver.core.ui.AzmzGray
import ru.azmz.logistics.driver.core.ui.AzmzNavy
import ru.azmz.logistics.driver.core.ui.AzmzOrange
import ru.azmz.logistics.driver.core.ui.TimeFmt

/**
 * Таб «Офис»: чат с диспетчером + системные строки
 * («Заявка Z-1067 изменена офисом»). Сообщения водителя уходят через outbox.
 */
@Composable
fun OfficeScreen() {
    val scope = rememberCoroutineScope()
    val driverId = AppGraph.driverId.orEmpty()
    val chat by remember(driverId) { AppGraph.db.chatDao().flowForDriver(driverId) }
        .collectAsStateWithLifecycle(initialValue = emptyList())
    val notes by remember(driverId) { AppGraph.db.systemNoteDao().flowForDriver(driverId) }
        .collectAsStateWithLifecycle(initialValue = emptyList())
    var input by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {

        Text("Чат с диспетчером", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)

        // лента сообщений
        Surface(shape = RoundedCornerShape(16.dp), color = Color.White) {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(4.dp),
                contentPadding = PaddingValues(8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(chat, key = { it.id }) { message ->
                    ChatBubble(message)
                }
                if (chat.isEmpty()) {
                    item {
                        Text(
                            "Сообщений пока нет. Напишите диспетчеру — уйдёт при появлении связи.",
                            color = AzmzGray, fontSize = 13.sp,
                            modifier = Modifier.padding(8.dp),
                        )
                    }
                }
            }
        }

        // ввод
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                placeholder = { Text("Сообщение диспетчеру") },
                modifier = Modifier.weight(1f),
                maxLines = 3,
            )
            IconButton(
                onClick = {
                    val body = input.trim()
                    if (body.isEmpty()) return@IconButton
                    scope.launch {
                        AppGraph.outbox.sendChat(
                            ChatMessageEntity(
                                id = UUID.randomUUID().toString(),
                                driverId = driverId,
                                tripId = null,
                                sender = "DRIVER",
                                body = body,
                                createdAt = System.currentTimeMillis(),
                            )
                        )
                    }
                    input = ""
                },
            ) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Отправить", tint = AzmzOrange)
            }
        }

        Text("Системные строки", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        if (notes.isEmpty()) {
            Text("Пока нет изменений от офиса", color = AzmzGray, fontSize = 13.sp)
        }
        notes.take(20).forEach { note ->
            SystemNoteRow(note)
        }
    }
}

@Composable
private fun ChatBubble(message: ChatMessageEntity) {
    val mine = message.sender == "DRIVER"
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Surface(
            shape = RoundedCornerShape(
                topStart = 14.dp, topEnd = 14.dp,
                bottomStart = if (mine) 14.dp else 3.dp,
                bottomEnd = if (mine) 3.dp else 14.dp,
            ),
            color = if (mine) AzmzOrange else AzmzBg,
        ) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                Text(message.body, fontSize = 14.sp, color = Color.White.takeIf { mine } ?: Color(0xFF15202B))
                Text(
                    TimeFmt.t(message.createdAt),
                    fontSize = 10.sp,
                    color = if (mine) Color(0xE6FFFFFF) else AzmzGray,
                )
            }
        }
    }
}

@Composable
private fun SystemNoteRow(note: SystemNoteEntity) {
    Surface(shape = RoundedCornerShape(12.dp), color = Color.White) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Surface(shape = RoundedCornerShape(4.dp), color = AzmzNavy.copy(alpha = 0.1f)) {
                Text(
                    "офис",
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                    color = AzmzNavy, fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
                )
            }
            Text(note.body, fontSize = 14.sp, modifier = Modifier.weight(1f))
            Text(TimeFmt.dt(note.createdAt), fontSize = 11.sp, color = AzmzGray)
        }
    }
}
