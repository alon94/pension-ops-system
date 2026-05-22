import { Injectable } from '@nestjs/common';
import { TerminationService } from '../termination/termination.service';
import { Agent, AgentResult, AgentTask, AUTONOMY } from './agent.types';

/**
 * A6 — Termination Lifecycle Agent (§11.2 A6, §11.5 PARTIAL).
 * סורק patterns ופותח אירועי סיום עבודה. פעולות תפעוליות (סגירת חשבון,
 * משיכת פיצויים) דורשות אישור אדם — requiresHumanApproval=true.
 */
@Injectable()
export class A6TerminationAgent implements Agent<{ mode?: 'scan' }> {
  readonly id = 'A6' as const;
  readonly autonomy = AUTONOMY.A6;

  constructor(private readonly termination: TerminationService) {}

  async run(task: AgentTask<{ mode?: 'scan' }>): Promise<AgentResult> {
    const opened = await this.termination.scan();
    return {
      ok: true,
      requiresHumanApproval: opened.some((e) => e.status === 'CONFIRMED'),
      summary: `A6 opened/refreshed ${opened.length} termination events`,
      data: { ids: opened.map((e) => e.terminationEventId) },
    };
  }
}
