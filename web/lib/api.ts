/**
 * Typed API client. בצד-שרת של Next משתמשים ב-API_BASE; בצד-לקוח דרך /api (proxy).
 * Bearer token נטען מ-cookie בשני הצדדים.
 */

const SERVER_BASE = process.env.API_BASE ?? 'http://localhost:3000';
const COOKIE_NAME = 'pension_jwt';

function baseUrl(): string {
  return typeof window === 'undefined' ? SERVER_BASE : '/api';
}

async function readToken(): Promise<string | null> {
  if (typeof window !== 'undefined') {
    const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : null;
  }
  // Server-side: read from Next.js request cookies
  const { cookies } = await import('next/headers');
  return cookies().get(COOKIE_NAME)?.value ?? null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await readToken();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(init.headers as Record<string, string> | undefined ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl()}${path}`, { cache: 'no-store', ...init, headers });
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------- Auth API ----------
export const authApi = {
  login: async (email: string, password: string): Promise<{ token: string; user: { userId: string; email: string; role: string; fullName?: string } }> => {
    const res = await fetch(`${baseUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? `Login failed (${res.status})`);
    return res.json();
  },
};

// ---------- Types ----------
export interface DashboardStats {
  rejects: { total: number; bySeverity: { CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number }; overdue: number };
  ingestion: { last24h: number; failed24h: number };
  terminations: { active: number };
  collection: { openDiscrepancies: number };
}

export interface RejectListItem {
  rejectId: string; rejectCode: string; rejectType: string; severity: string; status: string;
  customerId?: string; customerName?: string; customerIsraelId?: string;
  sourceEntity?: string; detectedAt: string; slaDueAt?: string; assignee?: string;
}

export interface Customer {
  customerId: string; israelId: string; firstName: string; lastName: string; city?: string;
}

export interface Customer360 {
  customer: { customerId: string; israelId: string; firstName: string; lastName: string; birthDate?: string; city?: string; status?: string };
  authorization?: { authorizationId: string; scope: string; status: string; validTo: string; daysUntilExpiry: number };
  accounts: { accountId: string; policyNumber: string; manufacturerCode: string; manufacturerName: string; productCode?: string; currentStatus: string; openedDate?: string; closedDate?: string; latestBalance?: { snapshotDate: string; total: number } }[];
  recentDeposits: { accountId: string; policyNumber: string; depositMonth: string; total: number }[];
  rejects: { rejectId: string; rejectCode: string; severity: string; status: string; detectedAt: string }[];
  terminations: { terminationEventId: string; status: string; detectedAt: string; confirmedTerminationDate?: string }[];
  riskFlags: string[];
}

// ---------- Calls ----------
export const api = {
  stats: () => request<DashboardStats>('/dashboard/stats'),
  rejects: (params: { status?: string; severity?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, String(v));
    return request<RejectListItem[]>(`/rejects${q.toString() ? '?' + q : ''}`);
  },
  customers: (q: string, limit = 50) =>
    request<Customer[]>(`/customers?q=${encodeURIComponent(q)}&limit=${limit}`),
  customer360: (id: string) => request<Customer360>(`/customers/${id}`),
  transitionReject: (id: string, body: { to: string; by: string; note?: string; manufacturerKey?: string; resolutionSummary?: string }) =>
    request(`/rejects/${id}/transition`, { method: 'POST', body: JSON.stringify(body) }),
  briefing: (customerId: string, reason?: string) =>
    request<BriefingResponse>(`/agent-context/${customerId}/briefing`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  collectionView: (month: string) => request<CollectionMonthView>(`/collection/view/${month}`),
  terminations: (status?: string) =>
    request<TerminationListItem[]>(`/terminations${status ? `?status=${status}` : ''}`),
  authorizationsView: () => request<AuthorizationsView>(`/authorizations/view`),
  managerStats: () => request<ManagerStats>(`/dashboard/manager-stats`),
  audit: (filters: { actor?: string; action?: string; entity?: string; since?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v != null && v !== '') q.set(k, String(v));
    return request<AuditLogEntry[]>(`/audit${q.toString() ? '?' + q : ''}`);
  },
  regulationVersions: () => request<RegulationVersionEntry[]>(`/regulation-versions`),
  ingestionRuns: (limit = 50) => request<IngestionRunListItem[]>(`/ingestion/runs?limit=${limit}`),
  ingestionRun: (id: string) => request<IngestionRunDetail>(`/ingestion/runs/${id}`),
  ingestFile: (sourceFileName: string, contentBase64: string) =>
    request<IngestOutcome>(`/ingestion/files`, {
      method: 'POST',
      body: JSON.stringify({ sourceFileName, contentBase64, source: 'UI' }),
    }),
  terminationDetail: (id: string) => request<TerminationDetail>(`/terminations/${id}`),
  extractForm161: (body: { contentBase64: string; mediaType: string; fileName?: string; terminationEventId?: string; accountId?: string; customerId?: string; employerId?: string }) =>
    request<A8ExtractResult>(`/agents/a8/extract-form-161`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  createForm161: (terminationId: string, body: any) =>
    request<{ form: Form161Item; issues: { code: string; message: string }[] }>(
      `/terminations/${terminationId}/forms-161`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  transitionForm161: (form161Id: string, body: { to: string; by: string; reason?: string }) =>
    request<Form161Item>(`/forms-161/${form161Id}/transition`, { method: 'POST', body: JSON.stringify(body) }),
  listUsers: () => request<UserListItem[]>(`/admin/users`),
  createUser: (body: { email: string; password: string; role: string; fullName?: string }) =>
    request<UserListItem>(`/admin/users`, { method: 'POST', body: JSON.stringify(body) }),
  setUserActive: (id: string, active: boolean) =>
    request<UserListItem>(`/admin/users/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  resetUserPassword: (id: string, newPassword: string) =>
    request<{ status: string }>(`/admin/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword }) }),
  changeMyPassword: (current: string, next: string) =>
    request<{ status: string }>(`/auth/me/password`, { method: 'POST', body: JSON.stringify({ current, next }) }),
};

