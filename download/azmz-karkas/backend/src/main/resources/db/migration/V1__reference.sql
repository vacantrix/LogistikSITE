-- ============================================================================
-- АЗМЗ Логистика · Каркас приложения водителя (п.1 плана работ)
-- V1. Справочники: водители, машины, устройства, смены.
--
-- Решение сессии «Привязка: на машине»: планшет закреплён за машиной (MDM),
-- водитель логинится в смену; каждое событие хранит driver_id + vehicle_id
-- + device_id. Оба идентификатора в схеме обязательны.
--
-- Интеграционная точка №1: если в платформе уже есть контур персонала
-- и автопарка — вести эти таблицы репликацией или ссылаться на существующие.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- Водители -------------------------------------------------------------
CREATE TABLE driver (
    id          uuid PRIMARY KEY,
    full_name   text NOT NULL,
    phone       text,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE driver IS
    'Водители. Источник — контур персонала платформы (интеграционная точка).';

CREATE INDEX idx_driver_active ON driver (is_active) WHERE is_active;

-- Машины ---------------------------------------------------------------
CREATE TABLE vehicle (
    id          uuid PRIMARY KEY,
    plate       text NOT NULL UNIQUE,        -- госномер
    model       text,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Устройства -----------------------------------------------------------
CREATE TABLE device (
    id                uuid PRIMARY KEY,      -- генерируется приложением при первом старте
    vehicle_id        uuid NOT NULL REFERENCES vehicle (id),
    mdm_enrollment_id text,                  -- идентификатор в Headwind MDM
    app_version       text,
    last_seen_at      timestamptz,
    is_active         boolean NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE device IS
    'Планшет живёт в кабине, привязан к машине. Раздача и контроль — Headwind MDM.';

-- Смены: кто за рулём в момент события --------------------------------
CREATE TABLE driver_shift (
    id         uuid PRIMARY KEY,
    driver_id  uuid NOT NULL REFERENCES driver (id),
    device_id  uuid NOT NULL REFERENCES device (id),
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at   timestamptz,
    CONSTRAINT ck_driver_shift_interval CHECK (ended_at IS NULL OR ended_at > started_at)
);

CREATE INDEX idx_driver_shift_driver ON driver_shift (driver_id, started_at DESC);
CREATE INDEX idx_driver_shift_open   ON driver_shift (device_id) WHERE ended_at IS NULL;
