import { InMemoryRepository } from '../src/persistence/in-memory.repository';
import { detectAccountDiscrepancies, detectBeneficiaryDiscrepancy, detectSalaryDepositDiscrepancy } from '../src/rejects/discrepancy';
import { deriveRejectsFromValidation } from '../src/rejects/reject-derivation';
import { IllegalTransitionError, RejectLifecycleService } from '../src/rejects/reject-lifecycle.service';
import { RejectService } from '../src/rejects/reject.service';
import { Reject } from '../src/rejects/reject.types';
import { rejectRiskFlags } from '../src/rejects/risk-flags';
import { addBusinessDays, internalResolutionDue } from '../src/rejects/sla';
import { ValidationIssue } from '../src/validation/types';

describe('SLA (§7.4)', () => {
  it('addBusinessDays מדלג שישי/שבת', () => {
    // 2026-05-21 = יום חמישי. +3 ימי עסקים => ראשון 24, שני 25, שלישי 26
    const from = new Date(Date.UTC(2026, 4, 21));
    expect(addBusinessDays(from, 3).toISOString().slice(0, 10)).toBe('2026-05-26');
  });
  it('פתרון פנימי לפי חומרה — CRITICAL = 24h', () => {
    const from = new Date('2026-05-20T00:00:00Z');
    expect(internalResolutionDue('CRITICAL', from).toISOString()).toBe('2026-05-21T00:00:00.000Z');
  });
});

describe('Reject lifecycle (§7.4)', () => {
  const lc = new RejectLifecycleService();
  const base = (): Reject => ({
    rejectId: 'r1', rejectType: 'MANUFACTURER', rejectCode: 'R001', severity: 'HIGH',
    status: 'OPEN', detectedAt: '2026-05-20T00:00:00Z', resolutionPath: [],
  });

  it('OPEN→IN_PROGRESS→WAITING_MANUFACTURER→RESOLVED', () => {
    let r = lc.applyTransition(base(), { to: 'IN_PROGRESS', by: 'ref1' });
    r = lc.applyTransition(r, { to: 'WAITING_MANUFACTURER', by: 'A3', manufacturerKey: 'MGD' });
    expect(r.slaDueAt).toBeDefined();
    r = lc.applyTransition(r, { to: 'RESOLVED', by: 'A3', resolutionSummary: 'נמצא בקוד חדש' });
    expect(r.status).toBe('RESOLVED');
    expect(r.resolvedAt).toBeDefined();
    expect(r.resolutionPath).toHaveLength(3);
  });

  it('מעבר לא חוקי OPEN→RESOLVED נחסם', () => {
    expect(() => lc.applyTransition(base(), { to: 'RESOLVED', by: 'x' })).toThrow(IllegalTransitionError);
  });

  it('isOverdue אמת רק אם עבר ה-SLA ולא טרמינלי/מוסלם', () => {
    const r = { ...base(), status: 'IN_PROGRESS' as const, slaDueAt: '2026-05-19T00:00:00Z' };
    expect(lc.isOverdue(r, new Date('2026-05-20T00:00:00Z'))).toBe(true);
  });
});

describe("גזירת ריג'קטים מתיקוף (§7.5)", () => {
  it('E001 → R007 CRITICAL; E010(WARN) → R011', () => {
    const issues: ValidationIssue[] = [
      { code: 'E001_BAD_ISRAEL_ID', severity: 'CRITICAL', message: 'bad id', blockCode: '020', recordSeq: 2 },
      { code: 'E010_BALANCE_MISMATCH', severity: 'WARN', message: 'mismatch', blockCode: '050', recordSeq: 5 },
      { code: 'E070_UNKNOWN_CURRENCY', severity: 'WARN', message: 'cur', blockCode: '090', recordSeq: 9 },
    ];
    const out = deriveRejectsFromValidation(issues, { ingestionRunId: 'run1' });
    const codes = out.map((r) => r.rejectCode);
    expect(codes).toContain('R007');
    expect(codes).toContain('R011');
    expect(codes).not.toContain('E070_UNKNOWN_CURRENCY'); // WARN לא ממופה => לא נפתח
    expect(out.find((r) => r.rejectCode === 'R007')?.severity).toBe('CRITICAL');
  });
});

