package ru.azmz.logistics.driver.core.data.db

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [
        TripEntity::class,
        TripPointEntity::class,
        TripEventEntity::class,
        RoadMarkEntity::class,
        ChatMessageEntity::class,
        SystemNoteEntity::class,
        OutboxOpEntity::class,
        SyncStateEntity::class,
    ],
    // v2: у рейса появились точки офисного маршрута (routeWaypointsJson),
    // чтобы навигатор вёл через все точки Яндекс.Карт по порядку.
    version = 2,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun tripDao(): TripDao
    abstract fun tripPointDao(): TripPointDao
    abstract fun tripEventDao(): TripEventDao
    abstract fun markDao(): MarkDao
    abstract fun chatDao(): ChatDao
    abstract fun systemNoteDao(): SystemNoteDao
    abstract fun outboxDao(): OutboxDao
    abstract fun syncStateDao(): SyncStateDao
}
