import { FixedWidthParser } from '../src/mevne-ahid/fixed-width.parser';
import { fwLine, sampleFixedWidthFile } from './fixtures/fw-builder';

describe('FixedWidthParser — מבנה אחיד Fixed-Width (§5.3)', () => {
  const parser = new FixedWidthParser();

  it('מפענח שדות לפי offsets ומאמת trailer', () => {
    const r = parser.parse(Buffer.from(sampleFixedWidthFile()), '2024.1');
    expect(r.format).toBe('FIXED_WIDTH');
    expect(r.records.map((x) => x.blockCode)).toEqual(
      ['010', '020', '030', '040', '050', '060', '070', '080', '090', '999'],
    );
    const cust = r.records.find((x) => x.blockCode === '020')!;
    expect(cust.fields.israelId).toBe('000000018');
    expect(cust.fields.firstName).toBe('Israel');
    expect(r.trailer).toEqual({ declaredRecordCount: 9, actualRecordCount: 9, ok: true });
  });

  it('קוד בלוק לא מוכר => P010', () => {
    const text = ['777junkline', fwLine('999', { recordCount: '0', checksum: 'OK' })].join('\n');
    const r = parser.parse(Buffer.from(text), '2024.1');
    expect(r.parseErrors.some((e) => e.code === 'P010_UNKNOWN_BLOCK')).toBe(true);
  });

  it('Trailer חסר => CRITICAL P020', () => {
    const r = parser.parse(Buffer.from(fwLine('020', { lotId: 'L1', israelId: '000000018', firstName: 'A', lastName: 'B', birthDate: '19900101' })), '2024.1');
    expect(r.parseErrors.some((e) => e.code === 'P020_MISSING_TRAILER' && e.severity === 'CRITICAL')).toBe(true);
  });
});
