import { ParsedRecord } from '../mevne-ahid/types';
import { issue, ValidationIssue } from './types';

function ymd(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value.trim());
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * אילוצים חוצי-זמן (§5.4):
 *  - start_date <= end_date בכל ישות תקופתית
 *  - effective_from < effective_to ב-SCD2
 *  - snapshot_date >= opened_date של אותו account
 */
export function validateTemporal(records: ParsedRecord[]): ValidationIssue[] {
  const out: ValidationIssue[] = [];

  // opened_date פר policy מבלוק 040 — לבדיקת snapshot מול פתיחה
  const openedByPolicy = new Map<string, number>();
  for (const r of records.filter((x) => x.blockCode === '040')) {
    const o = ymd(r.fields.openedDate);
    if (o !== null) openedByPolicy.set(r.fields.policyNumber, o);

    const closed = ymd(r.fields.closedDate);
    if (o !== null && closed !== null && o > closed) {
      out.push(issue('E080_TEMPORAL_RANGE', { blockCode: '040', recordSeq: r.recordSeq, field: 'closedDate' }));
    }
  }

  for (const r of records) {
    if (r.blockCode === '070') {
      const s = ymd(r.fields.employmentStart);
      const e = ymd(r.fields.employmentEnd);
      if (s !== null && e !== null && s > e) {
        out.push(issue('E080_TEMPORAL_RANGE', { blockCode: '070', recordSeq: r.recordSeq, field: 'employmentEnd' }));
      }
    }
    if (r.blockCode === '060') {
      const s = ymd(r.fields.coverageFrom);
      const e = ymd(r.fields.coverageTo);
      if (s !== null && e !== null && s > e) {
        out.push(issue('E080_TEMPORAL_RANGE', { blockCode: '060', recordSeq: r.recordSeq, field: 'coverageTo' }));
      }
    }
    if (r.blockCode === '050') {
      const snap = ymd(r.fields.snapshotDate);
      const opened = openedByPolicy.get(r.fields.policyNumber);
      if (snap !== null && opened !== undefined && snap < opened) {
        out.push(issue('E081_SNAPSHOT_BEFORE_OPEN', { blockCode: '050', recordSeq: r.recordSeq, field: 'snapshotDate' }));
      }
    }
  }

  return out;
}
