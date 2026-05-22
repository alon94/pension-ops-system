/** בסיס שכבת האייג'נטים (פרק 11). */

export type AgentId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8' | 'A9' | 'A10' | 'A11';

/** §11.5 — רמות אוטונומיה לכל אייג'נט. */
export type Autonomy = 'FULL' | 'SEMI' | 'PARTIAL';

export const AUTONOMY: Record<AgentId, Autonomy> = {
  A1: 'FULL',  A2: 'SEMI', A3: 'SEMI', A4: 'FULL', A5: 'FULL',
  A6: 'PARTIAL', A7: 'FULL', A8: 'PARTIAL', A9: 'PARTIAL', A10: 'SEMI', A11: 'FULL',
};

export interface AgentTask<P = unknown> {
  taskId: string;
  agent: AgentId;
  trigger: 'EVENT' | 'CRON' | 'MANUAL';
  reason: string;
  payload: P;
  enqueuedAt: string;
  priority?: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
}

export interface AgentResult {
  ok: boolean;
  /** §11.5 — האם נדרש אישור אדם לפני ביצוע פעולה תפעולית */
  requiresHumanApproval?: boolean;
  summary: string;
  data?: unknown;
  error?: string;
}

/** ממשק אחיד לאייג'נטים. */
export interface Agent<P = unknown> {
  readonly id: AgentId;
  readonly autonomy: Autonomy;
  run(task: AgentTask<P>): Promise<AgentResult>;
}
