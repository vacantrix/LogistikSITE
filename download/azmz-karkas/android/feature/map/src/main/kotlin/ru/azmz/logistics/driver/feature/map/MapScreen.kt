package ru.azmz.logistics.driver.feature.map

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Create
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import java.util.UUID
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory.circleColor
import org.maplibre.android.style.layers.PropertyFactory.circleOpacity
import org.maplibre.android.style.layers.PropertyFactory.circleRadius
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeColor
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeWidth
import org.maplibre.android.style.layers.PropertyFactory.lineCap
import org.maplibre.android.style.layers.PropertyFactory.lineColor
import org.maplibre.android.style.layers.PropertyFactory.lineDasharray
import org.maplibre.android.style.layers.PropertyFactory.lineJoin
import org.maplibre.android.style.layers.PropertyFactory.lineOpacity
import org.maplibre.android.style.layers.PropertyFactory.lineWidth
import org.maplibre.android.style.sources.GeoJsonSource
import ru.azmz.logistics.driver.core.common.Geo
import ru.azmz.logistics.driver.core.data.db.RoadMarkEntity
import ru.azmz.logistics.driver.core.data.db.TripEntity
import ru.azmz.logistics.driver.core.data.net.RouteStepDto
import ru.azmz.logistics.driver.core.sync.AppGraph
import ru.azmz.logistics.driver.core.ui.AzmzGray
import ru.azmz.logistics.driver.core.ui.AzmzInk
import ru.azmz.logistics.driver.core.ui.AzmzNavy
import ru.azmz.logistics.driver.core.ui.AzmzOrange
import ru.azmz.logistics.driver.core.ui.TimeFmt
import ru.azmz.logistics.driver.core.ui.markCategoryColor
import ru.azmz.logistics.driver.core.ui.markCategoryHex
import ru.azmz.logistics.driver.core.ui.markCategoryTitle

/**
 * Экран «Карта»: настоящая навигация.
 *
 * Подложка — растровые тайлы OpenStreetMap (контракт зеркалит веб-версию;
 * свой tile-сервер PMTiles — этап пилота, README «Тайлы»). Позиция водителя
 * приходит от системного GPS (LocationTracker) и рисуется оранжевой точкой.
 * Маршрут строится от текущей позиции до точки выгрузки через OSRM:
 * основной вариант — оранжевая линия, альтернативные — серые пунктиром.
 * Отклонился больше чем на 150 м — маршрут перестраивается автоматически.
 * 2ГИС убран по решению пилота; слой пробок вернётся с провайдером,
 * у которого есть лицензионные данные о трафике (README, V7).
 */

private const val SOURCE_ROUTE = "route-source"
private const val LAYER_ROUTE = "route-layer"
private const val SOURCE_ALT = "alt-source"
private const val LAYER_ALT = "alt-layer"
private const val SOURCE_LOC = "loc-source"
private const val LAYER_LOC_HALO = "loc-halo"
private const val LAYER_LOC_DOT = "loc-dot"

/** Фолбэк-окно, пока нет активного рейса (каркас). */
private val DEFAULT_BBOX = doubleArrayOf(54.0, 36.0, 57.0, 39.0)

/** Растровый стиль OSM: русские подписи, без ключей и внутренних серверов. */
private fun osmStyleJson(): String = """
{
  "version": 8,
  "sources": {
    "osm": {
      "type": "raster",
      "tiles": ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      "tileSize": 256,
      "maxzoom": 19,
      "attribution": "© OpenStreetMap contributors"
    }
  },
  "layers": [
    {"id": "bg", "type": "background", "paint": {"background-color": "#EDEFEA"}},
    {"id": "osm", "type": "raster", "source": "osm"}
  ]
}
""".trimIndent()

/** Поток создания пометки: 3 шага — начало → конец → панель. */
private sealed interface MarkFlow {
    data object Idle : MarkFlow
    data object AwaitStart : MarkFlow
    data class AwaitEnd(val start: Pair<Double, Double>) : MarkFlow
    data class Panel(val start: Pair<Double, Double>, val end: Pair<Double, Double>) : MarkFlow
}

