-- =============================================================================
-- Seed REF data — מינימום הכרחי לקליטת sample.mevne-ahid.xml.
-- מורץ אחרי כל קבצי schema.*.sql.
-- =============================================================================

INSERT INTO ref_manufacturer_type (manufacturer_code, manufacturer_name, category, active) VALUES
  ('MGD', 'מגדל', 'INSURER', true),
  ('HRL', 'הראל', 'INSURER', true),
  ('CLAL', 'כלל', 'INSURER', true),
  ('PHNX', 'הפניקס', 'INSURER', true),
  ('MNRH', 'מנורה מבטחים', 'INSURER', true),
  ('ALTS', 'אלטשולר שחם', 'INVESTMENT_HOUSE', true),
  ('MTDS', 'מיטב דש', 'INVESTMENT_HOUSE', true),
  ('MOR', 'מור', 'INVESTMENT_HOUSE', true),
  ('AMIT', 'עמיתים', 'OLD_PENSION_FUND', true)
ON CONFLICT (manufacturer_code) DO NOTHING;

INSERT INTO ref_coverage_type (coverage_type_code, coverage_name) VALUES
  ('DEATH', 'ביטוח חיים (מוות)'),
  ('DISAB', 'אבדן כושר עבודה (אכ"ע)'),
  ('CRIT',  'מחלות קשות'),
  ('LONG',  'סיעוד')
ON CONFLICT (coverage_type_code) DO NOTHING;

INSERT INTO regulation_version (parser_version, effective_from, notes) VALUES
  ('2024.1', '2024-01-01', 'גרסת מבנה אחיד דמה לפיתוח')
ON CONFLICT (parser_version) DO NOTHING;

-- §10.7 — תבנית ייפוי כוח (לרישום ה-INQUIRY-ים בעתיד)
INSERT INTO authorization_template (version, effective_from, regulator_approved, text_he) VALUES
  ('v1.0', '2024-01-01', true, 'נוסח ייפוי כוח דמה — לצורכי פיתוח בלבד')
ON CONFLICT (version) DO NOTHING;
