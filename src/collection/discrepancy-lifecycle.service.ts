import { Injectable } from '@nestjs/common';
import { CollectionDiscrepancy, DiscrepancyStatus } from './collection.types';

/** §9.2 — מחזור חיי COLLECTION_DISCREPANCY. */
export const DISCREPANCY_TRANSITIONS: Record<DiscrepancyStatus, DiscrepancyStatus[]> = {
  OPEN: ['EMPLOYER_NOTIFIED', 'FUND_NOTIFIED', 'RESOLVED', 'DISMISSED'],
  EMPLOYER_NOTIFIED: ['FUND_NOTIFIED', 'RESOLVED', 'DISMISSED'],
  FUND_NOTIFIED: ['RESOLVED', 'DISMISSED'],
  RESOLVED: [],
  DISMISSED: [],
};

export class DiscrepancyTransitionError extends Error {
  constructor(from: DiscrepancyStatus, to: DiscrepancyStatus) {
    super(`מעבר לא חוקי ${from} → ${to}`);
  }
}

@Injectable()
export class DiscrepancyLifecycleService {
  canTransition(from: DiscrepancyStatus, to: DiscrepancyStatus): boolean {
    return DISCREPANCY_TRANSITIONS[from]?.includes(to) ?? false;
  }

  applyTransition(
    d: CollectionDiscrepancy,
    input: { to: DiscrepancyStatus; by: string; summary?: string; now?: Date },
  ): CollectionDiscrepancy {
    if (!this.canTransition(d.status, input.to)) {
      throw new DiscrepancyTransitionError(d.status, input.to);
    }
    const now = input.now ?? new Date();
    const terminal = input.to === 'RESOLVED' || input.to === 'DISMISSED';
    return {
      ...d,
      status: input.to,
      resolutionSummary: input.summary ?? d.resolutionSummary,
      resolvedAt: terminal ? now.toISOString() : d.resolvedAt,
    };
  }
}
