import { Injectable, Logger } from '@nestjs/common';
import { ParsedRecord } from '../mevne-ahid/types';
import { PromoteCounts } from '../persistence/repository.port';
import { ValidationResult } from '../validation/types';

export interface AgentTrigger {
  agent: 'A4' | 'A5' | 'A6' | 'A7' | 'A11';
  reason: string;
  policyNumber?: string;
}

/**
 * שלב 5 — Post-Processing (§5.6).
 * כאן רק טריגרים לאייג'נטים והתראות (stubs) — שכבת האייג'נטים (פרק 11) תיבנה מעל ליבה זו.
 * AGENT_CONTEXT / embeddings / KPIs אינם בהיקף ליבת הקליטה.
 */
@Injectable()
export class PostProcessService {
  private readonly log = new Logger('PostProcess');

  run(records: ParsedRecord[], validation: ValidationResult, counts: PromoteCounts): AgentTrigger[] {
    const triggers: AgentTrigger[] = [];

    for (const r of records.filter((x) => x.blockCode === '040')) {
      // §5.6 — שינוי סטטוס חשבון => A6 (Termination Lifecycle)
      if (r.fields.accountStatus === 'CLOSED' || r.fields.closedDate) {
        triggers.push({ agent: 'A6', reason: 'ACCOUNT_CLOSED', policyNumber: r.fields.policyNumber });
      }
    }

    // §5.6 — חשבון חדש שלא היה ב-CRM => A4 (Sales-Production)
    if (counts.accounts > 0) {
      triggers.push({ agent: 'A4', reason: `NEW_ACCOUNTS:${counts.accounts}` });
    }

    // §5.6 — DEPOSIT חדש => A7 (Collection Reconciliation)
    if (counts.deposits > 0) {
      triggers.push({ agent: 'A7', reason: `NEW_DEPOSITS:${counts.deposits}` });
    }

    // §5.6 — INGESTION_ERROR CRITICAL => A11 (Audit Agent)
    if (validation.issues.some((i) => i.severity === 'CRITICAL')) {
      triggers.push({ agent: 'A11', reason: 'CRITICAL_INGESTION_ERROR' });
    }

    for (const t of triggers) this.log.log(`trigger -> ${t.agent}: ${t.reason}`);
    return triggers;
  }
}
