import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { toAmount } from '../common/money';
import { normalizeId } from '../common/israeli-id';
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
import {
  IngestionRunRecord,
  PromoteCounts,
  Repository,
} from './repository.port';

interface RawRow {
  runId: string;
  blockCode: string;
  recordSeq: number;
  fields: Record<string, string>;
  sourceOffset: string;
  targetEntity?: string;
  targetId?: string;
  superseded?: boolean;
}

/**
 * מימוש בזיכרון של ה-Repository — משקף נאמנה את סדר הקידום (§5.5)
 * ואת אילוצי §4.3. משמש לבדיקות ולהדגמת end-to-end ללא Postgres.
 */
@Injectable()
export class InMemoryRepository implements Repository {
  private runs = new Map<string, IngestionRunRecord>();
  private raw: RawRow[] = [];
  errors: { runId: string; issue: ValidationIssue }[] = [];

  /** קודי יצרן מוכרים מ-REF_MANUFACTURER_TYPE (נטען בנפרד מהקליטה) */
  refManufacturerCodes = new Set<string>();
  customers = new Map<string, any>(); // israel_id -> row
  employers = new Map<string, any>(); // company_id -> row
  manufacturers = new Map<string, any>(); // official_code -> row
  products = new Map<string, any>(); // mfrId|productCode -> row
  accounts = new Map<string, any>(); // mfrId|policyNumber -> row
  statusHistory: any[] = [];
  employments = new Map<string, any>(); // customerId|employerId|start -> row
  balanceSnapshots: any[] = [];
  coverages = new Map<string, any>(); // accountId|coverageTypeCode -> row
  coverageHistory: any[] = [];
  beneficiaries = new Map<string, any[]>(); // accountId -> rows
  beneficiaryHistory: any[] = [];
  deposits = new Map<string, any>(); // accountId|month -> row
  withdrawals: any[] = [];
  loans = new Map<string, any>(); // mfrId|loanExternalId -> row
  rejects: Reject[] = [];
  /** קודי יצרן של קרנות ותיקות — §8.5(9) דוכא יצירת טופס 161 */
  vatikaManufacturerCodes = new Set<string>();
  terminations: TerminationEvent[] = [];
  forms161: Form161[] = [];
  discrepancies: CollectionDiscrepancy[] = [];
  authorizations: Authorization[] = [];
  agentContexts = new Map<string, AgentContextRow>(); // customerId -> row
  users: UserWithPassword[] = [];
  authorizationTemplates: AuthorizationTemplate[] = [];
  auditLog: { occurredAt: string; actor: string; action: string; entity?: string; entityId?: string; meta?: any }[] = [];

  async findCompletedRunByHash(fileHash: string): Promise<IngestionRunRecord | null> {
    for (const r of this.runs.values()) {
      if (r.fileHash === fileHash && r.status === 'completed') return r;
    }
    return null;
  }

  async createIngestionRun(run: IngestionRunRecord): Promise<IngestionRunRecord> {
    const rec: IngestionRunRecord = { ...run, ingestionRunId: run.ingestionRunId || randomUUID() };
    this.runs.set(rec.ingestionRunId, rec);
    return rec;
  }

  async updateRunStatus(runId: string, status: string, error?: string): Promise<void> {
    const r = this.runs.get(runId);
    if (r) {
      r.status = status;
      if (error) r.error = error;
    }
  }

  async saveRawStaging(runId: string, records: ParsedRecord[]): Promise<void> {
    for (const rec of records) {
      this.raw.push({
        runId,
        blockCode: rec.blockCode,
        recordSeq: rec.recordSeq,
        fields: rec.fields,
        sourceOffset: rec.sourceOffset,
      });
    }
  }

  async saveErrors(runId: string, issues: ValidationIssue[]): Promise<void> {
    for (const issue of issues) this.errors.push({ runId, issue });
  }

  async knownPolicyNumbers(): Promise<Set<string>> {
    return new Set([...this.accounts.values()].map((a) => a.policyNumber));
  }

  async knownManufacturerCodes(): Promise<Set<string>> {
    return new Set([...this.refManufacturerCodes, ...this.manufacturers.keys()]);
  }

  private markTarget(runId: string, seq: number, entity: string, id: string): void {
    const row = this.raw.find((r) => r.runId === runId && r.recordSeq === seq);
    if (row) {
      row.targetEntity = entity;
      row.targetId = id;
    }
  }

