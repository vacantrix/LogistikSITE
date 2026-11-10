-- ============================================================================
-- V4. Пометки «водители для водителей» — слой данных №2 (привязаны к участку
-- дороги, не смешиваются с событиями рейса).
--
-- Решения сессии:
--  1) TTL автора: срок 6 ч / 12 ч / 30 дней течёт с момента применения
--     на сервере и НЕ продлевается; голоса не скрывают пометку — влияют
--     только на порядок показа (confirm_count / outdated_count);
--  2) «Без автора»: в road_mark нет колонки автора; анти-спам — отдельный
--     счётчик публикаций БЕЗ привязки к конкретной пометке (минимизация ПДн,
--     152-ФЗ);
--  3) публикация всем водителям сразу, без модерации офисом;
--  4) пометки НЕ ходят через личный журнал — тянутся снимком активных
--     по bbox коридора маршрута (см. V5 и GET /sync/marks).
-- ============================================================================

CREATE TABLE road_mark (
    id                uuid PRIMARY KEY,               -- генерирует клиент
    category          text NOT NULL CHECK (category IN (
                        'POTHOLE',     -- Яма
                        'ROADWORKS',   -- Ремонт
                        'POLICE',      -- ДПС
                        'ACCIDENT',    -- Авария
                        'CLOSED')),    -- Перекрыто
    geom              geometry (LineString, 4326) NOT NULL,  -- выделенный участок (2+ точки)
    comment           text,
    ttl_hours         integer NOT NULL CHECK (ttl_hours IN (6, 12, 720)),
    confirm_count     integer NOT NULL DEFAULT 0,     -- «+1 подтвердить»
    outdated_count    integer NOT NULL DEFAULT 0,     -- «неактуально»
    created_at        timestamptz NOT NULL DEFAULT now(),  -- применение на сервере
    client_created_at timestamptz,                    -- локальное время водителя (для сортировки)
    expires_at        timestamptz NOT NULL,           -- created_at + ttl; продления нет
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_road_mark_points CHECK (ST_NumPoints(geom) >= 2)
);

COMMENT ON COLUMN road_mark.expires_at IS
    'TTL автора: expires_at = created_at (применение на сервере) + ttl_hours. Продления голосами нет. Локальное время создания хранится отдельно для сортировки.';

CREATE INDEX idx_road_mark_geom    ON road_mark USING GIST (geom);
CREATE INDEX idx_road_mark_expires ON road_mark (expires_at);
CREATE INDEX idx_road_mark_updated ON road_mark (updated_at);

-- Голоса: дедупликация по (пометка, водитель); наружу отдаём только счётчики.
CREATE TABLE mark_vote (
    mark_id         uuid NOT NULL REFERENCES road_mark (id) ON DELETE CASCADE,
    voter_driver_id uuid NOT NULL REFERENCES driver (id),
    vote            smallint NOT NULL CHECK (vote IN (1, -1)),
    applied_op_id   uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (mark_id, voter_driver_id)
);

-- Анти-спам: только факт и время публикации, БЕЗ ссылки на пометку.
-- Узнать автора конкретной пометки из БД нельзя.
CREATE TABLE mark_publication_log (
    driver_id    uuid NOT NULL REFERENCES driver (id),
    published_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (driver_id, published_at)
);

CREATE INDEX idx_mark_pub_log_driver ON mark_publication_log (driver_id, published_at DESC);
