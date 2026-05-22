/**
 * בדיקת ספרת ביקורת לתעודת זהות ולמספר ח.פ. ישראלי.
 * נדרש לפי §4.3 ו-§5.4 (E001_BAD_ISRAEL_ID / E002_BAD_COMPANY_ID).
 *
 * ת.ז. ישראלית: 9 ספרות, אלגוריתם לוהן משוקלל (1,2,1,2,...).
 * ח.פ. (מספר תאגיד): 9 ספרות, אותו אלגוריתם ביקורת.
 * תעודות קצרות מאופסות משמאל ל-9 ספרות.
 */

const NINE_DIGITS = /^\d{1,9}$/;

function normalizeToNineDigits(raw: string): string | null {
  const digits = (raw ?? '').toString().trim().replace(/[\s-]/g, '');
  if (!NINE_DIGITS.test(digits)) return null;
  return digits.padStart(9, '0');
}

/** מחזיר את ספרת הביקורת המחושבת (0-9) עבור 9 ספרות, או null אם הקלט פסול. */
function luhnCheckDigit(idNineDigits: string): number | null {
  if (!/^\d{9}$/.test(idNineDigits)) return null;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let value = Number(idNineDigits[i]) * ((i % 2) + 1);
    if (value > 9) value -= 9;
    sum += value;
  }
  return sum % 10;
}

/** ת.ז. תקינה? (כולל בדיקת ספרת ביקורת לפי לוהן הישראלי). */
export function isValidIsraeliId(raw: string): boolean {
  const id = normalizeToNineDigits(raw);
  if (id === null) return false;
  return luhnCheckDigit(id) === 0;
}

/**
 * ח.פ. תקין? משתמש באותו אלגוריתם ביקורת כמו ת.ז.
 * (מספרי תאגיד ישראליים בני 9 ספרות חולקים את ספרת הביקורת).
 */
export function isValidCompanyId(raw: string): boolean {
  return isValidIsraeliId(raw);
}

/** נרמול ת.ז./ח.פ. לפורמט אחיד בן 9 ספרות לשמירה במודל. null אם פסול מבנית. */
export function normalizeId(raw: string): string | null {
  return normalizeToNineDigits(raw);
}
