import { BlockCode } from '../mevne-ahid/blocks';

/**
 * חומרות (§5.4):
 *  CRITICAL — עוצר את כל הקליטה; כל הריצה failed.
 *  ERROR    — רשומה ספציפית נכשלת; הקליטה ממשיכה; הרשומה נשארת ב-RAW_STAGING עם target_id=NULL.
 *  WARN     — הרשומה נקלטת אך מועלית התראה.
 *  INFO     — תיעוד בלבד.
 */
export type Severity = 'CRITICAL' | 'ERROR' | 'WARN' | 'INFO';

export interface ValidationIssue {
  code: string;
  severity: Severity;
  message: string;
  blockCode?: BlockCode;
  recordSeq?: number;
  field?: string;
}

/** קטלוג קודי שגיאה — §5.4 (תת-קבוצה; הרשימה המלאה בנספח המסמך). */
export const ERROR_CATALOG = {
  E001_BAD_ISRAEL_ID: { severity: 'CRITICAL' as Severity, desc: 'ת.ז. כושלת ספרת ביקורת' },
  E002_BAD_COMPANY_ID: { severity: 'CRITICAL' as Severity, desc: 'ח.פ. כושלת ספרת ביקורת' },
  E010_BALANCE_MISMATCH: { severity: 'WARN' as Severity, desc: 'total ≠ סכום רכיבים (סטיית > 1 ₪)' },
  E011_DEPOSIT_MISMATCH: { severity: 'WARN' as Severity, desc: 'DEPOSIT.total ≠ סכום רכיבים' },
  E012_WITHDRAWAL_MISMATCH: { severity: 'WARN' as Severity, desc: 'WITHDRAWAL.gross ≠ net + tax' },
  E020_MISSING_BENEFICIARY: { severity: 'WARN' as Severity, desc: 'אין מוטבים לחשבון' },
  E021_BENEFICIARY_SUM_NOT_100: { severity: 'ERROR' as Severity, desc: 'סכום אחוזי מוטבים ≠ 100%' },
  E030_UNKNOWN_MANUFACTURER: { severity: 'CRITICAL' as Severity, desc: 'קוד יצרן לא מוכר' },
  E040_DUPLICATE_DEPOSIT: { severity: 'ERROR' as Severity, desc: 'DEPOSIT כפול (אותו account+month)' },
  E050_ORPHAN_ACCOUNT: { severity: 'ERROR' as Severity, desc: 'חשבון בבלוק 050 לא קיים בבלוק 040' },
  E051_ORPHAN_COVERAGE: { severity: 'ERROR' as Severity, desc: 'כיסוי בבלוק 060 לא לחשבון מבלוק 040' },
  E052_CUSTOMER_LOT_MISMATCH: { severity: 'ERROR' as Severity, desc: 'לקוח בבלוק 070 לא תואם ל-020 באותו lot' },
  E060_FUTURE_DATE: { severity: 'ERROR' as Severity, desc: 'תאריך בעתיד' },
  E061_NEGATIVE_AMOUNT: { severity: 'ERROR' as Severity, desc: 'סכום שלילי ללא תנועת קיזוז' },
  E070_UNKNOWN_CURRENCY: { severity: 'WARN' as Severity, desc: 'קוד מטבע שאינו ILS/EUR/USD' },
  E080_TEMPORAL_RANGE: { severity: 'ERROR' as Severity, desc: 'start_date > end_date / effective_from > effective_to' },
  E081_SNAPSHOT_BEFORE_OPEN: { severity: 'ERROR' as Severity, desc: 'snapshot_date < opened_date' },
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export function issue(
  code: ErrorCode,
  partial: Omit<ValidationIssue, 'code' | 'severity' | 'message'> & { message?: string },
): ValidationIssue {
  const meta = ERROR_CATALOG[code];
  return {
    code,
    severity: meta.severity,
    message: partial.message ?? meta.desc,
    blockCode: partial.blockCode,
    recordSeq: partial.recordSeq,
    field: partial.field,
  };
}

export interface ValidationResult {
  issues: ValidationIssue[];
  /** recordSeq של רשומות שנכשלו (ERROR) — לא יקודמו למודל הנקי */
  failedRecordSeqs: Set<number>;
  /** האם קיימת לפחות שגיאת CRITICAL אחת — עוצר את כל הריצה (§5.4) */
  hasCritical: boolean;
}
