import { mkdirSync, mkdtempSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { ParserFactory } from '../src/mevne-ahid/parser.factory';
import { AgentContextService } from '../src/agent-context/agent-context.service';
import { EmbeddingProvider } from '../src/agent-context/embedding.provider';
import { LlmProvider } from '../src/agent-context/llm.provider';
import { FileWatcherService } from '../src/ingestion/file-watcher.service';
import { IngestionService } from '../src/ingestion/ingestion.service';
import { PostProcessService } from '../src/ingestion/post-process.service';
import { VaultService } from '../src/ingestion/vault.service';
import { InMemoryRepository } from '../src/persistence/in-memory.repository';
import { RejectLifecycleService } from '../src/rejects/reject-lifecycle.service';
import { RejectService } from '../src/rejects/reject.service';
import { Form161LifecycleService } from '../src/termination/form-161-lifecycle.service';
import { TerminationLifecycleService } from '../src/termination/termination-lifecycle.service';
import { TerminationService } from '../src/termination/termination.service';
import { ValidationService } from '../src/validation/validation.service';

const sampleXml = readFileSync(join(__dirname, 'fixtures/sample.mevne-ahid.xml'));

function buildIngestion(repo: InMemoryRepository, vaultDir: string): IngestionService {
  const cfg = { get: (k: string) => (k === 'vaultDir' ? vaultDir : undefined) } as unknown as ConfigService;
  const vault = new VaultService(cfg);
  const rejects = new RejectService(repo, new RejectLifecycleService());
  const term = new TerminationService(repo, new TerminationLifecycleService(), new Form161LifecycleService());
  const ctx = new AgentContextService(repo, new EmbeddingProvider(), new LlmProvider());
  return new IngestionService(repo, vault, new ParserFactory(), new ValidationService(), new PostProcessService(), rejects, term, ctx, cfg);
}

describe('FileWatcherService (§5.2)', () => {
  it('פותח קובץ מ-inbox, מזרים, ומעביר ל-archive עם רישום ה-runId', async () => {
    const repo = new InMemoryRepository();
    repo.refManufacturerCodes.add('MGD');
    const root = mkdtempSync(join(tmpdir(), 'watcher-'));
    const inbox = join(root, 'inbox');
    const archive = join(root, 'archive');
    mkdirSync(inbox, { recursive: true });
    process.env.FILE_WATCH_INBOX_DIR = inbox;
    process.env.FILE_WATCH_ARCHIVE_DIR = archive;

    const ingestion = buildIngestion(repo, join(root, 'vault'));
    const watcher = new FileWatcherService(ingestion);
    watcher.onModuleInit();

    // הנח קובץ עם mtime ישן (>1s) כדי שיוכל להיקרא מיד
    const fileName = 'demo.mevne-ahid.xml';
    const inPath = join(inbox, fileName);
    writeFileSync(inPath, sampleXml);
    // שינוי mtime ל-2s אחורה כדי לעקוף את ה-debounce
    const { utimesSync } = require('node:fs');
    const past = new Date(Date.now() - 5000);
    utimesSync(inPath, past, past);

    const result = await watcher.tick();
    watcher.onModuleDestroy();

    expect(result.found).toBe(1);
    expect(result.ingested).toBe(1);
    expect(repo.customers.size).toBe(1);

    // הקובץ הועבר ל-archive עם runId בשם
    const archived = readdirSync(archive);
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatch(/__demo\.mevne-ahid\.xml$/);
    delete process.env.FILE_WATCH_INBOX_DIR;
    delete process.env.FILE_WATCH_ARCHIVE_DIR;
  });

  it('debounce: לא מרים קובץ שזה עתה נכתב (mtime<1s)', async () => {
    const repo = new InMemoryRepository();
    repo.refManufacturerCodes.add('MGD');
    const root = mkdtempSync(join(tmpdir(), 'watcher-'));
    const inbox = join(root, 'inbox');
    mkdirSync(inbox, { recursive: true });
    process.env.FILE_WATCH_INBOX_DIR = inbox;
    process.env.FILE_WATCH_ARCHIVE_DIR = join(root, 'archive');

    const ingestion = buildIngestion(repo, join(root, 'vault'));
    const watcher = new FileWatcherService(ingestion);
    watcher.onModuleInit();

    writeFileSync(join(inbox, 'fresh.xml'), sampleXml);  // mtime עכשיו
    const result = await watcher.tick();
    watcher.onModuleDestroy();

    expect(result.found).toBe(0);
    expect(repo.customers.size).toBe(0);
    delete process.env.FILE_WATCH_INBOX_DIR;
    delete process.env.FILE_WATCH_ARCHIVE_DIR;
  });

  it('FILE_WATCH_INBOX_DIR לא מוגדר => watcher לא מאתחל source', async () => {
    delete process.env.FILE_WATCH_INBOX_DIR;
    const repo = new InMemoryRepository();
    const ingestion = buildIngestion(repo, mkdtempSync(join(tmpdir(), 'vault-')));
    const watcher = new FileWatcherService(ingestion);
    watcher.onModuleInit();
    const r = await watcher.tick();
    expect(r).toEqual({ found: 0, ingested: 0 });
    watcher.onModuleDestroy();
  });
});
