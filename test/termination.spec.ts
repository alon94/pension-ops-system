import { InMemoryRepository } from '../src/persistence/in-memory.repository';
import {
  Form161LifecycleService,
  Form161TransitionError,
} from '../src/termination/form-161-lifecycle.service';
import {
  ADVISOR_SIG_THRESHOLD_ILS,
  checkSeveranceWithdrawal,
  validateForm161,
} from '../src/termination/form-161-rules';
import {
  detectConfirmedTermination,
  detectPotentialTermination,
  isRehiredWithinGrace,
} from '../src/termination/termination-detection';
import {
  TerminationLifecycleService,
  TerminationTransitionError,
} from '../src/termination/termination-lifecycle.service';
import { TerminationService } from '../src/termination/termination.service';
import { Form161, NewForm161 } from '../src/termination/termination.types';

const baseSnap = {
  customerId: 'c1',
  employmentId: 'e1',
  employerId: 'emp1',
  accountId: 'a1',
  startDate: '2018-01-01T00:00:00Z',
  accountStatus: 'ACTIVE' as const,
};

describe('זיהוי סיום עבודה (§8.2)', () => {
  it('confirmed — end_date קיים והפקדה אחרונה קודמת', () => {
    const r = detectConfirmedTermination(
      { ...baseSnap, endDate: '2024-03-31T00:00:00Z', lastDepositDate: '2024-02-01T00:00:00Z' },
      { allEmploymentsForCustomer: [] },
      'CLEARING',
    );
    expect(r?.reason).toBe('CONFIRMED_END_DATE');
    expect(r?.candidate.confirmedTerminationDate).toBe('2024-03-31');
    expect(r?.suppressed).toBeUndefined();
  });

  it('potential — אין הפקדה 60+ ימים וחשבון פעיל', () => {
    const r = detectPotentialTermination(
      { ...baseSnap, lastDepositDate: '2026-02-01T00:00:00Z' },
      { allEmploymentsForCustomer: [], now: new Date('2026-05-20T00:00:00Z') },
    );
    expect(r?.reason).toBe('POTENTIAL_NO_DEPOSIT_60D');
  });

  it('potential לא נפתח אם החשבון לא ACTIVE', () => {
    const r = detectPotentialTermination(
      { ...baseSnap, accountStatus: 'CLOSED', lastDepositDate: '2026-01-01T00:00:00Z' },
      { allEmploymentsForCustomer: [], now: new Date('2026-05-20T00:00:00Z') },
    );
    expect(r).toBeNull();
  });

  it('§8.5(7) — חזרה לאותו מעסיק תוך 90 יום => suppressed', () => {
    const other = { ...baseSnap, employmentId: 'e2', startDate: '2024-05-01T00:00:00Z' };
    const r = detectConfirmedTermination(
      { ...baseSnap, endDate: '2024-03-31T00:00:00Z', lastDepositDate: '2024-02-01T00:00:00Z' },
      { allEmploymentsForCustomer: [other] },
      'CLEARING',
    );
    expect(r?.suppressed).toBe('REHIRED_WITHIN_90D');
  });

  it('§8.5(9) — קרן ותיקה מסומנת בהערות', () => {
    const r = detectConfirmedTermination(
      { ...baseSnap, endDate: '2024-03-31T00:00:00Z', lastDepositDate: '2024-02-01T00:00:00Z', isVatika: true },
      { allEmploymentsForCustomer: [] },
      'CLEARING',
    );
    expect(r?.notes.join(' ')).toContain('קרן ותיקה');
  });

  it('isRehiredWithinGrace דורש אותו זוג customer+employer', () => {
    expect(
      isRehiredWithinGrace(
        { ...baseSnap, endDate: '2024-03-31T00:00:00Z' },
        [{ ...baseSnap, employmentId: 'e2', employerId: 'OTHER', startDate: '2024-05-01T00:00:00Z' }],
      ),
    ).toBe(false);
  });
});

describe('Form 161 — אילוצי תוכן (§8.4)', () => {
  const base = (over: Partial<Form161> = {}): Form161 => ({
    form161Id: 'f1', terminationEventId: 't1', accountId: 'a1', customerId: 'c1', employerId: 'emp1',
    totalSeveranceAmount: 100_000, redemptionAmount: 0, fixationAmount: 100_000, taxWithholdingAmount: 0,
    signedByEmployerAt: '2024-04-01', validationStatus: 'DRAFT', ...over,
  });

  it('אריתמטיקה: redemption + fixation ≠ total', () => {
    const issues = validateForm161(base({ redemptionAmount: 30_000, fixationAmount: 50_000 }));
    expect(issues.find((i) => i.code === 'F161_ARITHMETIC')).toBeDefined();
  });

  it('פדיון > 0 ללא חתימת עובד => F161_MISSING_EMPLOYEE_SIG', () => {
    const issues = validateForm161(base({ redemptionAmount: 40_000, fixationAmount: 60_000 }));
    expect(issues.some((i) => i.code === 'F161_MISSING_EMPLOYEE_SIG')).toBe(true);
  });

  it(`קיבוע מעל סף ${ADVISOR_SIG_THRESHOLD_ILS} ללא יועץ => F161_MISSING_ADVISOR_SIG`, () => {
    const issues = validateForm161(base({ totalSeveranceAmount: 250_000, fixationAmount: 250_000 }));
    expect(issues.some((i) => i.code === 'F161_MISSING_ADVISOR_SIG')).toBe(true);
  });

  it('סכומים שליליים => F161_NEGATIVE_AMOUNT', () => {
    const issues = validateForm161(base({ redemptionAmount: -1, fixationAmount: 100_001 }));
    expect(issues.some((i) => i.code === 'F161_NEGATIVE_AMOUNT')).toBe(true);
  });

  it('סטיית עיגול ₪1 מותרת', () => {
    const issues = validateForm161(base({ redemptionAmount: 50_000.4, fixationAmount: 50_000.4, totalSeveranceAmount: 100_000 }));
    expect(issues.find((i) => i.code === 'F161_ARITHMETIC')).toBeUndefined();
  });

  it('checkSeveranceWithdrawal — אסורה ללא טופס VERIFIED/SUBMITTED', () => {
    expect(checkSeveranceWithdrawal({ accountId: 'a1', forms: [] })).toBeTruthy();
    expect(checkSeveranceWithdrawal({ accountId: 'a1', forms: [base({ validationStatus: 'DRAFT' })] })).toBeTruthy();
    expect(checkSeveranceWithdrawal({ accountId: 'a1', forms: [base({ validationStatus: 'VERIFIED' })] })).toBeNull();
    expect(checkSeveranceWithdrawal({ accountId: 'a1', forms: [base({ validationStatus: 'SUBMITTED' })] })).toBeNull();
  });
});

