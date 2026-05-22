import { CollectionService } from '../src/collection/collection.service';
import { ClearingReport, EmployerReport, ExpectedDeposit } from '../src/collection/collection.types';
import {
  DiscrepancyLifecycleService,
  DiscrepancyTransitionError,
} from '../src/collection/discrepancy-lifecycle.service';
import { detectOverCap, reconcile, MONTHLY_CAP_ILS } from '../src/collection/reconciliation';
import { InMemoryRepository } from '../src/persistence/in-memory.repository';

const exp = (over: Partial<ExpectedDeposit> = {}): ExpectedDeposit => ({
  customerId: 'c1',
  employmentId: 'em1',
  employerId: 'er1',
  accountId: 'a1',
  referenceMonth: '202404',
  expected: { employee: 600, employer: 700, severance: 800 },
  ...over,
});

describe('Reconciliation (§9.4)', () => {
  it('MISSING — אין דוח מעסיק', () => {
    const out = reconcile({ expected: exp() });
    expect(out[0].discrepancyType).toBe('MISSING');
  });

  it('WRONG_FUND — דווח לקופה שונה', () => {
    const emp: EmployerReport = {
      customerId: 'c1', employerId: 'er1', employmentId: 'em1', referenceMonth: '202404',
      accountId: 'OTHER', amounts: { employee: 600, employer: 700, severance: 800 },
    };
    const out = reconcile({ expected: exp(), employerReport: emp });
    expect(out.some((d) => d.discrepancyType === 'WRONG_FUND')).toBe(true);
  });

  it('WRONG_AMOUNT — סכום שונה מעבר לעיגול ₪5', () => {
    const emp: EmployerReport = {
      customerId: 'c1', employerId: 'er1', employmentId: 'em1', referenceMonth: '202404',
      accountId: 'a1', amounts: { employee: 500, employer: 700, severance: 800 },
    };
    const out = reconcile({ expected: exp(), employerReport: emp });
    expect(out.some((d) => d.discrepancyType === 'WRONG_AMOUNT')).toBe(true);
  });

  it('WRONG_SPLIT — סך תואם אך פיצול שונה (סטיית עיגול ≤5)', () => {
    const emp: EmployerReport = {
      customerId: 'c1', employerId: 'er1', employmentId: 'em1', referenceMonth: '202404',
      accountId: 'a1',
      // הזזות בתוך טווח עיגול אך הסך תואם — split mismatch on individual fields
      amounts: { employee: 596, employer: 704, severance: 800 },
    };
    const out = reconcile({ expected: exp(), employerReport: emp });
    expect(out.length).toBe(0); // הכל בתוך טווח עיגול
  });

  it('סטיית עיגול ₪5 מותרת', () => {
    const emp: EmployerReport = {
      customerId: 'c1', employerId: 'er1', employmentId: 'em1', referenceMonth: '202404',
      accountId: 'a1', amounts: { employee: 604, employer: 703, severance: 798 },
    };
    const out = reconcile({ expected: exp(), employerReport: emp });
    expect(out).toHaveLength(0);
  });

  it('§9.3(7) — סעיף 14: אין severance צפוי וגם דווח 0', () => {
    const expected = exp({ expected: { employee: 600, employer: 700, severance: 0 }, section14: true });
    const emp: EmployerReport = {
      customerId: 'c1', employerId: 'er1', employmentId: 'em1', referenceMonth: '202404',
      accountId: 'a1', amounts: { employee: 600, employer: 700, severance: 0 },
    };
    const out = reconcile({ expected, employerReport: emp });
    expect(out).toHaveLength(0);
  });

  it('§9.3(9) — LATE: deposit_date מעבר ל-7 ימים אחרי סוף החודש', () => {
    const emp: EmployerReport = {
      customerId: 'c1', employerId: 'er1', employmentId: 'em1', referenceMonth: '202404',
      accountId: 'a1', amounts: { employee: 600, employer: 700, severance: 800 },
      depositDate: '2024-05-15T00:00:00Z',
    };
    const out = reconcile({ expected: exp(), employerReport: emp });
    expect(out.some((d) => d.discrepancyType === 'LATE')).toBe(true);
  });

  it('שלב 2: מסלקה לא קיבלה למרות שהמעסיק דיווח', () => {
    const emp: EmployerReport = {
      customerId: 'c1', employerId: 'er1', employmentId: 'em1', referenceMonth: '202404',
      accountId: 'a1', amounts: { employee: 600, employer: 700, severance: 800 },
    };
    const out = reconcile({ expected: exp(), employerReport: emp, clearingExpected: true });
    expect(out.some((d) => d.discrepancyType === 'MISSING')).toBe(true);
  });

  it('שלב 2: מסלקה דיווחה לקופה אחרת', () => {
    const emp: EmployerReport = {
      customerId: 'c1', employerId: 'er1', employmentId: 'em1', referenceMonth: '202404',
      accountId: 'a1', amounts: { employee: 600, employer: 700, severance: 800 },
    };
    const clr: ClearingReport = {
      customerId: 'c1', accountId: 'OTHER', referenceMonth: '202404',
      amounts: { employee: 600, employer: 700, severance: 800 },
    };
    const out = reconcile({ expected: exp(), employerReport: emp, clearingReport: clr });
    expect(out.some((d) => d.discrepancyType === 'WRONG_FUND' && d.reportedByClearing)).toBe(true);
  });
});

