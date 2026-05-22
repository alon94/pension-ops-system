/** טיפוסי תשובה ייעודיים ל-UI (פרק 12). */

export interface DashboardStats {
  rejects: {
    total: number;
    bySeverity: { CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number };
    overdue: number;
  };
  ingestion: { last24h: number; failed24h: number };
  terminations: { active: number };
  collection: { openDiscrepancies: number };
}

export interface RejectListItem {
  rejectId: string;
  rejectCode: string;
  rejectType: string;
  severity: string;
  status: string;
  customerId?: string;
  customerName?: string;
  customerIsraelId?: string;
  sourceEntity?: string;
  detectedAt: string;
  slaDueAt?: string;
  assignee?: string;
}

export interface RejectFilters {
  status?: string;          // 'OPEN' | 'IN_PROGRESS' | ...; missing => כל הלא-טרמינלי
  severity?: string;
  rejectType?: string;
  limit?: number;
}

export interface CustomerSearchResult {
  customerId: string;
  israelId: string;
  firstName: string;
  lastName: string;
  city?: string;
}

export interface Customer360 {
  customer: {
    customerId: string;
    israelId: string;
    firstName: string;
    lastName: string;
    birthDate?: string;
    city?: string;
    status?: string;
  };
  authorization?: {
    authorizationId: string;
    scope: string;
    status: string;
    validTo: string;
    daysUntilExpiry: number;
  };
  accounts: {
    accountId: string;
    policyNumber: string;
    manufacturerCode: string;
    manufacturerName: string;
    productCode?: string;
    currentStatus: string;
    openedDate?: string;
    closedDate?: string;
    latestBalance?: { snapshotDate: string; total: number };
  }[];
  recentDeposits: { accountId: string; policyNumber: string; depositMonth: string; total: number }[];
  rejects: { rejectId: string; rejectCode: string; severity: string; status: string; detectedAt: string }[];
  terminations: { terminationEventId: string; status: string; detectedAt: string; confirmedTerminationDate?: string }[];
  riskFlags: string[];
}
