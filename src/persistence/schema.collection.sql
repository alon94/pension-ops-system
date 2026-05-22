-- =============================================================================
-- הרחבת מודל — בקרת גבייה ופיצול קופות (פרק 9). מורצת אחרי schema.sql.
-- =============================================================================

-- §9.3(7) — סעיף 14: דגל ב-EMPLOYMENT שמסיר חובת amount_severance>0 בבקרה
ALTER TABLE employment ADD COLUMN IF NOT EXISTS section_14 boolean NOT NULL DEFAULT false;

-- §9.3(5) — חברת שכר שמבצעת את ההפקדה (לא המעסיק עצמו)
ALTER TABLE employer ADD COLUMN IF NOT EXISTS payroll_provider_id uuid REFERENCES employer(employer_id);
-- §9.3(10) — סטטוס מעסיק (לסימון EMPLOYER_INSOLVENT)
ALTER TABLE employer ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE'
  CHECK (status IN ('ACTIVE','INSOLVENT','DISSOLVED'));

CREATE TABLE IF NOT EXISTS collection_discrepancy (
  discrepancy_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id               uuid REFERENCES customer(customer_id),
  employer_id               uuid REFERENCES employer(employer_id),
  employment_id             uuid REFERENCES employment(employment_id),
  reference_month           char(6) NOT NULL,                       -- YYYYMM
  expected_account_id       uuid REFERENCES account(account_id),
  expected_amount_employee  numeric(12,2) NOT NULL DEFAULT 0,
  expected_amount_employer  numeric(12,2) NOT NULL DEFAULT 0,
  expected_amount_severance numeric(12,2) NOT NULL DEFAULT 0,
  reported_by_employer      jsonb,
  reported_by_clearing      jsonb,
  discrepancy_type          text NOT NULL CHECK (discrepancy_type IN
                              ('MISSING','WRONG_FUND','WRONG_AMOUNT','WRONG_SPLIT','LATE','OVER_CAP','EMPLOYER_INSOLVENT')),
  discrepancy_amount        numeric(12,2) NOT NULL DEFAULT 0,
  status                    text NOT NULL DEFAULT 'OPEN' CHECK (status IN
                              ('OPEN','EMPLOYER_NOTIFIED','FUND_NOTIFIED','RESOLVED','DISMISSED')),
  resolution_summary        text,
  detected_at               timestamptz NOT NULL DEFAULT now(),
  resolved_at               timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_discrepancy_open
  ON collection_discrepancy (customer_id, employment_id, reference_month, discrepancy_type)
  WHERE status NOT IN ('RESOLVED','DISMISSED');
CREATE INDEX IF NOT EXISTS idx_discrepancy_employer ON collection_discrepancy (employer_id, reference_month);
CREATE INDEX IF NOT EXISTS idx_discrepancy_open_month ON collection_discrepancy (reference_month) WHERE status NOT IN ('RESOLVED','DISMISSED');
