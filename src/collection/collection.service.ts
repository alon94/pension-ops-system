import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { REPOSITORY, Repository } from '../persistence/repository.port';
import {
  CollectionDiscrepancy,
  ClearingReport,
  EmployerReport,
  ExpectedDeposit,
  NewCollectionDiscrepancy,
} from './collection.types';
import { DiscrepancyLifecycleService } from './discrepancy-lifecycle.service';
import { detectOverCap, reconcile } from './reconciliation';

/** שירות בקרת גבייה (פרק 9) — A5/A7 dual-stage. */
@Injectable()
export class CollectionService {
  private readonly log = new Logger('Collection');

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly lifecycle: DiscrepancyLifecycleService,
  ) {}

  /** §9.4 — סריקה חודשית: רץ על כל ה-expected/employer/clearing ומחזיר את הפערים שנפתחו. */
  async reconcileMonth(input: {
    expected: ExpectedDeposit[];
    employerReports: EmployerReport[];
    clearingReports: ClearingReport[];
  }): Promise<CollectionDiscrepancy[]> {
    const byKey = (e: ExpectedDeposit) => `${e.customerId}|${e.employmentId}|${e.referenceMonth}`;
    const empBy = new Map<string, EmployerReport>();
    for (const e of input.employerReports) {
      empBy.set(`${e.customerId}|${e.employmentId ?? ''}|${e.referenceMonth}`, e);
    }
    const clrBy = new Map<string, ClearingReport>();
    for (const c of input.clearingReports) {
      clrBy.set(`${c.customerId}|${c.referenceMonth}|${c.accountId}`, c);
    }

    const opened: CollectionDiscrepancy[] = [];

    const clearingExpected = input.clearingReports.length > 0;
    for (const exp of input.expected) {
      const emp = empBy.get(byKey(exp));
      const clr = clrBy.get(`${exp.customerId}|${exp.referenceMonth}|${exp.accountId}`);
      const issues = reconcile({ expected: exp, employerReport: emp, clearingReport: clr, clearingExpected });
      for (const i of issues) {
        const saved = await this.persistIfNew(i);
        if (saved) opened.push(saved);
      }
    }

    // §9.3(4) — תקרה חוצת-מעסיקים
    const byCustomerMonth = new Map<string, { employer: number; employee: number }[]>();
    for (const e of input.employerReports) {
      const k = `${e.customerId}|${e.referenceMonth}`;
      const arr = byCustomerMonth.get(k) ?? [];
      arr.push({ employer: e.amounts.employer, employee: e.amounts.employee });
      byCustomerMonth.set(k, arr);
    }
    for (const [k, arr] of byCustomerMonth) {
      const [customerId, month] = k.split('|');
      const overCap = detectOverCap(customerId, month, arr);
      if (overCap) {
        const saved = await this.persistIfNew(overCap);
        if (saved) opened.push(saved);
      }
    }

    return opened;
  }

  /** §9.3(10) — סימון מעסיק כחדל פירעון יוצר DISCREPANCY מסוג EMPLOYER_INSOLVENT. */
  async markEmployerInsolvent(customerId: string, employerId: string, employmentId: string, referenceMonth: string): Promise<CollectionDiscrepancy | null> {
    return this.persistIfNew({
      customerId, employerId, employmentId, referenceMonth,
      expectedAmountEmployee: 0, expectedAmountEmployer: 0, expectedAmountSeverance: 0,
      discrepancyType: 'EMPLOYER_INSOLVENT',
      discrepancyAmount: 0,
      resolutionSummary: 'מעסיק חדל פירעון — הפסקת הפקדות',
    });
  }

  async transition(id: string, input: { to: CollectionDiscrepancy['status']; by: string; summary?: string }): Promise<CollectionDiscrepancy> {
    const d = await this.repo.getDiscrepancy(id);
    if (!d) throw new Error(`COLLECTION_DISCREPANCY לא נמצא: ${id}`);
    const next = this.lifecycle.applyTransition(d, input);
    await this.repo.saveDiscrepancy(next);
    return next;
  }

  /** §9.5 — דוח חודשי תמציתי. */
  async monthlyReport(referenceMonth: string): Promise<{
    referenceMonth: string;
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
  }> {
    const items = await this.repo.listDiscrepanciesByMonth(referenceMonth);
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const i of items) {
      byType[i.discrepancyType] = (byType[i.discrepancyType] ?? 0) + 1;
      byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    }
    return { referenceMonth, total: items.length, byType, byStatus };
  }

  private async persistIfNew(input: NewCollectionDiscrepancy): Promise<CollectionDiscrepancy | null> {
    const existing = await this.repo.findOpenDiscrepancy(
      input.customerId, input.employmentId, input.referenceMonth, input.discrepancyType,
    );
    if (existing) return null;
    const d: CollectionDiscrepancy = {
      ...input,
      discrepancyId: randomUUID(),
      detectedAt: input.detectedAt ?? new Date().toISOString(),
      status: 'OPEN',
    };
    const saved = await this.repo.createDiscrepancy(d);
    this.log.log(`OPEN ${saved.discrepancyType} ${saved.referenceMonth} amount=${saved.discrepancyAmount}`);
    return saved;
  }
}
