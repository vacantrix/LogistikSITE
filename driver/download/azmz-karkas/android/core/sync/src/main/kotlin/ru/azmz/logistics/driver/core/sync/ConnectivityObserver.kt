package ru.azmz.logistics.driver.core.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.merge
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

    /**
     * Не просто «есть activeNetwork», а есть сеть с доступом в интернет.
     * Плюс раз в 10 с перепроверяем: callback может потеряться после
     * переключения Wi-Fi ↔ мобильные данные или выхода из спящего режима.
     */
    private fun hasInternet(): Boolean {
        val network = connectivityManager.activeNetwork ?: return false
        val caps = connectivityManager.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private val online: Flow<Boolean> = merge(
        callbackFlow {
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { trySend(hasInternet()) }
                override fun onCapabilitiesChanged(
                    network: Network,
                    networkCapabilities: NetworkCapabilities,
                ) {
                    trySend(
                        networkCapabilities.hasCapability(
                            NetworkCapabilities.NET_CAPABILITY_INTERNET,
                        ),
                    )
                }
                override fun onLost(network: Network) { trySend(hasInternet()) }
            }
            connectivityManager.registerDefaultNetworkCallback(callback)
            trySend(hasInternet())
            awaitClose { connectivityManager.unregisterNetworkCallback(callback) }
        },
        flow {
            while (true) {
                emit(hasInternet())
                delay(10_000)
            }
        },
    ).distinctUntilChanged()

    val state: Flow<ConnectionState> =
        combine(online, outboxDao.pendingCount()) { isOnline, queued ->
            ConnectionState.of(isOnline, queued)
        }.distinctUntilChanged()
}
