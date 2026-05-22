import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { REPOSITORY, Repository } from '../persistence/repository.port';
import { RejectLifecycleService, TransitionInput } from './reject-lifecycle.service';
import { NewReject, Reject } from './reject.types';
import { rejectRiskFlags, RejectRiskFlag } from './risk-flags';
import { internalResolutionDue } from './sla';

/** שירות ניהול ריג'קטים (פרק 7) — פתיחה, דה-דופ, מעברי מצב, הסלמה, דגלי סיכון. */
@Injectable()
export class RejectService {
  private readonly log = new Logger('Rejects');

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly lifecycle: RejectLifecycleService,
  ) {}

  /** פותח ריג'קט אם אין כבר אחד פעיל לאותו (קוד + ישות מקור) §7.2. */
  async open(input: NewReject, now = new Date()): Promise<Reject> {
    const existing = await this.repo.findOpenReject(input.rejectCode, input.sourceEntity, input.sourceEntityId);
    if (existing) return existing;

    const reject: Reject = {
      ...input,
      rejectId: randomUUID(),
      detectedAt: input.detectedAt ?? now.toISOString(),
      status: 'OPEN',
      resolutionPath: [],
      slaDueAt: internalResolutionDue(input.severity, now).toISOString(),
    };
    const saved = await this.repo.createReject(reject);
    this.log.log(`OPEN ${saved.rejectCode} (${saved.severity}) ${saved.sourceEntity ?? ''} → ${saved.assignee ?? '-'}`);
    return saved;
  }

  async openMany(inputs: NewReject[], now = new Date()): Promise<Reject[]> {
    const out: Reject[] = [];
    for (const i of inputs) out.push(await this.open(i, now));
    return out;
  }

  /** מבצע מעבר מצב על ריג'קט קיים §7.4. */
  async transition(rejectId: string, input: TransitionInput): Promise<Reject> {
    const reject = await this.repo.getReject(rejectId);
    if (!reject) throw new Error(`ריג'קט לא נמצא: ${rejectId}`);
    const next = this.lifecycle.applyTransition(reject, input);
    await this.repo.saveReject(next);
    return next;
  }

  /** §7.4 — סורק ריג'קטים שחרגו מ-SLA ומסלים אותם אוטומטית. */
  async escalateOverdue(now = new Date()): Promise<Reject[]> {
    const overdue = await this.repo.listOverdueRejects(now);
    const escalated: Reject[] = [];
    for (const r of overdue) {
      const next = this.lifecycle.applyTransition(r, {
        to: 'ESCALATED',
        by: 'system',
        note: `חריגת SLA — היה ${r.status}`,
        now,
      });
      await this.repo.saveReject(next);
      escalated.push(next);
      this.log.warn(`ESCALATED ${r.rejectCode} (${r.rejectId})`);
    }
    return escalated;
  }

  /** §7.7 — דגלי סיכון של לקוח לפי ריג'קטים פעילים. */
  async customerRiskFlags(customerId: string, now = new Date()): Promise<RejectRiskFlag[]> {
    return rejectRiskFlags(await this.repo.listRejectsByCustomer(customerId), now);
  }
}
