import { RejectSeverity } from './reject.types';

/** §7.4 — SLA פנימי לפי חומרה (זמן תגובה ראשון / זמן פתרון יעד). */
export interface InternalSla {
  firstResponseHours: number;
  resolutionHours: number;
}

export const INTERNAL_SLA: Record<RejectSeverity, InternalSla> = {
  CRITICAL: { firstResponseHours: 2, resolutionHours: 24 },
  HIGH: { firstResponseHours: 4, resolutionHours: 3 * 24 },
  MEDIUM: { firstResponseHours: 24, resolutionHours: 7 * 24 },
  LOW: { firstResponseHours: 72, resolutionHours: 30 * 24 },
};

/** §7.4 — SLA חיצוני לפי גוף מוסדי (ימי עסקים לחזרה, איש קשר להסלמה).
 *  אינדיקטיבי — לתיקוף מול הסכמי שירות בפועל. */
export interface ExternalSla {
  manufacturerKey: string;
  responseBusinessDays: number;
  escalationContact: string;
}

export const EXTERNAL_SLA: Record<string, ExternalSla> = {
  MGD: { manufacturerKey: 'MGD', responseBusinessDays: 5, escalationContact: 'manager-ops@migdal.co.il' },
  HRL: { manufacturerKey: 'HRL', responseBusinessDays: 5, escalationContact: 'ops-claims@harel.co.il' },
  CLAL: { manufacturerKey: 'CLAL', responseBusinessDays: 7, escalationContact: 'claims@clal.co.il' },
  PHNX: { manufacturerKey: 'PHNX', responseBusinessDays: 5, escalationContact: 'service@phoenix.co.il' },
  MNRH: { manufacturerKey: 'MNRH', responseBusinessDays: 7, escalationContact: 'תיק רגולציה — תלוי בנושא' },
  ALTS: { manufacturerKey: 'ALTS', responseBusinessDays: 5, escalationContact: 'service@altshul.co.il' },
  MTDS: { manufacturerKey: 'MTDS', responseBusinessDays: 5, escalationContact: 'claims@meitavdash.co.il' },
  MOR: { manufacturerKey: 'MOR', responseBusinessDays: 3, escalationContact: 'service@morinvest.co.il' },
  AMIT: { manufacturerKey: 'AMIT', responseBusinessDays: 14, escalationContact: 'SLA ארוך, בירוקרטי' },
};

/** הוספת ימי עסקים (דילוג שישי=5/שבת=6) לתאריך נתון. */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 5 && dow !== 6) added++;
  }
  return d;
}

/** §7.4 — תאריך יעד פתרון פנימי לפי חומרה. */
export function internalResolutionDue(severity: RejectSeverity, from = new Date()): Date {
  return new Date(from.getTime() + INTERNAL_SLA[severity].resolutionHours * 3600_000);
}

/** §7.4 — תאריך חזרה צפוי מגוף מוסדי (ימי עסקים). ברירת מחדל 7 אם לא מוכר. */
export function manufacturerResponseDue(manufacturerKey: string, from = new Date()): Date {
  const sla = EXTERNAL_SLA[manufacturerKey];
  return addBusinessDays(from, sla ? sla.responseBusinessDays : 7);
}

/** §7.4 — SLA חדש בעת הסלמה: 3 ימים. */
export function escalationDue(from = new Date()): Date {
  return new Date(from.getTime() + 3 * 24 * 3600_000);
}
