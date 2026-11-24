-- ============================================================================
-- V2. Рейсы и точки маршрута.
--
-- Интеграционная точка №2: рейс рождается на стороне платформы
-- (заявка/тендер → реестр рейсов). Модуль приложения водителя получает рейс
-- через журнал синхронизации и обогащает его событиями водителя.
-- Автостатусы для реестра офиса (status, last_event_*) пересчитываются
-- при применении каждого события — «не звоним где ты».
-- ============================================================================

CREATE TABLE trip (
    id                 uuid PRIMARY KEY,
    trip_code          text NOT NULL UNIQUE,          -- «Z-xxxx»
    status             text NOT NULL DEFAULT 'assigned',
                       -- assigned | in_progress | completed | cancelled
    driver_id          uuid REFERENCES driver (id),
    vehicle_id         uuid REFERENCES vehicle (id),
    planned_start_at   timestamptz,
    planned_finish_at  timestamptz,
    route_geom         geography (LineString, 4326),  -- геометрия маршрута (OSRM)
    route_steps        jsonb,                         -- манёвры для офлайн-навигации
    route_distance_m   integer,
    route_duration_s   integer,
    last_event_type    text,                          -- «последнее событие» для реестра
    last_event_at      timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_trip_status
        CHECK (status IN ('assigned', 'in_progress', 'completed', 'cancelled'))
);

COMMENT ON TABLE trip IS
    'Рейс. Создаётся офисной частью платформы; водитель получает через журнал и отмечает события.';

COMMENT ON COLUMN trip.route_steps IS
    'Упрощённые шаги OSRM: [{instruction, name, distanceM, durationS, lat, lon}]. Предзагружаются до выезда вместе с тайлами коридора — навигация офлайн.';

COMMENT ON COLUMN trip.last_event_type IS
    'Пересчитывается транзакционно при применении каждого события (см. TripEventApplier).';

CREATE INDEX idx_trip_driver_active ON trip (driver_id)
    WHERE status IN ('assigned', 'in_progress');

-- Точки маршрута -------------------------------------------------------
CREATE TABLE trip_point (
    id                   uuid PRIMARY KEY,
    trip_id              uuid NOT NULL REFERENCES trip (id) ON DELETE CASCADE,
    seq_no               integer NOT NULL,
    kind                 text NOT NULL
                         CHECK (kind IN ('loading', 'unloading', 'waypoint')),
    name                 text,
    address              text,
    geom                 geography (Point, 4326) NOT NULL,
    geofence_radius_m    integer NOT NULL DEFAULT 300
                         CHECK (geofence_radius_m BETWEEN 50 AND 2000),
    planned_arrival_at   timestamptz,
    planned_departure_at timestamptz,
    CONSTRAINT uq_trip_point UNIQUE (trip_id, seq_no)
);

COMMENT ON COLUMN trip_point.geofence_radius_m IS
    'Радиус геозоны для смарт-карточки «Вы у точки выгрузки → Отметить».';

CREATE INDEX idx_trip_point_geom ON trip_point USING GIST (geom);
