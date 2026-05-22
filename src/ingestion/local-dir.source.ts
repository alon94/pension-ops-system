import { mkdir, readFile, readdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSource, IncomingFile } from './file-source.port';

/**
 * LocalDirSource — סורק תיקייה מקומית. שימושי לפיתוח ולסביבות שבהן ספק
 * המסלקה מוריד קבצים ל-NFS משותף. בפרודקשן SFTP מתחבר ל-bucket בנפרד.
 */
export class LocalDirSource implements FileSource {
  readonly id: string;
  private readonly inbox: string;
  private readonly archiveDir: string;
  private readonly failedDir: string;
  /** קבצים שזיהינו והעברנו ל-pipeline בריצה הנוכחית — מונע double-pick */
  private readonly inFlight = new Set<string>();

  constructor(opts: { id?: string; inbox: string; archive: string; failed?: string }) {
    this.id = opts.id ?? 'local-inbox';
    this.inbox = opts.inbox;
    this.archiveDir = opts.archive;
    this.failedDir = opts.failed ?? `${opts.archive}-failed`;
  }

  async list(): Promise<IncomingFile[]> {
    try {
      await mkdir(this.inbox, { recursive: true });
    } catch {}
    let entries: string[] = [];
    try { entries = await readdir(this.inbox); } catch { return []; }
    const out: IncomingFile[] = [];
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const full = join(this.inbox, name);
      if (this.inFlight.has(full)) continue;
      let st;
      try { st = await stat(full); } catch { continue; }
      if (!st.isFile()) continue;
      // §5.2 — אם הקובץ עדיין בכתיבה (mtime עכשיו), נמתין לסיבוב הבא
      if (Date.now() - st.mtimeMs < 1000) continue;
      this.inFlight.add(full);
      const content = await readFile(full);
      out.push({ sourceRef: full, fileName: name, content });
    }
    return out;
  }

  async archive(sourceRef: string, outcome: 'completed' | 'failed' | 'duplicate', runId?: string): Promise<void> {
    try {
      const dir = outcome === 'failed' ? this.failedDir : this.archiveDir;
      await mkdir(dir, { recursive: true });
      const name = sourceRef.split('/').pop() ?? sourceRef;
      const dest = join(dir, `${runId ?? outcome}__${name}`);
      await rename(sourceRef, dest);
    } finally {
      this.inFlight.delete(sourceRef);
    }
  }
}
