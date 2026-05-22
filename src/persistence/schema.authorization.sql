-- =============================================================================
-- הרחבת מודל — ייפוי כוח, תבניות, פרטיות (פרק 10). מורצת אחרי schema.sql.
-- =============================================================================

-- §10.5(4-6) — שדות שמשפיעים על תוקף ייפוי כוח
ALTER TABLE customer ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE'
  CHECK (status IN ('ACTIVE','DECEASED','MINOR','LIMITED','UNDER_GUARDIANSHIP'));
ALTER TABLE customer ADD COLUMN IF NOT EXISTS legal_capacity_status text NOT NULL DEFAULT 'FULL'
  CHECK (legal_capacity_status IN ('FULL','MINOR','LIMITED','UNDER_GUARDIANSHIP'));
ALTER TABLE customer ADD COLUMN IF NOT EXISTS residence_country char(2) DEFAULT 'IL';

-- §10.7 — תבנית ייפוי כוח (נוסח רגולטורי)
CREATE TABLE IF NOT EXISTS authorization_template (
  template_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version              text NOT NULL,
  effective_from       date NOT NULL,
  effective_to         date,
  text_he              text,
  text_en              text,
  regulator_approved   boolean NOT NULL DEFAULT false,
  approval_reference   text,
  UNIQUE (version)
);

-- §10.2 — הרחבת AUTHORIZATION עם כל השדות (הטבלה כבר קיימת מ-schema.sql)
ALTER TABLE "authorization" ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES authorization_template(template_id);
ALTER TABLE "authorization" ADD COLUMN IF NOT EXISTS scope_details_json jsonb;
ALTER TABLE "authorization" ADD COLUMN IF NOT EXISTS signature_hash char(64);
ALTER TABLE "authorization" ADD COLUMN IF NOT EXISTS channel text CHECK (channel IN ('digital','paper','oral_recorded'));
ALTER TABLE "authorization" ADD COLUMN IF NOT EXISTS digital_signature_provider text;
ALTER TABLE "authorization" ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','expired','revoked','superseded','disputed'));
ALTER TABLE "authorization" ADD COLUMN IF NOT EXISTS revoked_reason text;
ALTER TABLE "authorization" ADD COLUMN IF NOT EXISTS revoked_by text
  CHECK (revoked_by IS NULL OR revoked_by IN ('customer','agent','system_auto'));
ALTER TABLE "authorization" ADD COLUMN IF NOT EXISTS valid_from date;
ALTER TABLE "authorization" ADD COLUMN IF NOT EXISTS document_id uuid;

-- §10.5(1) — לכל לקוח לא יותר מ-AUTH אחד פעיל לאותו scope
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_auth
  ON "authorization" (customer_id, scope)
  WHERE status = 'active';

-- AUDIT_LOG (§13.x) — נרשם גם בפרק 11
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id     bigserial PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor        text NOT NULL,          -- user / agent / system
  action       text NOT NULL,          -- READ / WRITE / EXPORT / REVOKE ...
  entity       text,                   -- customer / authorization / reject ...
  entity_id    text,
  meta         jsonb
);
CREATE INDEX IF NOT EXISTS idx_audit_actor_time ON audit_log (actor, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity, entity_id);
