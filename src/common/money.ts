/**
 * השוואות סכומים עמידות-עיגול.
 * §5.4: שלמות אריתמטית של סכומים נבדקת בסטיית עיגול עד 1 ₪.
 */

const ROUNDING_TOLERANCE_ILS = 1.0;

/** מנרמל מחרוזת/מספר לסכום numeric. NaN אם לא ניתן לפענוח. */
export function toAmount(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (raw === null || raw === undefined) return NaN;
  const cleaned = String(raw).trim().replace(/,/g, '');
  if (cleaned === '') return NaN;
  return Number(cleaned);
}

/** האם total שווה לסכום הרכיבים בתוך סטיית העיגול המותרת. */
export function sumMatches(total: number, components: number[], tolerance = ROUNDING_TOLERANCE_ILS): boolean {
  if (!Number.isFinite(total) || components.some((c) => !Number.isFinite(c))) return false;
  const sum = components.reduce((a, b) => a + b, 0);
  return Math.abs(total - sum) <= tolerance;
}

export { ROUNDING_TOLERANCE_ILS };