  async promote(runId: string, records: ParsedRecord[]): Promise<PromoteCounts> {
    const counts: PromoteCounts = {
      customers: 0, employers: 0, manufacturers: 0, products: 0, accounts: 0,
      balanceSnapshots: 0, coverages: 0, beneficiaries: 0, deposits: 0,
      withdrawals: 0, loans: 0, statusChanges: 0,
    };
    const by = (code: string) => records.filter((r) => r.blockCode === code);

    const lotToIsraelId = new Map<string, string>();

    // 1. CUSTOMER (upsert by israel_id)
    for (const r of by('020')) {
      const israelId = normalizeId(r.fields.israelId) ?? r.fields.israelId;
      lotToIsraelId.set(r.fields.lotId, israelId);
      let row = this.customers.get(israelId);
      if (!row) {
        row = { customerId: randomUUID(), israelId };
        this.customers.set(israelId, row);
        counts.customers++;
      }
      Object.assign(row, {
        firstName: r.fields.firstName, lastName: r.fields.lastName,
        birthDate: r.fields.birthDate, gender: r.fields.gender, city: r.fields.city,
        ingestionRunId: runId,
      });
      this.markTarget(runId, r.recordSeq, 'customer', row.customerId);
    }

    // 2. EMPLOYER (upsert by company_id)
    for (const r of by('070')) {
      const companyId = normalizeId(r.fields.employerCompanyId) ?? r.fields.employerCompanyId;
      if (!companyId) continue;
      let row = this.employers.get(companyId);
      if (!row) {
        row = { employerId: randomUUID(), companyId };
        this.employers.set(companyId, row);
        counts.employers++;
      }
      row.employerName = r.fields.employerName || row.employerName;
    }

    // 3. MANUFACTURER (upsert by official_code)
    for (const r of by('030')) {
      const code = r.fields.manufacturerCode;
      let row = this.manufacturers.get(code);
      if (!row) {
        row = { manufacturerId: randomUUID(), officialCode: code };
        this.manufacturers.set(code, row);
        counts.manufacturers++;
      }
      row.name = r.fields.manufacturerName || row.name;
      this.markTarget(runId, r.recordSeq, 'manufacturer', row.manufacturerId);
    }
    const mfrIdByCode = (code: string) => this.manufacturers.get(code)?.manufacturerId;

    // 4. PRODUCT (upsert by manufacturer_id + product_code)
    for (const r of by('040')) {
      const mfrId = mfrIdByCode(r.fields.manufacturerCode);
      if (!mfrId) continue;
      const key = `${mfrId}|${r.fields.productCode}`;
      let row = this.products.get(key);
      if (!row) {
        row = { productId: randomUUID(), manufacturerId: mfrId, productCode: r.fields.productCode };
        this.products.set(key, row);
        counts.products++;
      }
    }

    // 5. ACCOUNT (upsert by manufacturer_id + policy_number; status history)
    const accountIdByPolicy = new Map<string, string>();
    for (const r of by('040')) {
      const mfrId = mfrIdByCode(r.fields.manufacturerCode);
      const israelId = lotToIsraelId.get(r.fields.lotId);
      const customer = israelId ? this.customers.get(israelId) : undefined;
      if (!mfrId || !customer) continue;
      const key = `${mfrId}|${r.fields.policyNumber}`;
      let row = this.accounts.get(key);
      const newStatus = r.fields.accountStatus || 'ACTIVE';
      if (!row) {
        row = {
          accountId: randomUUID(), customerId: customer.customerId, manufacturerId: mfrId,
          policyNumber: r.fields.policyNumber, currentStatus: newStatus,
        };
        this.accounts.set(key, row);
        counts.accounts++;
        this.statusHistory.push({ accountId: row.accountId, status: newStatus, triggerEvent: 'OPEN', effectiveFrom: new Date(), runId });
        counts.statusChanges++;
      } else if (row.currentStatus !== newStatus) {
        // §5.5 — שינוי סטטוס => רשומת היסטוריה חדשה
        this.statusHistory.push({
          accountId: row.accountId, status: newStatus,
          triggerEvent: newStatus === 'CLOSED' ? 'CLOSE' : 'STATUS_CHANGE',
          effectiveFrom: new Date(), runId,
        });
        row.currentStatus = newStatus;
        counts.statusChanges++;
      }
      Object.assign(row, {
        openedDate: r.fields.openedDate, closedDate: r.fields.closedDate || null,
        riskTrackCode: r.fields.riskTrackCode, subPolicyCode: r.fields.subPolicyCode,
        ingestionRunId: runId,
      });
      accountIdByPolicy.set(r.fields.policyNumber, row.accountId);
      this.markTarget(runId, r.recordSeq, 'account', row.accountId);
    }
    const known = await this.knownPolicyNumbers();
    const accIdFor = (policy: string) =>
      accountIdByPolicy.get(policy) ??
      [...this.accounts.values()].find((a) => a.policyNumber === policy && known.has(policy))?.accountId;

    // 6. EMPLOYMENT (upsert; close previous if new start)
    for (const r of by('070')) {
      const israelId = lotToIsraelId.get(r.fields.lotId);
      const customer = israelId ? this.customers.get(israelId) : undefined;
      const companyId = normalizeId(r.fields.employerCompanyId) ?? r.fields.employerCompanyId;
      const employer = this.employers.get(companyId);
      if (!customer || !employer) continue;
      const key = `${customer.customerId}|${employer.employerId}|${r.fields.employmentStart}`;
      if (!this.employments.has(key)) {
        this.employments.set(key, {
          employmentId: randomUUID(), customerId: customer.customerId, employerId: employer.employerId,
          accountId: accIdFor(r.fields.policyNumber), startDate: r.fields.employmentStart,
          endDate: r.fields.employmentEnd || null, ingestionRunId: runId,
        });
      }
    }

    // 8. BALANCE_SNAPSHOT (insert only)
    for (const r of by('050')) {
      const accountId = accIdFor(r.fields.policyNumber);
      if (!accountId) continue;
      const sev = toAmount(r.fields.severance);
      const te = toAmount(r.fields.tagmulimEmployee);
      const tr = toAmount(r.fields.tagmulimEmployer);
      const allow = toAmount(r.fields.allowance);
      const snap = {
        id: randomUUID(), accountId, snapshotDate: r.fields.snapshotDate,
        severance: sev, tagmulimEmployee: te, tagmulimEmployer: tr, allowance: allow,
        total: sev + te + tr + allow, ingestionRunId: runId,
      };
      this.balanceSnapshots.push(snap);
      counts.balanceSnapshots++;
      this.markTarget(runId, r.recordSeq, 'balance_snapshot', snap.id);
    }

    // 9. COVERAGE (upsert; history on change)
    for (const r of by('060')) {
      const accountId = accIdFor(r.fields.policyNumber);
      if (!accountId) continue;
      const key = `${accountId}|${r.fields.coverageTypeCode}`;
      let row = this.coverages.get(key);
      if (row) {
        // §5.5 — שינוי כיסוי => snapshot ל-COVERAGE_HISTORY
        this.coverageHistory.push({ coverageId: row.coverageId, snapshot: { ...row }, changedAt: new Date() });
      }
      if (!row) {
        row = { coverageId: randomUUID(), accountId, coverageTypeCode: r.fields.coverageTypeCode };
        this.coverages.set(key, row);
        counts.coverages++;
      }
      Object.assign(row, {
        insuredAmount: toAmount(r.fields.insuredAmount), premium: toAmount(r.fields.premium),
        underwritingStatus: r.fields.underwritingStatus, coverageFrom: r.fields.coverageFrom,
        coverageTo: r.fields.coverageTo || null, ingestionRunId: runId,
      });
      this.markTarget(runId, r.recordSeq, 'coverage', row.coverageId);
    }

    // 10. BENEFICIARY (replace whole group per account; old -> history)
    const beneByPolicy = new Map<string, ParsedRecord[]>();
    for (const r of by('080')) {
      const list = beneByPolicy.get(r.fields.policyNumber) ?? [];
      list.push(r);
      beneByPolicy.set(r.fields.policyNumber, list);
    }
    for (const [policy, recs] of beneByPolicy) {
      const accountId = accIdFor(policy);
      if (!accountId) continue;
      const prev = this.beneficiaries.get(accountId);
      if (prev && prev.length) this.beneficiaryHistory.push({ accountId, snapshot: prev, replacedAt: new Date() });
      const group = recs.map((r) => ({
        beneficiaryId: randomUUID(), accountId, beneficiaryName: r.fields.beneficiaryName,
        relation: r.fields.relation, sharePercent: toAmount(r.fields.sharePercent), ingestionRunId: runId,
      }));
      this.beneficiaries.set(accountId, group);
      counts.beneficiaries += group.length;
      recs.forEach((r, i) => this.markTarget(runId, r.recordSeq, 'beneficiary', group[i].beneficiaryId));
    }

    // 11. DEPOSIT (insert only; UNIQUE account+month)
    for (const r of by('070')) {
      const accountId = accIdFor(r.fields.policyNumber);
      if (!accountId || !r.fields.depositMonth) continue;
      const key = `${accountId}|${r.fields.depositMonth}`;
      if (this.deposits.has(key)) continue; // §4.3 — לא ניתן לעדכון; כפילות נחסמה בתיקוף
      const e = toAmount(r.fields.amountEmployee);
      const em = toAmount(r.fields.amountEmployer);
      const sv = toAmount(r.fields.amountSeverance);
      const dep = {
        depositId: randomUUID(), accountId, depositMonth: r.fields.depositMonth,
        amountEmployee: e, amountEmployer: em, amountSeverance: sv, total: e + em + sv,
        ingestionRunId: runId,
      };
      this.deposits.set(key, dep);
      counts.deposits++;
      this.markTarget(runId, r.recordSeq, 'deposit', dep.depositId);
    }

    // 12 + 13. WITHDRAWAL / LOAN (block 090)
    for (const r of by('090')) {
      const accountId = accIdFor(r.fields.policyNumber);
      if (!accountId) continue;
      if (r.fields.movementType === 'WD') {
        const w = {
          withdrawalId: randomUUID(), accountId, movementDate: r.fields.movementDate,
          gross: toAmount(r.fields.gross), net: toAmount(r.fields.net), tax: toAmount(r.fields.tax),
          ingestionRunId: runId,
        };
        this.withdrawals.push(w);
        counts.withdrawals++;
        this.markTarget(runId, r.recordSeq, 'withdrawal', w.withdrawalId);
      } else if (r.fields.movementType === 'LN') {
        const mfr = [...this.accounts.values()].find((a) => a.accountId === accountId);
        const key = `${mfr?.manufacturerId}|${r.fields.loanExternalId}`;
        let row = this.loans.get(key);
        if (!row) {
          row = { loanId: randomUUID(), accountId, loanExternalId: r.fields.loanExternalId, manufacturerId: mfr?.manufacturerId };
          this.loans.set(key, row);
          counts.loans++;
        }
        row.remainingBalance = toAmount(r.fields.gross);
        this.markTarget(runId, r.recordSeq, 'loan', row.loanId);
      }
    }

    return counts;
  }

