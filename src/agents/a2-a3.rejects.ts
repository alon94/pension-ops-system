import { Injectable } from '@nestjs/common';
import { deriveRejectsFromValidation } from '../rejects/reject-derivation';
import { RejectService } from '../rejects/reject.service';
import { Reject } from '../rejects/reject.types';
import { ValidationIssue } from '../validation/types';
import { Agent, AgentResult, AgentTask, AUTONOMY } from './agent.types';

/** A2 — Internal Reject Agent (§11.2 A2). פותח ריג'קטים פנימיים מ-ingestion errors. */
@Injectable()
export class A2InternalRejectAgent implements Agent<{ issues: ValidationIssue[]; ingestionRunId?: string; customerId?: string }> {
  readonly id = 'A2' as const;
  readonly autonomy = AUTONOMY.A2;

  constructor(private readonly rejects: RejectService) {}

  async run(task: AgentTask<{ issues: ValidationIssue[]; ingestionRunId?: string; customerId?: string }>): Promise<AgentResult> {
    const opened = await this.rejects.openMany(
      deriveRejectsFromValidation(task.payload.issues, {
        ingestionRunId: task.payload.ingestionRunId,
        customerId: task.payload.customerId,
      }),
    );
    const hasCritical = opened.some((r) => r.severity === 'CRITICAL');
    return {
      ok: true,
      requiresHumanApproval: hasCritical, // §11.5 — A2 SEMI: CRITICAL דורש אישור
      summary: `A2 opened ${opened.length} internal rejects`,
      data: { opened: opened.map((r) => r.rejectId) },
    };
  }
}

/** A3 — Manufacturer Reject Agent (§11.2 A3). מטפל בריג'קטי יצרן. */
@Injectable()
export class A3ManufacturerRejectAgent implements Agent<{ rejectId: string; manufacturerKey?: string; note?: string }> {
  readonly id = 'A3' as const;
  readonly autonomy = AUTONOMY.A3;

  constructor(private readonly rejects: RejectService) {}

  async run(task: AgentTask<{ rejectId: string; manufacturerKey?: string; note?: string }>): Promise<AgentResult> {
    let reject: Reject;
    try {
      reject = await this.rejects.transition(task.payload.rejectId, {
        to: 'WAITING_MANUFACTURER',
        by: 'A3',
        manufacturerKey: task.payload.manufacturerKey,
        note: task.payload.note ?? 'נשלחה פנייה ליצרן',
      });
    } catch (e) {
      return { ok: false, summary: 'A3 failed', error: (e as Error).message };
    }
    return {
      ok: true,
      summary: `A3 sent to manufacturer (SLA ${reject.slaDueAt})`,
      data: { status: reject.status, slaDueAt: reject.slaDueAt },
    };
  }
}
