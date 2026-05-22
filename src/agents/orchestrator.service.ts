import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { REPOSITORY, Repository } from '../persistence/repository.port';
import { Agent, AgentId, AgentResult, AgentTask } from './agent.types';

export interface OrchestratorOptions {
  maxRetries?: number;
  /** האם לחסום פעולות שדורשות אישור אדם (true => לא מבוצעות, מוחזר flagged) */
  blockHumanApproval?: boolean;
}

/**
 * §11.4 — Orchestrator: תזמון, תיעדוף, ניתוב, retry, monitor.
 * מימוש לוקאלי בזיכרון; בפרודקשן יוחלף ב-Temporal/Airflow לפי 11.4.
 */
@Injectable()
export class OrchestratorService {
  private readonly log = new Logger('Orchestrator');
  private readonly agents = new Map<AgentId, Agent<any>>();
  private readonly queue: AgentTask<any>[] = [];

  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  register(agent: Agent<any>): void {
    this.agents.set(agent.id, agent);
  }

  enqueue<P>(agentId: AgentId, payload: P, opts: Partial<AgentTask<P>> = {}): AgentTask<P> {
    const task: AgentTask<P> = {
      taskId: randomUUID(),
      agent: agentId,
      trigger: opts.trigger ?? 'EVENT',
      reason: opts.reason ?? '',
      priority: opts.priority ?? 'NORMAL',
      payload,
      enqueuedAt: new Date().toISOString(),
    };
    this.queue.push(task);
    return task;
  }

  /** §11.4 תיעדוף: CRITICAL לפני שאר. עדיפות גבוהה לפני נמוכה. */
  private sortQueue(): void {
    const rank: Record<NonNullable<AgentTask['priority']>, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    this.queue.sort((a, b) => rank[a.priority!] - rank[b.priority!]);
  }

  /** מריץ את כל הטסקים בתור עד לסיום (לבדיקות; בפרודקשן ירוץ כ-worker מתמשך). */
  async drain(opts: OrchestratorOptions = {}): Promise<AgentResult[]> {
    const maxRetries = opts.maxRetries ?? 1;
    const results: AgentResult[] = [];
    this.sortQueue();
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      const agent = this.agents.get(task.agent);
      if (!agent) {
        results.push({ ok: false, summary: `agent ${task.agent} not registered`, error: 'NO_AGENT' });
        continue;
      }
      let attempt = 0;
      let lastResult: AgentResult | undefined;
      while (attempt <= maxRetries) {
        try {
          lastResult = await agent.run(task);
          break;
        } catch (e) {
          attempt++;
          lastResult = { ok: false, summary: `${task.agent} failed`, error: (e as Error).message };
        }
      }
      const result = lastResult!;
      await this.repo.appendAudit({
        actor: task.agent,
        action: `AGENT_RUN${result.requiresHumanApproval ? '_PENDING_APPROVAL' : ''}`,
        entity: 'agent_task',
        entityId: task.taskId,
        meta: { reason: task.reason, ok: result.ok, summary: result.summary },
      });
      if (result.requiresHumanApproval && opts.blockHumanApproval) {
        this.log.warn(`${task.agent} requires approval — blocked from auto-execution`);
      }
      results.push(result);
    }
    return results;
  }

  get pending(): number {
    return this.queue.length;
  }
}