  async rollback(runId: string): Promise<void> {
    // §5.7 — Soft delete של כל מה שקודם בריצה זו
    for (const row of this.raw) if (row.runId === runId) row.superseded = true;
    this.balanceSnapshots = this.balanceSnapshots.filter((b) => b.ingestionRunId !== runId);
    this.withdrawals = this.withdrawals.filter((w) => w.ingestionRunId !== runId);
    for (const [k, v] of this.deposits) if (v.ingestionRunId === runId) this.deposits.delete(k);
    await this.updateRunStatus(runId, 'rolled_back');
  }

  private isActive(r: Reject): boolean {
    return r.status !== 'RESOLVED' && r.status !== 'DISMISSED';
  }

  async findOpenReject(code: string, sourceEntity?: string, sourceEntityId?: string): Promise<Reject | null> {
    return (
      this.rejects.find(
        (r) =>
          this.isActive(r) &&
          r.rejectCode === code &&
          (r.sourceEntity ?? '') === (sourceEntity ?? '') &&
          (r.sourceEntityId ?? '') === (sourceEntityId ?? ''),
      ) ?? null
    );
  }

  async createReject(reject: Reject): Promise<Reject> {
    this.rejects.push(reject);
    return reject;
  }

  async saveReject(reject: Reject): Promise<void> {
    const i = this.rejects.findIndex((r) => r.rejectId === reject.rejectId);
    if (i >= 0) this.rejects[i] = reject;
  }

