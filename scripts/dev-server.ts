/**
 * scripts/dev-server.ts — שרת פיתוח שמרים PG משובץ + NestJS API
 * עם נתוני דמו, ונשאר חי עד SIGINT/SIGTERM. משמש בפיתוח UI.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { RejectService } from '../src/rejects/reject.service';
import { REPOSITORY, Repository } from '../src/persistence/repository.port';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { CollectionService } from '../src/collection/collection.service';
import { AuthService } from '../src/auth/auth.service';
import { UserRole } from '../src/auth/auth.types';
import { IngestionService } from '../src/ingestion/ingestion.service';

const log = new Logger('dev-server');

const PG_PORT = 55432;        // קבוע בפיתוח כדי שגם הפעלות עוקבות יעבדו זהה
const API_PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = join(process.cwd(), '.dev-pg-data');
const VAULT_DIR = join(process.cwd(), '.dev-vault');
const INBOX_DIR = join(process.cwd(), '.dev-inbox');
const ARCHIVE_DIR = join(process.cwd(), '.dev-inbox-done');

async function applySql(pool: Pool, path: string): Promise<void> {
  const sql = readFileSync(path, 'utf8');
  await pool.query(sql);
  log.log(`applied ${path.split('/').pop()}`);
}

async function ingestSample(ingestion: IngestionService): Promise<void> {
  // קליטה ישירה דרך השירות — עוקפת את ה-AuthGuard (זה seed פיתוח, לא HTTP).
  const xmlPath = join(__dirname, '..', 'test', 'fixtures', 'sample.mevne-ahid.xml');
  const content = readFileSync(xmlPath);
  const out = await ingestion.ingest({ sourceFileName: 'sample.mevne-ahid.xml', content, source: 'DEV' });
  log.log(`ingested sample: ${out.status}`);
}

async function seedDemoRejects(repo: Repository, rejects: RejectService): Promise<void> {
  // הוספת ריג'קטים לדמו הדשבורד — הקליטה היא נקייה, כאן מוסיפים מגוון
  const customerId = await repo.soleCustomerOfRun('').catch(() => null);
  const allCustomers = await repo.searchCustomers('', 1);
  const cid = allCustomers[0]?.customerId;
  if (!cid) {
    log.warn('אין לקוח בבסיס — מדלג על seed דמו של ריג\'קטים');
    return;
  }
  await rejects.open({
    rejectType: 'MANUFACTURER', rejectCode: 'R001', severity: 'HIGH',
    sourceEntity: 'ACCOUNT', sourceEntityId: 'POL-100',
    customerId: cid, rejectReason: 'דמו — פוליסה לא נמצאת אצל היצרן', assignee: 'A3',
  });
  await rejects.open({
    rejectType: 'INTERNAL', rejectCode: 'R011', severity: 'MEDIUM',
    sourceEntity: 'BALANCE', sourceEntityId: 'seq:5',
    customerId: cid, rejectReason: 'דמו — חוסר התאמה ביתרה', assignee: 'A2',
  });
  await rejects.open({
    rejectType: 'DISCREPANCY', rejectCode: 'R010', severity: 'HIGH',
    sourceEntity: 'DEPOSIT', sourceEntityId: 'POL-100',
    customerId: cid, rejectReason: 'דמו — פער שכר↔הפקדה (חודש 04/2024)', assignee: 'A7',
  });
  log.log('seeded 3 demo rejects');
}

async function seedDemoAuth(repo: Repository, auth: AuthorizationService, pool: Pool): Promise<void> {
  const customers = await repo.searchCustomers('', 1);
  const cid = customers[0]?.customerId;
  if (!cid) return;
  const existing = await pool.query(`SELECT count(*)::int AS n FROM "authorization" WHERE customer_id = $1`, [cid]);
  if (existing.rows[0].n > 0) return;

  const now = new Date();
  const inYears = (years: number) => new Date(now.getTime() + years * 365 * 86400_000).toISOString().slice(0, 10);
  const inDays = (days: number) => new Date(now.getTime() + days * 86400_000).toISOString().slice(0, 10);

  await auth.create({
    customerId: cid, scope: 'full', signedAt: now.toISOString(),
    validFrom: now.toISOString().slice(0, 10), validTo: inYears(2),
    channel: 'digital', digitalSignatureProvider: 'DigitalSign',
  });
  await auth.create({
    customerId: cid, scope: 'specific_products',
    scopeDetailsJson: { products: ['PENS-MAKIF'] },
    signedAt: new Date(now.getTime() - 700 * 86400_000).toISOString(),
    validFrom: new Date(now.getTime() - 700 * 86400_000).toISOString().slice(0, 10),
    validTo: inDays(15), // expiring soon
    channel: 'paper',
  });
  log.log('seeded 2 demo authorizations (active + expiring-soon)');
}

async function seedDemoCollection(pool: Pool): Promise<void> {
  const existing = await pool.query(`SELECT count(*)::int AS n FROM collection_discrepancy`);
  if (existing.rows[0].n > 0) return;

  const { rows: cust } = await pool.query(`SELECT customer_id FROM customer LIMIT 1`);
  const { rows: emp } = await pool.query(`SELECT employer_id FROM employer LIMIT 1`);
  const { rows: acc } = await pool.query(`SELECT account_id FROM account LIMIT 1`);
  if (!cust.length || !emp.length || !acc.length) return;

  for (const [month, type, amount, status] of [
    ['202404', 'WRONG_AMOUNT', 100, 'OPEN'],
    ['202404', 'LATE', 0, 'EMPLOYER_NOTIFIED'],
    ['202403', 'MISSING', 5400, 'RESOLVED'],
    ['202404', 'WRONG_SPLIT', 50, 'OPEN'],
  ] as const) {
    await pool.query(
      `INSERT INTO collection_discrepancy (customer_id, employer_id, employment_id, reference_month,
         expected_account_id, expected_amount_employee, expected_amount_employer, expected_amount_severance,
         discrepancy_type, discrepancy_amount, status, detected_at)
       VALUES ($1,$2,NULL,$3,$4,600,700,800,$5,$6,$7,now() - interval '${type === 'MISSING' ? 35 : 5} days')`,
      [cust[0].customer_id, emp[0].employer_id, month, acc[0].account_id, type, amount, status],
    );
  }
  log.log('seeded 4 demo collection_discrepancy rows');
}

async function seedDemoTermination(pool: Pool): Promise<void> {
  const { rows: cust } = await pool.query(`SELECT customer_id FROM customer LIMIT 1`);
  const { rows: acc } = await pool.query(`SELECT account_id FROM account LIMIT 1`);
  const { rows: emp } = await pool.query(`SELECT employer_id FROM employer LIMIT 1`);
  if (!cust.length || !acc.length || !emp.length) return;

  // PgRepository.promote יוצר employment מהקליטה הראשונית — אין צורך ב-seed ידני.
  const tExists = await pool.query(`SELECT count(*)::int AS n FROM termination_event`);
  if (tExists.rows[0].n > 0) return;
  await pool.query(
    `INSERT INTO termination_event (customer_id, account_id, detected_at, detection_source,
       confirmed_termination_date, status, notes)
     VALUES ($1, $2, now() - interval '7 days', 'MANUAL', '2024-05-15', 'CONFIRMED',
             'דמו — סיום עבודה לצורך הדגמת A8 Vision OCR על טופס 161')`,
    [cust[0].customer_id, acc[0].account_id],
  );
  log.log('seeded 1 demo termination_event (CONFIRMED, מחכה לטופס 161)');
}

async function seedDemoUsers(authService: AuthService, pool: Pool): Promise<void> {
  const existing = await pool.query(`SELECT count(*)::int AS n FROM users`);
  if (existing.rows[0].n > 0) return;
  const DEMO_USERS: { email: string; password: string; role: UserRole; name: string }[] = [
    { email: 'operator@demo.local', password: 'operator123', role: 'OPERATOR', name: 'רפרנט תפעולי' },
    { email: 'manager@demo.local', password: 'manager123', role: 'MANAGER', name: 'מנהל סוכנות' },
    { email: 'auditor@demo.local', password: 'auditor123', role: 'AUDITOR', name: 'בקר רגולציה' },
    { email: 'regulator@demo.local', password: 'regulator123', role: 'REGULATOR', name: 'גורם רגולטורי' },
  ];
  for (const u of DEMO_USERS) await authService.createUser(u.email, u.password, u.role, u.name);
  log.log(`seeded ${DEMO_USERS.length} demo users (password = role-name + '123')`);
}

async function main(): Promise<void> {
  // File watcher: סורק תיקייה מקומית באופן אוטומטי
  process.env.FILE_WATCH_INBOX_DIR ??= INBOX_DIR;
  process.env.FILE_WATCH_ARCHIVE_DIR ??= ARCHIVE_DIR;
  mkdirSync(INBOX_DIR, { recursive: true });
  mkdirSync(ARCHIVE_DIR, { recursive: true });

  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(VAULT_DIR, { recursive: true });

  const user = 'postgres';
  const password = 'postgres';
  const database = 'pension_ops';
  const url = `postgresql://${user}:${password}@localhost:${PG_PORT}/${database}`;

  log.log(`booting embedded postgres on port ${PG_PORT}`);
  const pg = new EmbeddedPostgres({ databaseDir: DATA_DIR, user, password, port: PG_PORT, persistent: true });
  try { await pg.initialise(); } catch { /* כבר אותחל */ }
  await pg.start();
  try { await pg.createDatabase(database); } catch { /* כבר קיים */ }

  process.env.DATABASE_URL = url;
  process.env.VAULT_DIR = VAULT_DIR;
  process.env.PORT = String(API_PORT);

  const pool = new Pool({ connectionString: url });
  const root = join(__dirname, '..', 'src', 'persistence');
  for (const file of ['schema.sql', 'schema.rejects.sql', 'schema.termination.sql', 'schema.collection.sql', 'schema.authorization.sql', 'schema.agent-context.sql', 'schema.auth.sql']) {
    await applySql(pool, join(root, file));
  }
  await applySql(pool, join(__dirname, 'seed.sql'));

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableCors({ origin: true, credentials: true });
  await app.listen(API_PORT);
  log.log(`API ↑ http://localhost:${API_PORT}`);

  // קליטה ראשונית של ה-XML אם אין לקוחות
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM customer`);
  if (rows[0].n === 0) {
    await ingestSample(app.get(IngestionService));
  } else {
    log.log(`customer count = ${rows[0].n} — מדלג על קליטה ראשונית`);
  }

  // top-up דמו לכל קטגוריה ש-empty (idempotent — לא יוצר כפילויות)
  const repo = app.get<Repository>(REPOSITORY);
  const rejects = app.get(RejectService);
  const auth = app.get(AuthorizationService);
  const rejCount = await pool.query(`SELECT count(*)::int AS n FROM reject`);
  if (rejCount.rows[0].n === 0) await seedDemoRejects(repo, rejects);
  await seedDemoAuth(repo, auth, pool);
  await seedDemoCollection(pool);
  await seedDemoTermination(pool);
  await seedDemoUsers(app.get(AuthService), pool);

  log.log('=== READY ===');
  log.log(`UI: http://localhost:3001  ·  API: http://localhost:${API_PORT}`);

  const shutdown = async (sig: string) => {
    log.log(`received ${sig}, shutting down...`);
    try { await app.close(); } catch {}
    try { await pool.end(); } catch {}
    try { await pg.stop(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
