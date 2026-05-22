import { ParsedFile, ParsedRecord } from '../src/mevne-ahid/types';
import { validateCrossBlock } from '../src/validation/cross-block.validators';
import { validateRecord } from '../src/validation/record.validators';
import { validateTemporal } from '../src/validation/temporal.validators';
import { ValidationService } from '../src/validation/validation.service';

function rec(blockCode: ParsedRecord['blockCode'], seq: number, fields: Record<string, string>): ParsedRecord {
  return { blockCode, recordSeq: seq, fields, sourceOffset: `t:${seq}` };
}

describe('תיקוף ברמת רשומה (§5.4)', () => {
  it('E001 — ת.ז. כושלת ספרת ביקורת => CRITICAL', () => {
    const i = validateRecord(rec('020', 1, { israelId: '123456789', birthDate: '19900101' }));
    expect(i.find((x) => x.code === 'E001_BAD_ISRAEL_ID')?.severity).toBe('CRITICAL');
  });

  it('E060 — תאריך לידה בעתיד => ERROR', () => {
    const i = validateRecord(rec('020', 1, { israelId: '000000018', birthDate: '21000101' }), new Date('2026-05-19'));
    expect(i.some((x) => x.code === 'E060_FUTURE_DATE')).toBe(true);
  });

  it('E010 — אי-התאמת יתרה => WARN', () => {
    const i = validateRecord(rec('050', 2, { severance: '100', tagmulimEmployee: '0', tagmulimEmployer: '0', allowance: '0', total: '999' }));
    expect(i.find((x) => x.code === 'E010_BALANCE_MISMATCH')?.severity).toBe('WARN');
  });

  it('E002 — ח.פ. מעסיק כושל + E061 סכום שלילי', () => {
    const i = validateRecord(rec('070', 3, { employerCompanyId: '111111111', amountEmployee: '-5', amountEmployer: '0', amountSeverance: '0' }));
    expect(i.some((x) => x.code === 'E002_BAD_COMPANY_ID')).toBe(true);
    expect(i.some((x) => x.code === 'E061_NEGATIVE_AMOUNT')).toBe(true);
  });
});

describe('תיקוף חוצה-בלוקים (§5.4)', () => {
  it('E050 — חשבון יתום בבלוק 050', () => {
    const i = validateCrossBlock([rec('050', 1, { policyNumber: 'X', lotId: 'L1' })]);
    expect(i.some((x) => x.code === 'E050_ORPHAN_ACCOUNT')).toBe(true);
  });

  it('חשבון קיים מריצה קודמת => אין E050', () => {
    const i = validateCrossBlock([rec('050', 1, { policyNumber: 'X' })], { knownPolicyNumbers: new Set(['X']) });
    expect(i.some((x) => x.code === 'E050_ORPHAN_ACCOUNT')).toBe(false);
  });

  it('E021 — סך מוטבים ≠ 100%', () => {
    const recs = [
      rec('040', 1, { policyNumber: 'P', manufacturerCode: 'M' }),
      rec('080', 2, { policyNumber: 'P', sharePercent: '60' }),
      rec('080', 3, { policyNumber: 'P', sharePercent: '30' }),
    ];
    const i = validateCrossBlock(recs);
    expect(i.find((x) => x.code === 'E021_BENEFICIARY_SUM_NOT_100')?.severity).toBe('ERROR');
  });

  it('E040 — DEPOSIT כפול לאותו policy+month', () => {
    const recs = [
      rec('070', 1, { policyNumber: 'P', depositMonth: '202404' }),
      rec('070', 2, { policyNumber: 'P', depositMonth: '202404' }),
    ];
    expect(validateCrossBlock(recs).some((x) => x.code === 'E040_DUPLICATE_DEPOSIT')).toBe(true);
  });

  it('E030 — קוד יצרן לא מוכר מול REF', () => {
    const i = validateCrossBlock([rec('030', 1, { manufacturerCode: 'ZZZ' })], { knownManufacturerCodes: new Set(['MGD']) });
    expect(i.find((x) => x.code === 'E030_UNKNOWN_MANUFACTURER')?.severity).toBe('CRITICAL');
  });
});

describe('תיקוף חוצה-זמן (§5.4)', () => {
  it('E080 — start > end', () => {
    const i = validateTemporal([rec('070', 1, { policyNumber: 'P', employmentStart: '20200101', employmentEnd: '20190101' })]);
    expect(i.some((x) => x.code === 'E080_TEMPORAL_RANGE')).toBe(true);
  });

  it('E081 — snapshot לפני פתיחת חשבון', () => {
    const recs = [
      rec('040', 1, { policyNumber: 'P', openedDate: '20200101' }),
      rec('050', 2, { policyNumber: 'P', snapshotDate: '20190101' }),
    ];
    expect(validateTemporal(recs).some((x) => x.code === 'E081_SNAPSHOT_BEFORE_OPEN')).toBe(true);
  });
});

describe('ValidationService — גזירת תוצאת ריצה (§5.4)', () => {
  const svc = new ValidationService();
  const baseParsed = (records: ParsedRecord[]): ParsedFile => ({
    format: 'XML', parserVersion: '2024.1', records, parseErrors: [],
    trailer: { declaredRecordCount: records.length, actualRecordCount: records.length, ok: true },
  });

  it('CRITICAL => hasCritical=true', () => {
    const r = svc.validate(baseParsed([rec('020', 1, { israelId: '123456789' })]));
    expect(r.hasCritical).toBe(true);
  });

  it('ERROR => recordSeq ב-failedRecordSeqs, hasCritical=false', () => {
    const recs = [
      rec('040', 1, { policyNumber: 'P', manufacturerCode: 'M' }),
      rec('080', 2, { policyNumber: 'P', sharePercent: '50' }),
    ];
    const r = svc.validate(baseParsed(recs));
    expect(r.hasCritical).toBe(false);
    expect(r.failedRecordSeqs.has(2)).toBe(true);
  });

  it('trailer לא תקין => hasCritical=true', () => {
    const p = baseParsed([rec('020', 1, { israelId: '000000018' })]);
    p.trailer.ok = false;
    expect(svc.validate(p).hasCritical).toBe(true);
  });
});
