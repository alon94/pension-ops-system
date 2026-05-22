import { sumMatches, toAmount } from '../common/money';
import {
  ClearingReport,
  EmployerReport,
  ExpectedDeposit,
  NewCollectionDiscrepancy,
} from './collection.types';

/**
 * §9.4 — לוגיקת בקרה דו-שלבית של A5/A7. טהור — בלי DB.
 *
 *   stage 1: expected vs employer   => WRONG_AMOUNT / WRONG_SPLIT / WRONG_FUND
 *   stage 2: employer vs clearing   => MISSING / WRONG_FUND
 *
 * §9.3(2) — סטיית עיגול עד 5 ₪ מותרת בהשוואת סכומים.
 */

export const ROUND_TOLERANCE_ILS = 5;

/** §9.3(4) — תקרת תגמולי עובד+מעסיק חודשית (אינדיקטיבי; ה-A10 מתחזק ערך מדויק). */
export const MONTHLY_CAP_ILS = 2_500;

function sumOf(a: { employee: number; employer: number; severance: number }): number {
  return toAmount(a.employee) + toAmount(a.employer) + toAmount(a.severance);
}

function near(a: number, b: number): boolean {
  return sumMatches(a, [b], ROUND_TOLERANCE_ILS);
}

/** האם הפיצול תואם (כל רכיב בנפרד תוך סובלנות 5 ₪)? */
function splitMatches(a: ExpectedDeposit['expected'], b: { employee: number; employer: number; severance: number }, section14 = false): boolean {
  if (!near(a.employee, b.employee)) return false;
  if (!near(a.employer, b.employer)) return false;
  // §9.3(7) — סעיף 14: לא דורש severance > 0
  if (section14 && a.severance === 0) return b.severance === 0 || near(0, b.severance);
  return near(a.severance, b.severance);
}

export interface ReconcileInputs {
  expected: ExpectedDeposit;
  employerReport?: EmployerReport;
  clearingReport?: ClearingReport;
  /**
   * האם הסבב הזה כולל בקרת שלב-2 מול המסלקה.
   * False (ברירת מחדל) => רק שלב 1 (employer vs expected). Stage-2 MISSING
   * (employer דיווח אך מסלקה לא) מופק רק כאשר ערך זה True ו-clearingReport חסר.
   */
  clearingExpected?: boolean;
  /** §9.3(9) — איחור: deposit_date מעבר ל-7 ימים אחרי סוף החודש */
  lateGraceDays?: number;
}

/**
 * §9.4 — מחזיר את כל הפערים שזוהו עבור (customer, employment, month).
 */
export function reconcile(inputs: ReconcileInputs): NewCollectionDiscrepancy[] {
  const out: NewCollectionDiscrepancy[] = [];
  const { expected, employerReport, clearingReport } = inputs;
  const lateGrace = inputs.lateGraceDays ?? 7;

  // ---------- שלב 1: expected vs employer ----------
  if (!employerReport) {
    out.push(makeDiscrepancy(expected, 'MISSING', sumOf(expected.expected)));
  } else {
    // §9.3(1) — קופה שגויה: דווח לקופה שונה מהמוסכמת
    if (employerReport.accountId && employerReport.accountId !== expected.accountId) {
      out.push(
        makeDiscrepancy(expected, 'WRONG_FUND', sumOf(expected.expected), { reportedByEmployer: employerReport }),
      );
    } else {
      // סכום או פיצול
      if (!splitMatches(expected.expected, employerReport.amounts, expected.section14)) {
        const totalExpected = sumOf(expected.expected);
        const totalReported = sumOf(employerReport.amounts);
        const totalDiff = Math.abs(totalExpected - totalReported);
        const type = totalDiff > ROUND_TOLERANCE_ILS ? 'WRONG_AMOUNT' : 'WRONG_SPLIT';
        out.push(
          makeDiscrepancy(expected, type, totalDiff, { reportedByEmployer: employerReport }),
        );
      }
    }

    // §9.3(9) — איחור
    if (employerReport.depositDate) {
      const endOfMonth = lastDayOfMonth(expected.referenceMonth);
      const allowedUntil = new Date(endOfMonth.getTime() + lateGrace * 86400_000);
      if (new Date(employerReport.depositDate).getTime() > allowedUntil.getTime()) {
        out.push(
          makeDiscrepancy(expected, 'LATE', 0, { reportedByEmployer: employerReport }),
        );
      }
    }
  }

  // ---------- שלב 2: employer vs clearing ----------
  if (employerReport && clearingReport) {
    if (clearingReport.accountId !== (employerReport.accountId ?? expected.accountId)) {
      out.push(
        makeDiscrepancy(expected, 'WRONG_FUND', sumOf(employerReport.amounts), {
          reportedByEmployer: employerReport,
          reportedByClearing: clearingReport,
        }),
      );
    } else if (!splitMatches(employerReport.amounts, clearingReport.amounts, expected.section14)) {
      const diff = Math.abs(sumOf(employerReport.amounts) - sumOf(clearingReport.amounts));
      out.push(
        makeDiscrepancy(expected, diff > ROUND_TOLERANCE_ILS ? 'WRONG_AMOUNT' : 'WRONG_SPLIT', diff, {
          reportedByEmployer: employerReport,
          reportedByClearing: clearingReport,
        }),
      );
    }
  } else if (employerReport && !clearingReport && inputs.clearingExpected) {
    // §9.4 — שלב 2 פעיל: המעסיק דיווח אך המסלקה לא — חסר ביצרן
    out.push(
      makeDiscrepancy(expected, 'MISSING', sumOf(employerReport.amounts), {
        reportedByEmployer: employerReport,
      }),
    );
  }

  return out;
}

/**
 * §9.3(4) — סכום הפקדות חודשיות פר customer מול תקרת חוק.
 * מחזיר OVER_CAP אם הסכום (employee+employer) חורג מהתקרה.
 */
export function detectOverCap(
  customerId: string,
  referenceMonth: string,
  monthlyDepositsAcrossEmployers: { employer: number; employee: number }[],
  cap = MONTHLY_CAP_ILS,
): NewCollectionDiscrepancy | null {
  const total = monthlyDepositsAcrossEmployers.reduce((a, b) => a + b.employee + b.employer, 0);
  if (total <= cap) return null;
  return {
    customerId,
    referenceMonth,
    expectedAmountEmployee: 0, expectedAmountEmployer: 0, expectedAmountSeverance: 0,
    discrepancyType: 'OVER_CAP',
    discrepancyAmount: total - cap,
    resolutionSummary: `סך תגמולים ${total} > תקרה ${cap}`,
  };
}

function makeDiscrepancy(
  exp: ExpectedDeposit,
  type: NewCollectionDiscrepancy['discrepancyType'],
  amount: number,
  extra: Partial<NewCollectionDiscrepancy> = {},
): NewCollectionDiscrepancy {
  return {
    customerId: exp.customerId,
    employerId: exp.employerId,
    employmentId: exp.employmentId,
    referenceMonth: exp.referenceMonth,
    expectedAccountId: exp.accountId,
    expectedAmountEmployee: exp.expected.employee,
    expectedAmountEmployer: exp.expected.employer,
    expectedAmountSeverance: exp.expected.severance,
    discrepancyType: type,
    discrepancyAmount: amount,
    ...extra,
  };
}

function lastDayOfMonth(yyyymm: string): Date {
  const y = Number(yyyymm.slice(0, 4));
  const m = Number(yyyymm.slice(4, 6));
  return new Date(Date.UTC(y, m, 0, 23, 59, 59));
}
