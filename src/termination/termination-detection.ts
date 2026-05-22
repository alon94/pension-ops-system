import { DetectionSource, NewTerminationEvent } from './termination.types';

/**
 * §8.2 — מודל זיהוי A6 (Termination Lifecycle Agent).
 * שתי דרכי זיהוי:
 *   - potential : last_deposit_date < TODAY - 60 days AND account.current_status = 'ACTIVE'
 *   - confirmed : employment.end_date set AND last_deposit_date < employment.end_date
 *
 * §8.5(7) — אם יש EMPLOYMENT חדש לאותו זוג customer/employer בתוך 90 יום מהסיום
 *           => אין פותחים סיום עבודה (זו הפסקה זמנית).
 * §8.5(9) — קרן ותיקה (vatika): A6 לא יוצרת form 161; מסומן בשדה notes.
 */

const MS_DAY = 24 * 3600_000;
export const POTENTIAL_NO_DEPOSIT_DAYS = 60;
export const REHIRE_GRACE_DAYS = 90;

export interface CustomerEmploymentSnapshot {
  customerId: string;
  employmentId: string;
  employerId: string;
  accountId?: string;
  startDate: string; // ISO
  endDate?: string; // ISO
  lastDepositDate?: string; // ISO
  accountStatus?: 'ACTIVE' | 'CLOSED' | string;
  /** האם זו קרן פנסיה ותיקה — §8.5(9) */
  isVatika?: boolean;
}

export interface DetectionResult {
  candidate: NewTerminationEvent;
  reason: 'POTENTIAL_NO_DEPOSIT_60D' | 'CONFIRMED_END_DATE';
  suppressed?: 'REHIRED_WITHIN_90D';
  /** הערות מצטברות שיצמדו ל-notes של ה-TerminationEvent */
  notes: string[];
}

function ageDays(fromIso: string, now: Date): number {
  return (now.getTime() - new Date(fromIso).getTime()) / MS_DAY;
}

/** האם קיים EMPLOYMENT חדש לאותו זוג customer+employer שהחל תוך 90 יום מהסיום? */
export function isRehiredWithinGrace(
  base: CustomerEmploymentSnapshot,
  otherEmployments: CustomerEmploymentSnapshot[],
): boolean {
  if (!base.endDate) return false;
  const endMs = new Date(base.endDate).getTime();
  return otherEmployments.some((e) => {
    if (e.employmentId === base.employmentId) return false;
    if (e.customerId !== base.customerId || e.employerId !== base.employerId) return false;
    const startMs = new Date(e.startDate).getTime();
    const gapDays = (startMs - endMs) / MS_DAY;
    return gapDays >= 0 && gapDays <= REHIRE_GRACE_DAYS;
  });
}

/**
 * §8.2 — confirmed termination: ל-EMPLOYMENT יש end_date והפקדה אחרונה מקדימה אותו.
 */
export function detectConfirmedTermination(
  snap: CustomerEmploymentSnapshot,
  context: { allEmploymentsForCustomer: CustomerEmploymentSnapshot[] },
  source: DetectionSource,
): DetectionResult | null {
  if (!snap.endDate) return null;
  if (snap.lastDepositDate && new Date(snap.lastDepositDate).getTime() >= new Date(snap.endDate).getTime()) {
    return null;
  }
  const rehired = isRehiredWithinGrace(snap, context.allEmploymentsForCustomer);
  const notes: string[] = [];
  if (snap.isVatika) notes.push('קרן ותיקה — לא נדרש טופס 161 (§8.5(9))');
  if (rehired) notes.push('נמצא EMPLOYMENT חדש לאותו מעסיק תוך 90 יום — דוכא (§8.5(7))');

  return {
    candidate: {
      customerId: snap.customerId,
      employmentId: snap.employmentId,
      accountId: snap.accountId,
      detectionSource: source,
      confirmedTerminationDate: snap.endDate.slice(0, 10),
      notes: notes.join(' · ') || undefined,
    },
    reason: 'CONFIRMED_END_DATE',
    suppressed: rehired ? 'REHIRED_WITHIN_90D' : undefined,
    notes,
  };
}

/**
 * §8.2 — potential termination: אין הפקדה 60+ ימים וחשבון פעיל.
 */
export function detectPotentialTermination(
  snap: CustomerEmploymentSnapshot,
  context: { allEmploymentsForCustomer: CustomerEmploymentSnapshot[]; now: Date },
): DetectionResult | null {
  if (snap.endDate) return null; // אם יש end_date נתפס ע"י confirmed
  if (snap.accountStatus && snap.accountStatus !== 'ACTIVE') return null;
  if (!snap.lastDepositDate) return null;
  if (ageDays(snap.lastDepositDate, context.now) < POTENTIAL_NO_DEPOSIT_DAYS) return null;

  return {
    candidate: {
      customerId: snap.customerId,
      employmentId: snap.employmentId,
      accountId: snap.accountId,
      detectionSource: 'AGENT_AUTOMATED',
      notes: `אין הפקדה ${POTENTIAL_NO_DEPOSIT_DAYS}+ ימים מאז ${snap.lastDepositDate.slice(0, 10)}`,
    },
    reason: 'POTENTIAL_NO_DEPOSIT_60D',
    notes: [`אין הפקדה ${POTENTIAL_NO_DEPOSIT_DAYS}+ ימים`],
  };
}
