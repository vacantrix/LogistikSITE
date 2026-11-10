package ru.azmz.logistics.driver.core.sync

import android.content.Context
import android.content.SharedPreferences
import androidx.room.Room
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import ru.azmz.logistics.driver.core.common.Clock
import ru.azmz.logistics.driver.core.common.SystemClock
import ru.azmz.logistics.driver.core.data.db.AppDatabase
import ru.azmz.logistics.driver.core.data.net.DriverApi
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/**
 * Каркасный DI-контейнер (ручной). Hilt — по желанию на этапе MVP;
 * для каркаса важнее читаемость потока данных: Room → DAO → UI,
 * действия → OutboxRepository → PushWorker.
 *
 * Время жизни — Application. Worker-ы берут зависимости отсюда
 * (AppGraph.init вызывается в AzmzApplication до любого ворка).
 */
object AppGraph {

    /** Эмулятор → localhost бэкенда. На устройстве — адрес стенда. */
    const val DEFAULT_BASE_URL = "http://10.0.2.2:8080/api/driver/v1/"

    lateinit var db: AppDatabase
        private set
    lateinit var api: DriverApi
        private set
    lateinit var json: Json
        private set
    lateinit var outbox: OutboxRepository
        private set
    lateinit var connectivity: ConnectivityObserver
        private set
    lateinit var clock: Clock
        private set

    private lateinit var prefs: SharedPreferences

    val isInitialized: Boolean
        get() = ::db.isInitialized

    /** Устройство живёт в кабине (MDM), id — с первого старта. */
    val deviceId: String
        get() = prefs.getString(KEY_DEVICE, null)
            ?: UUID.randomUUID().toString().also { prefs.edit().putString(KEY_DEVICE, it).apply() }

    /**
     * Водитель текущей смены. Точка входа логина (этап п.2, JWT):
     * экран логина смены присваивает значение. Для демо — подставить driverId
     * из лога DemoDataRunner (см. README).
     */
    var driverId: String?
        get() = prefs.getString(KEY_DRIVER, null)
        set(value) {
            prefs.edit().putString(KEY_DRIVER, value).apply()
            _driverIdOverride.value = value
        }

    private val _driverIdOverride = MutableStateFlow<String?>(null)

    /** Текущий водитель как Flow (для экранов). */
    val driverIdFlow: Flow<String?> = _driverIdOverride

    fun init(context: Context, baseUrl: String = DEFAULT_BASE_URL) {
        val appContext = context.applicationContext
        prefs = appContext.getSharedPreferences("azmz_driver", Context.MODE_PRIVATE)

        clock = SystemClock
        json = Json { ignoreUnknownKeys = true }

        db = Room.databaseBuilder(appContext, AppDatabase::class.java, "azmz-driver.db")
            // Каркас: быстрые итерации по схеме. Перед п.2 — убрать и включить
            // миграции Room; история схем уже коммитится (core/data/schemas)
            .fallbackToDestructiveMigration()
            .build()

        val http = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val request = chain.request().newBuilder()
                    .header("X-Device-Id", deviceId)
                    .header("X-Driver-Id", prefs.getString(KEY_DRIVER, null).orEmpty())
                    .build()
                chain.proceed(request)
            }
            .build()

        api = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(http)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(DriverApi::class.java)

        outbox = OutboxRepository(db, json, clock)
        connectivity = ConnectivityObserver(appContext, db.outboxDao())
        _driverIdOverride.value = prefs.getString(KEY_DRIVER, null)
    }

    /** Текущий водитель для запросов DAO (каркас: может быть null до логина). */
    fun requireDriverId(): String = driverId.orEmpty()

    private const val KEY_DEVICE = "deviceId"
    private const val KEY_DRIVER = "driverId"
}
