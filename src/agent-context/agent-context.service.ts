import { Inject, Injectable, Logger } from '@nestjs/common';
import { REPOSITORY, Repository } from '../persistence/repository.port';
import { AgentContextRow, BriefingResult, CustomerContextSummary } from './agent-context.types';
import { buildContextSummary, deriveFlags, hashSummary } from './context-builder';
import { EmbeddingProvider } from './embedding.provider';
import { LlmProvider } from './llm.provider';

/**
 * AgentContextService — מתחזק AGENT_CONTEXT לפי §5.6 ומפיק תקצירי A1.
 *
 * Refresh: נקרא מתוך post-process לאחר promote. בונה summary מתוך Customer360,
 * משדרג hash, ומריץ embedding רק אם ה-summary באמת השתנה.
 *
 * Briefing: on-demand מ-UI/ controllers. אם summary חדש לא נשמר מאז refresh
 * אחרון — משתמש בו ישירות; אחרת בונה חדש "תוך כדי".
 */
@Injectable()
export class AgentContextService {
  private readonly log = new Logger('AgentContext');

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly embeddings: EmbeddingProvider,
    private readonly llm: LlmProvider,
  ) {}

  /** §5.6 — חישוב מחדש של AGENT_CONTEXT עבור לקוח. */
  async refresh(customerId: string, now = new Date()): Promise<AgentContextRow | null> {
    const c360 = await this.repo.customer360(customerId, now);
    if (!c360) return null;

    const summary = buildContextSummary(c360, now);
    const { riskFlags, opportunityFlags } = deriveFlags(summary);
    const summaryHash = hashSummary(summary);

    const prev = await this.repo.getAgentContext(customerId);
    if (prev && prev.summaryHash === summaryHash) {
      // אין שינוי — לא נשלם על embedding חדש
      this.log.log(`refresh ${customerId}: no-op (hash unchanged)`);
      return prev;
    }

    const embeddingInput = this.embeddingInputFromSummary(summary);
    const embedding = await this.embeddings.embed(embeddingInput);

    const row: AgentContextRow = {
      customerId, summary, embedding, riskFlags, opportunityFlags,
      refreshedAt: now.toISOString(),
      version: (prev?.version ?? 0) + 1,
      summaryHash,
    };
    const saved = await this.repo.upsertAgentContext(row);
    this.log.log(
      `refresh ${customerId} v${saved.version} flags=[${riskFlags.join(',')}] ` +
        `opp=[${opportunityFlags.join(',')}]`,
    );
    return saved;
  }

  /** קורא ל-refresh בעקבות סיום ריצה (§5.6 — חישוב מחדש לכל customer_id שהושפע). */
  async refreshAffectedByRun(runId: string): Promise<number> {
    const ids = await this.repo.customerIdsAffectedByRun(runId);
    for (const id of ids) await this.refresh(id);
    return ids.length;
  }

  /** A1 — תקציר נרטיבי לסוכן. בונה context אם חסר. */
  async briefing(customerId: string, reason?: string, now = new Date()): Promise<BriefingResult | null> {
    let ctx = await this.repo.getAgentContext(customerId);
    if (!ctx) {
      ctx = await this.refresh(customerId, now);
      if (!ctx) return null;
    }
    const out = await this.llm.briefing(ctx.summary, reason);
    return {
      customerId, briefing: out.text, model: out.model,
      generatedAt: now.toISOString(),
      cacheRead: out.cacheRead, cacheCreation: out.cacheCreation,
      inputTokens: out.inputTokens, outputTokens: out.outputTokens,
      fallback: out.fallback,
    };
  }

  /**
   * ה-summary הוא JSON מובנה אך embeddings פועלים על טקסט.
   * אנו מצמצמים אותו לטקסט תיאורי קצר ויציב — הסדר חייב להיות דטרמיניסטי.
   */
  private embeddingInputFromSummary(s: CustomerContextSummary): string {
    return [
      `customer:${s.identity.fullName}`,
      `age:${s.identity.ageYears ?? '?'} city:${s.identity.city ?? '?'}`,
      `auth:${s.authorization.hasActive ? 'active' : 'none'}`,
      `accounts:${s.portfolio.accountsCount} assets:${s.portfolio.totalAssets}`,
      `manufacturers:${[...s.portfolio.manufacturers].sort().join('|')}`,
      `products:${[...s.portfolio.products].sort().join('|')}`,
      `last_deposit:${s.recentActivity.lastDepositMonth ?? 'none'}`,
      `terminations:${s.recentActivity.activeTerminations}`,
      `rejects:open=${s.rejects.openCount} critical=${s.rejects.criticalCount} high=${s.rejects.highCount}`,
    ].join(' ');
  }
}
