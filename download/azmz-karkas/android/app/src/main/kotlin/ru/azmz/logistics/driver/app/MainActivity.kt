package ru.azmz.logistics.driver.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
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
 * 4 таба: «Карта», «Рейс», «История», «Офис». Раздела «Документы» нет —
 * ЭДО ведут логисты, у водителя бумажный комплект.
 * Индикатор связи — поверх всех экранов (правый верхний угол).
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AzmzTheme {
                AppRoot()
            }
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

/** Двухрядная тёмно-синяя шапка веба отражена здесь нижней панелью #101E2E с белой «пилюлей». */
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