export interface UserListItem {
  userId: string;
  email: string;
  role: 'OPERATOR' | 'MANAGER' | 'AUDITOR' | 'REGULATOR';
  fullName?: string;
  active: boolean;
  lastLoginAt?: string;
}

// ---------- Termination detail ----------
export interface Form161Item {
  form161Id: string;
  formNumber?: string;
  totalSeveranceAmount: number;
  redemptionAmount: number;
  fixationAmount: number;
  taxWithholdingAmount?: number;
  validationStatus: string;
  rejectedReason?: string;
  signedByEmployeeAt?: string;
  signedByEmployerAt?: string;
  signedByAdvisorAt?: string;
}

export interface TerminationDetail {
  terminationEventId: string;
  customerId: string;
  customerName?: string;
  customerIsraelId?: string;
  accountId?: string;
  employerId?: string;
  detectionSource: string;
  status: string;
  detectedAt: string;
  confirmedTerminationDate?: string;
  formsCount: number;
  latestFormStatus?: string;
  notes?: string;
  forms: Form161Item[];
}

export interface A8ExtractResult {
  ok: boolean;
  requiresHumanApproval?: boolean;
  summary: string;
  data?: {
    extracted: {
      formNumber?: string;
      totalSeveranceAmount: number;
      redemptionAmount: number;
      fixationAmount: number;
      taxWithholdingAmount: number;
      signedByEmployeeAt?: string;
      signedByEmployerAt?: string;
      signedByAdvisorAt?: string;
      confidence?: Record<string, number>;
      notes?: string;
    };
    validationIssues: { code: string; message: string }[];
    model: string;
    fallback: boolean;
    tokensIn?: number;
    tokensOut?: number;
  };
}

// ---------- Ingestion types ----------
export interface IngestionRunListItem {
  ingestionRunId: string; sourceFileName?: string; fileHash: string; source?: string;
  parserVersion?: string; status: string; error?: string;
  receivedAt: string; completedAt?: string;
  rawCount: number; errorCount: number; criticalCount: number; rejectsCount: number;
}

export interface IngestionRunDetail extends IngestionRunListItem {
  errors: { code: string; severity: string; message: string; blockCode?: string; recordSeq?: number; field?: string }[];
  promotedByEntity: { entity: string; count: number }[];
}

export interface IngestOutcome {
  status: 'completed' | 'failed' | 'duplicate';
  ingestionRunId?: string;
  error?: string;
  issues?: number;
  failedRecords?: number;
  promoted?: Record<string, number>;
  triggers?: { agent: string; reason: string }[];
  rejectsOpened?: number;
  terminationsOpened?: number;
  contextsRefreshed?: number;
  stage?: string;
}

// ---------- Additional UI types (§12.2 #3,#4,#6,#7,#8) ----------
export interface DiscrepancyListItem {
  discrepancyId: string; referenceMonth: string;
  customerId?: string; customerName?: string;
  employerId?: string; employerName?: string;
  discrepancyType: string; discrepancyAmount: number; status: string;
  detectedAt: string; resolvedAt?: string;
}

export interface EmployerCollectionBreakdown {
  employerId: string; employerName?: string;
  openCount: number; totalAmount: number; byType: Record<string, number>;
}

export interface CollectionMonthView {
  referenceMonth: string;
  totals: { all: number; open: number; resolved: number; sumAmount: number };
  byType: Record<string, number>;
  topEmployers: EmployerCollectionBreakdown[];
  recentDiscrepancies: DiscrepancyListItem[];
}

export interface TerminationListItem {
  terminationEventId: string; customerId: string;
  customerName?: string; customerIsraelId?: string;
  detectionSource: string; status: string;
  detectedAt: string; confirmedTerminationDate?: string;
  formsCount: number; latestFormStatus?: string; notes?: string;
}

export interface AuthorizationListItem {
  authorizationId: string; customerId: string;
  customerName?: string; customerIsraelId?: string;
  scope: string; channel: string; status: string;
  signedAt: string; validTo: string; daysUntilExpiry: number;
  revokedAt?: string; revokedBy?: string; revokedReason?: string;
}

export interface AuthorizationsView {
  active: AuthorizationListItem[]; expiringSoon: AuthorizationListItem[];
  expired: AuthorizationListItem[]; revoked: AuthorizationListItem[];
}

export interface ManagerStats {
  overview: { customers: number; activeAccounts: number; totalAssets: number; ingestionRuns30d: number; ingestionFailures30d: number };
  rejects: { open: number; resolved30d: number; avgResolutionHours?: number; byCode: { rejectCode: string; count: number }[] };
  collection: { openDiscrepancies: number; sumOpenAmount: number; topEmployers: { employerName?: string; openCount: number }[] };
  manufacturers: { manufacturerName: string; openRejects: number }[];
}

export interface AuditLogEntry {
  auditId: number; occurredAt: string; actor: string; action: string;
  entity?: string; entityId?: string; meta?: any;
}

export interface RegulationVersionEntry {
  parserVersion: string; effectiveFrom: string; notes?: string;
}

export interface BriefingResponse {
  customerId: string;
  briefing: string;
  model: string;
  generatedAt: string;
  fallback?: boolean;
  cacheRead?: number;
  cacheCreation?: number;
  inputTokens?: number;
  outputTokens?: number;
}
