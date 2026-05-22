-- =============================================================================
-- הרחבת מודל — ישות REJECT (פרק 7, §7.2). מורצת אחרי schema.sql.
-- =============================================================================

CREATE TABLE IF NOT EXISTS reject (
  reject_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reject_type        text NOT NULL CHECK (reject_type IN
                       ('CLEARING','MANUFACTURER','INTERNAL','DISCREPANCY')),
  source_entity      text,                 -- INQUIRY / ACCOUNT / DEPOSIT / BALANCE ...
  source_entity_id   text,
  customer_id        uuid REFERENCES customer(customer_id),
  manufacturer_id    uuid REFERENCES manufacturer(manufacturer_id),
  detected_at        timestamptz NOT NULL DEFAULT now(),
  reject_code        text NOT NULL,        -- R001..R015 או קוד שגיאת קליטה
  reject_reason      text,
  severity           text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status             text NOT NULL DEFAULT 'OPEN' CHECK (status IN
                       ('OPEN','IN_PROGRESS','WAITING_MANUFACTURER','WAITING_CUSTOMER',
                        'ESCALATED','RESOLVED','DISMISSED')),
  assignee           text,                 -- משתמש או אייג'נט (A2/A3/A4/A7)
  sla_due_at         timestamptz,
  resolution_path    jsonb NOT NULL DEFAULT '[]'::jsonb,  -- היסטוריית פעולות
  resolved_at        timestamptz,
  resolved_by        text,
  resolution_summary text,
  ingestion_run_id   uuid REFERENCES ingestion_run(ingestion_run_id)
);

-- ריג'קט פעיל אחד פתוח לכל (קוד + ישות מקור) — מונע כפילויות בקליטות חוזרות
CREATE UNIQUE INDEX IF NOT EXISTS uq_reject_open
  ON reject (reject_code, COALESCE(source_entity,''), COALESCE(source_entity_id,''))
  WHERE status NOT IN ('RESOLVED','DISMISSED');

CREATE INDEX IF NOT EXISTS idx_reject_open_customer
  ON reject (customer_id) WHERE status NOT IN ('RESOLVED','DISMISSED');
CREATE INDEX IF NOT EXISTS idx_reject_sla
  ON reject (sla_due_at) WHERE status NOT IN ('RESOLVED','DISMISSED');
