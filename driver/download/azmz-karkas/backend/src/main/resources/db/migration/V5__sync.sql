-- ============================================================================
-- V5. Синхронизация: идемпотентность push, личный журнал водителя (канал 1),
-- чат и системные строки.
--
-- Канальная модель (решение сессии «Журнал+гео»):
--  * канал 1 — личный oplog водителя: монотонный seq, дельта по курсору
--    GET /sync/pull?cursor=...; сюда попадают TRIP / TRIP_POINT / TRIP_EVENT /
--    CHAT_MESSAGE / SYSTEM_NOTE;
--  * канал 2 — пометки: не в журнале, тянутся снимком активных по bbox
--    коридора (GET /sync/marks, см. V4).
--
-- Пуши (RuStore Push + FCM) — только «будильник» для ускорения pull,
-- данные ими не передаются.
-- ============================================================================

-- Журнал применённых операций outbox — основа идемпотентности push.
CREATE TABLE sync_operation (
    op_id         uuid PRIMARY KEY,           -- UUID операции из outbox клиента
    driver_id     uuid NOT NULL REFERENCES driver (id),
    device_id     uuid REFERENCES device (id),
    type          text NOT NULL,              -- TRIP_EVENT_CREATE | MARK_PUBLISH | MARK_VOTE | CHAT_SEND
    status        text NOT NULL
                  CHECK (status IN ('APPLIED', 'DUPLICATE', 'REJECTED')),
    reject_reason text,
    received_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sync_operation IS
    'Повторная доставка батча безопасна: op_id уже есть → статус берётся отсюда, применение пропускается. REJECTED финален — клиент прекращает повторы и показывает причину.';

CREATE INDEX idx_sync_operation_driver ON sync_operation (driver_id, received_at DESC);

-- Личный журнал водителя (канал 1).
CREATE TABLE sync_journal (
    seq        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    driver_id  uuid NOT NULL REFERENCES driver (id),
    entity     text NOT NULL,   -- TRIP | TRIP_POINT | TRIP_EVENT | CHAT_MESSAGE | SYSTEM_NOTE
    op         text NOT NULL CHECK (op IN ('UPSERT', 'DELETE')),
    payload    jsonb NOT NULL,  -- снимок строки (camelCase, как в DTO приложения)
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sync_journal IS
    'Курсор клиента = последний полученный seq. Записи создаются в той же транзакции, что и изменение данных, — дельта не теряется. Чистка старых записей — джоба (retention, напр. 30 дней).';

CREATE INDEX idx_sync_journal_cursor ON sync_journal (driver_id, seq);

-- Чат с диспетчером (таб «Офис») --------------------------------------
CREATE TABLE chat_message (
    id             uuid PRIMARY KEY,          -- для сообщений водителя — клиентский UUID
    driver_id      uuid NOT NULL REFERENCES driver (id),
    trip_id        uuid REFERENCES trip (id),
    sender         text NOT NULL CHECK (sender IN ('DRIVER', 'DISPATCHER')),
    body           text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
    created_at     timestamptz NOT NULL,
    applied_op_id  uuid
);

CREATE INDEX idx_chat_message_driver ON chat_message (driver_id, created_at DESC);

-- Системные строки («Заявка Z-1067 изменена офисом») -------------------
CREATE TABLE system_note (
    id         uuid PRIMARY KEY,
    driver_id  uuid NOT NULL REFERENCES driver (id),
    kind       text NOT NULL,          -- TRIP_CHANGED | TRIP_CANCELLED | ...
    body       text NOT NULL,
    ref        jsonb,                  -- ссылки на сущности платформы
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at    timestamptz
);

CREATE INDEX idx_system_note_driver ON system_note (driver_id, created_at DESC);
