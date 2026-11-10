package ru.azmz.logistics.driver.app

import android.app.Application
import ru.azmz.logistics.driver.core.common.ConnectionState
import ru.azmz.logistics.driver.core.sync.AppGraph
import ru.azmz.logistics.driver.core.sync.SyncScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class AzmzApplication : Application() {

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()
        // Room — источник правды; сеть только из воркеров (офлайн-first)
        AppGraph.init(this)
        SyncScheduler.schedulePeriodic(this)
        SyncScheduler.kick(this)

        // связь вернулась — немедленный сброс очереди и дельта
        appScope.launch {
            var wasOffline = true
            AppGraph.connectivity.state.collect { state ->
                if (state !is ConnectionState.Offline && wasOffline) {
                    SyncScheduler.kick(this@AzmzApplication)
                }
                wasOffline = state is ConnectionState.Offline
            }
        }
    }
}