@Composable
fun MapScreen() {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val driverId = AppGraph.driverId.orEmpty()

    val trip by remember(driverId) { AppGraph.db.tripDao().flowActiveTrip(driverId) }
        .collectAsStateWithLifecycle(initialValue = null)
    val bbox = remember(trip) { trip?.routeBbox() ?: DEFAULT_BBOX }
    val marks by remember(bbox) {
        AppGraph.db.markDao().flowActiveInBbox(bbox[0], bbox[1], bbox[2], bbox[3], System.currentTimeMillis())
    }.collectAsStateWithLifecycle(initialValue = emptyList())

    // --- GPS и навигатор ----------------------------------------------------
    val tracker = remember { LocationTracker(context) }
    val navigator = remember { Navigator(scope, tracker) }
    val fix by tracker.fix.collectAsStateWithLifecycle()
    val nav by navigator.state.collectAsStateWithLifecycle()

    var permissionAsked by remember { mutableStateOf(false) }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        if (grants.values.any { it }) tracker.start()
    }
    LaunchedEffect(Unit) {
        if (!permissionAsked) {
            permissionAsked = true
            if (tracker.hasPermission()) tracker.start() else permissionLauncher.launch(
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                )
            )
        }
        navigator.start()
    }
    DisposableEffect(Unit) { onDispose { navigator.stop(); tracker.stop() } }

    // назначение — конец маршрута рейса (последняя точка LineString)
    LaunchedEffect(trip?.id) {
        val dest = trip?.routeDestination() ?: return@LaunchedEffect
        navigator.setDestination(dest.first, dest.second)
    }

    var mapRef by remember { mutableStateOf<MapLibreMap?>(null) }
    var mapViewRef by remember { mutableStateOf<MapView?>(null) }
    var onMapClick by remember { mutableStateOf<(LatLng) -> Unit>({}) }
    var markFlow by remember { mutableStateOf<MarkFlow>(MarkFlow.Idle) }
    var showMarksList by remember { mutableStateOf(false) }
    var voiceOn by remember { mutableStateOf(true) }
    var follow by remember { mutableStateOf(true) }

    Box(Modifier.fillMaxSize()) {

        // --- карта (MapLibre, растровые тайлы OSM) ---------------------------
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                MapView(ctx).apply {
                    onCreate(null)
                    mapViewRef = this
                    getMapAsync { map ->
                        mapRef = map
                        map.setStyle(Style.Builder().fromJson(osmStyleJson()))
                        map.addOnMapClickListener { point -> onMapClick(point); true }
                        // Атрибуция обязательна: «© OpenStreetMap contributors» — в стиле
                    }
                }
            },
        )
        // владелец lifecycle читаем в композиции, а не внутри эффекта
        val lifecycleOwner = LocalLifecycleOwner.current
        DisposableEffect(lifecycleOwner) {
            val observer = LifecycleEventObserver { _, event ->
                val mv = mapViewRef
                when (event) {
                    Lifecycle.Event.ON_START -> mv?.onStart()
                    Lifecycle.Event.ON_RESUME -> mv?.onResume()
                    Lifecycle.Event.ON_PAUSE -> mv?.onPause()
                    Lifecycle.Event.ON_STOP -> mv?.onStop()
                    Lifecycle.Event.ON_DESTROY -> mv?.onDestroy()
                    else -> Unit
                }
            }
            lifecycleOwner.lifecycle.addObserver(observer)
            onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
        }

        // маршрут: основной + альтернативы (варианты поездки)
        LaunchedEffect(nav, trip?.id) {
            val map = mapRef ?: return@LaunchedEffect
            map.getStyle { style ->
                val active = nav.active
                if (active == null) {
                    (style.getSource(SOURCE_ROUTE) as? GeoJsonSource)?.setGeoJson(EMPTY_FC)
                    (style.getSource(SOURCE_ALT) as? GeoJsonSource)?.setGeoJson(EMPTY_FC)
                    return@getStyle
                }
                val altFc = nav.variants
                    .filterIndexed { i, _ -> i != nav.activeIndex }
                    .joinToString(prefix = """{"type":"FeatureCollection","features":[""",
                        separator = ",", postfix = "]}") {
                        """{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":${coordsJson(it.coords)}}}"""
                    }
                if (style.getSource(SOURCE_ALT) == null) {
                    style.addSource(GeoJsonSource(SOURCE_ALT, altFc))
                    style.addLayer(
                        LineLayer(LAYER_ALT, SOURCE_ALT).withProperties(
                            lineColor("#94A3B8"),
                            lineWidth(5f),
                            lineDasharray(arrayOf(1.5f, 1.2f)),
                            lineOpacity(0.8f),
                            lineCap(Property.LINE_CAP_ROUND),
                            lineJoin(Property.LINE_JOIN_ROUND),
                        )
                    )
                } else {
                    (style.getSource(SOURCE_ALT) as? GeoJsonSource)?.setGeoJson(altFc)
                }
                if (style.getSource(SOURCE_ROUTE) == null) {
                    style.addSource(GeoJsonSource(SOURCE_ROUTE, active.toGeoJson()))
                    style.addLayer(
                        LineLayer(LAYER_ROUTE, SOURCE_ROUTE).withProperties(
                            lineColor("#F97316"),
                            lineWidth(7f),
                            lineCap(Property.LINE_CAP_ROUND),
                            lineJoin(Property.LINE_JOIN_ROUND),
                        )
                    )
                } else {
                    (style.getSource(SOURCE_ROUTE) as? GeoJsonSource)?.setGeoJson(active.toGeoJson())
                }
            }
        }

        // точка местоположения водителя + камера сопровождения
        LaunchedEffect(fix) {
            val map = mapRef ?: return@LaunchedEffect
            val f = fix ?: return@LaunchedEffect
            map.getStyle { style ->
                val fc = """{"type":"Feature","geometry":{"type":"Point","coordinates":[${f.lon},${f.lat}]}}"""
                (style.getSource(SOURCE_LOC) as? GeoJsonSource)?.setGeoJson(fc)
                    ?: run {
                        style.addSource(GeoJsonSource(SOURCE_LOC, fc))
                        style.addLayer(
                            org.maplibre.android.style.layers.CircleLayer(LAYER_LOC_HALO, SOURCE_LOC)
                                .withProperties(
                                    circleColor("#F97316"),
                                    circleRadius(maxOf(16f, f.accuracyM.coerceAtMost(60f) / 4f)),
                                    circleOpacity(0.22f),
                                )
                        )
                        style.addLayer(
                            org.maplibre.android.style.layers.CircleLayer(LAYER_LOC_DOT, SOURCE_LOC)
                                .withProperties(
                                    circleColor("#F97316"),
                                    circleRadius(8f),
                                    circleStrokeColor("#FFFFFF"),
                                    circleStrokeWidth(2.5f),
                                )
                        )
                    }
            }
            if (follow) {
                val bearing = if (f.speedMps > 1.2f) f.bearingDeg else map.cameraPosition.bearing
                map.animateCamera(
                    CameraUpdateFactory.newCameraPosition(
                        CameraPosition.Builder()
                            .target(LatLng(f.lat, f.lon))
                            .bearing(bearing.toDouble())
                            .zoom(15.5)
                            .build(),
                    ),
                    900,
                )
            }
        }

        LaunchedEffect(marks) {
            val map = mapRef ?: return@LaunchedEffect
            map.getStyle { style -> renderMarks(style, marks) }
        }
        LaunchedEffect(markFlow) {
            onMapClick = { point ->
                markFlow = when (val f = markFlow) {
                    MarkFlow.AwaitStart -> MarkFlow.AwaitEnd(point.latitude to point.longitude)
                    is MarkFlow.AwaitEnd -> MarkFlow.Panel(f.start, point.latitude to point.longitude)
                    else -> f
                }
            }
        }

        // --- тулбар: Поиск / Пометки / Офис / Настройки --------------------
        Row(
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            MapToolbarButton(Icons.Filled.Search, "Поиск") { /* экран поиска — этап MVP (п.2) */ }
            MapToolbarButton(Icons.Filled.List, "Пометки") { showMarksList = true }
            MapToolbarButton(Icons.Filled.Forum, "Офис") { /* навигация в таб «Офис» — этап MVP */ }
            MapToolbarButton(Icons.Filled.Settings, "Настройки") { /* настройки — этап MVP */ }
        }

        // --- плашка манёвра / статус навигации -------------------------------
        val navActive = nav.active
        if (trip != null) {
            Column(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(top = 68.dp, start = 12.dp, end = 90.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Surface(shape = RoundedCornerShape(12.dp), shadowElevation = 4.dp) {
                    Column(Modifier.padding(12.dp)) {
                        val navTitle = when {
                            nav.building -> "Строим маршрут…"
                            navActive != null -> "Прибытие в " + TimeFmt.t(
                                System.currentTimeMillis() + (navActive.durationS * 1000).toLong(),
                            )
                            fix == null -> "Ждём сигнал GPS…"
                            else -> "Маршрут недоступен офлайн"
                        }
                        val navSub = if (navActive != null) {
                            val km = navActive.distanceM / 1000
                            val dur = TimeFmt.duration((navActive.durationS * 1000).toLong())
                            "От текущей позиции · " + String.format("%.1f км · %s", km, dur)
                        } else {
                            "Маршрут от вашей геопозиции до точки выгрузки"
                        }
                        Text(navTitle, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                        Text(navSub, color = Color(0xFF64748B), fontSize = 12.sp)
                    }
                }
                if (nav.reroutedAt > 0 && System.currentTimeMillis() - nav.reroutedAt < 4_000) {
                    Surface(shape = RoundedCornerShape(12.dp), color = AzmzOrange, shadowElevation = 4.dp) {
                        Text(
                            "Маршрут перестроен",
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                            color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium,
                        )
                    }
                }
                SpeedLimitPlate(
                    speedKmh = fix?.speedMps?.let { (it * 3.6).roundToInt() },
                    limitKmh = null,
                ) // скорость — от GPS; лимит — слой maxspeed, этап MVP (п.2)
            }
        }

        // --- подсказки создания пометки (шаги 1–2) --------------------------
        when (val f = markFlow) {
            MarkFlow.AwaitStart -> HintBanner(
                text = "Шаг 1 из 3 — коснитесь карты в начале участка",
                onCancel = { markFlow = MarkFlow.Idle },
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 120.dp),
            )
            is MarkFlow.AwaitEnd -> HintBanner(
                text = "Шаг 2 из 3 — коснитесь конца участка",
                onCancel = { markFlow = MarkFlow.Idle },
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 120.dp),
            )
            else -> Unit
        }

        // --- кнопки зум / компас / голос / моя позиция -----------------------
        Column(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .padding(end = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            MapToolbarButton(Icons.Filled.Add, "Приблизить") { mapRef?.animateCamera(CameraUpdateFactory.zoomIn()) }
            MapToolbarButton(Icons.Filled.Remove, "Отдалить") { mapRef?.animateCamera(CameraUpdateFactory.zoomOut()) }
            MapToolbarButton(Icons.Filled.Explore, "Компас") { mapRef?.resetNorth() }
            MapToolbarButton(Icons.Filled.LocationOn, "Моя позиция") {
                follow = true
                if (tracker.hasPermission()) tracker.start() else permissionLauncher.launch(
                    arrayOf(
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION,
                    )
                )
                fix?.let { f ->
                    mapRef?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(f.lat, f.lon), 15.5))
                }
            }
            MapToolbarButton(
                if (voiceOn) Icons.Filled.VolumeUp else Icons.Filled.VolumeOff,
                "Голос",
            ) { voiceOn = !voiceOn } // голосовые манёвры — синтез речи, этап MVP
        }

        // --- оранжевая FAB «Пометка» -----------------------------------------
        if (markFlow == MarkFlow.Idle) {
            ExtendedFloatingActionButton(
                onClick = { markFlow = MarkFlow.AwaitStart },
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 16.dp, bottom = 148.dp),
                containerColor = AzmzOrange,
                contentColor = Color.White,
            ) {
                Icon(Icons.Filled.Create, contentDescription = null)
                Text("Пометка")
            }
        }

        // --- нижняя панель рейса ---------------------------------------------
        trip?.let { t ->
            Surface(
                modifier = Modifier.align(Alignment.BottomCenter),
                shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
                color = Color.White,
                shadowElevation = 8.dp,
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Surface(shape = RoundedCornerShape(50), color = AzmzNavy) {
                            Text(
                                t.tripCode,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
                                color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                            )
                        }
                        LinearProgressIndicator(
                            progress = {
                                val a = nav.active
                                if (a == null) 0f
                                else {
                                    val total = t.routeDistanceM?.toDouble() ?: a.distanceM
                                    (1.0 - a.distanceM / total).toFloat().coerceIn(0f, 1f)
                                }
                            },
                            modifier = Modifier.weight(1f),
                            color = AzmzOrange,
                        )
                        TextButton(onClick = { /* список манёвров «По шагам» — этап MVP */ }) {
                            Text("По шагам", color = AzmzOrange, fontSize = 13.sp)
                        }
                    }
                    Text(
                        if (navActive != null) {
                            "${(navActive.distanceM / 1000).toInt()} км · " +
                                "Прибытие ${TimeFmt.t(System.currentTimeMillis() + (navActive.durationS * 1000).toLong())} · " +
                                TimeFmt.duration((navActive.durationS * 1000).toLong())
                        } else {
                            "${(t.routeDistanceM ?: 0) / 1000} км · " +
                                "Прибытие ${TimeFmt.t(t.plannedFinishAt ?: 0L)} · " +
                                TimeFmt.duration((t.routeDurationS ?: 0L) * 1000)
                        },
                        fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }

        // --- смарт-карточка по геозоне ---------------------------------------
        // «Вы у точки → Отметить»: триггер — Geo.distanceM(позиция, точка)
        // <= geofenceRadiusM; событие создаётся с source = GEOFENCE
        // через AppGraph.outbox.markTripEvent(...). Реализация в п.2.
        SmartEventCardPlaceholder()
    }

    // --- панель публикации пометки (шаг 3) ---------------------------------
    val flow = markFlow
    if (flow is MarkFlow.Panel) {
        MarkPublishPanel(
            start = flow.start,
            end = flow.end,
            onPublish = { category, ttlHours, comment ->
                val now = System.currentTimeMillis()
                val entity = RoadMarkEntity(
                    id = UUID.randomUUID().toString(),
                    category = category,
                    polylineGeoJson = Geo.lineStringJson(listOf(flow.start, flow.end)),
                    comment = comment.ifBlank { null },
                    ttlHours = ttlHours,
                    createdAt = now,
                    expiresAt = now + ttlHours * 3_600_000L, // TTL автора, сервер пересчитает
                    minLat = minOf(flow.start.first, flow.end.first),
                    minLon = minOf(flow.start.second, flow.end.second),
                    maxLat = maxOf(flow.start.first, flow.end.first),
                    maxLon = maxOf(flow.start.second, flow.end.second),
                    isMine = true,
                )
                scope.launch { AppGraph.outbox.publishMark(entity) }
                markFlow = MarkFlow.Idle
            },
            onCancel = { markFlow = MarkFlow.Idle },
        )
    }

    if (showMarksList) {
        MarksListSheet(marks = marks, onDismiss = { showMarksList = false })
    }
}