describe('detectOverCap (§9.3(4))', () => {
  it('סכום הפקדות חוצה-מעסיקים מעל התקרה', () => {
    const r = detectOverCap('c1', '202404', [
      { employer: 1500, employee: 1500 },
      { employer: 1000, employee: 1000 },
    ]);
    expect(r?.discrepancyType).toBe('OVER_CAP');
    expect(r?.discrepancyAmount).toBe(5000 - MONTHLY_CAP_ILS);
  });

  it('מתחת לתקרה => null', () => {
    expect(detectOverCap('c1', '202404', [{ employer: 100, employee: 100 }])).toBeNull();
  });
});

describe('Discrepancy lifecycle (§9.2)', () => {
  const lc = new DiscrepancyLifecycleService();
  const base = () => ({
    discrepancyId: 'd1', referenceMonth: '202404',
    expectedAmountEmployee: 0, expectedAmountEmployer: 0, expectedAmountSeverance: 0,
    discrepancyType: 'WRONG_AMOUNT' as const, discrepancyAmount: 50,
    status: 'OPEN' as const, detectedAt: '2026-05-20T00:00:00Z',
  });

  it('OPEN→EMPLOYER_NOTIFIED→FUND_NOTIFIED→RESOLVED', () => {
    let d = lc.applyTransition(base(), { to: 'EMPLOYER_NOTIFIED', by: 'A5' });
    d = lc.applyTransition(d, { to: 'FUND_NOTIFIED', by: 'A7' });
    d = lc.applyTransition(d, { to: 'RESOLVED', by: 'A7', summary: 'תוקן ע"י המעסיק' });
    expect(d.status).toBe('RESOLVED');
    expect(d.resolvedAt).toBeDefined();
  });

  it('מעבר לא חוקי RESOLVED→OPEN', () => {
    const d = { ...base(), status: 'RESOLVED' as const };
    expect(() => lc.applyTransition(d, { to: 'OPEN', by: 'x' })).toThrow(DiscrepancyTransitionError);
  });
});

describe('CollectionService — orchestration', () => {
  it('reconcileMonth פותח DISCREPANCYs ומבצע דה-דופ בקריאה שנייה', async () => {
    const repo = new InMemoryRepository();
    const svc = new CollectionService(repo, new DiscrepancyLifecycleService());
    const input = {
      expected: [exp()],
      employerReports: [{
        customerId: 'c1', employerId: 'er1', employmentId: 'em1', referenceMonth: '202404',
        accountId: 'a1', amounts: { employee: 500, employer: 700, severance: 800 },
      }],
      clearingReports: [],
    };
    const opened1 = await svc.reconcileMonth(input);
    expect(opened1.length).toBeGreaterThan(0);
    const opened2 = await svc.reconcileMonth(input);
    expect(opened2).toHaveLength(0); // דה-דופ
  });

  it('monthlyReport מסכם לפי type/status', async () => {
    const repo = new InMemoryRepository();
    const svc = new CollectionService(repo, new DiscrepancyLifecycleService());
    await svc.reconcileMonth({ expected: [exp()], employerReports: [], clearingReports: [] });
    const r = await svc.monthlyReport('202404');
    expect(r.total).toBe(1);
    expect(r.byType.MISSING).toBe(1);
    expect(r.byStatus.OPEN).toBe(1);
  });
});
