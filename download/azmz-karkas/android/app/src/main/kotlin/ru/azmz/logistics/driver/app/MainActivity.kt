package ru.azmz.logistics.driver.app

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Alignment
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.Map
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import ru.azmz.logistics.driver.core.common.ConnectionState
import ru.azmz.logistics.driver.core.sync.AppGraph
import ru.azmz.logistics.driver.core.ui.AzmzBg
import ru.azmz.logistics.driver.core.ui.AzmzNavy
import ru.azmz.logistics.driver.core.ui.AzmzTheme
import ru.azmz.logistics.driver.core.ui.ConnectionBadge
import ru.azmz.logistics.driver.feature.history.HistoryScreen
import ru.azmz.logistics.driver.feature.map.MapScreen
import ru.azmz.logistics.driver.feature.office.OfficeScreen
import ru.azmz.logistics.driver.feature.trip.TripScreen

/**
 * Приложение открывается картой (startDestination = "map").
 * 4 таба: «Карта», «Рейс», «История», «Офис».
 * Индикатор связи — поверх всех экранов (правый верхний угол).
 *
 * Режим экрана — полноэкранный (immersive sticky): системная статус-строка
 * (время, зарядка, оператор) скрыта, приложение занимает весь дисплей.
 * Шторка уведомлений вызывается свайпом от верхнего края — она не теряется,
 * просто не висит над рабочей картой. Экран не гаснет во время рейса.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // --- полноэкранный режим: без статус-бара (время/зарядка) ------------
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val insetsController = WindowInsetsControllerCompat(window, window.decorView)
        insetsController.hide(WindowInsetsCompat.Type.systemBars())
        insetsController.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        // за рулём экран не должен гаснуть на каждой паузе
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        setContent {
            AzmzTheme {
                AppRoot()
            }
        }
    }

    /** Повторно прячем бары после выхода из полноэкранных системных окон. */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            WindowInsetsControllerCompat(window, window.decorView)
                .hide(WindowInsetsCompat.Type.systemBars())
        }
    }
}

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab("map", "Карта", Icons.Filled.Map),
    Tab("trip", "Рейс", Icons.Filled.LocalShipping),
    Tab("history", "История", Icons.Filled.History),
    Tab("office", "Офис", Icons.Filled.Forum),
)

@Composable
private fun AppRoot() {
    val nav = rememberNavController()
    // зелёный «На связи» / оранжевый анимированный «Отправка: N» / красный «Офлайн. В очереди: N»
    val connection by AppGraph.connectivity.state
        .collectAsStateWithLifecycle(initialValue = ConnectionState.Offline(0))

    Scaffold(
        containerColor = AzmzBg,
        bottomBar = { AzmzBottomBar(nav) },
    ) { padding ->
        Box(Modifier.padding(padding)) {
            NavHost(navController = nav, startDestination = "map") {
                composable("map") { MapScreen() }
                composable("trip") { TripScreen() }
                composable("history") { HistoryScreen() }
                composable("office") { OfficeScreen() }
            }
            ConnectionBadge(
                state = connection,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(12.dp),
            )
        }
    }
}

/** Тёмно-синяя нижняя панель #101E2E с белой «пилюлей» — как в вебе. */
@Composable
private fun AzmzBottomBar(nav: NavHostController) {
    val backStack by nav.currentBackStackEntryAsState()
    val current = backStack?.destination?.route

    NavigationBar(containerColor = AzmzNavy) {
        tabs.forEach { tab ->
            val selected = current == tab.route
            NavigationBarItem(
                selected = selected,
                onClick = {
                    nav.navigate(tab.route) {
                        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                },
                icon = { Icon(tab.icon, contentDescription = tab.label) },
                label = { Text(tab.label) },
                colors = NavigationBarItemDefaults.colors(
                    indicatorColor = Color.White,
                    selectedIconColor = AzmzNavy,
                    selectedTextColor = Color.White,
                    unselectedIconColor = Color(0xB3FFFFFF),
                    unselectedTextColor = Color(0xB3FFFFFF),
                ),
            )
        }
    }
}
