/** עיצוב מספרים, תאריכים ו-SLA קאונטדאון בעברית. */

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
const ILS_FULL = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' });
const HE_DATE = new Intl.DateTimeFormat('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit' });
const HE_DATETIME = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' });

export const fmtIls = (n: number) => ILS.format(n);
export const fmtIlsExact = (n: number) => ILS_FULL.format(n);

export function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : HE_DATE.format(d);
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : HE_DATETIME.format(d);
}

/** YYYYMM → "MM/YYYY" */
export function fmtMonth(yyyymm: string): string {
  if (!/^\d{6}$/.test(yyyymm)) return yyyymm;
  return `${yyyymm.slice(4, 6)}/${yyyymm.slice(0, 4)}`;
}

/** "in 2 days" / "overdue by 3h" */
export function fmtRelative(iso?: string, now = new Date()): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - now.getTime();
  const absH = Math.abs(diff) / 3_600_000;
  const overdue = diff < 0;
  const value = absH < 48 ? `${Math.round(absH)} שעות` : `${Math.round(absH / 24)} ימים`;
  return overdue ? `חרג ב-${value}` : `בעוד ${value}`;
}
