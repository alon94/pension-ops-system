import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sha256 } from '../common/hashing';
import { ParserFactory } from '../mevne-ahid/parser.factory';
import { ParsedRecord } from '../mevne-ahid/types';
import { REPOSITORY, Repository } from '../persistence/repository.port';
import { ValidationService } from '../validation/validation.service';
import { deriveRejectsFromValidation } from '../rejects/reject-derivation';
import { RejectService } from '../rejects/reject.service';
import { TerminationService } from '../termination/termination.service';
import { AgentContextService } from '../agent-context/agent-context.service';
import { AgentTrigger, PostProcessService } from './post-process.service';
import { VaultService } from './vault.service';

export interface IngestInput {
  sourceFileName: string;
  content: Buffer;
  source?: string; // SFTP / API / EMAIL
}

export type IngestOutcome =
  | { status: 'duplicate'; ingestionRunId: string }
  | { status: 'failed'; ingestionRunId: string; stage: string; error: string; issues: number }
  | {
      status: 'completed';
      ingestionRunId: string;
      promoted: Record<string, number>;
      issues: number;
      failedRecords: number;
      triggers: AgentTrigger[];
      rejectsOpened: number;
      terminationsOpened: number;
      contextsRefreshed: number;
    };

/**
 * אורקסטרטור צינור הקליטה (§5.1) — 5 שלבים כטרנזקציה לוגית:
 * Receive → Parse → Validate → Promote → Post-Process.
 * כל CRITICAL עוצר את הריצה ומסמן failed (§5.4); ERROR מדלג על רשומה (§5.4).
 */
@Injectable()
export class IngestionService {
  private readonly log = new Logger('Ingestion');

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly vault: VaultService,
    private readonly parsers: ParserFactory,
    private readonly validation: ValidationService,
    private readonly postProcess: PostProcessService,
    private readonly rejects: RejectService,
    private readonly termination: TerminationService,
    private readonly agentContext: AgentContextService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  private get defaultParserVersion(): string {
    return this.config?.get<string>('defaultParserVersion') ?? process.env.DEFAULT_PARSER_VERSION ?? '2024.1';
  }

  async ingest(input: IngestInput): Promise<IngestOutcome> {
    // ---------- שלב 1 — Receive (§5.2) ----------
    const fileHash = sha256(input.content);

    if (input.content.length === 0) {
      const run = await this.repo.createIngestionRun({
        ingestionRunId: '', fileHash, status: 'failed',
        sourceFileName: input.sourceFileName, error: 'EMPTY_FILE',
      });
      return { status: 'failed', ingestionRunId: run.ingestionRunId, stage: 'receive', error: 'EMPTY_FILE', issues: 0 };
    }

    const dup = await this.repo.findCompletedRunByHash(fileHash);
    if (dup) {
      this.log.warn(`DUPLICATE file_hash=${fileHash} (run ${dup.ingestionRunId})`);
      return { status: 'duplicate', ingestionRunId: dup.ingestionRunId };
    }

    const format = this.parsers.detectFormat(input.content);
    const parserVersion = this.parsers.detectVersion(input.content, format, this.defaultParserVersion);
    const rawPath = await this.vault.store(fileHash, input.sourceFileName, input.content);

    const run = await this.repo.createIngestionRun({
      ingestionRunId: '', fileHash, status: 'received',
      sourceFileName: input.sourceFileName, parserVersion, rawFilePath: rawPath,
    });
    const runId = run.ingestionRunId;

    try {
      // ---------- שלב 2 — Parse (§5.3) ----------
      await this.repo.updateRunStatus(runId, 'parsing');
      const parsed = this.parsers.getParser(format).parse(input.content, parserVersion);
      await this.repo.saveRawStaging(runId, parsed.records);

      // ---------- שלב 3 — Validate (§5.4) ----------
      await this.repo.updateRunStatus(runId, 'validating');
      const ctx = {
        knownPolicyNumbers: await this.repo.knownPolicyNumbers(),
        knownManufacturerCodes: await this.repo.knownManufacturerCodes(),
      };
      const validation = this.validation.validate(parsed, ctx);
      await this.repo.saveErrors(runId, validation.issues);

      if (validation.hasCritical) {
        await this.repo.updateRunStatus(runId, 'failed', 'CRITICAL_VALIDATION');
        // §7.5 — גם בריצה שנעצרה ב-CRITICAL נפתחים ריג'קטים פנימיים (R007 וכו')
        await this.rejects.openMany(
          deriveRejectsFromValidation(validation.issues, { ingestionRunId: runId, records: parsed.records }),
        );
        return {
          status: 'failed', ingestionRunId: runId, stage: 'validate',
          error: 'CRITICAL_VALIDATION', issues: validation.issues.length,
        };
      }

      // ---------- שלב 4 — Promote (§5.5) ----------
      await this.repo.updateRunStatus(runId, 'promoting');
      const promotable: ParsedRecord[] = parsed.records.filter(
        (r) => !validation.failedRecordSeqs.has(r.recordSeq),
      );
      const counts = await this.repo.promote(runId, promotable);

      // ---------- שלב 5 — Post-Process (§5.6) ----------
      const triggers = this.postProcess.run(promotable, validation, counts);

      // פרק 7 — גזירת ריג'קטים פנימיים מתוצאת התיקוף (§7.5)
      const customerId = (await this.repo.soleCustomerOfRun(runId)) ?? undefined;
      const opened = await this.rejects.openMany(
        deriveRejectsFromValidation(validation.issues, { ingestionRunId: runId, customerId, records: parsed.records }),
      );

      // פרק 8 — employmentEnd בקליטה => פתיחת אירוע סיום עבודה CONFIRMED (§8.2)
      const terminationsOpened = await this.termination.openConfirmedFromRun(runId);

      // §5.6 — חישוב מחדש של AGENT_CONTEXT לכל לקוח שהושפע מהקליטה
      const contextsRefreshed = await this.agentContext.refreshAffectedByRun(runId);

      await this.repo.updateRunStatus(runId, 'completed');

      return {
        status: 'completed',
        ingestionRunId: runId,
        promoted: counts as unknown as Record<string, number>,
        issues: validation.issues.length,
        failedRecords: validation.failedRecordSeqs.size,
        triggers,
        rejectsOpened: opened.length,
        terminationsOpened: terminationsOpened.length,
        contextsRefreshed,
      };
    } catch (e) {
      // §5.7 — כשל אחרי קידום => rollback
      this.log.error(`ingestion failed run=${runId}: ${(e as Error).message}`);
      await this.repo.rollback(runId);
      await this.repo.updateRunStatus(runId, 'failed', (e as Error).message);
      return { status: 'failed', ingestionRunId: runId, stage: 'promote', error: (e as Error).message, issues: 0 };
    }
  }

  /** §5.7 — rollback ידני יזום של ריצה שהושלמה (לדוגמה, בעקבות באג ב-Parser). */
  async rollback(runId: string): Promise<void> {
    await this.repo.rollback(runId);
  }
}
