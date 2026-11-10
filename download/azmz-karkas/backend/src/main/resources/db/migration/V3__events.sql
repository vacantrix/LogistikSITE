-- ============================================================================
-- V3. События рейса — слой данных №1 (привязаны ко времени, отмечает водитель).
--
-- Решения сессии:
--  1) идемпотентность: id (UUID) генерирует клиент в outbox; повторная
--     вставка игнорируется (ON CONFLICT DO NOTHING + sync_operation);
--  2) интервальные события = пары «открывашка → закрывашка»; данные о
--     закрытии хранятся на открывашке (interval_closed_*), запрос открытых
--     интервалов тривиален;
--  3) авто-закрытие: новое событие закрывает открытую открывашку с более
--     ранним occurred_at; явная закрывашка → interval_auto_closed = false,
--     иначе true («закрыто автоматически»). «Рейс завершён» (TRIP_DONE)
--     закрывает все открытые интервалы безусловно;
--  4) гибридные правки: ручные отметки (MANUAL_BACKDATED) офис может
--     править (edited_*), геозонные — только корректирующей записью
--     (correction_of);
--  5) источник отметки: смарт-карточка по геозоне (GEOFENCE) или ручная
--     кнопка (MANUAL / MANUAL_BACKDATED с «Указать время») — работает
--     без сети и GPS.
-- ============================================================================

CREATE TABLE trip_event (
    id                     uuid PRIMARY KEY,          -- генерирует клиент (из outbox)
    trip_id                uuid NOT NULL REFERENCES trip (id),
    trip_point_id          uuid REFERENCES trip_point (id),
    driver_id              uuid NOT NULL REFERENCES driver (id),
    vehicle_id             uuid NOT NULL REFERENCES vehicle (id),
    device_id              uuid REFERENCES device (id),
    type                   text NOT NULL,
    occurred_at            timestamptz NOT NULL,      -- когда произошло; может быть в прошлом («Указать время»)
    source                 text NOT NULL
                           CHECK (source IN ('GEOFENCE', 'MANUAL', 'MANUAL_BACKDATED')),
    lat                    double precision,
    lon                    double precision,
    note                   text,
    -- Интервальность (заполняется на «открывашке»):
    interval_closed_at     timestamptz,
    interval_closed_by     uuid REFERENCES trip_event (id),
    interval_auto_closed   boolean,
    -- Корректировки и офисные правки (гибрид):
    correction_of          uuid REFERENCES trip_event (id),
    edited_at              timestamptz,
    edited_by_employee_id  uuid,                      -- сотрудник офиса (справочник платформы)
    -- Служебное:
    created_at             timestamptz NOT NULL DEFAULT now(),  -- когда дошло до сервера
    applied_op_id          uuid,                      -- операция outbox, породившая событие
    CONSTRAINT ck_trip_event_type CHECK (type IN (
        'DEPARTURE',          -- Выезд
        'ARRIVAL_LOADING',    -- Прибытие на погрузку (открывает интервал «Погрузка»)
        'LOADING_DONE',       -- Погрузка завершена
        'REST_START',         -- Начать стоянку по тахографу (открывает «Стоянка»)
        'REST_END',           -- Завершить стоянку
        'ARRIVAL_UNLOADING',  -- Прибытие на выгрузку (открывает «Выгрузка»)
        'UNLOADING_DONE',     -- Выгрузка завершена
        'TRIP_DONE'           -- Рейс завершён (закрывает все открытые интервалы)
    )),
    CONSTRAINT ck_trip_event_self_ref
        CHECK (correction_of IS NULL OR correction_of <> id)
);

COMMENT ON TABLE trip_event IS
    'Слой 1: события рейса. Единственный источник — отметки водителя; офис читает, правит только ручные (гибрид) и пишет корректировки.';

CREATE INDEX idx_trip_event_trip   ON trip_event (trip_id, occurred_at);
CREATE INDEX idx_trip_event_point  ON trip_event (trip_point_id);
CREATE INDEX idx_trip_event_open   ON trip_event (trip_id)
    WHERE interval_closed_at IS NULL
      AND type IN ('ARRIVAL_LOADING', 'REST_START', 'ARRIVAL_UNLOADING');

-- Незакрытые интервалы — индикатор для реестра офиса (разбор диспетчером)
CREATE VIEW v_open_interval AS
SELECT e.id, e.trip_id, t.trip_code, e.type, e.occurred_at, e.driver_id, e.source
FROM trip_event e
JOIN trip t ON t.id = e.trip_id
WHERE e.type IN ('ARRIVAL_LOADING', 'REST_START', 'ARRIVAL_UNLOADING')
  AND e.interval_closed_at IS NULL;
