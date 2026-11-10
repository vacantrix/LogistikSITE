package ru.azmz.logistics.driver.core.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface TripDao {
    @Upsert suspend fun upsert(item: TripEntity)
    @Upsert suspend fun upsertAll(items: List<TripEntity>)
    @Query("DELETE FROM trip WHERE id = :id") suspend fun delete(id: String)

    @Query(
        """SELECT * FROM trip WHERE driverId = :driverId
           AND status IN ('assigned', 'in_progress')
           ORDER BY plannedStartAt LIMIT 1"""
    )
    fun flowActiveTrip(driverId: String): Flow<TripEntity?>

    @Query(
        """SELECT * FROM trip WHERE driverId = :driverId
           AND status IN ('assigned', 'in_progress')
           ORDER BY plannedStartAt LIMIT 1"""
    )
    suspend fun activeTrip(driverId: String): TripEntity?

    @Query(
        """SELECT * FROM trip WHERE driverId = :driverId AND status = 'completed'
           ORDER BY lastEventAt DESC"""
    )
    fun flowHistory(driverId: String): Flow<List<TripEntity>>
}

@Dao
interface TripPointDao {
    @Upsert suspend fun upsertAll(items: List<TripPointEntity>)
    @Query("DELETE FROM trip_point WHERE id = :id") suspend fun delete(id: String)
    @Query("SELECT * FROM trip_point WHERE tripId = :tripId ORDER BY seqNo")
    fun flowForTrip(tripId: String): Flow<List<TripPointEntity>>
}

@Dao
interface TripEventDao {
    @Upsert suspend fun upsert(item: TripEventEntity)
    @Upsert suspend fun upsertAll(items: List<TripEventEntity>)
    @Query("DELETE FROM trip_event WHERE id = :id") suspend fun delete(id: String)

    @Query("SELECT * FROM trip_event WHERE tripId = :tripId ORDER BY occurredAt, createdAt")
    fun flowForTrip(tripId: String): Flow<List<TripEventEntity>>

    /** Открытые интервалы старше :at — те же правила, что на сервере. */
    @Query(
        """SELECT * FROM trip_event WHERE tripId = :tripId
           AND type IN ('ARRIVAL_LOADING', 'REST_START', 'ARRIVAL_UNLOADING')
           AND intervalClosedAt IS NULL AND occurredAt <= :at"""
    )
    suspend fun openOpeners(tripId: String, at: Long): List<TripEventEntity>

    /** Все открытые интервалы — для «Рейс завершён» (закрывает всё безусловно). */
    @Query(
        """SELECT * FROM trip_event WHERE tripId = :tripId
           AND type IN ('ARRIVAL_LOADING', 'REST_START', 'ARRIVAL_UNLOADING')
           AND intervalClosedAt IS NULL"""
    )
    suspend fun openOpenersAll(tripId: String): List<TripEventEntity>

    @Query(
        """UPDATE trip_event SET intervalClosedAt = :closedAt,
           intervalClosedBy = :byId, intervalAutoClosed = :auto WHERE id = :id"""
    )
    suspend fun closeInterval(id: String, closedAt: Long, byId: String, auto: Boolean)
}

@Dao
interface MarkDao {
    @Upsert suspend fun upsert(item: RoadMarkEntity)
    @Upsert suspend fun upsertAll(items: List<RoadMarkEntity>)
    @Query("DELETE FROM road_mark WHERE expiresAt < :now") suspend fun purgeExpired(now: Long)
    @Query("SELECT * FROM road_mark WHERE id = :id") suspend fun byId(id: String): RoadMarkEntity?

    /** Активные в окне (bbox-индекс); Offline-период переживают предзагруженные. */
    @Query(
        """SELECT * FROM road_mark
           WHERE maxLat >= :minLat AND minLat <= :maxLat
             AND maxLon >= :minLon AND minLon <= :maxLon
             AND expiresAt > :now"""
    )
    fun flowActiveInBbox(
        minLat: Double, minLon: Double, maxLat: Double, maxLon: Double, now: Long,
    ): Flow<List<RoadMarkEntity>>
}

@Dao
interface ChatDao {
    @Upsert suspend fun upsertAll(items: List<ChatMessageEntity>)
    @Query("DELETE FROM chat_message WHERE id = :id") suspend fun delete(id: String)
    @Query("SELECT * FROM chat_message WHERE driverId = :driverId ORDER BY createdAt")
    fun flowForDriver(driverId: String): Flow<List<ChatMessageEntity>>
}

@Dao
interface SystemNoteDao {
    @Upsert suspend fun upsertAll(items: List<SystemNoteEntity>)
    @Query("DELETE FROM system_note WHERE id = :id") suspend fun delete(id: String)
    @Query("SELECT * FROM system_note WHERE driverId = :driverId ORDER BY createdAt DESC")
    fun flowForDriver(driverId: String): Flow<List<SystemNoteEntity>>
}

@Dao
interface OutboxDao {
    @Insert suspend fun insert(op: OutboxOpEntity)

    @Query("SELECT * FROM outbox_op WHERE state = 'PENDING' ORDER BY createdAt LIMIT :limit")
    suspend fun pendingBatch(limit: Int): List<OutboxOpEntity>

    @Query("SELECT count(*) FROM outbox_op WHERE state = 'PENDING'")
    fun pendingCount(): Flow<Int>

    @Query("SELECT count(*) FROM outbox_op WHERE state = 'PENDING'")
    suspend fun pendingCountOnce(): Int

    @Query(
        """UPDATE outbox_op SET state = :state, rejectReason = :reason,
           syncedAt = :at, attempts = attempts + 1 WHERE opId = :opId"""
    )
    suspend fun finish(opId: String, state: String, reason: String?, at: Long)

    @Query("UPDATE outbox_op SET attempts = attempts + 1 WHERE opId = :opId")
    suspend fun bumpAttempts(opId: String)

    /** Гигиена: подтверждённые операции старше недели удаляются. */
    @Query("DELETE FROM outbox_op WHERE state != 'PENDING' AND syncedAt < :threshold")
    suspend fun purgeOld(threshold: Long)
}

@Dao
interface SyncStateDao {
    @Query("SELECT value FROM sync_state WHERE channel = :channel")
    suspend fun get(channel: String): String?

    @Upsert suspend fun put(item: SyncStateEntity)
}
