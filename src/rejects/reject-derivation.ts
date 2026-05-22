import { ParsedRecord } from '../mevne-ahid/types';
import { Severity, ValidationIssue } from '../validation/types';
import { catalogEntry } from './reject-catalog';
import { NewReject, RejectSeverity } from './reject.types';

/** מיפוי קוד שגיאת קליטה (§5.4) → קוד ריג'קט בקטלוג (§7.3). */
const ERROR_TO_REJECT: Record<string, string> = {
  E001_BAD_ISRAEL_ID: 'R007',
  E002_BAD_COMPANY_ID: 'R007',
  E010_BALANCE_MISMATCH: 'R011',
  E011_DEPOSIT_MISMATCH: 'R011',
  E012_WITHDRAWAL_MISMATCH: 'R011',
  E030_UNKNOWN_MANUFACTURER: 'R014',
};

/** קודי WARN שעדיין מחייבים פתיחת ריג'קט (§7.3 — R011 על אי-התאמת יתרה). */
const WARN_CODES_WITH_REJECT = new Set(['E010_BALANCE_MISMATCH', 'E011_DEPOSIT_MISMATCH', 'E012_WITHDRAWAL_MISMATCH']);

const BLOCK_TO_SOURCE: Record<string, string> = {
  '020': 'CUSTOMER',
  '030': 'MANUFACTURER',
  '040': 'ACCOUNT',
  '050': 'BALANCE',
  '060': 'COVERAGE',
  '070': 'DEPOSIT',
  '080': 'BENEFICIARY',
  '090': 'WITHDRAWAL',
};

function mapSeverity(s: Severity): RejectSeverity {
  return s === 'CRITICAL' ? 'CRITICAL' : s === 'ERROR' ? 'MEDIUM' : 'LOW';
}

export interface DeriveContext {
  ingestionRunId?: string;
  customerId?: string;
  /** policyNumber לפי recordSeq — לשיוך source_entity_id קריא */
  records?: ParsedRecord[];
}

/**
 * §7.5 — ריג'קט פנימי נגזר אוטומטית מתוצאת התיקוף.
 * נפתח עבור כל issue בחומרת ERROR/CRITICAL, או WARN שמופיע ב-WARN_CODES_WITH_REJECT.
 */
export function deriveRejectsFromValidation(issues: ValidationIssue[], ctx: DeriveContext = {}): NewReject[] {
  const out: NewReject[] = [];
  const seen = new Set<string>();

  for (const it of issues) {
    const isError = it.severity === 'ERROR' || it.severity === 'CRITICAL';
    if (!isError && !WARN_CODES_WITH_REJECT.has(it.code)) continue;

    const rejectCode = ERROR_TO_REJECT[it.code] ?? it.code;
    const sourceEntity = it.blockCode ? BLOCK_TO_SOURCE[it.blockCode] : 'INGESTION';
    const sourceEntityId = it.recordSeq !== undefined ? `seq:${it.recordSeq}` : undefined;

    // דה-דופ בתוך אותה ריצה: קוד+ישות+seq
    const key = `${rejectCode}|${sourceEntity}|${sourceEntityId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cat = catalogEntry(rejectCode);
    // חומרה: ברירת המחדל מהקטלוג, אך CRITICAL בקליטה גובר.
    const severity: RejectSeverity =
      it.severity === 'CRITICAL' ? 'CRITICAL' : cat?.defaultSeverity ?? mapSeverity(it.severity);

    out.push({
      rejectType: cat?.type ?? 'INTERNAL',
      rejectCode,
      sourceEntity,
      sourceEntityId,
      customerId: ctx.customerId,
      ingestionRunId: ctx.ingestionRunId,
      severity,
      rejectReason: `[${it.code}] ${it.message}`,
      assignee: cat?.type === 'INTERNAL' ? 'A2' : 'A3',
    });
  }
  return out;
}
