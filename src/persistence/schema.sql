-- =============================================================================
-- מודל הנתונים — ליבת קליטה ממסלקה פנסיונית (פרק 4 + הרחבות §4.4)
-- PostgreSQL 15+. אילוצים מרכזיים לפי §4.3.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- ישויות עזר / קודים (REF) -----------------------------------------
CREATE TABLE IF NOT EXISTS ref_manufacturer_type (
  manufacturer_code   text PRIMARY KEY,
  manufacturer_name   text NOT NULL,
  category            text NOT NULL CHECK (category IN
                        ('INSURER','INVESTMENT_HOUSE','OLD_PENSION_FUND','NEW_PENSION_FUND','OTHER')),
  active              boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS ref_product_type (
  product_code        text PRIMARY KEY,
  product_name        text NOT NULL,
  is_annuity          boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS ref_coverage_type (
  coverage_type_code  text PRIMARY KEY,
  coverage_name       text NOT NULL
);

CREATE TABLE IF NOT EXISTS regulation_version (
  parser_version      text PRIMARY KEY,
  effective_from      date NOT NULL,
  notes               text
);

-- ---------- ישויות זהות וגורמים ----------------------------------------------
CREATE TABLE IF NOT EXISTS customer (
  customer_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  israel_id       char(9) NOT NULL UNIQUE,          -- §4.3 בדיקת ספרת ביקורת לפני קליטה
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  birth_date      date,
  gender          char(1),
  city            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  ingestion_run_id uuid
);

CREATE TABLE IF NOT EXISTS customer_name_history (   -- §4.4(1)
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES customer(customer_id),
  prev_first_name text,
  prev_last_name  text,
  changed_at      timestamptz NOT NULL DEFAULT now(),
  reason          text
);

CREATE TABLE IF NOT EXISTS employer (
  employer_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      char(9) NOT NULL UNIQUE,           -- §4.3 בדיקת ספרת ביקורת
  employer_name   text,
  ingestion_run_id uuid
);

CREATE TABLE IF NOT EXISTS manufacturer (
  manufacturer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  official_code   text NOT NULL UNIQUE REFERENCES ref_manufacturer_type(manufacturer_code),
  name            text NOT NULL
);

CREATE TABLE IF NOT EXISTS product (
  product_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer_id uuid NOT NULL REFERENCES manufacturer(manufacturer_id),
  product_code    text NOT NULL,
  product_name    text,
  closure_date    date,
  UNIQUE (manufacturer_id, product_code)
);

-- ---------- חשבון ומצב -------------------------------------------------------
CREATE TABLE IF NOT EXISTS account (
  account_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES customer(customer_id),
  manufacturer_id   uuid NOT NULL REFERENCES manufacturer(manufacturer_id),
  product_id        uuid REFERENCES product(product_id),
  policy_number     text NOT NULL,
  opened_date       date,
  closed_date       date,
  current_status    text NOT NULL DEFAULT 'ACTIVE',
  risk_track_code   text,
  mgmt_fee_deposit  numeric(6,4),
  mgmt_fee_balance  numeric(6,4),
  sub_policy_code   text,
  ingestion_run_id  uuid,
  -- §4.3: policy_number ייחודי לכל יצרן
  UNIQUE (manufacturer_id, policy_number),
  CHECK (closed_date IS NULL OR opened_date IS NULL OR opened_date <= closed_date)
);

CREATE TABLE IF NOT EXISTS account_status_history (   -- SCD2 §4.2
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES account(account_id),
  status          text NOT NULL,
  trigger_event   text,                              -- TRACK_CHANGE / INTERNAL_MIGRATION / PRODUCT_MERGE ...
  effective_from  timestamptz NOT NULL,
  effective_to    timestamptz,
  ingestion_run_id uuid,
  CHECK (effective_to IS NULL OR effective_from <= effective_to)
);

CREATE TABLE IF NOT EXISTS balance_snapshot (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES account(account_id),
  snapshot_date      date NOT NULL,
  severance          numeric(15,2) NOT NULL DEFAULT 0,
  tagmulim_employee  numeric(15,2) NOT NULL DEFAULT 0,
  tagmulim_employer  numeric(15,2) NOT NULL DEFAULT 0,
  allowance          numeric(15,2) NOT NULL DEFAULT 0,
  total              numeric(15,2) NOT NULL,
  source             text,
  ingestion_run_id   uuid
);
-- §4.5 — partitioning חודשי לפי snapshot_date כאשר היקף הנתונים מצדיק זאת.
-- מושאר ללא partition כברירת מחדל (PK צריך לכלול את עמודת הפרטישן בפרודקשן).

-- ---------- תוכן עסקי --------------------------------------------------------
CREATE TABLE IF NOT EXISTS coverage (
  coverage_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES account(account_id),
  coverage_type_code text NOT NULL REFERENCES ref_coverage_type(coverage_type_code),
  insured_amount     numeric(15,2),
  premium            numeric(15,2),
  underwriting_status text,
  coverage_from      date,
  coverage_to        date,
  ingestion_run_id   uuid,
  CHECK (coverage_to IS NULL OR coverage_from IS NULL OR coverage_from <= coverage_to)
);

CREATE TABLE IF NOT EXISTS coverage_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_id   uuid NOT NULL REFERENCES coverage(coverage_id),
  snapshot      jsonb NOT NULL,
  change_reason text,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS beneficiary (
  beneficiary_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES account(account_id),
  beneficiary_name text NOT NULL,
  beneficiary_id_num char(9),
  relation         text,
  share_percent    numeric(6,3) NOT NULL CHECK (share_percent >= 0 AND share_percent <= 100),
  ingestion_run_id uuid
);
-- §4.3: סך אחוזי מוטבים פר חשבון = 100% — נאכף בשכבת התיקוף (cross-block) לפני קידום.

CREATE TABLE IF NOT EXISTS beneficiary_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES account(account_id),
  snapshot    jsonb NOT NULL,
  replaced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employment (
  employment_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES customer(customer_id),
  employer_id     uuid NOT NULL REFERENCES employer(employer_id),
  account_id      uuid REFERENCES account(account_id),
  start_date      date NOT NULL,
  end_date        date,
  employment_type text,
  ingestion_run_id uuid,
  CHECK (end_date IS NULL OR start_date <= end_date)
);

CREATE TABLE IF NOT EXISTS deposit (
  deposit_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES account(account_id),
  employment_id     uuid REFERENCES employment(employment_id),
  deposit_month     char(6) NOT NULL,                 -- YYYYMM
  amount_employee   numeric(15,2) NOT NULL DEFAULT 0,
  amount_employer   numeric(15,2) NOT NULL DEFAULT 0,
  amount_severance  numeric(15,2) NOT NULL DEFAULT 0,
  total             numeric(15,2) NOT NULL,
  reversal_of_deposit_id uuid REFERENCES deposit(deposit_id),  -- §5.5 תנועת קיזוז
  ingestion_run_id  uuid,
  -- §4.3: DEPOSIT לא ניתן לעדכון — תיקון דרך תנועה מקזזת. UNIQUE על account+month.
  UNIQUE (account_id, deposit_month)
);

CREATE TABLE IF NOT EXISTS withdrawal (
  withdrawal_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES account(account_id),
  movement_date     date NOT NULL,
  gross             numeric(15,2) NOT NULL,
  net               numeric(15,2) NOT NULL,
  tax               numeric(15,2) NOT NULL DEFAULT 0,
  reversal_of_withdrawal_id uuid REFERENCES withdrawal(withdrawal_id),
  ingestion_run_id  uuid
);

CREATE TABLE IF NOT EXISTS loan (
  loan_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES account(account_id),
  loan_external_id  text NOT NULL,
  manufacturer_id   uuid NOT NULL REFERENCES manufacturer(manufacturer_id),
  remaining_balance numeric(15,2),
  ingestion_run_id  uuid,
  UNIQUE (manufacturer_id, loan_external_id)
);

-- ---------- בקרה והרשאה ------------------------------------------------------
CREATE TABLE IF NOT EXISTS "authorization" (
  authorization_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      uuid NOT NULL REFERENCES customer(customer_id),
  scope            text NOT NULL,
  signed_at        timestamptz NOT NULL,
  valid_until      timestamptz,
  revoked_at       timestamptz,
  doc_ref          text
);

CREATE TABLE IF NOT EXISTS inquiry (
  inquiry_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id  uuid NOT NULL REFERENCES "authorization"(authorization_id),
  inquiry_number    text NOT NULL UNIQUE,
  requested_at      timestamptz NOT NULL DEFAULT now()
);
-- §4.3: אסור INQUIRY ללא AUTHORIZATION בתוקף (נאכף בשכבת השירות).

CREATE TABLE IF NOT EXISTS ingestion_run (
  ingestion_run_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id        uuid REFERENCES inquiry(inquiry_id),
  source_file_name  text,
  file_hash         char(64) NOT NULL UNIQUE,         -- §4.3 file_hash ייחודי גלובלית
  source            text,
  parser_version    text REFERENCES regulation_version(parser_version),
  raw_file_path     text,
  status            text NOT NULL DEFAULT 'received',  -- received|parsing|validating|promoting|completed|failed|rolled_back|...
  error             text,
  received_at       timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);

CREATE TABLE IF NOT EXISTS ingestion_error (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_run_id uuid NOT NULL REFERENCES ingestion_run(ingestion_run_id),
  code             text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('CRITICAL','ERROR','WARN','INFO')),
  message          text NOT NULL,
  block_code       text,
  record_seq       integer,
  field            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raw_staging (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_run_id uuid NOT NULL REFERENCES ingestion_run(ingestion_run_id),
  block_code       text NOT NULL,
  record_seq       integer NOT NULL,
  fields           jsonb NOT NULL,
  source_offset    text,
  target_entity    text,                              -- §5.5 מתעדכן בקידום
  target_id        uuid,                              -- NULL => רשומה כשלה (§5.4 ERROR)
  UNIQUE (ingestion_run_id, record_seq)
);
-- §4.5 — partitioning ב-raw_staging לפי record_seq כאשר היקף הקבצים מצדיק זאת.

-- ---------- אינדקסים (§4.5) --------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_account_active ON account (customer_id) WHERE current_status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_deposit_account_month ON deposit (account_id, deposit_month);
CREATE INDEX IF NOT EXISTS idx_raw_staging_run ON raw_staging (ingestion_run_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_error_run ON ingestion_error (ingestion_run_id, severity);
CREATE INDEX IF NOT EXISTS idx_raw_staging_fields_gin ON raw_staging USING gin (fields);
