/**
 * scripts/run-e2e.ts — אימות end-to-end מול Postgres אמיתי (embedded).
 *
 * 1. מוריד ומריץ Postgres זמני בפורט פנוי
 * 2. מריץ את כל קבצי schema.*.sql + seed.sql
 * 3. מעלה את NestJS app עם DATABASE_URL מצביע לאינסטנס המקומי
 * 4. שולח את sample.mevne-ahid.xml דרך POST /ingestion/files
 * 5. מאמת שורות במסד הנתונים ומדפיס סיכום
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { Pool } from 'pg';

const log = new Logger('e2e');

async function applySql(pool: Pool, path: string): Promise<void> {
  const sql = readFileSync(path, 'utf8');
  await pool.query(sql);
  log.log(`applied ${path.split('/').pop()}`);
}

async function findFreePort(): Promise<number> {
  const net = await import('node:net');
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as any).port as number;
      srv.close(() => res(port));
    });
    srv.on('error', rej);
  });
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'pg-e2e-'));
  const pgPort = await findFreePort();
  const httpPort = await findFreePort();
  const user = 'postgres';
  const password = 'postgres';
  const database = 'pension_ops';

  log.log(`booting embedded postgres on port ${pgPort} (data: ${dataDir})`);
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir, user, password, port: pgPort, persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(database);

  const url = `postgresql://${user}:${password}@localhost:${pgPort}/${database}`;
  process.env.DATABASE_URL = url;
  process.env.PORT = String(httpPort);
  process.env.VAULT_DIR = join(dataDir, 'vault');

  const pool = new Pool({ connectionString: url });

  try {
    // ---------- 1. הרצת schemas ----------
    const root = join(__dirname, '..', 'src', 'persistence');
    for (const file of ['schema.sql', 'schema.rejects.sql', 'schema.termination.sql', 'schema.collection.sql', 'schema.authorization.sql', 'schema.agent-context.sql']) {
      await applySql(pool, join(root, file));
    }
    await applySql(pool, join(__dirname, 'seed.sql'));

    // ---------- 2. NestJS app ----------
    const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
    await app.listen(httpPort);
    log.log(`API listening on http://localhost:${httpPort}`);

    // ---------- 3. שליחת sample.mevne-ahid.xml ----------
    const xmlPath = join(__dirname, '..', 'test', 'fixtures', 'sample.mevne-ahid.xml');
    const contentBase64 = readFileSync(xmlPath).toString('base64');
    const resp = await fetch(`http://localhost:${httpPort}/ingestion/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceFileName: 'sample.mevne-ahid.xml', contentBase64, source: 'E2E' }),
    });
    const outcome = await resp.json();
    log.log(`POST /ingestion/files → ${resp.status}`);
    log.log(`outcome: ${JSON.stringify(outcome, null, 2)}`);

    // ---------- 4. אימות שורות ----------
    const summary: Record<string, number> = {};
    for (const t of ['ingestion_run', 'ingestion_error', 'raw_staging', 'customer', 'employer',
                     'manufacturer', 'product', 'account', 'account_status_history',
                     'balance_snapshot', 'deposit', 'reject', 'termination_event']) {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${t}`);
      summary[t] = rows[0].n;
    }
    log.log('row counts:');
    for (const [k, v] of Object.entries(summary)) log.log(`  ${k.padEnd(28)} ${v}`);

    const { rows: cust } = await pool.query(
      `SELECT israel_id, first_name, last_name FROM customer ORDER BY created_at DESC LIMIT 5`,
    );
    log.log(`customers: ${JSON.stringify(cust)}`);

    const { rows: acc } = await pool.query(
      `SELECT a.policy_number, m.official_code AS manufacturer, a.current_status
       FROM account a JOIN manufacturer m USING (manufacturer_id) ORDER BY policy_number`,
    );
    log.log(`accounts: ${JSON.stringify(acc)}`);

    const { rows: bs } = await pool.query(
      `SELECT snapshot_date, total FROM balance_snapshot ORDER BY snapshot_date DESC LIMIT 5`,
    );
    log.log(`balance_snapshots: ${JSON.stringify(bs)}`);

    const { rows: dep } = await pool.query(
      `SELECT deposit_month, total FROM deposit ORDER BY deposit_month DESC LIMIT 5`,
    );
    log.log(`deposits: ${JSON.stringify(dep)}`);

    const { rows: errs } = await pool.query(
      `SELECT code, severity, count(*)::int FROM ingestion_error GROUP BY code, severity ORDER BY severity DESC`,
    );
    log.log(`ingestion_error breakdown: ${JSON.stringify(errs)}`);

    // ---------- 5. דחיית כפילות ----------
    const dup = await fetch(`http://localhost:${httpPort}/ingestion/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceFileName: 'again.xml', contentBase64, source: 'E2E' }),
    });
    log.log(`re-POST same file → ${JSON.stringify(await dup.json())}`);

    await app.close();
    log.log('E2E COMPLETE');
  } finally {
    await pool.end();
    await pg.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
