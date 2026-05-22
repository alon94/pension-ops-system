import { ParsedRecord } from '../mevne-ahid/types';
import { ValidationIssue } from '../validation/types';
import { Reject } from '../rejects/reject.types';
import { Form161, TerminationEvent } from '../termination/termination.types';
import { CustomerEmploymentSnapshot } from '../termination/termination-detection';
import { CollectionDiscrepancy, DiscrepancyType } from '../collection/collection.types';
import { Authorization, AuthorizationTemplate, AuthScope } from '../authorization/authorization.types';
import { Customer360, CustomerSearchResult, DashboardStats, RejectFilters, RejectListItem } from '../api/ui-query.types';
import { AgentContextRow } from '../agent-context/agent-context.types';
import { UserRecord, UserWithPassword } from '../auth/auth.types';
import {
  AuditLogEntry, AuditSearchFilters, AuthorizationsView,
  CollectionMonthView, ManagerStats, RegulationVersionEntry, TerminationDetail, TerminationListItem,
} from '../api/ui-query-v2.types';
import { IngestionRunDetail, IngestionRunListItem } from '../api/ui-query-v3.types';

/**
 * Port של שכבת הנתונים. הפייפליין תלוי בממשק הזה בלבד — כך הליבה נבדקת
 * ללא Postgres חי (InMemoryRepository), והפרודקשן משתמש ב-PgRepository.
 */
export const REPOSITORY = Symbol('REPOSITORY');

export interface IngestionRunRecord {
  ingestionRunId: string;
  fileHash: string;
  status: string;
  sourceFileName?: string;
  parserVersion?: string;
  rawFilePath?: string;
  error?: string;
}

export interface PromoteCounts {
  customers: number;
  employers: number;
  manufacturers: number;
  products: number;
  accounts: number;
  balanceSnapshots: number;
  coverages: number;
  beneficiaries: number;
  deposits: number;
  withdrawals: number;
  loans: number;
  statusChanges: number;
}

export interface Repository {
  /** §5.2 — דחיית כפילות: ריצה קודמת שהושלמה עם אותו hash */
  findCompletedRunByHash(fileHash: string): Promise<IngestionRunRecord | null>;

  createIngestionRun(run: Omit<IngestionRunRecord, 'status'> & { status: string }): Promise<IngestionRunRecord>;
  updateRunStatus(runId: string, status: string, error?: string): Promise<void>;

  saveRawStaging(runId: string, records: ParsedRecord[]): Promise<void>;
  saveErrors(runId: string, issues: ValidationIssue[]): Promise<void>;

  /** הקשר ל-cross-block validation: מה כבר קיים במודל הנקי (§5.4) */
  knownPolicyNumbers(): Promise<Set<string>>;
  knownManufacturerCodes(): Promise<Set<string>>;

  /**
   * קידום (§5.5) — מבוצע בסדר התלות. מקבל את הרשומות התקינות בלבד
   * (אלו שלא נמצאות ב-failedRecordSeqs). מעדכן raw_staging.target_* ומחזיר ספירות.
   */
  promote(runId: string, records: ParsedRecord[]): Promise<PromoteCounts>;

  /** §5.7 — Soft-delete של כל מה שקודם בריצה זו */
  rollback(runId: string): Promise<void>;

  // ---------- ריג'קטים (פרק 7) ----------
  /** ריג'קט פעיל קיים לאותו (קוד + ישות מקור) — דה-דופ §7.2 */
  findOpenReject(rejectCode: string, sourceEntity?: string, sourceEntityId?: string): Promise<Reject | null>;
  createReject(reject: Reject): Promise<Reject>;
  saveReject(reject: Reject): Promise<void>;
  getReject(rejectId: string): Promise<Reject | null>;
  listRejectsByCustomer(customerId: string): Promise<Reject[]>;
  /** כל הריג'קטים שחרגו מ-SLA ועדיין פעילים (להסלמה) */
  listOverdueRejects(now: Date): Promise<Reject[]>;
  /** customer_id יחיד שקודם בריצה (אם בדיוק לקוח אחד) — לשיוך ריג'קט */
  soleCustomerOfRun(runId: string): Promise<string | null>;

  // ---------- סיום עבודה וטופס 161 (פרק 8) ----------
  /** §8.5(7) — אירוע פעיל קיים לאותו זוג customer+employment */
  findActiveTermination(customerId: string, employmentId?: string): Promise<TerminationEvent | null>;
  createTermination(ev: TerminationEvent): Promise<TerminationEvent>;
  saveTermination(ev: TerminationEvent): Promise<void>;
  getTermination(id: string): Promise<TerminationEvent | null>;
  listTerminationsByCustomer(customerId: string): Promise<TerminationEvent[]>;

