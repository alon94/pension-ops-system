-- =============================================================================
-- הרחבת מודל — סיום עבודה וטופס 161 (פרק 8). מורצת אחרי schema.sql.
-- =============================================================================

CREATE TABLE IF NOT EXISTS termination_event (
  termination_event_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id                 uuid NOT NULL REFERENCES customer(customer_id),
  employment_id               uuid REFERENCES employment(employment_id),
  account_id                  uuid REFERENCES account(account_id),
  detected_at                 timestamptz NOT NULL DEFAULT now(),
  detection_source            text NOT NULL CHECK (detection_source IN
                                ('AGENT_AUTOMATED','SALARY_REPORT','CLEARING','MANUAL')),
  confirmed_termination_date  date,
  status                      text NOT NULL DEFAULT 'DETECTED' CHECK (status IN
                                ('DETECTED','CONFIRMED','IN_PROCESS','COMPLETED','DISMISSED')),
  notes                       text,
  ingestion_run_id            uuid REFERENCES ingestion_run(ingestion_run_id)
);

-- §8.5(7) — לא יוצרים אירוע חדש אם יש כבר אירוע פתוח לאותו זוג customer+employment
CREATE UNIQUE INDEX IF NOT EXISTS uq_termination_active
  ON termination_event (customer_id, COALESCE(employment_id::text,''))
  WHERE status NOT IN ('COMPLETED','DISMISSED');

CREATE TABLE IF NOT EXISTS form_161 (
  form_161_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  termination_event_id     uuid NOT NULL REFERENCES termination_event(termination_event_id),
  account_id               uuid NOT NULL REFERENCES account(account_id),
  customer_id              uuid NOT NULL REFERENCES customer(customer_id),
  employer_id              uuid NOT NULL REFERENCES employer(employer_id),
  form_number              text,                                    -- מספר אסמכתא מהמעסיק
  total_severance_amount   numeric(15,2) NOT NULL,
  redemption_amount        numeric(15,2) NOT NULL DEFAULT 0,
  fixation_amount          numeric(15,2) NOT NULL DEFAULT 0,
  tax_withholding_amount   numeric(15,2) NOT NULL DEFAULT 0,
  signed_by_employee_at    date,
  signed_by_employer_at    date,
  signed_by_advisor_at     date,
  document_id              uuid,                                    -- FK ל-DOCUMENT (פרק 4.4) — לא נאכף כאן
  validation_status        text NOT NULL DEFAULT 'DRAFT' CHECK (validation_status IN
                             ('DRAFT','SIGNED','VERIFIED','SUBMITTED','REJECTED')),
  rejected_reason          text,
  ingestion_run_id         uuid REFERENCES ingestion_run(ingestion_run_id),
  -- §8.4 — אילוץ אריתמטי: redemption + fixation = total (סטיית עיגול ₪1)
  CHECK (ABS((redemption_amount + fixation_amount) - total_severance_amount) <= 1),
  CHECK (redemption_amount >= 0 AND fixation_amount >= 0 AND total_severance_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_form_161_termination ON form_161 (termination_event_id);
CREATE INDEX IF NOT EXISTS idx_form_161_account_status ON form_161 (account_id, validation_status);
