import { RejectSeverity, RejectType } from './reject.types';

/** §7.3 — קטלוג ריג'קטים נפוצים R001–R015. */
export interface CatalogEntry {
  code: string;
  type: RejectType;
  source: string;
  description: string;
  defaultSeverity: RejectSeverity;
  /** אייג'נט/פעולה אוטומטית מטפל/ת (אינדיקטיבי, §7.3) */
  autoHandling: string;
}

export const REJECT_CATALOG: Record<string, CatalogEntry> = {
  R001: { code: 'R001', type: 'MANUFACTURER', source: 'יצרן', description: 'פוליסה לא נמצאת אצל היצרן', defaultSeverity: 'HIGH', autoHandling: 'אימות מול CRM ושליחה לבירור (A3)' },
  R002: { code: 'R002', type: 'MANUFACTURER', source: 'יצרן', description: 'פוליסה בוטלה לפני 5+ שנים', defaultSeverity: 'MEDIUM', autoHandling: "סגירת ACCOUNT — trigger='RETROACTIVE_CLOSURE'" },
  R003: { code: 'R003', type: 'MANUFACTURER', source: 'יצרן', description: 'בעלות לא תואמת — מישהו אחר רשום', defaultSeverity: 'HIGH', autoHandling: 'חקירה — אולי טעות הזנה ב-CRM' },
  R004: { code: 'R004', type: 'MANUFACTURER', source: 'יצרן', description: 'חסר ייפוי כוח ספציפי לגוף', defaultSeverity: 'HIGH', autoHandling: 'בקשת חתימה מהלקוח' },
  R005: { code: 'R005', type: 'CLEARING', source: 'מסלקה', description: 'ייפוי כוח פג תוקף', defaultSeverity: 'HIGH', autoHandling: 'בקשת חידוש מהלקוח' },
  R006: { code: 'R006', type: 'CLEARING', source: 'מסלקה', description: 'חריגת מכסת בקשות חודשית', defaultSeverity: 'LOW', autoHandling: 'המתנה לחודש הבא' },
  R007: { code: 'R007', type: 'INTERNAL', source: 'מערכת', description: 'ת.ז. לא תקנית בקובץ נכנס', defaultSeverity: 'HIGH', autoHandling: 'חקירה — שגיאת רגולציה ביצרן?' },
  R008: { code: 'R008', type: 'DISCREPANCY', source: 'CRM↔Clearing', description: 'חשבון ב-CRM אבל לא במסלקה', defaultSeverity: 'MEDIUM', autoHandling: 'A4 — האם המכירה הופקה?' },
  R009: { code: 'R009', type: 'DISCREPANCY', source: 'Clearing↔CRM', description: 'חשבון במסלקה אבל לא ב-CRM', defaultSeverity: 'MEDIUM', autoHandling: 'A4 — רכישה חיצונית?' },
  R010: { code: 'R010', type: 'DISCREPANCY', source: 'Salary↔Deposit', description: 'פער בין שכר לדיווח הפקדה', defaultSeverity: 'HIGH', autoHandling: 'A7 — חקירת בקרת גבייה' },
  R011: { code: 'R011', type: 'INTERNAL', source: 'מערכת', description: 'total ≠ סכום רכיבים ב-BALANCE', defaultSeverity: 'MEDIUM', autoHandling: 'בירור עם יצרן — שדה נוסף?' },
  R012: { code: 'R012', type: 'MANUFACTURER', source: 'יצרן', description: 'יתרה שונה ממה שדווח', defaultSeverity: 'MEDIUM', autoHandling: 'חקירה — תנועה חדשה?' },
  R013: { code: 'R013', type: 'DISCREPANCY', source: 'Coverage↔Risk', description: 'כיסוי קיים אבל בלי הפקדה', defaultSeverity: 'HIGH', autoHandling: 'סיכון איבוד כיסוי' },
  R014: { code: 'R014', type: 'MANUFACTURER', source: 'יצרן', description: 'סטטוס לא בסטנדרט', defaultSeverity: 'LOW', autoHandling: 'עדכון REF + חזרה' },
  R015: { code: 'R015', type: 'DISCREPANCY', source: 'Beneficiary', description: 'מוטבים שונים ב-CRM ובמסלקה', defaultSeverity: 'MEDIUM', autoHandling: 'אימות מול הלקוח' },
};

export function catalogEntry(code: string): CatalogEntry | undefined {
  return REJECT_CATALOG[code];
}