  async getReject(rejectId: string): Promise<Reject | null> {
    return this.rejects.find((r) => r.rejectId === rejectId) ?? null;
  }

  async listRejectsByCustomer(customerId: string): Promise<Reject[]> {
    return this.rejects.filter((r) => r.customerId === customerId);
  }

  async listOverdueRejects(now: Date): Promise<Reject[]> {
    return this.rejects.filter(
      (r) => this.isActive(r) && r.status !== 'ESCALATED' && !!r.slaDueAt && now.getTime() > new Date(r.slaDueAt).getTime(),
    );
  }

  async soleCustomerOfRun(runId: string): Promise<string | null> {
    const ids = [...this.customers.values()].filter((c) => c.ingestionRunId === runId).map((c) => c.customerId);
    return ids.length === 1 ? ids[0] : null;
  }

  // ---------- סיום עבודה וטופס 161 (פרק 8) ----------
  private toIsoDate(yyyymm: string): string {
    if (!/^\d{6}$/.test(yyyymm)) return new Date(0).toISOString();
    return new Date(Date.UTC(Number(yyyymm.slice(0, 4)), Number(yyyymm.slice(4, 6)) - 1, 1)).toISOString();
  }

  private normalizeYmd(raw?: string): string | undefined {
    if (!raw) return undefined;
    const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(raw.trim());
    if (!m) return undefined;
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString();
  }

  private buildSnapshot(emp: any): CustomerEmploymentSnapshot {
    const acc = [...this.accounts.values()].find((a) => a.accountId === emp.accountId);
    const mfr = acc ? [...this.manufacturers.values()].find((m) => m.manufacturerId === acc.manufacturerId) : undefined;
    const isVatika = !!mfr && this.vatikaManufacturerCodes.has(mfr.officialCode);
    // last deposit per account
    const months = [...this.deposits.values()]
      .filter((d) => d.accountId === emp.accountId)
      .map((d) => d.depositMonth);
    const last = months.length ? months.sort().slice(-1)[0] : undefined;
    return {
      customerId: emp.customerId,
      employmentId: emp.employmentId,
      employerId: emp.employerId,
      accountId: emp.accountId,
      startDate: this.normalizeYmd(emp.startDate) ?? new Date(0).toISOString(),
      endDate: this.normalizeYmd(emp.endDate),
      lastDepositDate: last ? this.toIsoDate(last) : undefined,
      accountStatus: acc?.currentStatus,
      isVatika,
    };
  }

  async loadEmploymentSnapshots(): Promise<CustomerEmploymentSnapshot[]> {
    return [...this.employments.values()].map((e) => this.buildSnapshot(e));
  }

  async loadEmploymentSnapshotsForRun(runId: string): Promise<CustomerEmploymentSnapshot[]> {
    return [...this.employments.values()].filter((e) => e.ingestionRunId === runId).map((e) => this.buildSnapshot(e));
  }

  async findActiveTermination(customerId: string, employmentId?: string): Promise<TerminationEvent | null> {
    return (
      this.terminations.find(
        (t) =>
          t.customerId === customerId &&
          (t.employmentId ?? '') === (employmentId ?? '') &&
          t.status !== 'COMPLETED' &&
          t.status !== 'DISMISSED',
      ) ?? null
    );
  }

  async createTermination(ev: TerminationEvent): Promise<TerminationEvent> {
    this.terminations.push(ev);
    return ev;
  }

