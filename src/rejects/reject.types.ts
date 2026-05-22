/** ישות וטיפוסי ריג'קט (פרק 7). */

export type RejectType = 'CLEARING' | 'MANUFACTURER' | 'INTERNAL' | 'DISCREPANCY';

export type RejectSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type RejectStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_MANUFACTURER'
  | 'WAITING_CUSTOMER'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'DISMISSED';

export interface ResolutionStep {
  at: string; // ISO
  from: RejectStatus;
  to: RejectStatus;
  by: string; // user / agent
  note?: string;
}

export interface Reject {
  rejectId: string;
  rejectType: RejectType;
  sourceEntity?: string;
  sourceEntityId?: string;
  customerId?: string;
  manufacturerId?: string;
  detectedAt: string;
  rejectCode: string;
  rejectReason?: string;
  severity: RejectSeverity;
  status: RejectStatus;
  assignee?: string;
  slaDueAt?: string;
  resolutionPath: ResolutionStep[];
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionSummary?: string;
  ingestionRunId?: string;
}

export type NewReject = Omit<
  Reject,
  'rejectId' | 'detectedAt' | 'status' | 'resolutionPath' | 'slaDueAt'
> & { detectedAt?: string };
