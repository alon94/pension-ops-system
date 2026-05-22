import { sumMatches, toAmount } from '../common/money';
import { ParsedRecord } from '../mevne-ahid/types';
import { issue, ValidationIssue } from './types';

export interface CrossBlockContext {
  /** policy_numbers שכבר קיימים במודל הנקי מריצות קודמות (§5.4) */
  knownPolicyNumbers?: Set<string>;
  /** קודי יצרן מוכרים מטבלת REF_MANUFACTURER_TYPE (§5.4 — E030) */
  knownManufacturerCodes?: Set<string>;
}

/**
 * אילוצים חוצי-בלוקים (§5.4):
 *  - 050/060 חייבים להצביע לחשבון מ-040 או מריצה קודמת
 *  - 070.lot חייב להתאים ללקוח 020 באותו lot
 *  - 080: סך אחוזי מוטבים פר חשבון = 100%; חשבון בלי מוטבים => WARN
 *  - 070: DEPOSIT כפול לאותו policy+month
 *  - 030: קוד יצרן חייב להיות מוכר (REF)
 */
export function validateCrossBlock(records: ParsedRecord[], ctx: CrossBlockContext = {}): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const known = ctx.knownPolicyNumbers ?? new Set<string>();

  const accountsIn040 = new Set(records.filter((r) => r.blockCode === '040').map((r) => r.fields.policyNumber));
  const lotsIn020 = new Set(records.filter((r) => r.blockCode === '020').map((r) => r.fields.lotId));

  const accountExists = (policy: string) => accountsIn040.has(policy) || known.has(policy);

  for (const r of records) {
    if (r.blockCode === '050' && !accountExists(r.fields.policyNumber)) {
      out.push(issue('E050_ORPHAN_ACCOUNT', { blockCode: '050', recordSeq: r.recordSeq, field: 'policyNumber' }));
    }
    if (r.blockCode === '060' && !accountExists(r.fields.policyNumber)) {
      out.push(issue('E051_ORPHAN_COVERAGE', { blockCode: '060', recordSeq: r.recordSeq, field: 'policyNumber' }));
    }
    if (r.blockCode === '070' && r.fields.lotId && !lotsIn020.has(r.fields.lotId)) {
      out.push(issue('E052_CUSTOMER_LOT_MISMATCH', { blockCode: '070', recordSeq: r.recordSeq, field: 'lotId' }));
    }
  }

  // קוד יצרן מוכר (אם סופקה טבלת REF)
  if (ctx.knownManufacturerCodes) {
    for (const r of records.filter((x) => x.blockCode === '030')) {
      if (!ctx.knownManufacturerCodes.has(r.fields.manufacturerCode)) {
        out.push(
          issue('E030_UNKNOWN_MANUFACTURER', {
            blockCode: '030',
            recordSeq: r.recordSeq,
            field: 'manufacturerCode',
            message: `קוד יצרן לא מוכר '${r.fields.manufacturerCode}' — דורש עדכון REF`,
          }),
        );
      }
    }
  }

  // DEPOSIT כפול: אותו policy + depositMonth בבלוק 070
  const depositSeen = new Map<string, number>();
  for (const r of records.filter((x) => x.blockCode === '070')) {
    const key = `${r.fields.policyNumber}|${r.fields.depositMonth}`;
    if (depositSeen.has(key)) {
      out.push(issue('E040_DUPLICATE_DEPOSIT', { blockCode: '070', recordSeq: r.recordSeq, field: 'depositMonth' }));
    } else {
      depositSeen.set(key, r.recordSeq);
    }
  }

  // מוטבים: סך אחוזים פר חשבון = 100; חשבון בלי מוטבים => WARN
  const beneficiaryByPolicy = new Map<string, { sum: number; lastSeq: number }>();
  for (const r of records.filter((x) => x.blockCode === '080')) {
    const policy = r.fields.policyNumber;
    const share = toAmount(r.fields.sharePercent);
    const agg = beneficiaryByPolicy.get(policy) ?? { sum: 0, lastSeq: r.recordSeq };
    agg.sum += Number.isFinite(share) ? share : 0;
    agg.lastSeq = r.recordSeq;
    beneficiaryByPolicy.set(policy, agg);
  }
  for (const [policy, agg] of beneficiaryByPolicy) {
    // סטיית עיגול של 0.01% מותרת
    if (!sumMatches(100, [agg.sum], 0.01)) {
      out.push(
        issue('E021_BENEFICIARY_SUM_NOT_100', {
          blockCode: '080',
          recordSeq: agg.lastSeq,
          message: `סך אחוזי מוטבים לפוליסה ${policy} = ${agg.sum}% (נדרש 100%)`,
        }),
      );
    }
  }
  for (const r of records.filter((x) => x.blockCode === '040')) {
    if (!beneficiaryByPolicy.has(r.fields.policyNumber)) {
      out.push(
        issue('E020_MISSING_BENEFICIARY', {
          blockCode: '040',
          recordSeq: r.recordSeq,
          message: `אין מוטבים לחשבון ${r.fields.policyNumber}`,
        }),
      );
    }
  }

  return out;
}