  async saveTermination(ev: TerminationEvent): Promise<void> {
    const i = this.terminations.findIndex((t) => t.terminationEventId === ev.terminationEventId);
    if (i >= 0) this.terminations[i] = ev;
  }

  async getTermination(id: string): Promise<TerminationEvent | null> {
    return this.terminations.find((t) => t.terminationEventId === id) ?? null;
  }

  async listTerminationsByCustomer(customerId: string): Promise<TerminationEvent[]> {
    return this.terminations.filter((t) => t.customerId === customerId);
  }

  async createForm161(form: Form161): Promise<Form161> {
    this.forms161.push(form);
    return form;
  }

  async saveForm161(form: Form161): Promise<void> {
    const i = this.forms161.findIndex((f) => f.form161Id === form.form161Id);
    if (i >= 0) this.forms161[i] = form;
  }

  async getForm161(id: string): Promise<Form161 | null> {
    return this.forms161.find((f) => f.form161Id === id) ?? null;
  }

  async listForms161ByTermination(terminationId: string): Promise<Form161[]> {
    return this.forms161.filter((f) => f.terminationEventId === terminationId);
  }

  async listForms161ByAccount(accountId: string): Promise<Form161[]> {
    return this.forms161.filter((f) => f.accountId === accountId);
  }

  // ---------- בקרת גבייה (פרק 9) ----------
  private isOpenD(d: CollectionDiscrepancy): boolean {
    return d.status !== 'RESOLVED' && d.status !== 'DISMISSED';
  }

  async findOpenDiscrepancy(
    customerId: string | undefined,
    employmentId: string | undefined,
    referenceMonth: string,
    type: DiscrepancyType,
  ): Promise<CollectionDiscrepancy | null> {
    return (
      this.discrepancies.find(
        (d) =>
          this.isOpenD(d) &&
          (d.customerId ?? '') === (customerId ?? '') &&
          (d.employmentId ?? '') === (employmentId ?? '') &&
          d.referenceMonth === referenceMonth &&
          d.discrepancyType === type,
      ) ?? null
    );
  }

  async createDiscrepancy(d: CollectionDiscrepancy): Promise<CollectionDiscrepancy> {
    this.discrepancies.push(d);
    return d;
  }

  async saveDiscrepancy(d: CollectionDiscrepancy): Promise<void> {
    const i = this.discrepancies.findIndex((x) => x.discrepancyId === d.discrepancyId);
    if (i >= 0) this.discrepancies[i] = d;
  }

  async getDiscrepancy(id: string): Promise<CollectionDiscrepancy | null> {
    return this.discrepancies.find((d) => d.discrepancyId === id) ?? null;
  }

  async listDiscrepanciesByEmployer(employerId: string, referenceMonth?: string): Promise<CollectionDiscrepancy[]> {
    return this.discrepancies.filter(
      (d) => d.employerId === employerId && (!referenceMonth || d.referenceMonth === referenceMonth),
    );
  }

  async listDiscrepanciesByMonth(referenceMonth: string): Promise<CollectionDiscrepancy[]> {
    return this.discrepancies.filter((d) => d.referenceMonth === referenceMonth);
  }

  // ---------- ייפוי כוח ופרטיות (פרק 10) ----------
  /** Test seeding helper — sets customer status / legal capacity */
  customerProfiles = new Map<string, { status: string; legalCapacityStatus: string; residenceCountry?: string }>();

  async getCustomerStatus(customerId: string): Promise<{ status: string; legalCapacityStatus: string; residenceCountry?: string } | null> {
    if (this.customerProfiles.has(customerId)) return this.customerProfiles.get(customerId)!;
    const c = [...this.customers.values()].find((x) => x.customerId === customerId);
    return c ? { status: 'ACTIVE', legalCapacityStatus: 'FULL', residenceCountry: 'IL' } : null;
  }

  async findActiveAuthorization(customerId: string, scope: AuthScope): Promise<Authorization | null> {
    return this.authorizations.find((a) => a.customerId === customerId && a.scope === scope && a.status === 'active') ?? null;
  }

  async listAuthorizations(customerId: string): Promise<Authorization[]> {
    return this.authorizations.filter((a) => a.customerId === customerId);
  }

  async createAuthorization(a: Authorization): Promise<Authorization> {
    this.authorizations.push(a);
    return a;
  }

  async saveAuthorization(a: Authorization): Promise<void> {
    const i = this.authorizations.findIndex((x) => x.authorizationId === a.authorizationId);
    if (i >= 0) this.authorizations[i] = a;
  }

  async getAuthorization(id: string): Promise<Authorization | null> {
    return this.authorizations.find((a) => a.authorizationId === id) ?? null;
  }

  async listExpirableAuthorizations(now: Date): Promise<Authorization[]> {
    return this.authorizations.filter((a) => a.status === 'active' && new Date(a.validTo).getTime() < now.getTime());
  }

  async createAuthorizationTemplate(t: AuthorizationTemplate): Promise<AuthorizationTemplate> {
    this.authorizationTemplates.push(t);
    return t;
  }

