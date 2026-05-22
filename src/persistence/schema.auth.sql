-- =============================================================================
-- שכבת אימות והרשאות (פרק 13). מורצת אחרי schema.sql.
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
  user_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  -- §13.1 — 4 תפקידי RBAC מהאפיון
  role           text NOT NULL CHECK (role IN ('OPERATOR','MANAGER','AUDITOR','REGULATOR')),
  full_name      text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_users_email_active ON users (email) WHERE active = true;
