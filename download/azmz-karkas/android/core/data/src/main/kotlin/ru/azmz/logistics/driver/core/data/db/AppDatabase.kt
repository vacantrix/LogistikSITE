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
    version = 1,
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
