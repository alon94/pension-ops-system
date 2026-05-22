import { sumMatches, toAmount } from '../src/common/money';

describe('השוואות סכומים עמידות-עיגול (§5.4)', () => {
  it('toAmount מנקה פסיקים', () => {
    expect(toAmount('1,234.50')).toBeCloseTo(1234.5);
    expect(toAmount('')).toBeNaN();
  });

  it('סובלנות עיגול של 1 ₪', () => {
    expect(sumMatches(300000, [120000, 80000, 95000, 5000])).toBe(true);
    expect(sumMatches(300000.9, [120000, 80000, 95000, 5000])).toBe(true);
    expect(sumMatches(300002, [120000, 80000, 95000, 5000])).toBe(false);
  });

  it('NaN בסכום => לא תואם', () => {
    expect(sumMatches(NaN, [1, 2])).toBe(false);
  });
});
