import { isValidCompanyId, isValidIsraeliId } from '../common/israeli-id';
import { sumMatches, toAmount } from '../common/money';
import { ParsedRecord } from '../mevne-ahid/types';
import { issue, ValidationIssue } from './types';

const KNOWN_CURRENCIES = new Set(['ILS', 'EUR', 'USD', '']);

function parseYmd(value: string): Date | null {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value.trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/**
 * תיקוף ברמת רשומה (§5.4):
 *  - ספרת ביקורת ת.ז. (020) וח.פ. (070)
 *  - תאריכים לא בעתיד הרחוק (לידה > היום וכו')
 *  - סכומים לא שליליים (אלא אם תנועת קיזוז)
 *  - שלמות אריתמטית: balance / deposit / withdrawal
 */
export function validateRecord(rec: ParsedRecord, now: Date = new Date()): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const f = rec.fields;

  if (rec.blockCode === '020') {
    if (f.israelId && !isValidIsraeliId(f.israelId)) {
      out.push(issue('E001_BAD_ISRAEL_ID', { blockCode: '020', recordSeq: rec.recordSeq, field: 'israelId' }));
    }
    const birth = parseYmd(f.birthDate ?? '');
    if (birth && birth.getTime() > now.getTime()) {
      out.push(issue('E060_FUTURE_DATE', { blockCode: '020', recordSeq: rec.recordSeq, field: 'birthDate' }));
    }
  }

  if (rec.blockCode === '070') {
    if (f.employerCompanyId && !isValidCompanyId(f.employerCompanyId)) {
      out.push(issue('E002_BAD_COMPANY_ID', { blockCode: '070', recordSeq: rec.recordSeq, field: 'employerCompanyId' }));
    }
    const emp = toAmount(f.amountEmployee);
    const empr = toAmount(f.amountEmployer);
    const sev = toAmount(f.amountSeverance);
    for (const [name, v] of [['amountEmployee', emp], ['amountEmployer', empr], ['amountSeverance', sev]] as const) {
      if (Number.isFinite(v) && v < 0) {
        out.push(issue('E061_NEGATIVE_AMOUNT', { blockCode: '070', recordSeq: rec.recordSeq, field: name }));
      }
    }
  }

  if (rec.blockCode === '050') {
    const sev = toAmount(f.severance);
    const te = toAmount(f.tagmulimEmployee);
    const tr = toAmount(f.tagmulimEmployer);
    const allow = toAmount(f.allowance);
    const total = f.total !== undefined && f.total !== '' ? toAmount(f.total) : sev + te + tr + allow;
    // §5.4: BALANCE_SNAPSHOT.total = severance + tagmulim_employee + tagmulim_employer + allowance
    if (!sumMatches(total, [sev, te, tr, allow])) {
      out.push(issue('E010_BALANCE_MISMATCH', { blockCode: '050', recordSeq: rec.recordSeq }));
    }
  }

  if (rec.blockCode === '090') {
    const cur = (f.currency ?? '').trim().toUpperCase();
    if (!KNOWN_CURRENCIES.has(cur)) {
      out.push(issue('E070_UNKNOWN_CURRENCY', { blockCode: '090', recordSeq: rec.recordSeq, field: 'currency' }));
    }
    if (f.movementType === 'WD') {
      const gross = toAmount(f.gross);
      const net = toAmount(f.net);
      const tax = toAmount(f.tax);
      // §5.4: WITHDRAWAL.gross = net + tax
      if (!sumMatches(gross, [net, tax])) {
        out.push(issue('E012_WITHDRAWAL_MISMATCH', { blockCode: '090', recordSeq: rec.recordSeq }));
      }
    }
  }

  return out;
}
