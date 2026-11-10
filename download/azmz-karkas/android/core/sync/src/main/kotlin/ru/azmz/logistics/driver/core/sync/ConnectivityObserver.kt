package ru.azmz.logistics.driver.core.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import ru.azmz.logistics.driver.core.common.ConnectionState
import ru.azmz.logistics.driver.core.data.db.OutboxDao

/**
 * Источник состояния индикатора связи: соединение + глубина очереди outbox.
 * UI получает Flow<ConnectionState> и анимирует переходы.
 */
class ConnectivityObserver(
    context: Context,
    outboxDao: OutboxDao,
) {

    private val connectivityManager =
        context.getSystemService(ConnectivityManager::class.java)

    private val online: Flow<Boolean> = callbackFlow {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { trySend(true) }
            override fun onLost(network: Network) {
                trySend(connectivityManager.activeNetwork != null)
            }
        }
        connectivityManager.registerDefaultNetworkCallback(callback)
        trySend(connectivityManager.activeNetwork != null)
        awaitClose { connectivityManager.unregisterNetworkCallback(callback) }
    }

    val state: Flow<ConnectionState> =
        combine(online, outboxDao.pendingCount()) { isOnline, queued ->
            ConnectionState.of(isOnline, queued)
        }.distinctUntilChanged()
}
