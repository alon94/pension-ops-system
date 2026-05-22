import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { ParserFactory } from '../src/mevne-ahid/parser.factory';
import { InMemoryRepository } from '../src/persistence/in-memory.repository';
import { ValidationService } from '../src/validation/validation.service';
import { IngestionService } from '../src/ingestion/ingestion.service';
import { PostProcessService } from '../src/ingestion/post-process.service';
import { VaultService } from '../src/ingestion/vault.service';
import { RejectLifecycleService } from '../src/rejects/reject-lifecycle.service';
import { RejectService } from '../src/rejects/reject.service';
import { Form161LifecycleService } from '../src/termination/form-161-lifecycle.service';
import { TerminationLifecycleService } from '../src/termination/termination-lifecycle.service';
import { TerminationService } from '../src/termination/termination.service';
import { AgentContextService } from '../src/agent-context/agent-context.service';
import { EmbeddingProvider } from '../src/agent-context/embedding.provider';
import { LlmProvider } from '../src/agent-context/llm.provider';
import { sampleFixedWidthFile } from './fixtures/fw-builder';

function buildService(repo: InMemoryRepository) {
  const cfg = { get: (k: string) => (k === 'vaultDir' ? mkdtempSync(join(tmpdir(), 'vault-')) : undefined) } as unknown as ConfigService;
  const vault = new VaultService(cfg);
  const rejects = new RejectService(repo, new RejectLifecycleService());
  const termination = new TerminationService(repo, new TerminationLifecycleService(), new Form161LifecycleService());
  const agentContext = new AgentContextService(repo, new EmbeddingProvider(), new LlmProvider());
  return new IngestionService(
    repo, vault, new ParserFactory(), new ValidationService(), new PostProcessService(),
    rejects, termination, agentContext, cfg,
  );
}

const xml = readFileSync(join(__dirname, 'fixtures/sample.mevne-ahid.xml'));

describe('צינור קליטה end-to-end (פרק 5)', () => {
  it('קולט קובץ XML תקין ומקדם את כל הישויות', async () => {
    const repo = new InMemoryRepository();
    repo.refManufacturerCodes.add('MGD');
    const svc = buildService(repo);

    const out = await svc.ingest({ sourceFileName: 'sample.xml', content: xml, source: 'SFTP' });

    expect(out.status).toBe('completed');
    if (out.status !== 'completed') return;
    expect(out.promoted.customers).toBe(1);
    expect(out.promoted.accounts).toBe(1);
    expect(out.promoted.balanceSnapshots).toBe(1);
    expect(out.promoted.beneficiaries).toBe(2);
    expect(out.promoted.deposits).toBe(1);
    expect(out.promoted.withdrawals).toBe(1);

    const cust = [...repo.customers.values()][0];
    expect(cust.israelId).toBe('000000018');
    expect(cust.lastName).toBe('ישראלי');
    // §5.5 — raw_staging.target_* מתעדכן בקידום
    const accRow = repo.rawRows(out.ingestionRunId).find((r) => r.blockCode === '040')!;
    expect(accRow.targetEntity).toBe('account');
    expect(accRow.targetId).toBeDefined();
  });

  it('§5.2 — קובץ זהה (אותו hash) נדחה כ-DUPLICATE', async () => {
    const repo = new InMemoryRepository();
    repo.refManufacturerCodes.add('MGD');
    const svc = buildService(repo);
    await svc.ingest({ sourceFileName: 'a.xml', content: xml });
    const second = await svc.ingest({ sourceFileName: 'a.xml', content: xml });
    expect(second.status).toBe('duplicate');
  });

  it('§5.2 — קובץ ריק => failed/EMPTY_FILE', async () => {
    const repo = new InMemoryRepository();
    const svc = buildService(repo);
    const out = await svc.ingest({ sourceFileName: 'empty.xml', content: Buffer.alloc(0) });
    expect(out).toMatchObject({ status: 'failed', error: 'EMPTY_FILE' });
  });

  it('§5.4 — CRITICAL (יצרן לא מוכר ב-REF) עוצר את הריצה', async () => {
    const repo = new InMemoryRepository(); // ללא seed ל-MGD
    const svc = buildService(repo);
    const out = await svc.ingest({ sourceFileName: 'sample.xml', content: xml });
    expect(out.status).toBe('failed');
    if (out.status === 'failed') expect(out.stage).toBe('validate');
    expect(repo.customers.size).toBe(0); // לא קודם דבר
    // §7.5 — גם בכשל CRITICAL נפתח ריג'קט פנימי (E030 → R014)
    expect(repo.rejects.some((r) => r.rejectCode === 'R014')).toBe(true);
  });

  it('קולט קובץ Fixed-Width תקין (יצרן CLAL)', async () => {
    const repo = new InMemoryRepository();
    repo.refManufacturerCodes.add('CLAL');
    const svc = buildService(repo);
    const out = await svc.ingest({ sourceFileName: 'legacy.fw', content: Buffer.from(sampleFixedWidthFile()) });
    expect(out.status).toBe('completed');
    if (out.status !== 'completed') return;
    expect(out.promoted.accounts).toBe(1);
    expect(out.promoted.loans).toBe(1);
    expect(out.triggers.some((t) => t.agent === 'A7')).toBe(true); // DEPOSIT => A7
  });

  it('§8.2 — employmentEnd בקליטה => פתיחת אירוע סיום עבודה CONFIRMED', async () => {
    const repo = new InMemoryRepository();
    repo.refManufacturerCodes.add('MGD');
    const svc = buildService(repo);
    // employmentEnd לאחר חודש ההפקדה האחרון (lastDeposit=2024-04 < endDate=2024-05-01)
    const xmlWithEnd = xml.toString().replace(
      '<employmentStart>20190101</employmentStart>',
      '<employmentStart>20190101</employmentStart>\n      <employmentEnd>20240501</employmentEnd>',
    );
    const out = await svc.ingest({ sourceFileName: 'with-end.xml', content: Buffer.from(xmlWithEnd) });
    expect(out.status).toBe('completed');
    if (out.status !== 'completed') return;
    expect(out.terminationsOpened).toBe(1);
    expect(repo.terminations[0].status).toBe('CONFIRMED');
    expect(repo.terminations[0].detectionSource).toBe('CLEARING');
    expect(repo.terminations[0].confirmedTerminationDate).toBe('2024-05-01');
  });

  it('§5.7 — rollback מסמן superseded ומסיר insert-only', async () => {
    const repo = new InMemoryRepository();
    repo.refManufacturerCodes.add('MGD');
    const svc = buildService(repo);
    const out = await svc.ingest({ sourceFileName: 'sample.xml', content: xml });
    if (out.status !== 'completed') throw new Error('expected completed');
    await svc.rollback(out.ingestionRunId);
    expect(repo.balanceSnapshots).toHaveLength(0);
    expect(repo.rawRows(out.ingestionRunId).every((r) => r.superseded)).toBe(true);
  });
});
