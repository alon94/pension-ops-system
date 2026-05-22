import { Injectable } from '@nestjs/common';
import { CollectionService } from '../collection/collection.service';
import { ClearingReport, EmployerReport, ExpectedDeposit } from '../collection/collection.types';
import { Agent, AgentResult, AgentTask, AUTONOMY } from './agent.types';

/**
 * A4 — Sales-Production Reconciliation Agent (§11.2 A4).
 * השוואה בין רשומות מכירה ב-CRM ליצירת ACCOUNT במסלקה.
 * stub פונקציונלי — מקבל את הזוגות מבחוץ ומחזיר חוסרים.
 */
@Injectable()
export class A4SalesProductionAgent implements Agent<{
  crmSoldPolicies: { policyNumber: string; soldAt: string }[];
  clearingAccounts: string[];
}> {
  readonly id = 'A4' as const;
  readonly autonomy = AUTONOMY.A4;

  async run(task: AgentTask<{
    crmSoldPolicies: { policyNumber: string; soldAt: string }[];
    clearingAccounts: string[];
  }>): Promise<AgentResult> {
    const clearingSet = new Set(task.payload.clearingAccounts);
    const missingInClearing = task.payload.crmSoldPolicies.filter((p) => !clearingSet.has(p.policyNumber));
    const crmSet = new Set(task.payload.crmSoldPolicies.map((p) => p.policyNumber));
    const missingInCrm = task.payload.clearingAccounts.filter((p) => !crmSet.has(p));
    return {
      ok: true,
      summary: `A4 found ${missingInClearing.length} missing-in-clearing, ${missingInCrm.length} missing-in-CRM`,
      data: { missingInClearing, missingInCrm },
    };
  }
}

/** A5 — Employer Allocation Agent (§11.2 A5). בקרת פיצול קופות (שלב 1: expected vs employer). */
@Injectable()
export class A5EmployerAllocationAgent implements Agent<{
  expected: ExpectedDeposit[];
  employerReports: EmployerReport[];
}> {
  readonly id = 'A5' as const;
  readonly autonomy = AUTONOMY.A5;

  constructor(private readonly collection: CollectionService) {}

  async run(task: AgentTask<{ expected: ExpectedDeposit[]; employerReports: EmployerReport[] }>): Promise<AgentResult> {
    const opened = await this.collection.reconcileMonth({
      expected: task.payload.expected,
      employerReports: task.payload.employerReports,
      clearingReports: [], // A5 שלב 1 בלבד
    });
    return { ok: true, summary: `A5 opened ${opened.length} employer-stage discrepancies` };
  }
}

/** A7 — Collection Reconciliation Agent (§11.2 A7). בקרה דו-שלבית מלאה. */
@Injectable()
export class A7CollectionAgent implements Agent<{
  expected: ExpectedDeposit[];
  employerReports: EmployerReport[];
  clearingReports: ClearingReport[];
}> {
  readonly id = 'A7' as const;
  readonly autonomy = AUTONOMY.A7;

  constructor(private readonly collection: CollectionService) {}

  async run(task: AgentTask<{
    expected: ExpectedDeposit[];
    employerReports: EmployerReport[];
    clearingReports: ClearingReport[];
  }>): Promise<AgentResult> {
    const opened = await this.collection.reconcileMonth(task.payload);
    return { ok: true, summary: `A7 opened ${opened.length} collection discrepancies` };
  }
}