  async getActiveTemplate(at: Date): Promise<AuthorizationTemplate | null> {
    return (
      this.authorizationTemplates.find((t) => {
        const from = new Date(t.effectiveFrom).getTime();
        const to = t.effectiveTo ? new Date(t.effectiveTo).getTime() : Infinity;
        return at.getTime() >= from && at.getTime() < to && t.regulatorApproved;
      }) ?? null
    );
  }

  async appendAudit(entry: { actor: string; action: string; entity?: string; entityId?: string; meta?: any }): Promise<void> {
    this.auditLog.push({ ...entry, occurredAt: new Date().toISOString() });
  }

  // ---------- שאילתות UI (פרק 12) ----------
  async dashboardStats(now: Date): Promise<DashboardStats> {
    const open = this.rejects.filter((r) => r.status !== 'RESOLVED' && r.status !== 'DISMISSED');
    const bySev = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const r of open) (bySev as any)[r.severity]++;
    const dayAgo = new Date(now.getTime() - 86400_000).getTime();
    return {
      rejects: {
        total: open.length, bySeverity: bySev,
        overdue: open.filter((r) => r.status !== 'ESCALATED' && r.slaDueAt && new Date(r.slaDueAt).getTime() < now.getTime()).length,
      },
      ingestion: { last24h: 0, failed24h: 0 }, // In-Memory לא שומר ingestion_run history בנפרד
      terminations: { active: this.terminations.filter((t) => t.status !== 'COMPLETED' && t.status !== 'DISMISSED').length },
      collection: { openDiscrepancies: this.discrepancies.filter((d) => d.status !== 'RESOLVED' && d.status !== 'DISMISSED').length },
    };
  }

  async listRejectsForUi(filters: RejectFilters): Promise<RejectListItem[]> {
    let list = this.rejects.slice();
    if (filters.status) list = list.filter((r) => r.status === filters.status);
    else list = list.filter((r) => r.status !== 'RESOLVED' && r.status !== 'DISMISSED');
    if (filters.severity) list = list.filter((r) => r.severity === filters.severity);
    if (filters.rejectType) list = list.filter((r) => r.rejectType === filters.rejectType);
    const sevRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    list.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
    return list.slice(0, Math.min(filters.limit ?? 100, 500)).map((r) => {
      const c = r.customerId ? [...this.customers.values()].find((x) => x.customerId === r.customerId) : undefined;
      return {
        rejectId: r.rejectId, rejectCode: r.rejectCode, rejectType: r.rejectType,
        severity: r.severity, status: r.status, customerId: r.customerId,
        customerName: c ? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() : undefined,
        customerIsraelId: c?.israelId, sourceEntity: r.sourceEntity,
        detectedAt: r.detectedAt, slaDueAt: r.slaDueAt, assignee: r.assignee,
      };
    });
  }

  async searchCustomers(q: string, limit: number): Promise<CustomerSearchResult[]> {
    const term = q.trim().toLowerCase();
    return [...this.customers.values()]
      .filter((c) => `${c.firstName ?? ''} ${c.lastName ?? ''} ${c.israelId}`.toLowerCase().includes(term))
      .slice(0, Math.min(limit, 100))
      .map((c) => ({
        customerId: c.customerId, israelId: c.israelId,
        firstName: c.firstName ?? '', lastName: c.lastName ?? '', city: c.city,
      }));
  }

  async customer360(customerId: string, now: Date): Promise<Customer360 | null> {
    const c = [...this.customers.values()].find((x) => x.customerId === customerId);
    if (!c) return null;
    const auths = this.authorizations.filter((a) => a.customerId === customerId && a.status === 'active');
    const accs = [...this.accounts.values()].filter((a) => a.customerId === customerId);
    const rej = this.rejects.filter((r) => r.customerId === customerId);
    const term = this.terminations.filter((t) => t.customerId === customerId);
    const auth = auths[0]
      ? {
          authorizationId: auths[0].authorizationId, scope: auths[0].scope, status: auths[0].status,
          validTo: auths[0].validTo,
          daysUntilExpiry: Math.floor((new Date(auths[0].validTo).getTime() - now.getTime()) / 86400_000),
        }
      : undefined;
    return {
      customer: {
        customerId: c.customerId, israelId: c.israelId,
        firstName: c.firstName ?? '', lastName: c.lastName ?? '',
        birthDate: c.birthDate, city: c.city, status: 'ACTIVE',
      },
      authorization: auth,
      accounts: accs.map((a) => {
        const mfr = [...this.manufacturers.values()].find((m) => m.manufacturerId === a.manufacturerId);
        const latestBal = this.balanceSnapshots
          .filter((b) => b.accountId === a.accountId)
          .sort((x, y) => (x.snapshotDate < y.snapshotDate ? 1 : -1))[0];
        return {
          accountId: a.accountId, policyNumber: a.policyNumber,
          manufacturerCode: mfr?.officialCode ?? '', manufacturerName: mfr?.name ?? '',
          currentStatus: a.currentStatus, openedDate: a.openedDate, closedDate: a.closedDate,
          latestBalance: latestBal ? { snapshotDate: latestBal.snapshotDate, total: latestBal.total } : undefined,
        };
      }),
      recentDeposits: [...this.deposits.values()]
        .filter((d) => accs.some((a) => a.accountId === d.accountId))
        .sort((a, b) => (a.depositMonth < b.depositMonth ? 1 : -1))
        .slice(0, 12)
        .map((d) => {
          const a = accs.find((x) => x.accountId === d.accountId);
          return { accountId: d.accountId, policyNumber: a?.policyNumber ?? '', depositMonth: d.depositMonth, total: d.total };
        }),
      rejects: rej.map((r) => ({
        rejectId: r.rejectId, rejectCode: r.rejectCode,
        severity: r.severity, status: r.status, detectedAt: r.detectedAt,
      })),
      terminations: term.map((t) => ({
        terminationEventId: t.terminationEventId, status: t.status,
        detectedAt: t.detectedAt, confirmedTerminationDate: t.confirmedTerminationDate,
      })),
      riskFlags: [],
    };
  }

  // ---------- AGENT_CONTEXT (פרק 11 + §5.6) ----------
  async getAgentContext(customerId: string): Promise<AgentContextRow | null> {
    return this.agentContexts.get(customerId) ?? null;
  }

  async upsertAgentContext(row: AgentContextRow): Promise<AgentContextRow> {
    const prev = this.agentContexts.get(row.customerId);
    const merged: AgentContextRow = { ...row, version: (prev?.version ?? 0) + 1 };
    this.agentContexts.set(row.customerId, merged);
    return merged;
  }

  async customerIdsAffectedByRun(runId: string): Promise<string[]> {
    const ids = new Set<string>();
    for (const c of this.customers.values()) if (c.ingestionRunId === runId) ids.add(c.customerId);
    // עסקאות באותה ריצה (employments) — לכסות לקוחות שעודכנו אך לא נוצרו
    for (const e of this.employments.values()) if (e.ingestionRunId === runId) ids.add(e.customerId);
    return [...ids];
  }

  // ---------- מסכים נוספים §12.2 (מימוש in-memory מקוצר; ה-UI רץ מול PG) ----------
  async collectionMonthView(referenceMonth: string): Promise<CollectionMonthView> {
    const all = this.discrepancies.filter((d) => d.referenceMonth === referenceMonth);
    const open = all.filter((d) => d.status !== 'RESOLVED' && d.status !== 'DISMISSED');
    const byType: Record<string, number> = {};
    for (const d of all) byType[d.discrepancyType] = (byType[d.discrepancyType] ?? 0) + 1;
    return {
      referenceMonth,
      totals: {
        all: all.length, open: open.length,
        resolved: all.length - open.length,
        sumAmount: open.reduce((s, d) => s + d.discrepancyAmount, 0),
      },
      byType, topEmployers: [], recentDiscrepancies: [],
    };
  }

  async listTerminationsForUi(): Promise<TerminationListItem[]> {
    return this.terminations.map((t) => ({
      terminationEventId: t.terminationEventId, customerId: t.customerId,
      detectionSource: t.detectionSource, status: t.status,
      detectedAt: t.detectedAt, confirmedTerminationDate: t.confirmedTerminationDate,
      formsCount: this.forms161.filter((f) => f.terminationEventId === t.terminationEventId).length,
      notes: t.notes,
    }));
  }

  async terminationDetailForUi(id: string): Promise<TerminationDetail | null> {
    const t = this.terminations.find((x) => x.terminationEventId === id);
    if (!t) return null;
    const forms = this.forms161
      .filter((f) => f.terminationEventId === id)
      .map((f) => ({
        form161Id: f.form161Id, formNumber: f.formNumber,
        totalSeveranceAmount: f.totalSeveranceAmount, redemptionAmount: f.redemptionAmount,
        fixationAmount: f.fixationAmount, validationStatus: f.validationStatus,
        rejectedReason: f.rejectedReason,
        signedByEmployeeAt: f.signedByEmployeeAt, signedByEmployerAt: f.signedByEmployerAt,
        signedByAdvisorAt: f.signedByAdvisorAt,
      }));
    const emp = [...this.employments.values()].find((e) => e.customerId === t.customerId);
    return {
      terminationEventId: t.terminationEventId, customerId: t.customerId,
      detectionSource: t.detectionSource, status: t.status,
      detectedAt: t.detectedAt, confirmedTerminationDate: t.confirmedTerminationDate,
      formsCount: forms.length, notes: t.notes,
      accountId: t.accountId, employerId: emp?.employerId,
      forms,
    };
  }

  async authorizationsView(now: Date): Promise<AuthorizationsView> {
    const mapItem = (a: Authorization) => {
      const c = [...this.customers.values()].find((x) => x.customerId === a.customerId);
      const days = Math.floor((new Date(a.validTo).getTime() - now.getTime()) / 86400_000);
      return {
        authorizationId: a.authorizationId, customerId: a.customerId,
        customerName: c ? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() : undefined,
        customerIsraelId: c?.israelId, scope: a.scope, channel: a.channel, status: a.status,
        signedAt: a.signedAt, validTo: a.validTo, daysUntilExpiry: days,
        revokedAt: a.revokedAt, revokedBy: a.revokedBy, revokedReason: a.revokedReason,
      };
    };
    const items = this.authorizations.map(mapItem);
    return {
      active: items.filter((x) => x.status === 'active' && x.daysUntilExpiry > 30),
      expiringSoon: items.filter((x) => x.status === 'active' && x.daysUntilExpiry <= 30),
      expired: items.filter((x) => x.status === 'expired'),
      revoked: items.filter((x) => x.status === 'revoked' || x.status === 'superseded'),
    };
  }

  async managerStats(): Promise<ManagerStats> {
    const openRejects = this.rejects.filter((r) => r.status !== 'RESOLVED' && r.status !== 'DISMISSED');
    return {
      overview: {
        customers: this.customers.size,
        activeAccounts: [...this.accounts.values()].filter((a) => a.currentStatus === 'ACTIVE' || a.currentStatus === 'AC').length,
        totalAssets: this.balanceSnapshots.reduce((s, b) => s + Number(b.total ?? 0), 0),
        ingestionRuns30d: 0, ingestionFailures30d: 0,
      },
      rejects: { open: openRejects.length, resolved30d: 0, byCode: [] },
      collection: { openDiscrepancies: this.discrepancies.filter((d) => d.status !== 'RESOLVED' && d.status !== 'DISMISSED').length, sumOpenAmount: 0, topEmployers: [] },
      manufacturers: [],
    };
  }

  async searchAuditLog(filters: AuditSearchFilters): Promise<AuditLogEntry[]> {
    let list = this.auditLog.slice();
    if (filters.actor) list = list.filter((l) => l.actor === filters.actor);
    if (filters.action) list = list.filter((l) => l.action === filters.action);
    if (filters.entity) list = list.filter((l) => l.entity === filters.entity);
    if (filters.since) list = list.filter((l) => l.occurredAt >= filters.since!);
    list.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
    return list.slice(0, Math.min(filters.limit ?? 100, 500)).map((l, i) => ({
      auditId: i + 1, occurredAt: l.occurredAt, actor: l.actor,
      action: l.action, entity: l.entity, entityId: l.entityId, meta: l.meta,
    }));
  }

  async listRegulationVersions(): Promise<RegulationVersionEntry[]> {
    return [];
  }

  async listIngestionRuns(limit: number): Promise<IngestionRunListItem[]> {
    const list = [...this.runs.values()]
      .sort((a, b) => 0)
      .slice(0, Math.min(limit, 500));
    return list.map((r) => ({
      ingestionRunId: r.ingestionRunId, sourceFileName: r.sourceFileName, fileHash: r.fileHash,
      parserVersion: r.parserVersion, status: r.status, error: r.error,
      receivedAt: new Date().toISOString(), rawCount: 0, errorCount: 0, criticalCount: 0, rejectsCount: 0,
    }));
  }

  async getIngestionRunDetail(id: string): Promise<IngestionRunDetail | null> {
    const r = this.runs.get(id);
    if (!r) return null;
    return {
      ingestionRunId: r.ingestionRunId, sourceFileName: r.sourceFileName, fileHash: r.fileHash,
      parserVersion: r.parserVersion, status: r.status, error: r.error,
      receivedAt: new Date().toISOString(), rawCount: 0, errorCount: 0, criticalCount: 0, rejectsCount: 0,
      errors: this.errors.filter((e) => e.runId === id).map((e) => ({
        code: e.issue.code, severity: e.issue.severity, message: e.issue.message,
        blockCode: e.issue.blockCode, recordSeq: e.issue.recordSeq, field: e.issue.field,
      })),
      promotedByEntity: [],
    };
  }

  // ---------- אימות והרשאות (פרק 13) ----------
  async findUserByEmail(email: string): Promise<UserWithPassword | null> {
    return this.users.find((u) => u.email === email && u.active) ?? null;
  }
  async getUserById(userId: string): Promise<UserRecord | null> {
    const u = this.users.find((x) => x.userId === userId);
    if (!u) return null;
    const { passwordHash, ...rest } = u;
    return rest;
  }
  async createUser(input: Omit<UserWithPassword, 'userId' | 'active' | 'lastLoginAt'>): Promise<UserRecord> {
    const u: UserWithPassword = { ...input, userId: randomUUID(), active: true };
    this.users.push(u);
    const { passwordHash, ...rest } = u;
    return rest;
  }
  async touchLastLogin(userId: string): Promise<void> {
    const u = this.users.find((x) => x.userId === userId);
    if (u) u.lastLoginAt = new Date().toISOString();
  }
  async listUsers(): Promise<UserRecord[]> {
    return this.users.map(({ passwordHash, ...rest }) => rest);
  }
  async setUserActive(userId: string, active: boolean): Promise<UserRecord | null> {
    const u = this.users.find((x) => x.userId === userId);
    if (!u) return null;
    u.active = active;
    const { passwordHash, ...rest } = u;
    return rest;
  }
  async setUserPassword(userId: string, passwordHash: string): Promise<void> {
    const u = this.users.find((x) => x.userId === userId);
    if (u) u.passwordHash = passwordHash;
  }

  // עזר לבדיקות
  rawRows(runId: string): RawRow[] {
    return this.raw.filter((r) => r.runId === runId);
  }
}
