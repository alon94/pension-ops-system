import { Injectable } from '@nestjs/common';
import { Agent, AgentResult, AgentTask, AUTONOMY } from './agent.types';
import { Form161Extracted, Form161VisionExtractor } from './a8-vision/form-161-extractor';
import { validateForm161 } from '../termination/form-161-rules';

export interface DocumentExtractionPayload {
  contentBase64: string;
  mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  fileName?: string;
  /** הקשר לוואלידציה: יוצא בכל מקרה, וגם אם terminationEventId חסר נוכל להחזיר טיוטה. */
  terminationEventId?: string;
  accountId?: string;
  customerId?: string;
  employerId?: string;
}

export interface DocumentExtractionData {
  extracted: Form161Extracted;
  /** issues שמתקבלות מהפעלת אילוצי §8.4 על השדות שחולצו */
  validationIssues: { code: string; message: string }[];
  model: string;
  fallback: boolean;
  tokensIn?: number;
  tokensOut?: number;
}

/**
 * A8 — Document Understanding Agent (§11.2 A8, §11.5 PARTIAL).
 *
 * חילוץ אוטומטי של טופס 161 מסריקה ע"י Claude Vision. הסוכן לא יוצר ישות
 * FORM_161 בעצמו — הוא מחזיר את המידע + אילוצים שלא מתקיימים, ואדם בלבד
 * מאשר ויוצר את הטופס. §11.5: A8 בחלקה — אימות חתימה דורש אישור אדם.
 */
@Injectable()
export class A8DocumentUnderstandingAgent implements Agent<DocumentExtractionPayload> {
  readonly id = 'A8' as const;
  readonly autonomy = AUTONOMY.A8;

  constructor(private readonly extractor: Form161VisionExtractor) {}

  async run(task: AgentTask<DocumentExtractionPayload>): Promise<AgentResult> {
    const p = task.payload;
    const out = await this.extractor.extract(p.contentBase64, p.mediaType, p.fileName);

    // בודקים את התוצאה מול חוקי §8.4 כאילו זה כבר טופס DRAFT
    const draftForm = {
      form161Id: 'preview', terminationEventId: p.terminationEventId ?? 'preview',
      accountId: p.accountId ?? 'preview', customerId: p.customerId ?? 'preview', employerId: p.employerId ?? 'preview',
      totalSeveranceAmount: out.extracted.totalSeveranceAmount,
      redemptionAmount: out.extracted.redemptionAmount,
      fixationAmount: out.extracted.fixationAmount,
      taxWithholdingAmount: out.extracted.taxWithholdingAmount,
      signedByEmployeeAt: out.extracted.signedByEmployeeAt,
      signedByEmployerAt: out.extracted.signedByEmployerAt,
      signedByAdvisorAt: out.extracted.signedByAdvisorAt,
      validationStatus: 'DRAFT' as const,
    };
    const issues = validateForm161(draftForm);

    const data: DocumentExtractionData = {
      extracted: out.extracted,
      validationIssues: issues.map((i) => ({ code: i.code, message: i.message })),
      model: out.model, fallback: out.fallback,
      tokensIn: out.inputTokens, tokensOut: out.outputTokens,
    };

    return {
      ok: true,
      // §11.5 — A8 בחלקה: אדם חייב לאשר לפני שהטופס נוצר במערכת
      requiresHumanApproval: true,
      summary: `A8 חילץ טופס 161 (${out.fallback ? 'fallback' : out.model}) — ${issues.length} אילוצים לבדיקה`,
      data,
    };
  }
}