describe('Form 161 — lifecycle (§8.4)', () => {
  const lc = new Form161LifecycleService();
  const valid = (): Form161 => ({
    form161Id: 'f', terminationEventId: 't', accountId: 'a', customerId: 'c', employerId: 'e',
    totalSeveranceAmount: 100_000, redemptionAmount: 0, fixationAmount: 100_000, taxWithholdingAmount: 0,
    signedByEmployerAt: '2024-04-01', validationStatus: 'DRAFT',
  });

  it('DRAFT→SIGNED דורש חתימת מעסיק; אחרת זריקה', () => {
    expect(() => lc.applyTransition({ ...valid(), signedByEmployerAt: undefined }, { to: 'SIGNED', by: 'x' })).toThrow(Form161TransitionError);
    expect(lc.applyTransition(valid(), { to: 'SIGNED', by: 'x' }).validationStatus).toBe('SIGNED');
  });

  it('DRAFT→REJECTED דורש reason', () => {
    expect(() => lc.applyTransition(valid(), { to: 'REJECTED', by: 'x' })).toThrow(Form161TransitionError);
    const r = lc.applyTransition(valid(), { to: 'REJECTED', by: 'x', reason: 'חתימה חסרה' });
    expect(r.rejectedReason).toBe('חתימה חסרה');
  });

  it('SIGNED→VERIFIED מאמת את כל החוקים', () => {
    let f = lc.applyTransition(valid(), { to: 'SIGNED', by: 'x' });
    f = lc.applyTransition(f, { to: 'VERIFIED', by: 'y' });
    expect(f.validationStatus).toBe('VERIFIED');
  });

  it('VERIFIED→SUBMITTED', () => {
    let f = lc.applyTransition(valid(), { to: 'SIGNED', by: 'x' });
    f = lc.applyTransition(f, { to: 'VERIFIED', by: 'y' });
    f = lc.applyTransition(f, { to: 'SUBMITTED', by: 'z' });
    expect(f.validationStatus).toBe('SUBMITTED');
  });
});

describe('Termination event lifecycle (§8.3)', () => {
  const lc = new TerminationLifecycleService();
  const base = () => ({
    terminationEventId: 't', customerId: 'c1', detectedAt: '2026-05-20T00:00:00Z',
    detectionSource: 'CLEARING' as const, status: 'DETECTED' as const,
  });

  it('DETECTED→CONFIRMED→IN_PROCESS→COMPLETED', () => {
    let e = lc.applyTransition(base(), { to: 'CONFIRMED', by: 'A6' });
    e = lc.applyTransition(e, { to: 'IN_PROCESS', by: 'ref' });
    e = lc.applyTransition(e, { to: 'COMPLETED', by: 'ref' });
    expect(e.status).toBe('COMPLETED');
  });

  it('מעבר לא חוקי DETECTED→COMPLETED', () => {
    expect(() => lc.applyTransition(base(), { to: 'COMPLETED', by: 'x' })).toThrow(TerminationTransitionError);
  });
});

describe('TerminationService — דה-דופ וקריאות', () => {
  it('open פעמיים לאותו customer+employment => אירוע אחד', async () => {
    const repo = new InMemoryRepository();
    const svc = new TerminationService(repo, new TerminationLifecycleService(), new Form161LifecycleService());
    const snap = {
      ...baseSnap,
      endDate: '2024-03-31T00:00:00Z',
      lastDepositDate: '2024-02-01T00:00:00Z',
    };
    const a = await svc.openFromSnapshot(snap, [], 'CLEARING');
    const b = await svc.openFromSnapshot(snap, [], 'CLEARING');
    expect(a?.terminationEventId).toBe(b?.terminationEventId);
    expect(repo.terminations).toHaveLength(1);
  });

  it('createForm מחזיר issues אם אריתמטיקה שגויה', async () => {
    const repo = new InMemoryRepository();
    const svc = new TerminationService(repo, new TerminationLifecycleService(), new Form161LifecycleService());
    const input: NewForm161 = {
      terminationEventId: 't1', accountId: 'a1', customerId: 'c1', employerId: 'e1',
      totalSeveranceAmount: 100_000, redemptionAmount: 30_000, fixationAmount: 50_000, taxWithholdingAmount: 0,
    };
    const { form, issues } = await svc.createForm(input);
    expect(form.validationStatus).toBe('DRAFT');
    expect(issues.some((i) => i.code === 'F161_ARITHMETIC')).toBe(true);
  });
});
