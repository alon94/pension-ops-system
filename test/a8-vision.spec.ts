import { A8DocumentUnderstandingAgent, DocumentExtractionData } from '../src/agents/a8.document-understanding';
import { Form161VisionExtractor } from '../src/agents/a8-vision/form-161-extractor';

describe('A8 — Form 161 Vision OCR (§11.2 A8, §8.4)', () => {
  // הבדיקות רצות בלי ANTHROPIC_API_KEY: ה-extractor משתמש ב-fallback דטרמיניסטי
  const extractor = new Form161VisionExtractor();
  const a8 = new A8DocumentUnderstandingAgent(extractor);

  const baseTask = (payload: any) => ({
    taskId: 't', agent: 'A8' as const, trigger: 'MANUAL' as const,
    reason: 'test', payload, enqueuedAt: new Date().toISOString(),
  });

  it("fallback מחזיר שדות תקניים ומסומן fallback=true", async () => {
    const res = await a8.run(baseTask({
      contentBase64: Buffer.from('fake-pdf').toString('base64'),
      mediaType: 'application/pdf', fileName: 'form-161-demo.pdf',
    }));
    expect(res.ok).toBe(true);
    expect(res.requiresHumanApproval).toBe(true);
    const data = res.data as DocumentExtractionData;
    expect(data.fallback).toBe(true);
    expect(data.extracted.totalSeveranceAmount).toBeGreaterThan(0);
    expect(data.extracted.redemptionAmount + data.extracted.fixationAmount)
      .toBeCloseTo(data.extracted.totalSeveranceAmount, 0);
  });

  it("מזהה היעדר חתימת יועץ ל-fixation > 200K (§8.4)", async () => {
    const res = await a8.run(baseTask({
      contentBase64: 'x', mediaType: 'application/pdf', fileName: 'big-full-fix.pdf',
    }));
    const data = res.data as DocumentExtractionData;
    // big-full-fix => total 500K, full fixation, מעל סף 200K
    expect(data.extracted.fixationAmount).toBeGreaterThan(200_000);
    // ה-mock כן מציב חתימת יועץ כשנדרש; בודקים שאין F161_MISSING_ADVISOR_SIG
    expect(data.validationIssues.find((i) => i.code === 'F161_MISSING_ADVISOR_SIG')).toBeUndefined();
  });

  it("ערכים אריתמטיים שגויים → F161_ARITHMETIC", async () => {
    // יוצרים תרחיש שלא ניתן ב-mock רגיל ע"י עקיפת השדה ידנית
    const ext = new (class extends Form161VisionExtractor {
      override async extract() {
        return {
          extracted: {
            totalSeveranceAmount: 100, redemptionAmount: 30, fixationAmount: 50,
            taxWithholdingAmount: 0, signedByEmployeeAt: '2024-01-01',
          },
          model: 'test', fallback: true,
        };
      }
    })();
    const agent = new A8DocumentUnderstandingAgent(ext);
    const res = await agent.run(baseTask({
      contentBase64: 'x', mediaType: 'application/pdf',
    }));
    const data = res.data as DocumentExtractionData;
    expect(data.validationIssues.some((i) => i.code === 'F161_ARITHMETIC')).toBe(true);
  });

  it("PDF/image media types נתמכים", async () => {
    for (const mt of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const) {
      const res = await a8.run(baseTask({ contentBase64: 'x', mediaType: mt, fileName: `f-${mt}.bin` }));
      expect(res.ok).toBe(true);
    }
  });
});
