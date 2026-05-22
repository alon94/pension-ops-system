import { createHash } from 'node:crypto';
import { Customer360 } from '../api/ui-query.types';
import { CustomerContextSummary } from './agent-context.types';

/**
 * §5.6 — חישוב מחדש של AGENT_CONTEXT לאחר קליטה.
 * פונקציה טהורה: ממירה Customer360 ל-summary + risk_flags + opportunity_flags + hash.
 */
export function buildContextSummary(c360: Customer360, now = new Date()): CustomerContextSummary {
  const c = c360.customer;
  const ageYears = c.birthDate
    ? Math.floor((now.getTime() - new Date(c.birthDate).getTime()) / (365.25 * 86_400_000))
    : undefined;

  const totalAssets = c360.accounts.reduce((s, a) => s + (a.latestBalance?.total ?? 0), 0);
  const last12 = c360.recentDeposits.reduce((s, d) => s + d.total, 0);
  const lastDeposit = c360.recentDeposits[0]; // already ORDER BY deposit_month DESC

  const open = c360.rejects.filter((r) => r.status !== 'RESOLVED' && r.status !== 'DISMISSED');
  const bySource: Record<string, number> = {};
  for (const r of open) bySource[r.rejectCode.charAt(0)] = (bySource[r.rejectCode.charAt(0)] ?? 0) + 1;

  return {
    customerId: c.customerId,
    identity: {
      israelId: c.israelId,
      fullName: `${c.firstName} ${c.lastName}`.trim(),
      birthDate: c.birthDate, city: c.city, ageYears,
    },
    authorization: {
      hasActive: !!c360.authorization,
      expiresInDays: c360.authorization?.daysUntilExpiry,
      scope: c360.authorization?.scope,
    },
    portfolio: {
      accountsCount: c360.accounts.length,
      activeAccountsCount: c360.accounts.filter((a) => a.currentStatus === 'AC' || a.currentStatus === 'ACTIVE').length,
      totalAssets,
      manufacturers: [...new Set(c360.accounts.map((a) => a.manufacturerName))],
      products: [...new Set(c360.accounts.map((a) => a.productCode).filter((p): p is string => !!p))],
    },
    recentActivity: {
      lastDepositMonth: lastDeposit?.depositMonth,
      lastDepositAmount: lastDeposit?.total,
      last12MonthsTotal: last12,
      activeTerminations: c360.terminations.filter((t) => t.status !== 'COMPLETED' && t.status !== 'DISMISSED').length,
    },
    rejects: {
      openCount: open.length,
      criticalCount: open.filter((r) => r.severity === 'CRITICAL').length,
      highCount: open.filter((r) => r.severity === 'HIGH').length,
      overdueCount: 0, // לא קיים ב-Customer360 כיום; נחושב משם בעתיד
      bySource,
    },
  };
}

/** §5.6 + §7.7 + §8.6 — דגלי סיכון ודגלי הזדמנות נגזרים מ-summary. */
export function deriveFlags(s: CustomerContextSummary): { riskFlags: string[]; opportunityFlags: string[] } {
  const risk: string[] = [];
  const opportunity: string[] = [];

  // §7.7
  if (s.rejects.highCount + s.rejects.criticalCount > 0) risk.push('OPEN_REJECT_HIGH');
  if (s.rejects.openCount > 3) risk.push('MULTIPLE_REJECTS');

  // §10.4 — ייפוי כוח פג קרוב
  if (!s.authorization.hasActive) risk.push('NO_ACTIVE_AUTHORIZATION');
  else if ((s.authorization.expiresInDays ?? Infinity) < 30) risk.push('AUTH_EXPIRES_SOON');

  // §8.x — סיום עבודה פעיל
  if (s.recentActivity.activeTerminations > 0) risk.push('ACTIVE_TERMINATION');

  // §6.x — לקוח עם נכסים גדולים שלא הופקד עליו לאחרונה
  if (s.recentActivity.lastDepositMonth) {
    const [y, m] = [Number(s.recentActivity.lastDepositMonth.slice(0, 4)), Number(s.recentActivity.lastDepositMonth.slice(4, 6))];
    const monthsAgo = (new Date().getUTCFullYear() - y) * 12 + (new Date().getUTCMonth() + 1 - m);
    if (monthsAgo > 3) risk.push('STALE_DEPOSITS_3M');
  } else if (s.portfolio.totalAssets > 0) {
    risk.push('NO_RECENT_DEPOSITS');
  }

  // §6.x — הזדמנויות
  if (s.portfolio.accountsCount > 1) opportunity.push('CONSOLIDATION_CANDIDATE');
  if (s.portfolio.totalAssets > 500_000) opportunity.push('HIGH_NET_WORTH');
  if (s.identity.ageYears !== undefined && s.identity.ageYears >= 55) opportunity.push('PRE_RETIREMENT_PLANNING');

  return { riskFlags: risk, opportunityFlags: opportunity };
}

/** Hash דטרמיניסטי של ה-summary — נשמר במסד כדי לזהות כשהוא באמת השתנה. */
export function hashSummary(s: CustomerContextSummary): string {
  return createHash('sha256').update(stableStringify(s)).digest('hex');
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v as object).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify((v as any)[k])).join(',') + '}';
}
