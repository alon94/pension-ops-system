import { Injectable } from '@nestjs/common';
import { Reject, RejectStatus } from './reject.types';
import { escalationDue, internalResolutionDue, manufacturerResponseDue } from './sla';

/** §7.4 — מעברי מצב חוקיים במחזור חיי ריג'קט. */
export const TRANSITIONS: Record<RejectStatus, RejectStatus[]> = {
  // OPEN→ESCALATED: ריג'קט שלא טופל ועבר SLA מוסלם אוטומטית גם מ-OPEN
  OPEN: ['IN_PROGRESS', 'ESCALATED', 'DISMISSED'],
  IN_PROGRESS: ['WAITING_MANUFACTURER', 'WAITING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'DISMISSED'],
  WAITING_MANUFACTURER: ['IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'DISMISSED'],
  WAITING_CUSTOMER: ['IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'DISMISSED'],
  ESCALATED: ['IN_PROGRESS', 'RESOLVED', 'DISMISSED'],
  RESOLVED: [],
  DISMISSED: [],
};

const TERMINAL: RejectStatus[] = ['RESOLVED', 'DISMISSED'];
const WAITING_CUSTOMER_SLA_DAYS = 7; // §7.4

export class IllegalTransitionError extends Error {
  constructor(from: RejectStatus, to: RejectStatus) {
    super(`מעבר לא חוקי ${from} → ${to}`);
  }
}

export interface TransitionInput {
  to: RejectStatus;
  by: string; // user / agent
  note?: string;
  /** מפתח יצרן לחישוב SLA חיצוני במעבר ל-WAITING_MANUFACTURER */
  manufacturerKey?: string;
  resolutionSummary?: string;
  now?: Date;
}

@Injectable()
export class RejectLifecycleService {
  canTransition(from: RejectStatus, to: RejectStatus): boolean {
    return TRANSITIONS[from]?.includes(to) ?? false;
  }

  /** מחיל מעבר מצב: מאמת חוקיות, מעדכן SLA, ומוסיף צעד ל-resolution_path. */
  applyTransition(reject: Reject, input: TransitionInput): Reject {
    const now = input.now ?? new Date();
    if (!this.canTransition(reject.status, input.to)) {
      throw new IllegalTransitionError(reject.status, input.to);
    }

    const step = {
      at: now.toISOString(),
      from: reject.status,
      to: input.to,
      by: input.by,
      note: input.note,
    };

    const next: Reject = {
      ...reject,
      status: input.to,
      assignee: input.by,
      resolutionPath: [...reject.resolutionPath, step],
      slaDueAt: this.computeSlaDue(reject, input, now),
    };

    if (TERMINAL.includes(input.to)) {
      next.resolvedAt = now.toISOString();
      next.resolvedBy = input.by;
      next.resolutionSummary = input.resolutionSummary ?? reject.resolutionSummary;
      next.slaDueAt = undefined;
    }
    return next;
  }

  private computeSlaDue(reject: Reject, input: TransitionInput, now: Date): string | undefined {
    switch (input.to) {
      case 'WAITING_MANUFACTURER':
        return manufacturerResponseDue(input.manufacturerKey ?? '', now).toISOString();
      case 'WAITING_CUSTOMER':
        return new Date(now.getTime() + WAITING_CUSTOMER_SLA_DAYS * 24 * 3600_000).toISOString();
      case 'ESCALATED':
        return escalationDue(now).toISOString();
      case 'IN_PROGRESS':
        return internalResolutionDue(reject.severity, now).toISOString();
      default:
        return reject.slaDueAt;
    }
  }

  /** §7.4 — ריג'קט שחרג מ-SLA ועדיין לא טופל => מועמד להסלמה. */
  isOverdue(reject: Reject, now = new Date()): boolean {
    if (TERMINAL.includes(reject.status) || reject.status === 'ESCALATED') return false;
    return !!reject.slaDueAt && now.getTime() > new Date(reject.slaDueAt).getTime();
  }
}