/** Конец маршрута рейса = последняя точка LineString (lat, lon). */
private fun TripEntity.routeDestination(): Pair<Double, Double>? {
    val geo = routeGeoJson ?: return null
    return runCatching {
        val obj = Json.parseToJsonElement(geo).jsonObject
        val coords = obj["coordinates"]?.jsonArray ?: return@runCatching null
        val last = coords.lastOrNull()?.jsonArray ?: return@runCatching null
        val lon = last[0].jsonPrimitive.double
        val lat = last[1].jsonPrimitive.double
        lat to lon
    }.getOrNull()
}

private fun coordsJson(coords: List<List<Double>>): String =
    coords.joinToString(prefix = "[", separator = ",", postfix = "]") { c -> "[${c[0]},${c[1]}]" }

private fun OsrmRouting.Variant.toGeoJson(): String =
    """{"type":"LineString","coordinates":${coordsJson(coords)}}"""

private const val EMPTY_FC = """{"type":"FeatureCollection","features":[]}"""

/** Цветные участки поверх дорог: один слой на категорию. */
private fun renderMarks(style: Style, marks: List<RoadMarkEntity>) {
    marks.groupBy { it.category }.forEach { (category, list) ->
        val sourceId = "marks-$category"
        val featureCollection = list.joinToString(
            prefix = """{"type":"FeatureCollection","features":[""",
            separator = ",",
            postfix = "]}",
        ) { """{"type":"Feature","geometry":${it.polylineGeoJson},"properties":{}}""" }

        val existing = style.getSource(sourceId) as? GeoJsonSource
        if (existing == null) {
            style.addSource(GeoJsonSource(sourceId, featureCollection))
            style.addLayer(
                LineLayer("layer-$sourceId", sourceId).withProperties(
                    lineColor(markCategoryHex(category)),
                    lineWidth(9f),
                    lineCap(Property.LINE_CAP_ROUND),
                )
            )
        } else {
            runCatching { existing.setGeoJson(featureCollection) }
        }
    }
}

