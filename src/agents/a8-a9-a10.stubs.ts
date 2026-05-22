import { Injectable } from '@nestjs/common';
import { Agent, AgentResult, AgentTask, AUTONOMY } from './agent.types';

// A8 הועבר לקובץ a8.document-understanding.ts והוא משדרג ל-Claude Vision.

/** A9 — Customer Communication Agent (§11.2 A9). Stub שמדגים הוספת notification ל-queue. */
@Injectable()
export class A9CommunicationAgent implements Agent<{ customerId: string; channel: 'email' | 'sms' | 'whatsapp'; body: string; sensitive?: boolean }> {
  readonly id = 'A9' as const;
  readonly autonomy = AUTONOMY.A9;

  async run(task: AgentTask<{ customerId: string; channel: 'email' | 'sms' | 'whatsapp'; body: string; sensitive?: boolean }>): Promise<AgentResult> {
    return {
      ok: true,
      requiresHumanApproval: !!task.payload.sensitive,
      summary: `A9 queued ${task.payload.channel} to ${task.payload.customerId}`,
    };
  }
}

/**
 * A10 — Knowledge Agent (§11.2 A10). Stub לעדכון REF tables.
 * §11.5 SEMI — עדכון REF דורש אישור מנהל.
 */
@Injectable()
export class A10KnowledgeAgent implements Agent<{ refType: 'product' | 'coverage' | 'manufacturer'; update: any }> {
  readonly id = 'A10' as const;
  readonly autonomy = AUTONOMY.A10;

  async run(task: AgentTask<{ refType: string; update: any }>): Promise<AgentResult> {
    return {
      ok: true,
      requiresHumanApproval: true,
      summary: `A10 proposes REF_${task.payload.refType.toUpperCase()} update`,
      data: task.payload.update,
    };
  }
}
