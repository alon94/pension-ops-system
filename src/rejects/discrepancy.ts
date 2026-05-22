import { NewReject } from './reject.types';

/**
 * §7.6 — גילוי פערים בין מקורות. פונקציות טהורות; מקורות הנתונים (CRM/שכר)
 * מוזרקים מבחוץ — כאן רק לוגיקת ההשוואה (נבדקת ביחידה).
 */

export interface CrmPolicy {
  policyNumber: string;
  soldAt: string; // ISO
  customerId?: string;
}

const MS_DAY = 24 * 3600_000;
const CRM_CLEARING_GRACE_DAYS = 30; // §7.6 — 30+ יום מהמכירה ועדיין אין במסלקה

/** פער CRM ↔ Clearing (A4): R008 (חסר במסלקה) / R009 (חסר ב-CRM). */
export function detectAccountDiscrepancies(
  crm: CrmPolicy[],
  clearingPolicyNumbers: Set<string>,
  now = new Date(),
): NewReject[] {
  const out: NewReject[] = [];
  const crmSet = new Set(crm.map((c) => c.policyNumber));

  for (const c of crm) {
    if (clearingPolicyNumbers.has(c.policyNumber)) continue;
    const ageDays = (now.getTime() - new Date(c.soldAt).getTime()) / MS_DAY;
    if (ageDays >= CRM_CLEARING_GRACE_DAYS) {
      out.push({
        rejectType: 'DISCREPANCY',
        rejectCode: 'R008',
        sourceEntity: 'ACCOUNT',
        sourceEntityId: c.policyNumber,
        customerId: c.customerId,
        severity: 'MEDIUM',
        rejectReason: `פוליסה ${c.policyNumber} ב-CRM (נמכרה ${c.soldAt}) אך לא נמצאה במסלקה אחרי ${Math.floor(ageDays)} ימים`,
        assignee: 'A4',
      });
    }
  }

  for (const policy of clearingPolicyNumbers) {
    if (!crmSet.has(policy)) {
      out.push({
        rejectType: 'DISCREPANCY',
        rejectCode: 'R009',
        sourceEntity: 'ACCOUNT',
        sourceEntityId: policy,
        severity: 'MEDIUM',
        rejectReason: `פוליסה ${policy} במסלקה אך לא קיימת ב-CRM — רכישה חיצונית?`,
        assignee: 'A4',
      });
    }
  }
  return out;
}

/** פער Salary ↔ Deposit (A7): R010. שיעור חוקי ברירת מחדל ~12% (עובד+מעסיק). */
export function detectSalaryDepositDiscrepancy(
  input: { policyNumber: string; reportedSalary: number; actualDepositTotal: number; lawRate?: number; customerId?: string },
  tolerancePct = 5,
): NewReject | null {
  const rate = input.lawRate ?? 0.12;
  const expected = input.reportedSalary * rate;
  if (expected <= 0) return null;
  const deviationPct = (Math.abs(expected - input.actualDepositTotal) / expected) * 100;
  if (deviationPct <= tolerancePct) return null;
  return {
    rejectType: 'DISCREPANCY',
    rejectCode: 'R010',
    sourceEntity: 'DEPOSIT',
    sourceEntityId: input.policyNumber,
    customerId: input.customerId,
    severity: 'HIGH',
    rejectReason: `שכר ${input.reportedSalary} → צפי הפקדה ~${expected.toFixed(0)} אך בפועל ${input.actualDepositTotal} (סטייה ${deviationPct.toFixed(1)}%)`,
    assignee: 'A7',
  };
}

/**
 * פער Beneficiary (§7.6): אם תאריך המסלקה ישן מתאריך עדכון ב-CRM → R015.
 * (אם המסלקה עדכנית יותר — אין ריג'קט; ה-CRM הוא שמתעדכן.)
 */
export function detectBeneficiaryDiscrepancy(input: {
  policyNumber: string;
  crmUpdatedAt: string;
  clearingAsOf: string;
  customerId?: string;
}): NewReject | null {
  if (new Date(input.clearingAsOf).getTime() >= new Date(input.crmUpdatedAt).getTime()) return null;
  return {
    rejectType: 'DISCREPANCY',
    rejectCode: 'R015',
    sourceEntity: 'BENEFICIARY',
    sourceEntityId: input.policyNumber,
    customerId: input.customerId,
    severity: 'MEDIUM',
    rejectReason: `מוטבי מסלקה (${input.clearingAsOf}) ישנים מעדכון CRM (${input.crmUpdatedAt}) — אימות מול הלקוח`,
    assignee: 'A4',
  };
}
