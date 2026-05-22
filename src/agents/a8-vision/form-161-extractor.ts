import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';

/**
 * §11.2 A8 + §8.4 — חילוץ שדות מסריקת טופס 161 ע"י Claude Vision.
 *
 * הקלט: PDF או תמונה (JPG/PNG/WebP/GIF) כ-base64 + media type.
 * הפלט: אובייקט JSON עם שדות הטופס (סכומים, מספרי טופס, תאריכי חתימה).
 *
 * אם ANTHROPIC_API_KEY חסר — fallback דטרמיניסטי מהשם של הקובץ (למוצג בלבד).
 */

export interface Form161Extracted {
  formNumber?: string;
  totalSeveranceAmount: number;
  redemptionAmount: number;
  fixationAmount: number;
  taxWithholdingAmount: number;
  signedByEmployeeAt?: string;
  signedByEmployerAt?: string;
  signedByAdvisorAt?: string;
  /** Confidence per field 0-1 — שמיש בעיקר ל-UI ולסימון לסוכן */
  confidence?: Record<string, number>;
  /** הערות מהמודל — לדוגמה "חתימת המעסיק לא נראית ברורה" */
  notes?: string;
}

export interface ExtractionResult {
  extracted: Form161Extracted;
  model: string;
  fallback: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  rawText?: string;        // התשובה הגולמית של המודל (לדיבאג)
}

const SYSTEM_PROMPT = `אתה עוזר תפעולי לסוכן/יועץ פנסיוני בישראל המתמחה בחילוץ שדות מטופס 161 סרוק. \
טופס 161 הוא הצהרת עובד למעסיק על שיוך כספי פיצויים בעת סיום עבודה.

מטרתך: לחלץ את השדות המבניים של הטופס מתוך הסריקה ולהחזיר JSON תקני. \
אל תמציא ערכים. אם שדה לא קריא, החזר null וציין את הסיבה ב-notes.

שדות הטופס:
- formNumber: מספר אסמכתא של המעסיק (מחרוזת, אופציונלי)
- totalSeveranceAmount: סך פיצויים מצטברים (מספר בש"ח, חובה)
- redemptionAmount: סכום שיועבר לפדיון (מספר בש"ח, חובה — 0 אם לא נבחר)
- fixationAmount: סכום שיישאר לקיבוע בקופה (מספר בש"ח, חובה — 0 אם לא נבחר)
- taxWithholdingAmount: ניכוי מס במקור (מספר בש"ח, ברירת מחדל 0)
- signedByEmployeeAt: תאריך חתימת העובד (YYYY-MM-DD; null אם לא חתום)
- signedByEmployerAt: תאריך חתימת המעסיק (YYYY-MM-DD; null אם לא חתום)
- signedByAdvisorAt: תאריך חתימת יועץ מס (YYYY-MM-DD; null אם לא נדרש)
- confidence: אובייקט עם confidence (0-1) פר שדה — דיווח כן על מה שאינך בטוח לגביו
- notes: הערות חופשיות בעברית — חתימות שאינן ברורות, סכומים מעורפלים, סתירות

אילוצים שעוזרים בזיהוי שגיאות:
- redemptionAmount + fixationAmount = totalSeveranceAmount (סטיית עיגול עד ₪1)
- אם redemptionAmount > 0 חייב להיות signedByEmployeeAt
- אם fixationAmount > 200,000 חייב להיות signedByAdvisorAt

תאריכים בטופס לרוב בפורמט DD/MM/YYYY — המר ל-YYYY-MM-DD.
סכומים לרוב מופיעים עם פסיק אלפים (לדוגמה "120,000") — החזר כמספר.

החזר אך ורק JSON תקני, ללא markdown, ללא הסברים נוספים.`;

@Injectable()
export class Form161VisionExtractor {
  private readonly log = new Logger('A8.Vision');
  private readonly model = process.env.LLM_VISION_MODEL ?? process.env.LLM_MODEL ?? 'claude-opus-4-7';
  private readonly client: Anthropic | null;

  constructor() {
    this.client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
    if (!this.client) this.log.warn('ANTHROPIC_API_KEY חסר — A8 ישתמש ב-fallback');
  }

