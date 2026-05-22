import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { REPOSITORY, Repository } from '../persistence/repository.port';
import { Form161LifecycleService, Form161TransitionInput } from './form-161-lifecycle.service';
import { validateForm161, Form161Issue } from './form-161-rules';
import {
  CustomerEmploymentSnapshot,
  detectConfirmedTermination,
  detectPotentialTermination,
} from './termination-detection';
import { TerminationLifecycleService, TerminationTransitionInput } from './termination-lifecycle.service';
import { DetectionSource, Form161, NewForm161, TerminationEvent } from './termination.types';

/**
 * שירות סיום עבודה (פרק 8) — פותח אירועים מתוך זיהוי A6, מנהל מחזור חיים,
 * ויוצר/מתחזק טפסי 161 לפי §8.4.
 */
@Injectable()
export class TerminationService {
  private readonly log = new Logger('Termination');

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly lifecycle: TerminationLifecycleService,
    private readonly form161Lifecycle: Form161LifecycleService,
  ) {}

  /**
   * §8.3 — פותח אירוע סיום עבודה אם אין כבר אחד פעיל לאותו זוג customer+employment.
   * דוכא אם §8.5(7) — חזרה תוך 90 יום לאותו מעסיק.
   */
  async openFromSnapshot(
    snap: CustomerEmploymentSnapshot,
    allForCustomer: CustomerEmploymentSnapshot[],
    source: DetectionSource,
    ingestionRunId?: string,
    now = new Date(),
  ): Promise<TerminationEvent | null> {
    const existing = await this.repo.findActiveTermination(snap.customerId, snap.employmentId);
    if (existing) return existing;

    const confirmed = detectConfirmedTermination(snap, { allEmploymentsForCustomer: allForCustomer }, source);
    const potential = !confirmed ? detectPotentialTermination(snap, { allEmploymentsForCustomer: allForCustomer, now }) : null;
    const result = confirmed ?? potential;
    if (!result) return null;
    if (result.suppressed) {
      this.log.log(`סיום עבודה דוכא (§8.5(7)) — ${result.suppressed}`);
      return null;
    }

    const ev: TerminationEvent = {
      ...result.candidate,
      terminationEventId: randomUUID(),
      detectedAt: result.candidate.detectedAt ?? now.toISOString(),
      status: result.reason === 'CONFIRMED_END_DATE' ? 'CONFIRMED' : 'DETECTED',
      ingestionRunId,
    };
    const saved = await this.repo.createTermination(ev);
    this.log.log(`OPEN ${saved.status} customer=${saved.customerId} src=${saved.detectionSource}`);
    return saved;
  }

  /** §8.2 — סריקה תקופתית (cron של A6) על כל ה-snapshots. */
  async scan(now = new Date()): Promise<TerminationEvent[]> {
    const snaps = await this.repo.loadEmploymentSnapshots();
    const byCustomer = groupBy(snaps, (s) => s.customerId);
    const opened: TerminationEvent[] = [];
    for (const s of snaps) {
      const ev = await this.openFromSnapshot(s, byCustomer.get(s.customerId) ?? [], 'AGENT_AUTOMATED', undefined, now);
      if (ev) opened.push(ev);
    }
    return opened;
  }

  /** קליטה חדשה הביאה employmentEnd → פתיחת CONFIRMED על המקור CLEARING. */
  async openConfirmedFromRun(runId: string, now = new Date()): Promise<TerminationEvent[]> {
    const runSnaps = await this.repo.loadEmploymentSnapshotsForRun(runId);
    if (runSnaps.length === 0) return [];
    const allSnaps = await this.repo.loadEmploymentSnapshots();
    const byCustomer = groupBy(allSnaps, (s) => s.customerId);
    const opened: TerminationEvent[] = [];
    for (const s of runSnaps) {
      if (!s.endDate) continue;
      const ev = await this.openFromSnapshot(s, byCustomer.get(s.customerId) ?? [], 'CLEARING', runId, now);
      if (ev) opened.push(ev);
    }
    return opened;
  }

  async transition(eventId: string, input: TerminationTransitionInput): Promise<TerminationEvent> {
    const ev = await this.repo.getTermination(eventId);
    if (!ev) throw new Error(`אירוע סיום עבודה לא נמצא: ${eventId}`);
    const next = this.lifecycle.applyTransition(ev, input);
    await this.repo.saveTermination(next);
    return next;
  }

  /** §8.4 — יצירת טופס 161 חדש בסטטוס DRAFT לאחר אימות אריתמטיקה. */
  async createForm(input: NewForm161): Promise<{ form: Form161; issues: Form161Issue[] }> {
    const form: Form161 = {
      ...input,
      form161Id: randomUUID(),
      validationStatus: input.validationStatus ?? 'DRAFT',
    };
    const issues = validateForm161(form);
    const saved = await this.repo.createForm161(form);
    return { form: saved, issues };
  }

  async transitionForm(formId: string, input: Form161TransitionInput): Promise<Form161> {
    const f = await this.repo.getForm161(formId);
    if (!f) throw new Error(`טופס 161 לא נמצא: ${formId}`);
    const next = this.form161Lifecycle.applyTransition(f, input);
    await this.repo.saveForm161(next);
    return next;
  }
}

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}
