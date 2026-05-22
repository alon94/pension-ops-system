import { createHmac } from 'node:crypto';

/**
 * §10.6 — Pseudonymization. israel_id מוצפן at-rest; שאילתות BI עוברות דרך טוקן.
 * HMAC-SHA256 עם סוד שמסופק מבחוץ — דטרמיניסטי, מאפשר join על טוקן.
 *
 * חשוב: זה לא תחליף ל-Encryption at rest (AES-256) של ה-DB; זוהי שכבת
 * tokenization עצמאית למקרים בהם ה-id יוצא מה-trust boundary (BI, exports).
 */
export function tokenizeIsraelId(israelId: string, secret: string): string {
  if (!israelId) throw new Error('israelId required');
  if (!secret) throw new Error('tokenization secret required');
  return createHmac('sha256', secret).update(israelId).digest('hex').slice(0, 32);
}

/** §10.6 — RBAC Operator: מציג רק 4 ספרות אחרונות. */
export function maskIsraelId(israelId: string): string {
  const norm = israelId.padStart(9, '0');
  return `*****${norm.slice(-4)}`;
}

/**
 * §10.6 — anonymization על בקשת מחיקה. מחזיר אובייקט עם רק שדות תפעוליים-היסטוריים
 * (sums, ids מקושרים) ללא PII.
 */
export function anonymizeCustomerRow(row: {
  customerId: string;
  israelId: string;
  firstName?: string;
  lastName?: string;
  birthDate?: string;
  city?: string;
}): { customerId: string; israelIdToken: string; status: 'ANONYMIZED'; anonymizedAt: string } {
  return {
    customerId: row.customerId,
    israelIdToken: row.israelId ? row.israelId.slice(-4) : 'XXXX',
    status: 'ANONYMIZED',
    anonymizedAt: new Date().toISOString(),
  };
}
