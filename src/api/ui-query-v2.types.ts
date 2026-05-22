/** טיפוסים ל-5 המסכים הנוספים של פרסונת רפרנט/מנהל/בקר (§12.2). */

// ---------- מסך 3 — בקרת גבייה (פרק 9) ----------
export interface DiscrepancyListItem {
  discrepancyId: string;
  referenceMonth: string;
  customerId?: string;
  customerName?: string;
  employerId?: string;
  employerName?: string;
  discrepancyType: string;
  discrepancyAmount: number;
  status: string;
  detectedAt: string;
  resolvedAt?: string;
}

export interface EmployerCollectionBreakdown {
  employerId: string;
  employerName?: string;
  openCount: number;
  totalAmount: number;
  byType: Record<string, number>;
}

export interface CollectionMonthView {
  referenceMonth: string;
  totals: { all: number; open: number; resolved: number; sumAmount: number };
  byType: Record<string, number>;
  topEmployers: EmployerCollectionBreakdown[]; // top 10 by openCount
  recentDiscrepancies: DiscrepancyListItem[];
}

// ---------- מסך 4 — סיום עבודה (פרק 8) ----------
export interface TerminationListItem {
  terminationEventId: string;
  customerId: string;
  customerName?: string;
  customerIsraelId?: string;
  detectionSource: string;
  status: string;
  detectedAt: string;
  confirmedTerminationDate?: string;
  formsCount: number;            // כמה Form 161 משוייכים
  latestFormStatus?: string;     // DRAFT / SIGNED / VERIFIED / SUBMITTED / REJECTED
  notes?: string;
}

export interface TerminationDetail extends TerminationListItem {
  /** account/employer מקושרים — לטובת יצירת FORM_161 ב-UI */
  accountId?: string;
  employerId?: string;
  forms: {
    form161Id: string;
    formNumber?: string;
    totalSeveranceAmount: number;
    redemptionAmount: number;
    fixationAmount: number;
    validationStatus: string;
    rejectedReason?: string;
    signedByEmployeeAt?: string;
    signedByEmployerAt?: string;
    signedByAdvisorAt?: string;
  }[];
}

// ---------- מסך 6 — ייפוי כוח (פרק 10) ----------
export interface AuthorizationListItem {
  authorizationId: string;
  customerId: string;
  customerName?: string;
  customerIsraelId?: string;
  scope: string;
  channel: string;
  status: string;
  signedAt: string;
  validTo: string;
  daysUntilExpiry: number;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
}

export interface AuthorizationsView {
  active: AuthorizationListItem[];
  expiringSoon: AuthorizationListItem[];  // active וגם daysUntilExpiry <= 30
  expired: AuthorizationListItem[];
  revoked: AuthorizationListItem[];
}

// ---------- מסך 7 — דשבורד מנהל (§12.2 #7) ----------
export interface ManagerStats {
  overview: {
    customers: number;
    activeAccounts: number;
    totalAssets: number;
    ingestionRuns30d: number;
    ingestionFailures30d: number;
  };
  rejects: {
    open: number;
    resolved30d: number;
    avgResolutionHours?: number;
    byCode: { rejectCode: string; count: number }[]; // top 10
  };
  collection: {
    openDiscrepancies: number;
    sumOpenAmount: number;
    topEmployers: { employerName?: string; openCount: number }[]; // top 5
  };
  manufacturers: { manufacturerName: string; openRejects: number }[]; // top 5
}

// ---------- מסך 8 — Audit & Compliance (§12.2 #8) ----------
export interface AuditLogEntry {
  auditId: number;
  occurredAt: string;
  actor: string;
  action: string;
  entity?: string;
  entityId?: string;
  meta?: any;
}

export interface AuditSearchFilters {
  actor?: string;
  action?: string;
  entity?: string;
  since?: string;  // ISO date
  limit?: number;
}

export interface RegulationVersionEntry {
  parserVersion: string;
  effectiveFrom: string;
  notes?: string;
}
