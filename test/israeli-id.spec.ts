import { isValidCompanyId, isValidIsraeliId, normalizeId } from '../src/common/israeli-id';

describe('ספרת ביקורת ת.ז. / ח.פ. (§4.3, §5.4)', () => {
  it('מקבל ת.ז. תקינות', () => {
    expect(isValidIsraeliId('000000018')).toBe(true);
    expect(isValidIsraeliId('000000026')).toBe(true);
  });

  it('מאפס משמאל ל-9 ספרות לפני הבדיקה', () => {
    expect(isValidIsraeliId('18')).toBe(true); // = 000000018
  });

  it('דוחה ת.ז. עם ספרת ביקורת שגויה', () => {
    expect(isValidIsraeliId('123456789')).toBe(false);
    expect(isValidIsraeliId('000000019')).toBe(false);
  });

  it('דוחה קלט לא מספרי / ארוך מדי', () => {
    expect(isValidIsraeliId('12A456789')).toBe(false);
    expect(isValidIsraeliId('1234567890')).toBe(false);
    expect(isValidIsraeliId('')).toBe(false);
  });

  it('ח.פ. משתמש באותו אלגוריתם', () => {
    expect(isValidCompanyId('000000026')).toBe(true);
    expect(isValidCompanyId('123456789')).toBe(false);
  });

  it('normalizeId מחזיר 9 ספרות או null', () => {
    expect(normalizeId('18')).toBe('000000018');
    expect(normalizeId('bad')).toBeNull();
  });
});
