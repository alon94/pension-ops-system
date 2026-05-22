-- =============================================================================
-- AGENT_CONTEXT (§4.x ישות אייג'נטים + §5.6 חישוב מחדש לאחר קליטה).
-- מורצת אחרי schema.sql. שדה embedding מאוחסן כ-float8[] (1536 dims).
-- כאשר pgvector זמין: מומלץ להמיר ל-vector(1536) ולהוסיף אינדקס HNSW.
-- =============================================================================

CREATE TABLE IF NOT EXISTS agent_context (
  customer_id        uuid PRIMARY KEY REFERENCES customer(customer_id),
  summary            jsonb NOT NULL,
  embedding          float8[] NOT NULL,            -- 1536 dims (spec §5.6); HNSW כשpgvector קיים
  risk_flags         text[] NOT NULL DEFAULT '{}', -- §7.7 + §5.6
  opportunity_flags  text[] NOT NULL DEFAULT '{}',
  refreshed_at       timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  summary_hash       char(64)                       -- SHA-256 של summary כדי לזהות שינויים אמיתיים
);

CREATE INDEX IF NOT EXISTS idx_agent_ctx_risk ON agent_context USING gin (risk_flags);
CREATE INDEX IF NOT EXISTS idx_agent_ctx_opp ON agent_context USING gin (opportunity_flags);
CREATE INDEX IF NOT EXISTS idx_agent_ctx_refreshed ON agent_context (refreshed_at DESC);
