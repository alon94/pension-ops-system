import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { CustomerContextSummary } from './agent-context.types';
import { BRIEFING_SYSTEM_PROMPT } from './briefing-prompt';

/**
 * LlmProvider — מפיק תקציר נרטיבי בעברית לפי AGENT_CONTEXT (פרק 11 A1).
 *
 * • model: claude-opus-4-7 (ברירת מחדל לפי skill claude-api; אפשר לדרוס דרך LLM_MODEL).
 * • adaptive thinking — Claude מחליט בעצמו על עומק החשיבה.
 * • prompt caching — system prompt מסומן ephemeral; חוסך עלות בפגישות עוקבות.
 * • טיפוסי שגיאות — Anthropic.RateLimitError / APIError, ללא string-match.
 *
 * Fallback: אם ANTHROPIC_API_KEY חסר — תקציר דטרמיניסטי מתוך ה-summary
 * (כך שניתן להציג את ה-pipeline בפיתוח ללא מפתח).
 */

export interface BriefingOutput {
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  cacheCreation?: number;
  fallback: boolean;
}

@Injectable()
export class LlmProvider {
  private readonly log = new Logger('LLM');
  private readonly model = process.env.LLM_MODEL ?? 'claude-opus-4-7';
  private readonly client: Anthropic | null;

  constructor() {
    if (process.env.ANTHROPIC_API_KEY) {
      this.client = new Anthropic();
    } else {
      this.client = null;
      this.log.warn('ANTHROPIC_API_KEY חסר — משתמשים ב-fallback דטרמיניסטי');
    }
  }

  /** מפיק תקציר Hebrew על בסיס AGENT_CONTEXT.summary + reason אופציונלי. */
  async briefing(summary: CustomerContextSummary, reason?: string): Promise<BriefingOutput> {
    if (!this.client) return this.mockBriefing(summary, reason);

    const userPrompt = this.buildUserPrompt(summary, reason);

    try {
      // Adaptive thinking + prompt caching על ה-system block האחרון.
      // Render order: tools → system → messages. הקאש תופס את כל ה-system.
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        thinking: { type: 'adaptive' },
        system: [
          {
            type: 'text',
            text: BRIEFING_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userPrompt }],
      });

      // ContentBlock[] — נרצה רק את הטקסט (לא thinking blocks).
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();

      const usage = response.usage;
      this.log.log(
        `briefing model=${this.model} in=${usage.input_tokens} out=${usage.output_tokens} ` +
          `cache_read=${usage.cache_read_input_tokens ?? 0} cache_write=${usage.cache_creation_input_tokens ?? 0}`,
      );

      return {
        text,
        model: response.model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheRead: usage.cache_read_input_tokens ?? undefined,
        cacheCreation: usage.cache_creation_input_tokens ?? undefined,
        fallback: false,
      };
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) {
        this.log.warn('Rate limited — חוזר ל-fallback');
      } else if (e instanceof Anthropic.AuthenticationError) {
        this.log.error('Anthropic auth failed — חוזר ל-fallback');
      } else if (e instanceof Anthropic.APIError) {
        this.log.error(`Anthropic API ${e.status}: ${e.message}`);
      } else {
        this.log.error(`LLM error: ${(e as Error).message}`);
      }
      return this.mockBriefing(summary, reason, true);
    }
  }

  private buildUserPrompt(s: CustomerContextSummary, reason?: string): string {
    return [
      reason ? `סיבת הפגישה: ${reason}` : 'הסוכן עומד להיכנס לפגישת תפעול עם הלקוח.',
      '',
      'נתוני הלקוח (JSON):',
      '```json',
      JSON.stringify(s, null, 2),
      '```',
      '',
      'הפק תקציר לסוכן לקריאה של 30-60 שניות לפי הכללים שבמערכת.',
    ].join('\n');
  }

  /** Fallback דטרמיניסטי — מבנה את התקציר ישירות מה-summary, ללא LLM. */
  private mockBriefing(s: CustomerContextSummary, reason?: string, afterError = false): BriefingOutput {
    const parts: string[] = [];
    const id = s.identity;
    parts.push(
      [
        `לקוח${id.ageYears !== undefined ? ` בן ${id.ageYears}` : ''}`,
        id.city ? `מ${id.city}` : null,
        s.authorization.hasActive
          ? `עם ייפוי כוח פעיל ל-${s.authorization.expiresInDays ?? '?'} ימים נוספים`
          : 'ללא ייפוי כוח פעיל — לא ניתן להגיש INQUIRY חדש',
      ].filter(Boolean).join(', ') + '.',
    );

    const p = s.portfolio;
    if (p.accountsCount > 0) {
      parts.push(
        `התיק כולל ${p.accountsCount} חשבון/ות אצל ${p.manufacturers.join(', ')} ` +
          `בסך כולל של ${p.totalAssets.toLocaleString('he-IL')} ש"ח.`,
      );
    } else {
      parts.push('לא נמצאו חשבונות פנסיוניים בנתונים.');
    }

    const a = s.recentActivity;
    if (a.lastDepositMonth) {
      const yr = a.lastDepositMonth.slice(0, 4);
      const mo = a.lastDepositMonth.slice(4, 6);
      parts.push(`הפקדה אחרונה: ${mo}/${yr} בסך ${(a.lastDepositAmount ?? 0).toLocaleString('he-IL')} ש"ח.`);
    } else if (p.totalAssets > 0) {
      parts.push('אין הפקדות בנתונים האחרונים — דורש בירור.');
    }

    const r = s.rejects;
    if (r.criticalCount + r.highCount > 0) {
      parts.push(
        `דורש תשומת לב: ${r.criticalCount} ריג'קטים בחומרת CRITICAL ו-${r.highCount} בחומרת HIGH פתוחים. ` +
          'יש לטפל לפני סוף ה-SLA.',
      );
    } else if (r.openCount > 0) {
      parts.push(`קיימים ${r.openCount} ריג'קטים פתוחים בחומרה נמוכה, ניתן לסקור בקצרה.`);
    }

    if (a.activeTerminations > 0) {
      parts.push(`קיים אירוע סיום עבודה פעיל — יש להתכונן לדיון על טופס 161 ופיצויים.`);
    }

    return {
      text: (reason ? `מטרת הפגישה: ${reason}. ` : '') + parts.join(' '),
      model: afterError ? 'fallback-after-error' : 'fallback-local',
      fallback: true,
    };
  }
}
