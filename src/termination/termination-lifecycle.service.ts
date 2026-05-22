import { Injectable } from '@nestjs/common';
import { TerminationEvent, TerminationStatus } from './termination.types';

/** §8.3 — מחזור חיי TerminationEvent. */
export const TERMINATION_TRANSITIONS: Record<TerminationStatus, TerminationStatus[]> = {
  DETECTED: ['CONFIRMED', 'DISMISSED'],
  CONFIRMED: ['IN_PROCESS', 'DISMISSED'],
  IN_PROCESS: ['COMPLETED', 'DISMISSED'],
  COMPLETED: [],
  DISMISSED: [],
};

export class TerminationTransitionError extends Error {
  constructor(from: TerminationStatus, to: TerminationStatus) {
    super(`מעבר לא חוקי ${from} → ${to}`);
  }
}

export interface TerminationTransitionInput {
  to: TerminationStatus;
  by: string;
  notes?: string;
}

@Injectable()
export class TerminationLifecycleService {
  canTransition(from: TerminationStatus, to: TerminationStatus): boolean {
    return TERMINATION_TRANSITIONS[from]?.includes(to) ?? false;
  }

  applyTransition(ev: TerminationEvent, input: TerminationTransitionInput): TerminationEvent {
    if (!this.canTransition(ev.status, input.to)) {
      throw new TerminationTransitionError(ev.status, input.to);
    }
    return {
      ...ev,
      status: input.to,
      notes: input.notes ? `${ev.notes ? ev.notes + ' · ' : ''}${input.notes}` : ev.notes,
    };
  }
}
