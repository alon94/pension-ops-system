import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalDirSource } from './local-dir.source';
import { FileSource } from './file-source.port';
import { IngestionService } from './ingestion.service';

/**
 * §5.2 — Poller שמשך קבצים מ-FileSource כל N שניות ומזרים דרך IngestionService.
 *
 * הפעלה: אם FILE_WATCH_INBOX_DIR מוגדר ב-env, נוצרת LocalDirSource ומופעל poll.
 * אם לא — השירות לא עושה כלום (testing-friendly).
 */
@Injectable()
export class FileWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('FileWatcher');
  private timer?: NodeJS.Timeout;
  private running = false;
  private source?: FileSource;
  private intervalMs = 5000;

  constructor(
    private readonly ingestion: IngestionService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  onModuleInit(): void {
    const inbox = this.config?.get<string>('fileWatchInbox') ?? process.env.FILE_WATCH_INBOX_DIR;
    if (!inbox) {
      this.log.log('FILE_WATCH_INBOX_DIR לא מוגדר — file watcher לא פעיל');
      return;
    }
    const archive = this.config?.get<string>('fileWatchArchive') ?? process.env.FILE_WATCH_ARCHIVE_DIR ?? `${inbox}-done`;
    const intervalSeconds = Number(this.config?.get<string>('fileWatchIntervalSec') ?? process.env.FILE_WATCH_INTERVAL_SEC ?? 5);
    this.intervalMs = Math.max(1000, intervalSeconds * 1000);
    this.source = new LocalDirSource({ inbox, archive });
    this.log.log(`watcher פעיל — inbox=${inbox} archive=${archive} every ${intervalSeconds}s`);
    this.scheduleTick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleTick(): void {
    this.timer = setTimeout(() => this.tick().finally(() => this.scheduleTick()), this.intervalMs);
  }

  /** ציבורי כדי שאפשר יהיה להפעיל ידנית מבדיקות. */
  async tick(): Promise<{ found: number; ingested: number }> {
    if (!this.source) return { found: 0, ingested: 0 };
    if (this.running) return { found: 0, ingested: 0 };
    this.running = true;
    try {
      const files = await this.source.list();
      let ingested = 0;
      for (const f of files) {
        try {
          const out = await this.ingestion.ingest({
            sourceFileName: f.fileName, content: f.content, source: this.source.id,
          });
          const outcome = out.status === 'completed' ? 'completed'
            : out.status === 'duplicate' ? 'duplicate' : 'failed';
          const runId = (out as any).ingestionRunId;
          await this.source.archive(f.sourceRef, outcome, runId);
          if (out.status === 'completed') ingested++;
          this.log.log(`${f.fileName} → ${out.status}${runId ? ` (run ${runId})` : ''}`);
        } catch (e) {
          this.log.error(`${f.fileName} threw: ${(e as Error).message}`);
          await this.source.archive(f.sourceRef, 'failed');
        }
      }
      return { found: files.length, ingested };
    } finally {
      this.running = false;
    }
  }
}
