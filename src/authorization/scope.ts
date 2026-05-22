import { Authorization } from './authorization.types';

/**
 * §10.2 — בדיקת scope לפני INQUIRY.
 *   - full: מכסה הכל.
 *   - read_only: מכסה רק קריאה.
 *   - specific_products: דורש שכל המוצרים המבוקשים יופיעו ב-scopeDetailsJson.products.
 *   - specific_manufacturers: כמו לעיל אך עבור manufacturers.
 *
 * §10.4 — AUTH לא 'active' או שפג תוקפו => coverage=false תמיד.
 */
export interface InquiryRequirement {
  action: 'READ' | 'WRITE';
  manufacturerCode?: string;
  productCode?: string;
}

export function isActiveNow(auth: Authorization, now = new Date()): boolean {
  if (auth.status !== 'active') return false;
  const validTo = new Date(auth.validTo).getTime();
  return validTo >= now.getTime();
}

export function coversInquiry(auth: Authorization, req: InquiryRequirement, now = new Date()): boolean {
  if (!isActiveNow(auth, now)) return false;
  if (auth.scope === 'full') return true;
  if (auth.scope === 'read_only') return req.action === 'READ';
  if (auth.scope === 'specific_products') {
    const list = auth.scopeDetailsJson?.products ?? [];
    return !!req.productCode && list.includes(req.productCode);
  }
  if (auth.scope === 'specific_manufacturers') {
    const list = auth.scopeDetailsJson?.manufacturers ?? [];
    return !!req.manufacturerCode && list.includes(req.manufacturerCode);
  }
  return false;
}
