import { Inject, Injectable } from '@nestjs/common';
import { AgentContextService } from '../agent-context/agent-context.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { REPOSITORY, Repository } from '../persistence/repository.port';
import { RejectService } from '../rejects/reject.service';
import { Agent, AgentResult, AgentTask, AUTONOMY } from './agent.types';

export interface MeetingPrepPayload {
  customerId: string;
  reason?: string;
}

export interface MeetingPrepReport {
  customerId: string;
  freshness: { hasIngestionInLast30d: boolean };
  authorization: { active: boolean; expiresInDays?: number };
  rejects: { open: number; high: number; flags: string[] };
  terminations: { active: number };
  warnings: string[];
  /** §11.2 — תקציר LLM (Hebrew narrative). מופיע גם אם ה-LLM היה fallback. */
  briefing?: { text: string; model: string; fallback: boolean };
}

/**
 * A1 — Meeting Quality Agent (§11.2 A1, FULL autonomy).
 *
 * שדרוג מ-rule-based ל-LLM-assisted: עדיין מפיק דוח דגלים מובנה (read-only),
 * אבל גם מבקש מ-AgentContextService תקציר נרטיבי שמופק ע"י Claude עם
 * prompt-caching, adaptive thinking, ו-fallback דטרמיניסטי כשאין API key.
 */
@Injectable()
export class A1MeetingQualityAgent implements Agent<MeetingPrepPayload> {
  readonly id = 'A1' as const;
  readonly autonomy = AUTONOMY.A1;

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly rejects: RejectService,
    private readonly authSvc: AuthorizationService,
    private readonly agentContext: AgentContextService,
  ) {}

  async run(task: AgentTask<MeetingPrepPayload>): Promise<AgentResult> {
    const { customerId, reason } = task.payload;
    const warnings: string[] = [];
    const now = new Date();

    // ייפוי כוח
    const auths = await this.repo.listAuthorizations(customerId);
    const activeAuth = auths.find((a) => a.status === 'active' && new Date(a.validTo).getTime() >= now.getTime());
    if (!activeAuth) warnings.push('NO_ACTIVE_AUTHORIZATION');
    const expiresInDays = activeAuth
      ? Math.floor((new Date(activeAuth.validTo).getTime() - now.getTime()) / 86400_000)
      : undefined;
    if (expiresInDays !== undefined && expiresInDays < 30) warnings.push(`AUTH_EXPIRES_IN_${expiresInDays}D`);

    // ריג'קטים פתוחים
    const customerRejects = await this.repo.listRejectsByCustomer(customerId);
    const open = customerRejects.filter((r) => r.status !== 'RESOLVED' && r.status !== 'DISMISSED');
    const high = open.filter((r) => r.severity === 'HIGH' || r.severity === 'CRITICAL').length;
    const flags = await this.rejects.customerRiskFlags(customerId, now);
    if (high > 0) warnings.push('HIGH_SEVERITY_REJECTS');

    // סיום עבודה
    const terms = await this.repo.listTerminationsByCustomer(customerId);
    const activeTerms = terms.filter((t) => t.status !== 'COMPLETED' && t.status !== 'DISMISSED').length;
    if (activeTerms > 0) warnings.push('ACTIVE_TERMINATION_IN_PROGRESS');

    // תקציר Claude — דרך AgentContextService (LLM + caching + fallback אוטומטי)
    const briefingResult = await this.agentContext.briefing(customerId, reason, now);

    const report: MeetingPrepReport = {
      customerId,
      freshness: { hasIngestionInLast30d: true }, // TODO: lookup INGESTION_RUN.completed_at
      authorization: { active: !!activeAuth, expiresInDays },
      rejects: { open: open.length, high, flags },
      terminations: { active: activeTerms },
      warnings,
      briefing: briefingResult
        ? { text: briefingResult.briefing, model: briefingResult.model, fallback: !!briefingResult.fallback }
        : undefined,
    };
    return { ok: true, summary: `Meeting prep for ${customerId}: ${warnings.length} warnings`, data: report };
  }
}
