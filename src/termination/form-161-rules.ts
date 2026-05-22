import { sumMatches } from '../common/money';
import { Form161 } from './termination.types';

/**
 * §8.4 — אילוצי תוכן לטופס 161 (אריתמטיקה + חתימות + סף יועץ).
 * החוקים טהורים — נבדקים מחוץ למסד הנתונים.
 */

export type Form161IssueCode =
  | 'F161_ARITHMETIC'           // redemption + fixation != total
  | 'F161_NEGATIVE_AMOUNT'
  | 'F161_MISSING_EMPLOYEE_SIG' // יש פדיון אך אין חתימת עובד
  | 'F161_MISSING_EMPLOYER_SIG' // אין חתימת מעסיק
  | 'F161_MISSING_ADVISOR_SIG'  // קיבוע מעל 200K ללא חתימת יועץ מס
  | 'F161_NO_ALLOCATION';       // total > 0 אבל אין הקצאה

/** §8.4 — סף קיבוע שמעליו נדרשת חתימת יועץ מס. */
export const ADVISOR_SIG_THRESHOLD_ILS = 200_000;

export interface Form161Issue {
  code: Form161IssueCode;
  message: string;
}

export function validateForm161(f: Form161): Form161Issue[] {
  const issues: Form161Issue[] = [];

  if ([f.totalSeveranceAmount, f.redemptionAmount, f.fixationAmount].some((v) => v < 0)) {
    issues.push({ code: 'F161_NEGATIVE_AMOUNT', message: 'סכומים חייבים להיות אי-שליליים' });
  }

  // §8.4 — אילוץ אריתמטי
  if (!sumMatches(f.totalSeveranceAmount, [f.redemptionAmount, f.fixationAmount])) {
    issues.push({
      code: 'F161_ARITHMETIC',
      message: `redemption (${f.redemptionAmount}) + fixation (${f.fixationAmount}) != total (${f.totalSeveranceAmount})`,
    });
  }

  if (f.totalSeveranceAmount > 0 && f.redemptionAmount + f.fixationAmount === 0) {
    issues.push({ code: 'F161_NO_ALLOCATION', message: 'נדרש לפצל בין פדיון לקיבוע' });
  }

  // §8.4 — אם יש פדיון => חובה חתימת עובד
  if (f.redemptionAmount > 0 && !f.signedByEmployeeAt) {
    issues.push({ code: 'F161_MISSING_EMPLOYEE_SIG', message: 'פדיון > 0 דורש חתימת עובד' });
  }

  // §8.4 — אם יש קיבוע מעל הסף => חובה חתימת יועץ מס
  if (f.fixationAmount > ADVISOR_SIG_THRESHOLD_ILS && !f.signedByAdvisorAt) {
    issues.push({
      code: 'F161_MISSING_ADVISOR_SIG',
      message: `קיבוע ${f.fixationAmount} > ${ADVISOR_SIG_THRESHOLD_ILS} דורש חתימת יועץ מס`,
    });
  }

  return issues;
}

/**
 * §8.4 — WITHDRAWAL של פיצויים אסורה ללא form_161 בסטטוס VERIFIED/SUBMITTED.
 * מחזיר reason אם המשיכה חסומה, אחרת null (מותרת).
 */
export function checkSeveranceWithdrawal(args: { accountId: string; forms: Form161[] }): string | null {
  const verified = args.forms.find(
    (f) => f.accountId === args.accountId && (f.validationStatus === 'VERIFIED' || f.validationStatus === 'SUBMITTED'),
  );
  return verified ? null : 'משיכת פיצויים אסורה ללא טופס 161 בסטטוס VERIFIED או SUBMITTED';
}
