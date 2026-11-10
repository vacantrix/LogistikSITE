-- ============================================================================
-- V6. Телеметрия позиции — закладка под дашборд директора (фаза 5).
--
-- НЕ офлайн-критична: батчи best-effort, потеря допустима, поэтому идёт мимо
-- outbox (отдельный батчевый эндпоинт, не входит в каркас MVP). Срез парка
-- «в движении / на погрузке / на стоянке по тахографу» в v1 выводится из
-- событий рейса; позиционная телеметрия уточняет его онлайн.
--
-- 152-ФЗ: местоположение — ПДн; хранение только в РФ, retention по политике
-- (дефолт 90 дней, чистка джобой), согласие водителя — в трудовом контракте.
-- ============================================================================

CREATE TABLE position_ping (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    driver_id    uuid REFERENCES driver (id),
    vehicle_id   uuid REFERENCES vehicle (id),
    trip_id      uuid REFERENCES trip (id),
    lat          double precision NOT NULL,
    lon          double precision NOT NULL,
    speed_mps    real,
    recorded_at  timestamptz NOT NULL,          -- время на клиенте
    received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_position_ping_trip     ON position_ping (trip_id, recorded_at);
CREATE INDEX idx_position_ping_received ON position_ping USING BRIN (received_at);