describe('פערים בין מקורות (§7.6)', () => {
  it('R008 — CRM אבל לא מסלקה אחרי 30+ יום', () => {
    const now = new Date('2026-05-20T00:00:00Z');
    const out = detectAccountDiscrepancies(
      [{ policyNumber: 'P1', soldAt: '2026-01-01T00:00:00Z' }],
      new Set<string>(),
      now,
    );
    expect(out[0].rejectCode).toBe('R008');
  });
  it('R009 — מסלקה אבל לא CRM', () => {
    const out = detectAccountDiscrepancies([], new Set(['PX']), new Date());
    expect(out[0].rejectCode).toBe('R009');
  });
  it('R010 — פער שכר↔הפקדה (15000 → 1500 בפועל)', () => {
    const r = detectSalaryDepositDiscrepancy({ policyNumber: 'P', reportedSalary: 15000, actualDepositTotal: 1500 });
    expect(r?.rejectCode).toBe('R010');
    expect(detectSalaryDepositDiscrepancy({ policyNumber: 'P', reportedSalary: 15000, actualDepositTotal: 1800 })).toBeNull();
  });
  it('R015 — מוטבי מסלקה ישנים מעדכון CRM', () => {
    expect(detectBeneficiaryDiscrepancy({ policyNumber: 'P', crmUpdatedAt: '2024-03-01', clearingAsOf: '2024-01-01' })?.rejectCode).toBe('R015');
    expect(detectBeneficiaryDiscrepancy({ policyNumber: 'P', crmUpdatedAt: '2024-01-01', clearingAsOf: '2024-03-01' })).toBeNull();
  });
});

describe('דגלי סיכון (§7.7)', () => {
  it('OPEN_REJECT_HIGH / STALE_REJECT_30D / MULTIPLE_REJECTS', () => {
    const now = new Date('2026-05-20T00:00:00Z');
    const mk = (over: Partial<Reject>): Reject => ({
      rejectId: Math.random().toString(), rejectType: 'INTERNAL', rejectCode: 'R011',
      severity: 'MEDIUM', status: 'OPEN', detectedAt: now.toISOString(), resolutionPath: [], ...over,
    });
    const flags = rejectRiskFlags(
      [
        mk({ severity: 'HIGH' }),
        mk({ detectedAt: '2026-03-01T00:00:00Z' }),
        mk({}), mk({}),
      ],
      now,
    );
    expect(flags.sort()).toEqual(['MULTIPLE_REJECTS', 'OPEN_REJECT_HIGH', 'STALE_REJECT_30D']);
  });
});

describe('RejectService — דה-דופ והסלמה', () => {
  it("open פעמיים לאותו קוד+מקור => ריג'קט אחד", async () => {
    const repo = new InMemoryRepository();
    const svc = new RejectService(repo, new RejectLifecycleService());
    const a = await svc.open({ rejectType: 'INTERNAL', rejectCode: 'R011', severity: 'MEDIUM', sourceEntity: 'BALANCE', sourceEntityId: 'seq:5' });
    const b = await svc.open({ rejectType: 'INTERNAL', rejectCode: 'R011', severity: 'MEDIUM', sourceEntity: 'BALANCE', sourceEntityId: 'seq:5' });
    expect(a.rejectId).toBe(b.rejectId);
    expect(repo.rejects).toHaveLength(1);
  });

  it("escalateOverdue מסלים ריג'קטים שחרגו מ-SLA", async () => {
    const repo = new InMemoryRepository();
    const svc = new RejectService(repo, new RejectLifecycleService());
    const r = await svc.open({ rejectType: 'INTERNAL', rejectCode: 'R011', severity: 'CRITICAL' }, new Date('2026-05-01T00:00:00Z'));
    expect(r.slaDueAt).toBeDefined();
    const escalated = await svc.escalateOverdue(new Date('2026-05-20T00:00:00Z'));
    expect(escalated).toHaveLength(1);
    expect((await repo.getReject(r.rejectId))?.status).toBe('ESCALATED');
  });
});