  async extract(
    fileBase64: string,
    mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
    fileName?: string,
  ): Promise<ExtractionResult> {
    if (!this.client) return this.mockExtract(fileName);

    try {
      const source =
        mediaType === 'application/pdf'
          ? ({ type: 'base64' as const, media_type: 'application/pdf' as const, data: fileBase64 })
          : ({ type: 'base64' as const, media_type: mediaType, data: fileBase64 });

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        thinking: { type: 'adaptive' },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: [
            mediaType === 'application/pdf'
              ? ({ type: 'document', source } as Anthropic.DocumentBlockParam)
              : ({ type: 'image', source } as Anthropic.ImageBlockParam),
            { type: 'text', text: 'חלץ את שדות הטופס לפי הסכמה והחזר JSON בלבד.' },
          ],
        }],
      });

      const rawText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();

      const extracted = this.safeParseJson(rawText);
      this.log.log(
        `extract model=${this.model} in=${response.usage.input_tokens} out=${response.usage.output_tokens} ` +
          `cache_read=${response.usage.cache_read_input_tokens ?? 0}`,
      );
      return {
        extracted,
        model: response.model,
        fallback: false,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens ?? undefined,
        rawText,
      };
    } catch (e) {
      if (e instanceof Anthropic.APIError) {
        this.log.error(`Anthropic API ${e.status}: ${e.message}`);
      } else {
        this.log.error(`vision error: ${(e as Error).message}`);
      }
      return this.mockExtract(fileName, true);
    }
  }

  /** מנסה לחלץ JSON מהפלט גם אם המודל החזיר טקסט שעוטף אותו. */
  private safeParseJson(text: string): Form161Extracted {
    const stripped = text.replace(/```json\s*|\s*```/g, '').trim();
    const match = stripped.match(/\{[\s\S]*\}/);
    const candidate = match ? match[0] : stripped;
    try {
      const parsed = JSON.parse(candidate);
      return normalizeExtracted(parsed);
    } catch {
      this.log.warn(`לא הצלחתי לפרסר JSON — חוזר ל-defaults`);
      return defaultExtracted('שגיאת פירסור JSON מהמודל');
    }
  }

  /**
   * Mock דטרמיניסטי המבוסס על שם הקובץ — לאפשר הדגמת UI ללא API key.
   * אם שם הקובץ מכיל מילים תוצאתיות (אחוז, ש"ח) הוא ייצר ערכים ריאליים.
   */
  private mockExtract(fileName?: string, afterError = false): ExtractionResult {
    const seed = (fileName ?? 'demo').toLowerCase();
    const total = seed.includes('big') ? 500_000 : 120_000;
    const redemptionRatio = seed.includes('full-fix') ? 0 : seed.includes('full-red') ? 1 : 0.5;
    const red = Math.round(total * redemptionRatio);
    const fix = total - red;
    return {
      extracted: {
        formNumber: `MOCK-${seed.replace(/[^a-z0-9]/g, '').slice(0, 8) || 'auto'}`,
        totalSeveranceAmount: total,
        redemptionAmount: red,
        fixationAmount: fix,
        taxWithholdingAmount: red > 0 ? Math.round(red * 0.15) : 0,
        signedByEmployeeAt: red > 0 ? '2024-03-15' : undefined,
        signedByEmployerAt: '2024-03-20',
        signedByAdvisorAt: fix > 200_000 ? '2024-03-18' : undefined,
        confidence: { totalSeveranceAmount: 0.95, redemptionAmount: 0.9, fixationAmount: 0.9 },
        notes: 'נתוני דמו דטרמיניסטיים (אין ANTHROPIC_API_KEY)',
      },
      model: afterError ? 'mock-after-error' : 'mock-local',
      fallback: true,
    };
  }
}

function normalizeExtracted(raw: any): Form161Extracted {
  const num = (v: unknown) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return Number(v.replace(/,/g, '').trim()) || 0;
    return 0;
  };
  const dateOrUndef = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  return {
    formNumber: typeof raw.formNumber === 'string' ? raw.formNumber : undefined,
    totalSeveranceAmount: num(raw.totalSeveranceAmount),
    redemptionAmount: num(raw.redemptionAmount),
    fixationAmount: num(raw.fixationAmount),
    taxWithholdingAmount: num(raw.taxWithholdingAmount),
    signedByEmployeeAt: dateOrUndef(raw.signedByEmployeeAt),
    signedByEmployerAt: dateOrUndef(raw.signedByEmployerAt),
    signedByAdvisorAt: dateOrUndef(raw.signedByAdvisorAt),
    confidence: typeof raw.confidence === 'object' && raw.confidence ? raw.confidence : undefined,
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
  };
}

function defaultExtracted(notes: string): Form161Extracted {
  return {
    totalSeveranceAmount: 0, redemptionAmount: 0, fixationAmount: 0, taxWithholdingAmount: 0,
    notes,
  };
}
