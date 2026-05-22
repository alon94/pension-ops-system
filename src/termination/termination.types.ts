/** ישויות סיום עבודה וטופס 161 (פרק 8). */

export type DetectionSource = 'AGENT_AUTOMATED' | 'SALARY_REPORT' | 'CLEARING' | 'MANUAL';

export type TerminationStatus = 'DETECTED' | 'CONFIRMED' | 'IN_PROCESS' | 'COMPLETED' | 'DISMISSED';

export interface TerminationEvent {
  terminationEventId: string;
  customerId: string;
  employmentId?: string;
  accountId?: string;
  detectedAt: string; // ISO
  detectionSource: DetectionSource;
  confirmedTerminationDate?: string; // ISO date
  status: TerminationStatus;
  notes?: string;
  ingestionRunId?: string;
}

export type NewTerminationEvent = Omit<TerminationEvent, 'terminationEventId' | 'status' | 'detectedAt'> & {
  detectedAt?: string;
};

/** §8.4 — סטטוס תיקוף של טופס 161. */
export type Form161Status = 'DRAFT' | 'SIGNED' | 'VERIFIED' | 'SUBMITTED' | 'REJECTED';

export interface Form161 {
  form161Id: string;
  terminationEventId: string;
  accountId: string;
  customerId: string;
  employerId: string;
  formNumber?: string;
  totalSeveranceAmount: number;
  redemptionAmount: number;
  fixationAmount: number;
  taxWithholdingAmount: number;
  signedByEmployeeAt?: string;
  signedByEmployerAt?: string;
  signedByAdvisorAt?: string;
  documentId?: string;
  validationStatus: Form161Status;
  rejectedReason?: string;
  ingestionRunId?: string;
}

export type NewForm161 = Omit<Form161, 'form161Id' | 'validationStatus'> & {
  validationStatus?: Form161Status;
};
