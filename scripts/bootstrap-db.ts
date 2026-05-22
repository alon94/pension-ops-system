/**
 * scripts/bootstrap-db.ts — חיווט סכמה מלא + seed אופציונלי על Postgres חיצוני.
 *
 * שלא כמו dev-server.ts (שמרים PG משובץ), הסקריפט הזה מצפה ל-DATABASE_URL חיצוני
 * (לרוב service בשם 'postgres' ב-docker-compose). מופעל מה-entrypoint של ה-API
 * אישית בעלייה ראשונה, או ידנית דרך `docker compose run --rm api npm run db:bootstrap`.
 *
 * משתני סביבה:
 *   DATABASE_URL          (חובה) — connection string ל-Postgres
 *   BOOTSTRAP_SEED        (אופציונלי) — '1' / 'true' → מריץ seed.sql אחרי הסכמות
 *   BOOTSTRAP_DEMO_USERS  (אופציונלי) — '1' / 'true' → יוצר 4 משתמשי דמו אם הטבלה ריקה
 *   BOOTSTRAP_WAIT_SEC    (אופציונלי, default 60) — כמה שניות מחכים ל-PG להיות זמין
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const log = (m: string) => console.log(`[bootstrap] ${m}`);
const warn = (m: string) => console.warn(`[bootstrap] WARN ${m}`);

const SCHEMA_FILES = [
  'schema.sql',
  'schema.rejects.sql',
  'schema.termination.sql',
  'schema.collection.sql',
  'schema.authorization.sql',
  'schema.agent-context.sql',
  'schema.auth.sql',
];

async function waitForPg(url: string, maxSec: number): Promise<Pool> {
  const start = Date.now();
  // עד שה-PG עונה SELECT 1 — מחכים. ב-docker-compose ה-API מתחיל יחד עם DB
  // ויכול לקרות שהוא מוכן רק תוך כמה שניות.
  let last: Error | null = null;
  while ((Date.now() - start) / 1000 < maxSec) {
    const pool = new Pool({ connectionString: url, max: 2 });
    try {
      await pool.query('SELECT 1');
      log(`PG ready after ${Math.round((Date.now() - start) / 1000)}s`);
      return pool;
    } catch (e) {
      last = e as Error;
      await pool.end().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error(`Postgres did not become ready in ${maxSec}s. last error: ${last?.message}`);
}

async function applySchema(pool: Pool, schemaDir: string): Promise<void> {
  for (const f of SCHEMA_FILES) {
    const path = join(schemaDir, f);
    const sql = readFileSync(path, 'utf8');
    await pool.query(sql);
    log(`applied ${f}`);
  }
}

async function maybeSeed(pool: Pool, seedPath: string): Promise<void> {
  if (!['1', 'true', 'yes'].includes((process.env.BOOTSTRAP_SEED ?? '').toLowerCase())) {
    log('BOOTSTRAP_SEED לא דלוק — מדלג על seed.sql');
    return;
  }
  try {
    const sql = readFileSync(seedPath, 'utf8');
    await pool.query(sql);
    log(`applied seed.sql`);
  } catch (e) {
    warn(`seed failed: ${(e as Error).message}`);
  }
}

async function maybeCreateDemoUsers(pool: Pool): Promise<void> {
  if (!['1', 'true', 'yes'].includes((process.env.BOOTSTRAP_DEMO_USERS ?? '').toLowerCase())) {
    log('BOOTSTRAP_DEMO_USERS לא דלוק — מדלג על יצירת משתמשי דמו');
    return;
  }
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM users`);
  if (rows[0].n > 0) {
    log(`users טבלה כבר מאוכלסת (${rows[0].n}) — מדלג`);
    return;
  }
  // ייבוא דחוי — bcryptjs רק במצב seed
  const bcrypt = await import('bcryptjs');
  const DEMO = [
    { email: 'operator@demo.local', password: 'operator123', role: 'OPERATOR', name: 'רפרנט תפעולי' },
    { email: 'manager@demo.local', password: 'manager123', role: 'MANAGER', name: 'מנהל סוכנות' },
    { email: 'auditor@demo.local', password: 'auditor123', role: 'AUDITOR', name: 'בקר רגולציה' },
    { email: 'regulator@demo.local', password: 'regulator123', role: 'REGULATOR', name: 'גורם רגולטורי' },
  ];
  for (const u of DEMO) {
    const hash = await bcrypt.hash(u.password, 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, role, full_name, active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (email) DO NOTHING`,
      [u.email, hash, u.role, u.name],
    );
  }
  log(`נוצרו ${DEMO.length} משתמשי דמו (סיסמה = role + '123')`);
  warn('משתמשי דמו מיועדים ל-test בלבד. אל תפעיל BOOTSTRAP_DEMO_USERS=1 בפרודקשן.');
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL לא מוגדר');

  const waitSec = Number(process.env.BOOTSTRAP_WAIT_SEC ?? 60);
  // השורש של src/persistence תלוי איך התקנו את הקובץ — מהקוד המקור או מ-dist.
  // ב-Docker אנחנו מעתיקים את src/persistence/*.sql ל-/app/sql ולכן נחפש שם קודם.
  const schemaDir = process.env.BOOTSTRAP_SCHEMA_DIR
    ?? (existsSync('/app/sql') ? '/app/sql' : join(__dirname, '..', 'src', 'persistence'));
  const seedPath = process.env.BOOTSTRAP_SEED_PATH
    ?? (existsSync('/app/sql/seed.sql') ? '/app/sql/seed.sql' : join(__dirname, 'seed.sql'));

  log(`schemaDir=${schemaDir}`);
  log(`seedPath=${seedPath}`);

  const pool = await waitForPg(url, waitSec);
  try {
    await applySchema(pool, schemaDir);
    await maybeSeed(pool, seedPath);
    await maybeCreateDemoUsers(pool);
    log('=== BOOTSTRAP DONE ===');
  } finally {
    await pool.end();
  }
}

// existsSync דחוי — נמנע מ-import בראש כדי לא להפעיל IO בטעות
function existsSync(p: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('node:fs').existsSync(p);
  } catch {
    return false;
  }
}

main().catch((e) => {
  console.error('[bootstrap] FATAL', e);
  process.exit(1);
});
