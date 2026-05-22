import { Reject } from './reject.types';

/** §7.7 — דגלי סיכון ב-AGENT_CONTEXT הנגזרים מריג'קטים פעילים של לקוח. */
export type RejectRiskFlag = 'OPEN_REJECT_HIGH' | 'STALE_REJECT_30D' | 'MULTIPLE_REJECTS';

const ACTIVE = (r: Reject) => r.status !== 'RESOLVED' && r.status !== 'DISMISSED';
const MS_DAY = 24 * 3600_000;

export function rejectRiskFlags(customerRejects: Reject[], now = new Date()): RejectRiskFlag[] {
  const active = customerRejects.filter(ACTIVE);
  const flags: RejectRiskFlag[] = [];

  if (active.some((r) => r.severity === 'HIGH' || r.severity === 'CRITICAL')) {
    flags.push('OPEN_REJECT_HIGH');
  }
  if (active.some((r) => (now.getTime() - new Date(r.detectedAt).getTime()) / MS_DAY > 30)) {
    flags.push('STALE_REJECT_30D');
  }
  if (active.length > 3) {
    flags.push('MULTIPLE_REJECTS');
  }
  return flags;
}
