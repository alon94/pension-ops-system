import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { XmlParser } from '../src/mevne-ahid/xml.parser';

const sample = readFileSync(join(__dirname, 'fixtures/sample.mevne-ahid.xml'));

describe('XmlParser — מבנה אחיד XML (§5.3)', () => {
  const parser = new XmlParser();

  it('מפענח את כל הבלוקים ל-RAW_STAGING records', () => {
    const r = parser.parse(sample, '2024.1');
    expect(r.format).toBe('XML');
    const codes = r.records.map((x) => x.blockCode);
    expect(codes).toEqual(['010', '020', '030', '040', '050', '060', '070', '080', '080', '090', '999']);
    expect(r.records[1].fields.israelId).toBe('000000018');
  });

  it('בלוק 999 — ספירה תואמת => trailer ok', () => {
    const r = parser.parse(sample, '2024.1');
    expect(r.trailer).toEqual({ declaredRecordCount: 10, actualRecordCount: 10, ok: true });
    expect(r.parseErrors.filter((e) => e.severity === 'CRITICAL')).toHaveLength(0);
  });

  it('trailer לא תואם => CRITICAL', () => {
    const bad = sample.toString().replace('<recordCount>10</recordCount>', '<recordCount>99</recordCount>');
    const r = parser.parse(Buffer.from(bad), '2024.1');
    expect(r.trailer.ok).toBe(false);
    expect(r.parseErrors.some((e) => e.code === 'P021_TRAILER_MISMATCH' && e.severity === 'CRITICAL')).toBe(true);
  });

  it('שדה חובה ריק => P001 ERROR', () => {
    const bad = sample.toString().replace('<israelId>000000018</israelId>', '<israelId></israelId>');
    const r = parser.parse(Buffer.from(bad), '2024.1');
    expect(r.parseErrors.some((e) => e.code === 'P001_REQUIRED_FIELD_EMPTY' && e.field === 'israelId')).toBe(true);
  });

  it('XML פגום => CRITICAL P030', () => {
    const r = parser.parse(Buffer.from('<MevneAhid><Block'), '2024.1');
    expect(r.parseErrors.some((e) => e.severity === 'CRITICAL')).toBe(true);
  });
});
