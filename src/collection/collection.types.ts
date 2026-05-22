/** ישויות וטיפוסים — בקרת גבייה (פרק 9). */

export type DiscrepancyType =
  | 'MISSING'              // לא הופקד בכלל
  | 'WRONG_FUND'           // הפקדה הגיעה לקופה אחרת
  | 'WRONG_AMOUNT'         // סכום שגוי (מעבר לעיגול)
  | 'WRONG_SPLIT'          // פיצול שגוי בין רכיבים
  | 'LATE'                 // הופקד באיחור (deposit_date אחרי SLA)
  | 'OVER_CAP'             // §9.3(4) — חריגת תקרת חוק (multi-employer)
  | 'EMPLOYER_INSOLVENT';  // §9.3(10)

export type DiscrepancyStatus =
  | 'OPEN'
  | 'EMPLOYER_NOTIFIED'
  | 'FUND_NOTIFIED'
  | 'RESOLVED'
  | 'DISMISSED';

export interface DepositAmounts {
  employee: number;
  employer: number;
  severance: number;
}

export interface ExpectedDeposit {
  customerId: string;
  employmentId: string;
  employerId: string;
  accountId: string;
  referenceMonth: string; // YYYYMM
  expected: DepositAmounts;
  /** §9.3(7) — אם True אין חובת amount_severance > 0 */
  section14?: boolean;
}

/** דיווח חודשי שמתקבל מהמעסיק או מחברת שכר. */
export interface EmployerReport {
  customerId: string;
  employerId: string;
  employmentId?: string;
  accountId?: string;       // לאיזו קופה דווחה ההפקדה (אם דווח)
  referenceMonth: string;
  amounts: DepositAmounts;
  reportedSalary?: number;
  depositDate?: string;     // ISO — לבדיקת איחור
}

/** דיווח מסלקה (חודש מאוחר יותר) — מה היצרן רשם בפועל. */
export interface ClearingReport {
  customerId: string;
  accountId: string;
  referenceMonth: string;
  amounts: DepositAmounts;
}

export interface CollectionDiscrepancy {
  discrepancyId: string;
  customerId?: string;
  employerId?: string;
  employmentId?: string;
  referenceMonth: string;
  expectedAccountId?: string;
  expectedAmountEmployee: number;
  expectedAmountEmployer: number;
  expectedAmountSeverance: number;
  reportedByEmployer?: EmployerReport;
  reportedByClearing?: ClearingReport;
  discrepancyType: DiscrepancyType;
  discrepancyAmount: number;
  status: DiscrepancyStatus;
  resolutionSummary?: string;
  detectedAt: string;
  resolvedAt?: string;
}

export type NewCollectionDiscrepancy = Omit<
  CollectionDiscrepancy,
  'discrepancyId' | 'detectedAt' | 'status'
> & { detectedAt?: string };
