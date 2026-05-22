import { Inject, Injectable } from '@nestjs/common';
import { REPOSITORY, Repository } from '../persistence/repository.port';
import { Agent, AgentResult, AgentTask, AUTONOMY } from './agent.types';

/**
 * A11 — Audit Agent (§11.2 A11).
 * §11.5 FULL — read-only על audit_log; alert על אנומליות.
 */
@Injectable()
export class A11AuditAgent implements Agent<{ alert?: { actor: string; entity?: string; reason: string } }> {
  readonly id = 'A11' as const;
  readonly autonomy = AUTONOMY.A11;

  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  async run(task: AgentTask<{ alert?: { actor: string; entity?: string; reason: string } }>): Promise<AgentResult> {
    if (task.payload.alert) {
      await this.repo.appendAudit({
        actor: 'A11',
        action: 'AUDIT_ALERT',
        entity: task.payload.alert.entity,
        meta: task.payload.alert,
      });
      return { ok: true, summary: `A11 alert: ${task.payload.alert.reason}` };
    }
    await this.repo.appendAudit({ actor: 'A11', action: 'AUDIT_HEARTBEAT' });
    return { ok: true, summary: 'A11 heartbeat' };
  }
}