@Composable
private fun MapToolbarButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Surface(shape = CircleShape, color = Color.White, shadowElevation = 3.dp) {
        IconButton(onClick = onClick) {
            Icon(icon, contentDescription = label, tint = AzmzNavy)
        }
    }
}

@Composable
private fun HintBanner(text: String, onCancel: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        color = AzmzOrange,
        shape = RoundedCornerShape(12.dp),
        shadowElevation = 4.dp,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(text, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            IconButton(onClick = onCancel) {
                Icon(Icons.Filled.Close, contentDescription = "Отмена", tint = Color.White)
            }
        }
    }
}

@Composable
private fun SpeedLimitPlate(speedKmh: Int?, limitKmh: Int?) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Surface(shape = RoundedCornerShape(10.dp), color = Color.White, shadowElevation = 3.dp) {
            Text(
                if (speedKmh != null) "$speedKmh км/ч" else "— км/ч",
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                fontSize = 16.sp, fontWeight = FontWeight.Bold,
            )
        }
        if (limitKmh != null) {
            Surface(shape = CircleShape, color = Color(0xFFEF4444)) {
                Text(
                    "$limitKmh",
                    modifier = Modifier.padding(10.dp),
                    color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Black,
                )
            }
        }
    }
}

/** Каркас: смарт-карточка появляется по геозоне (позиция — этап MVP). */
@Composable
private fun SmartEventCardPlaceholder() {
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun MarkPublishPanel(
    start: Pair<Double, Double>,
    end: Pair<Double, Double>,
    onPublish: (category: String, ttlHours: Int, comment: String) -> Unit,
    onCancel: () -> Unit,
) {
    var category by remember { mutableStateOf("POTHOLE") }
    var ttlHours by remember { mutableStateOf(6) }
    var comment by remember { mutableStateOf("") }

    ModalBottomSheet(onDismissRequest = onCancel) {
        Column(
            Modifier
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .verticalScroll(androidx.compose.foundation.rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Пометка «водители для водителей»", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            Text(
                "Участок: %.4f, %.4f → %.4f, %.4f".format(start.first, start.second, end.first, end.second),
                fontSize = 12.sp, color = AzmzGray,
            )
            Text("Категория", fontSize = 13.sp, color = AzmzGray)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("POTHOLE", "ROADWORKS", "POLICE", "ACCIDENT", "CLOSED").forEach { c ->
                    FilterChip(
                        selected = category == c,
                        onClick = { category = c },
                        label = { Text(markCategoryTitle(c)) },
                    )
                }
            }
            Text("Сколько проживёт", fontSize = 13.sp, color = AzmzGray)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(6 to "6 ч", 12 to "12 ч", 720 to "30 дней").forEach { (hours, label) ->
                    FilterChip(
                        selected = ttlHours == hours,
                        onClick = { ttlHours = hours },
                        label = { Text(label) },
                    )
                }
            }
            OutlinedTextField(
                value = comment,
                onValueChange = { comment = it },
                label = { Text("Комментарий (необязательно)") },
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = { onPublish(category, ttlHours, comment) },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = AzmzInk),
            ) {
                Text("Опубликовать всем водителям")
            }
            Text(
                "Срок жизни не продлевается: голоса влияют только на порядок показа. " +
                    "Автор другим водителям не виден.",
                fontSize = 11.sp, color = AzmzGray,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MarksListSheet(marks: List<RoadMarkEntity>, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Пометки на маршруте", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            if (marks.isEmpty()) {
                Text("Пока пусто — создайте первую кнопкой «Пометка»", color = AzmzGray)
            }
            marks.take(30).forEach { mark ->
                Surface(shape = RoundedCornerShape(12.dp), color = Color.White) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(12.dp)
                                .background(markCategoryColor(mark.category), CircleShape),
                        )
                        Column(Modifier.weight(1f).padding(start = 10.dp)) {
                            Text(markCategoryTitle(mark.category), fontWeight = FontWeight.SemiBold)
                            Text(
                                "+${mark.confirmCount} / неактуально: ${mark.outdatedCount} · до ${TimeFmt.dt(mark.expiresAt)}",
                                fontSize = 12.sp, color = AzmzGray,
                            )
                        }
                        IconButton(onClick = { scope.launch { AppGraph.outbox.voteMark(mark.id, 1) } }) {
                            Icon(Icons.Filled.ThumbUp, contentDescription = "Подтвердить", tint = AzmzNavy)
                        }
                        IconButton(onClick = { scope.launch { AppGraph.outbox.voteMark(mark.id, -1) } }) {
                            Icon(Icons.Filled.ThumbDown, contentDescription = "Неактуально", tint = AzmzGray)
                        }
                    }
                }
            }
        }
    }
}

private fun TripEntity.routeBbox(): DoubleArray? {
    val minLat = routeMinLat ?: return null
    val minLon = routeMinLon ?: return null
    val maxLat = routeMaxLat ?: return null
    val maxLon = routeMaxLon ?: return null
    val pad = 0.3 // запас вокруг коридора
    return doubleArrayOf(minLat - pad, minLon - pad, maxLat + pad, maxLon + pad)
}