  /** snapshots של כל העסקות הפעילות/האחרונות — לסריקה תקופתית של A6 (§8.2). */
  loadEmploymentSnapshots(): Promise<CustomerEmploymentSnapshot[]>;
  /** snapshot של EMPLOYMENT שקודם בריצה (לזיהוי confirmed מתוך הקליטה). */
  loadEmploymentSnapshotsForRun(runId: string): Promise<CustomerEmploymentSnapshot[]>;

  createForm161(form: Form161): Promise<Form161>;
  saveForm161(form: Form161): Promise<void>;
  getForm161(id: string): Promise<Form161 | null>;
  listForms161ByTermination(terminationId: string): Promise<Form161[]>;
  listForms161ByAccount(accountId: string): Promise<Form161[]>;

  // ---------- בקרת גבייה (פרק 9) ----------
  findOpenDiscrepancy(
    customerId: string | undefined,
    employmentId: string | undefined,
    referenceMonth: string,
    type: DiscrepancyType,
  ): Promise<CollectionDiscrepancy | null>;
  createDiscrepancy(d: CollectionDiscrepancy): Promise<CollectionDiscrepancy>;
  saveDiscrepancy(d: CollectionDiscrepancy): Promise<void>;
  getDiscrepancy(id: string): Promise<CollectionDiscrepancy | null>;
  listDiscrepanciesByEmployer(employerId: string, referenceMonth?: string): Promise<CollectionDiscrepancy[]>;
  listDiscrepanciesByMonth(referenceMonth: string): Promise<CollectionDiscrepancy[]>;

  // ---------- ייפוי כוח ופרטיות (פרק 10) ----------
  /** סטטוס לקוח (ACTIVE / DECEASED / MINOR / LIMITED) §10.5 */
  getCustomerStatus(customerId: string): Promise<{ status: string; legalCapacityStatus: string; residenceCountry?: string } | null>;

  findActiveAuthorization(customerId: string, scope: AuthScope): Promise<Authorization | null>;
  listAuthorizations(customerId: string): Promise<Authorization[]>;
  createAuthorization(a: Authorization): Promise<Authorization>;
  saveAuthorization(a: Authorization): Promise<void>;
  getAuthorization(id: string): Promise<Authorization | null>;
  /** סורק AUTH עם valid_to קטן מעכשיו ועדיין active (§10.4 פקיעה אוטומטית) */
  listExpirableAuthorizations(now: Date): Promise<Authorization[]>;

  createAuthorizationTemplate(t: AuthorizationTemplate): Promise<AuthorizationTemplate>;
  getActiveTemplate(at: Date): Promise<AuthorizationTemplate | null>;

  appendAudit(entry: { actor: string; action: string; entity?: string; entityId?: string; meta?: any }): Promise<void>;

  // ---------- שאילתות UI (פרק 12) ----------
  dashboardStats(now: Date): Promise<DashboardStats>;
  listRejectsForUi(filters: RejectFilters): Promise<RejectListItem[]>;
  searchCustomers(q: string, limit: number): Promise<CustomerSearchResult[]>;
  customer360(customerId: string, now: Date): Promise<Customer360 | null>;

  // ---------- AGENT_CONTEXT (פרק 11 + §5.6) ----------
  getAgentContext(customerId: string): Promise<AgentContextRow | null>;
  upsertAgentContext(row: AgentContextRow): Promise<AgentContextRow>;
  /** customers שהושפעו מקליטה — להפעלת refresh של AGENT_CONTEXT */
  customerIdsAffectedByRun(runId: string): Promise<string[]>;

  // ---------- מסכים נוספים (§12.2) ----------
  collectionMonthView(referenceMonth: string): Promise<CollectionMonthView>;
  listTerminationsForUi(filters: { status?: string; limit?: number }): Promise<TerminationListItem[]>;
  terminationDetailForUi(terminationEventId: string): Promise<TerminationDetail | null>;
  authorizationsView(now: Date): Promise<AuthorizationsView>;
  managerStats(now: Date): Promise<ManagerStats>;
  searchAuditLog(filters: AuditSearchFilters): Promise<AuditLogEntry[]>;
  listRegulationVersions(): Promise<RegulationVersionEntry[]>;

  // ---------- מסך קליטה (פרק 12) ----------
  listIngestionRuns(limit: number): Promise<IngestionRunListItem[]>;
  getIngestionRunDetail(ingestionRunId: string): Promise<IngestionRunDetail | null>;

  // ---------- אימות והרשאות (פרק 13) ----------
  findUserByEmail(email: string): Promise<UserWithPassword | null>;
  getUserById(userId: string): Promise<UserRecord | null>;
  createUser(input: Omit<UserWithPassword, 'userId' | 'active' | 'lastLoginAt'>): Promise<UserRecord>;
  touchLastLogin(userId: string): Promise<void>;
  listUsers(): Promise<UserRecord[]>;
  setUserActive(userId: string, active: boolean): Promise<UserRecord | null>;
  setUserPassword(userId: string, passwordHash: string): Promise<void>;
}
