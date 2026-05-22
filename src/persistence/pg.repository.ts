import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { normalizeId } from '../common/israeli-id';
import { toAmount } from '../common/money';
import { ParsedRecord } from '../mevne-ahid/types';
import { ValidationIssue } from '../validation/types';
import { Reject } from '../rejects/reject.types';
import { Form161, TerminationEvent } from '../termination/termination.types';
import { CustomerEmploymentSnapshot } from '../termination/termination-detection';
import { CollectionDiscrepancy, DiscrepancyType } from '../collection/collection.types';
import { Authorization, AuthorizationTemplate, AuthScope } from '../authorization/authorization.types';
import { Customer360, CustomerSearchResult, DashboardStats, RejectFilters, RejectListItem } from '../api/ui-query.types';
import { AgentContextRow } from '../agent-context/agent-context.types';
import { UserRecord, UserRole, UserWithPassword } from '../auth/auth.types';
import {
  AuditLogEntry, AuditSearchFilters, AuthorizationsView,
  CollectionMonthView, ManagerStats, RegulationVersionEntry, TerminationDetail, TerminationListItem,
} from '../api/ui-query-v2.types';
import { IngestionRunDetail, IngestionRunListItem } from '../api/ui-query-v3.types';
import { DbService } from './db.service';
import { IngestionRunRecord, PromoteCounts, Repository } from './repository.port';

/**
 * מימוש PostgreSQL של ה-Repository מול schema.sql.
 * הקידום (§5.5) רץ בטרנזקציה אחת — קליטה היא טרנזקציה לוגית (§5.1).
 */
@Injectable()
export class PgRepository implements Repository {
  constructor(private readonly db: DbService) {}

  async findCompletedRunByHash(fileHash: string): Promise<IngestionRunRecord | null> {
    const { rows } = await this.db.pool.query(
      `SELECT ingestion_run_id, file_hash, status FROM ingestion_run
       WHERE file_hash = $1 AND status = 'completed' LIMIT 1`,
      [fileHash],
    );
    if (!rows.length) return null;
    return { ingestionRunId: rows[0].ingestion_run_id, fileHash: rows[0].file_hash, status: rows[0].status };
  }

  async createIngestionRun(run: IngestionRunRecord): Promise<IngestionRunRecord> {
    const { rows } = await this.db.pool.query(
      `INSERT INTO ingestion_run (file_hash, source_file_name, parser_version, raw_file_path, status)
       VALUES ($1,$2,$3,$4,$5) RETURNING ingestion_run_id`,
      [run.fileHash, run.sourceFileName, run.parserVersion, run.rawFilePath, run.status],
    );
    return { ...run, ingestionRunId: rows[0].ingestion_run_id };
  }

  async updateRunStatus(runId: string, status: string, error?: string): Promise<void> {
    await this.db.pool.query(
      `UPDATE ingestion_run SET status = $2, error = COALESCE($3, error),
       completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END
       WHERE ingestion_run_id = $1`,
      [runId, status, error ?? null],
    );
  }

  async saveRawStaging(runId: string, records: ParsedRecord[]): Promise<void> {
    for (const r of records) {
      await this.db.pool.query(
        `INSERT INTO raw_staging (ingestion_run_id, block_code, record_seq, fields, source_offset)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (ingestion_run_id, record_seq) DO NOTHING`,
        [runId, r.blockCode, r.recordSeq, JSON.stringify(r.fields), r.sourceOffset],
      );
    }
  }

  async saveErrors(runId: string, issues: ValidationIssue[]): Promise<void> {
    for (const i of issues) {
      await this.db.pool.query(
        `INSERT INTO ingestion_error (ingestion_run_id, code, severity, message, block_code, record_seq, field)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [runId, i.code, i.severity, i.message, i.blockCode ?? null, i.recordSeq ?? null, i.field ?? null],
      );
    }
  }

  async knownPolicyNumbers(): Promise<Set<string>> {
    const { rows } = await this.db.pool.query(`SELECT policy_number FROM account`);
    return new Set(rows.map((r) => r.policy_number));
  }

  async knownManufacturerCodes(): Promise<Set<string>> {
    const { rows } = await this.db.pool.query(`SELECT manufacturer_code FROM ref_manufacturer_type`);
    return new Set(rows.map((r) => r.manufacturer_code));
  }

  async rollback(runId: string): Promise<void> {
    // §5.7 — מחיקה רכה: סימון raw_staging + מחיקת insert-only entities של הריצה
    await this.db.tx(async (c) => {
      await c.query(`UPDATE raw_staging SET target_id = NULL, target_entity = 'SUPERSEDED' WHERE ingestion_run_id = $1`, [runId]);
      await c.query(`DELETE FROM balance_snapshot WHERE ingestion_run_id = $1`, [runId]);
      await c.query(`DELETE FROM deposit WHERE ingestion_run_id = $1`, [runId]);
      await c.query(`DELETE FROM withdrawal WHERE ingestion_run_id = $1`, [runId]);
      await c.query(`UPDATE ingestion_run SET status = 'rolled_back' WHERE ingestion_run_id = $1`, [runId]);
    });
  }

  async promote(runId: string, records: ParsedRecord[]): Promise<PromoteCounts> {
    const counts: PromoteCounts = {
      customers: 0, employers: 0, manufacturers: 0, products: 0, accounts: 0,
      balanceSnapshots: 0, coverages: 0, beneficiaries: 0, deposits: 0,
      withdrawals: 0, loans: 0, statusChanges: 0,
    };
    const by = (code: string) => records.filter((r) => r.blockCode === code);

    await this.db.tx(async (c: PoolClient) => {
      const lotToIsraelId = new Map<string, string>();

      // 1. CUSTOMER
      for (const r of by('020')) {
        const israelId = normalizeId(r.fields.israelId) ?? r.fields.israelId;
        lotToIsraelId.set(r.fields.lotId, israelId);
        const { rows } = await c.query(
          `INSERT INTO customer (israel_id, first_name, last_name, birth_date, gender, city, ingestion_run_id)
           VALUES ($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),$7)
           ON CONFLICT (israel_id) DO UPDATE SET
             first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
             birth_date = EXCLUDED.birth_date, city = EXCLUDED.city, ingestion_run_id = EXCLUDED.ingestion_run_id
           RETURNING customer_id, (xmax = 0) AS inserted`,
          [israelId, r.fields.firstName, r.fields.lastName, this.dateOrNull(r.fields.birthDate), r.fields.gender, r.fields.city, runId],
        );
        if (rows[0].inserted) counts.customers++;
        await this.mark(c, runId, r.recordSeq, 'customer', rows[0].customer_id);
      }

      // 2. EMPLOYER
      for (const r of by('070')) {
        const companyId = normalizeId(r.fields.employerCompanyId) ?? r.fields.employerCompanyId;
        if (!companyId) continue;
        const { rows } = await c.query(
          `INSERT INTO employer (company_id, employer_name) VALUES ($1, NULLIF($2,''))
           ON CONFLICT (company_id) DO UPDATE SET employer_name = COALESCE(EXCLUDED.employer_name, employer.employer_name)
           RETURNING (xmax = 0) AS inserted`,
          [companyId, r.fields.employerName],
        );
        if (rows[0].inserted) counts.employers++;
      }

      // 3. MANUFACTURER (חייב כבר להיות ב-REF — אחרת E030 ב-cross-block)
      for (const r of by('030')) {
        const { rows } = await c.query(
          `INSERT INTO manufacturer (official_code, name) VALUES ($1,$2)
           ON CONFLICT (official_code) DO UPDATE SET name = EXCLUDED.name
           RETURNING manufacturer_id, (xmax = 0) AS inserted`,
          [r.fields.manufacturerCode, r.fields.manufacturerName],
        );
        if (rows[0].inserted) counts.manufacturers++;
        await this.mark(c, runId, r.recordSeq, 'manufacturer', rows[0].manufacturer_id);
      }

      const mfrId = async (code: string): Promise<string | null> => {
        const { rows } = await c.query(`SELECT manufacturer_id FROM manufacturer WHERE official_code = $1`, [code]);
        return rows[0]?.manufacturer_id ?? null;
      };

      // 4. PRODUCT + 5. ACCOUNT
      for (const r of by('040')) {
        const m = await mfrId(r.fields.manufacturerCode);
        if (!m) continue;
        const prod = await c.query(
          `INSERT INTO product (manufacturer_id, product_code) VALUES ($1,$2)
           ON CONFLICT (manufacturer_id, product_code) DO UPDATE SET product_code = EXCLUDED.product_code
           RETURNING product_id, (xmax = 0) AS inserted`,
          [m, r.fields.productCode],
        );
        if (prod.rows[0].inserted) counts.products++;

        const israelId = lotToIsraelId.get(r.fields.lotId);
        const cust = israelId
          ? (await c.query(`SELECT customer_id FROM customer WHERE israel_id = $1`, [israelId])).rows[0]
          : undefined;
        if (!cust) continue;

        const existing = await c.query(
          `SELECT account_id, current_status FROM account WHERE manufacturer_id = $1 AND policy_number = $2`,
          [m, r.fields.policyNumber],
        );
        const newStatus = r.fields.accountStatus || 'ACTIVE';
        let accountId: string;
        if (!existing.rows.length) {
          const ins = await c.query(
            `INSERT INTO account (customer_id, manufacturer_id, product_id, policy_number, opened_date,
               closed_date, current_status, risk_track_code, sub_policy_code, ingestion_run_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),NULLIF($9,''),$10) RETURNING account_id`,
            [cust.customer_id, m, prod.rows[0].product_id, r.fields.policyNumber, this.dateOrNull(r.fields.openedDate),
             this.dateOrNull(r.fields.closedDate), newStatus, r.fields.riskTrackCode, r.fields.subPolicyCode, runId],
          );
          accountId = ins.rows[0].account_id;
          counts.accounts++;
          await c.query(
            `INSERT INTO account_status_history (account_id, status, trigger_event, effective_from, ingestion_run_id)
             VALUES ($1,$2,'OPEN', now(), $3)`,
            [accountId, newStatus, runId],
          );
          counts.statusChanges++;
        } else {
          accountId = existing.rows[0].account_id;
          if (existing.rows[0].current_status !== newStatus) {
            await c.query(
              `UPDATE account_status_history SET effective_to = now()
               WHERE account_id = $1 AND effective_to IS NULL`,
              [accountId],
            );
            await c.query(
              `INSERT INTO account_status_history (account_id, status, trigger_event, effective_from, ingestion_run_id)
               VALUES ($1,$2,$3, now(), $4)`,
              [accountId, newStatus, newStatus === 'CLOSED' ? 'CLOSE' : 'STATUS_CHANGE', runId],
            );
            counts.statusChanges++;
          }
          await c.query(
            `UPDATE account SET current_status=$2, opened_date=$3, closed_date=$4,
               risk_track_code=NULLIF($5,''), sub_policy_code=NULLIF($6,''), ingestion_run_id=$7
             WHERE account_id=$1`,
            [accountId, newStatus, this.dateOrNull(r.fields.openedDate), this.dateOrNull(r.fields.closedDate),
             r.fields.riskTrackCode, r.fields.subPolicyCode, runId],
          );
        }
        await this.mark(c, runId, r.recordSeq, 'account', accountId);
      }

      const accId = async (policy: string): Promise<string | null> =>
        (await c.query(`SELECT account_id FROM account WHERE policy_number = $1 ORDER BY ingestion_run_id LIMIT 1`, [policy]))
          .rows[0]?.account_id ?? null;

      // 8. BALANCE_SNAPSHOT
      for (const r of by('050')) {
        const a = await accId(r.fields.policyNumber);
        if (!a) continue;
        const sev = toAmount(r.fields.severance), te = toAmount(r.fields.tagmulimEmployee),
          tr = toAmount(r.fields.tagmulimEmployer), al = toAmount(r.fields.allowance);
        const ins = await c.query(
          `INSERT INTO balance_snapshot (account_id, snapshot_date, severance, tagmulim_employee,
             tagmulim_employer, allowance, total, ingestion_run_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [a, this.dateOrNull(r.fields.snapshotDate), sev, te, tr, al, sev + te + tr + al, runId],
        );
        counts.balanceSnapshots++;
        await this.mark(c, runId, r.recordSeq, 'balance_snapshot', ins.rows[0].id);
      }

      // 6. EMPLOYMENT (upsert לפי customer+employer+start; קישור ל-account_id)
      for (const r of by('070')) {
        const israelId = lotToIsraelId.get(r.fields.lotId);
        if (!israelId) continue;
        const customer = (await c.query(`SELECT customer_id FROM customer WHERE israel_id = $1`, [israelId])).rows[0];
        const companyId = normalizeId(r.fields.employerCompanyId) ?? r.fields.employerCompanyId;
        if (!customer || !companyId) continue;
        const employer = (await c.query(`SELECT employer_id FROM employer WHERE company_id = $1`, [companyId])).rows[0];
        if (!employer) continue;
        const accountId = await accId(r.fields.policyNumber);
        await c.query(
          `INSERT INTO employment (customer_id, employer_id, account_id, start_date, end_date, ingestion_run_id)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT DO NOTHING`,
          [customer.customer_id, employer.employer_id, accountId, this.dateOrNull(r.fields.employmentStart),
           this.dateOrNull(r.fields.employmentEnd), runId],
        );
      }

      // 11. DEPOSIT (insert only; UNIQUE account+month)
      for (const r of by('070')) {
        const a = await accId(r.fields.policyNumber);
        if (!a || !r.fields.depositMonth) continue;
        const e = toAmount(r.fields.amountEmployee), em = toAmount(r.fields.amountEmployer), sv = toAmount(r.fields.amountSeverance);
        const ins = await c.query(
          `INSERT INTO deposit (account_id, deposit_month, amount_employee, amount_employer, amount_severance, total, ingestion_run_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (account_id, deposit_month) DO NOTHING RETURNING deposit_id`,
          [a, r.fields.depositMonth, e, em, sv, e + em + sv, runId],
        );
        if (ins.rows.length) {
          counts.deposits++;
          await this.mark(c, runId, r.recordSeq, 'deposit', ins.rows[0].deposit_id);
        }
      }

      // 9. COVERAGE (upsert; שינוי => snapshot ל-coverage_history) — §5.5
      for (const r of by('060')) {
        const a = await accId(r.fields.policyNumber);
        if (!a) continue;
        const existing = await c.query(
          `SELECT * FROM coverage WHERE account_id=$1 AND coverage_type_code=$2 LIMIT 1`,
          [a, r.fields.coverageTypeCode],
        );
        const insured = toAmount(r.fields.insuredAmount);
        const premium = toAmount(r.fields.premium);
        if (existing.rows.length) {
          await c.query(
            `INSERT INTO coverage_history (coverage_id, snapshot, change_reason)
             VALUES ($1, to_jsonb($2::record), 'UPDATE_FROM_RUN')`,
            [existing.rows[0].coverage_id, existing.rows[0]],
          );
          await c.query(
            `UPDATE coverage SET insured_amount=$2, premium=$3, underwriting_status=NULLIF($4,''),
               coverage_from=$5, coverage_to=$6, ingestion_run_id=$7 WHERE coverage_id=$1`,
            [existing.rows[0].coverage_id, insured, premium, r.fields.underwritingStatus,
             this.dateOrNull(r.fields.coverageFrom), this.dateOrNull(r.fields.coverageTo), runId],
          );
          await this.mark(c, runId, r.recordSeq, 'coverage', existing.rows[0].coverage_id);
        } else {
          const ins = await c.query(
            `INSERT INTO coverage (account_id, coverage_type_code, insured_amount, premium,
               underwriting_status, coverage_from, coverage_to, ingestion_run_id)
             VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8) RETURNING coverage_id`,
            [a, r.fields.coverageTypeCode, insured, premium, r.fields.underwritingStatus,
             this.dateOrNull(r.fields.coverageFrom), this.dateOrNull(r.fields.coverageTo), runId],
          );
          counts.coverages++;
          await this.mark(c, runId, r.recordSeq, 'coverage', ins.rows[0].coverage_id);
        }
      }

      // 10. BENEFICIARY (replace per account; old → beneficiary_history) — §5.5
      const beneByPolicy = new Map<string, ParsedRecord[]>();
      for (const r of by('080')) {
        const arr = beneByPolicy.get(r.fields.policyNumber) ?? [];
        arr.push(r);
        beneByPolicy.set(r.fields.policyNumber, arr);
      }
      for (const [policy, recs] of beneByPolicy) {
        const a = await accId(policy);
        if (!a) continue;
        const prev = await c.query(`SELECT * FROM beneficiary WHERE account_id=$1`, [a]);
        if (prev.rows.length) {
          await c.query(
            `INSERT INTO beneficiary_history (account_id, snapshot)
             VALUES ($1, to_jsonb($2::jsonb))`,
            [a, JSON.stringify(prev.rows)],
          );
          await c.query(`DELETE FROM beneficiary WHERE account_id=$1`, [a]);
        }
        for (const r of recs) {
          const israelIdBene = normalizeId(r.fields.beneficiaryId);
          const ins = await c.query(
            `INSERT INTO beneficiary (account_id, beneficiary_name, beneficiary_id_num, relation, share_percent, ingestion_run_id)
             VALUES ($1,$2,$3,NULLIF($4,''),$5,$6) RETURNING beneficiary_id`,
            [a, r.fields.beneficiaryName, israelIdBene, r.fields.relation, toAmount(r.fields.sharePercent), runId],
          );
          counts.beneficiaries++;
          await this.mark(c, runId, r.recordSeq, 'beneficiary', ins.rows[0].beneficiary_id);
        }
      }

      // 12 + 13. WITHDRAWAL / LOAN (block 090)
      for (const r of by('090')) {
        const a = await accId(r.fields.policyNumber);
        if (!a) continue;
        if (r.fields.movementType === 'WD') {
          const ins = await c.query(
            `INSERT INTO withdrawal (account_id, movement_date, gross, net, tax, ingestion_run_id)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING withdrawal_id`,
            [a, this.dateOrNull(r.fields.movementDate), toAmount(r.fields.gross),
             toAmount(r.fields.net), toAmount(r.fields.tax), runId],
          );
          counts.withdrawals++;
          await this.mark(c, runId, r.recordSeq, 'withdrawal', ins.rows[0].withdrawal_id);
        } else if (r.fields.movementType === 'LN') {
          const mfrRow = await c.query(
            `SELECT manufacturer_id FROM account WHERE account_id=$1`,
            [a],
          );
          const mfrId = mfrRow.rows[0]?.manufacturer_id;
          if (!mfrId || !r.fields.loanExternalId) continue;
          const ins = await c.query(
            `INSERT INTO loan (account_id, loan_external_id, manufacturer_id, remaining_balance, ingestion_run_id)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (manufacturer_id, loan_external_id) DO UPDATE SET
               remaining_balance = EXCLUDED.remaining_balance,
               ingestion_run_id = EXCLUDED.ingestion_run_id
             RETURNING loan_id, (xmax = 0) AS inserted`,
            [a, r.fields.loanExternalId, mfrId, toAmount(r.fields.gross), runId],
          );
          if (ins.rows[0].inserted) counts.loans++;
          await this.mark(c, runId, r.recordSeq, 'loan', ins.rows[0].loan_id);
        }
      }
    });

    return counts;
  }

  // ---------- ריג'קטים (פרק 7) ----------
  private mapReject(r: any): Reject {
    return {
      rejectId: r.reject_id, rejectType: r.reject_type, sourceEntity: r.source_entity ?? undefined,
      sourceEntityId: r.source_entity_id ?? undefined, customerId: r.customer_id ?? undefined,
      manufacturerId: r.manufacturer_id ?? undefined, detectedAt: r.detected_at?.toISOString?.() ?? r.detected_at,
      rejectCode: r.reject_code, rejectReason: r.reject_reason ?? undefined, severity: r.severity,
      status: r.status, assignee: r.assignee ?? undefined,
      slaDueAt: r.sla_due_at?.toISOString?.() ?? r.sla_due_at ?? undefined,
      resolutionPath: r.resolution_path ?? [], resolvedAt: r.resolved_at?.toISOString?.() ?? r.resolved_at ?? undefined,
      resolvedBy: r.resolved_by ?? undefined, resolutionSummary: r.resolution_summary ?? undefined,
      ingestionRunId: r.ingestion_run_id ?? undefined,
    };
  }

  async findOpenReject(code: string, sourceEntity?: string, sourceEntityId?: string): Promise<Reject | null> {
    const { rows } = await this.db.pool.query(
      `SELECT * FROM reject WHERE reject_code=$1 AND COALESCE(source_entity,'')=$2
       AND COALESCE(source_entity_id,'')=$3 AND status NOT IN ('RESOLVED','DISMISSED') LIMIT 1`,
      [code, sourceEntity ?? '', sourceEntityId ?? ''],
    );
    return rows.length ? this.mapReject(rows[0]) : null;
  }

  async createReject(r: Reject): Promise<Reject> {
    const { rows } = await this.db.pool.query(
      `INSERT INTO reject (reject_type, source_entity, source_entity_id, customer_id, manufacturer_id,
         detected_at, reject_code, reject_reason, severity, status, assignee, sla_due_at,
         resolution_path, ingestion_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING reject_id`,
      [r.rejectType, r.sourceEntity ?? null, r.sourceEntityId ?? null, r.customerId ?? null,
       r.manufacturerId ?? null, r.detectedAt, r.rejectCode, r.rejectReason ?? null, r.severity,
       r.status, r.assignee ?? null, r.slaDueAt ?? null, JSON.stringify(r.resolutionPath), r.ingestionRunId ?? null],
    );
    return { ...r, rejectId: rows[0].reject_id };
  }

  async saveReject(r: Reject): Promise<void> {
    await this.db.pool.query(
      `UPDATE reject SET status=$2, assignee=$3, sla_due_at=$4, resolution_path=$5,
         resolved_at=$6, resolved_by=$7, resolution_summary=$8 WHERE reject_id=$1`,
      [r.rejectId, r.status, r.assignee ?? null, r.slaDueAt ?? null, JSON.stringify(r.resolutionPath),
       r.resolvedAt ?? null, r.resolvedBy ?? null, r.resolutionSummary ?? null],
    );
  }

  async getReject(rejectId: string): Promise<Reject | null> {
    const { rows } = await this.db.pool.query(`SELECT * FROM reject WHERE reject_id=$1`, [rejectId]);
    return rows.length ? this.mapReject(rows[0]) : null;
  }

  async listRejectsByCustomer(customerId: string): Promise<Reject[]> {
    const { rows } = await this.db.pool.query(`SELECT * FROM reject WHERE customer_id=$1 ORDER BY detected_at DESC`, [customerId]);
    return rows.map((x) => this.mapReject(x));
  }

  async listOverdueRejects(now: Date): Promise<Reject[]> {
    const { rows } = await this.db.pool.query(
      `SELECT * FROM reject WHERE status NOT IN ('RESOLVED','DISMISSED','ESCALATED')
       AND sla_due_at IS NOT NULL AND sla_due_at < $1`,
      [now.toISOString()],
    );
    return rows.map((x) => this.mapReject(x));
  }

  async soleCustomerOfRun(runId: string): Promise<string | null> {
    const { rows } = await this.db.pool.query(
      `SELECT customer_id FROM customer WHERE ingestion_run_id=$1 LIMIT 2`,
      [runId],
    );
    return rows.length === 1 ? rows[0].customer_id : null;
  }

  // ---------- סיום עבודה וטופס 161 (פרק 8) ----------
  private mapTermination(r: any): TerminationEvent {
    return {
      terminationEventId: r.termination_event_id,
      customerId: r.customer_id,
      employmentId: r.employment_id ?? undefined,
      accountId: r.account_id ?? undefined,
      detectedAt: r.detected_at?.toISOString?.() ?? r.detected_at,
      detectionSource: r.detection_source,
      confirmedTerminationDate: r.confirmed_termination_date?.toISOString?.()?.slice(0, 10) ?? r.confirmed_termination_date ?? undefined,
      status: r.status,
      notes: r.notes ?? undefined,
      ingestionRunId: r.ingestion_run_id ?? undefined,
    };
  }

  async findActiveTermination(customerId: string, employmentId?: string): Promise<TerminationEvent | null> {
    const { rows } = await this.db.pool.query(
      `SELECT * FROM termination_event WHERE customer_id=$1 AND COALESCE(employment_id::text,'')=$2
       AND status NOT IN ('COMPLETED','DISMISSED') LIMIT 1`,
      [customerId, employmentId ?? ''],
    );
    return rows.length ? this.mapTermination(rows[0]) : null;
  }

  async createTermination(ev: TerminationEvent): Promise<TerminationEvent> {
    const { rows } = await this.db.pool.query(
      `INSERT INTO termination_event (customer_id, employment_id, account_id, detected_at, detection_source,
         confirmed_termination_date, status, notes, ingestion_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING termination_event_id`,
      [ev.customerId, ev.employmentId ?? null, ev.accountId ?? null, ev.detectedAt, ev.detectionSource,
       ev.confirmedTerminationDate ?? null, ev.status, ev.notes ?? null, ev.ingestionRunId ?? null],
    );
    return { ...ev, terminationEventId: rows[0].termination_event_id };
  }

  async saveTermination(ev: TerminationEvent): Promise<void> {
    await this.db.pool.query(
      `UPDATE termination_event SET status=$2, notes=$3, confirmed_termination_date=$4
       WHERE termination_event_id=$1`,
      [ev.terminationEventId, ev.status, ev.notes ?? null, ev.confirmedTerminationDate ?? null],
    );
  }

  async getTermination(id: string): Promise<TerminationEvent | null> {
    const { rows } = await this.db.pool.query(`SELECT * FROM termination_event WHERE termination_event_id=$1`, [id]);
    return rows.length ? this.mapTermination(rows[0]) : null;
  }

  async listTerminationsByCustomer(customerId: string): Promise<TerminationEvent[]> {
    const { rows } = await this.db.pool.query(
      `SELECT * FROM termination_event WHERE customer_id=$1 ORDER BY detected_at DESC`,
      [customerId],
    );
    return rows.map((r) => this.mapTermination(r));
  }

  /** snapshot עם החודש האחרון של הפקדה ועם דגל ותיקות (manufacturer.category='OLD_PENSION_FUND'). */
  async loadEmploymentSnapshots(): Promise<CustomerEmploymentSnapshot[]> {
    const { rows } = await this.db.pool.query(`
      SELECT e.employment_id, e.customer_id, e.employer_id, e.account_id, e.start_date, e.end_date,
             a.current_status,
             (rmt.category = 'OLD_PENSION_FUND') AS is_vatika,
             (SELECT MAX(deposit_month) FROM deposit d WHERE d.account_id = e.account_id) AS last_month
      FROM employment e
      LEFT JOIN account a ON a.account_id = e.account_id
      LEFT JOIN manufacturer m ON m.manufacturer_id = a.manufacturer_id
      LEFT JOIN ref_manufacturer_type rmt ON rmt.manufacturer_code = m.official_code
    `);
    return rows.map((r) => this.snapshotFromRow(r));
  }

  async loadEmploymentSnapshotsForRun(runId: string): Promise<CustomerEmploymentSnapshot[]> {
    const { rows } = await this.db.pool.query(`
      SELECT e.employment_id, e.customer_id, e.employer_id, e.account_id, e.start_date, e.end_date,
             a.current_status,
             (rmt.category = 'OLD_PENSION_FUND') AS is_vatika,
             (SELECT MAX(deposit_month) FROM deposit d WHERE d.account_id = e.account_id) AS last_month
      FROM employment e
      LEFT JOIN account a ON a.account_id = e.account_id
      LEFT JOIN manufacturer m ON m.manufacturer_id = a.manufacturer_id
      LEFT JOIN ref_manufacturer_type rmt ON rmt.manufacturer_code = m.official_code
      WHERE e.ingestion_run_id = $1
    `, [runId]);
    return rows.map((r) => this.snapshotFromRow(r));
  }

  private snapshotFromRow(r: any): CustomerEmploymentSnapshot {
    const last = r.last_month
      ? new Date(Date.UTC(Number(String(r.last_month).slice(0, 4)), Number(String(r.last_month).slice(4, 6)) - 1, 1)).toISOString()
      : undefined;
    return {
      employmentId: r.employment_id,
      customerId: r.customer_id,
      employerId: r.employer_id,
      accountId: r.account_id ?? undefined,
      startDate: (r.start_date?.toISOString?.() ?? r.start_date),
      endDate: r.end_date?.toISOString?.() ?? r.end_date ?? undefined,
      lastDepositDate: last,
      accountStatus: r.current_status ?? undefined,
      isVatika: !!r.is_vatika,
    };
  }

  private mapForm161(r: any): Form161 {
    return {
      form161Id: r.form_161_id,
      terminationEventId: r.termination_event_id,
      accountId: r.account_id,
      customerId: r.customer_id,
      employerId: r.employer_id,
      formNumber: r.form_number ?? undefined,
      totalSeveranceAmount: Number(r.total_severance_amount),
      redemptionAmount: Number(r.redemption_amount),
      fixationAmount: Number(r.fixation_amount),
      taxWithholdingAmount: Number(r.tax_withholding_amount),
      signedByEmployeeAt: r.signed_by_employee_at ?? undefined,
      signedByEmployerAt: r.signed_by_employer_at ?? undefined,
      signedByAdvisorAt: r.signed_by_advisor_at ?? undefined,
      documentId: r.document_id ?? undefined,
      validationStatus: r.validation_status,
      rejectedReason: r.rejected_reason ?? undefined,
      ingestionRunId: r.ingestion_run_id ?? undefined,
    };
  }

  async createForm161(f: Form161): Promise<Form161> {
    const { rows } = await this.db.pool.query(
      `INSERT INTO form_161 (termination_event_id, account_id, customer_id, employer_id, form_number,
         total_severance_amount, redemption_amount, fixation_amount, tax_withholding_amount,
         signed_by_employee_at, signed_by_employer_at, signed_by_advisor_at, document_id,
         validation_status, rejected_reason, ingestion_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING form_161_id`,
      [f.terminationEventId, f.accountId, f.customerId, f.employerId, f.formNumber ?? null,
       f.totalSeveranceAmount, f.redemptionAmount, f.fixationAmount, f.taxWithholdingAmount,
       f.signedByEmployeeAt ?? null, f.signedByEmployerAt ?? null, f.signedByAdvisorAt ?? null,
       f.documentId ?? null, f.validationStatus, f.rejectedReason ?? null, f.ingestionRunId ?? null],
    );
    return { ...f, form161Id: rows[0].form_161_id };
  }

  async saveForm161(f: Form161): Promise<void> {
    await this.db.pool.query(
      `UPDATE form_161 SET total_severance_amount=$2, redemption_amount=$3, fixation_amount=$4,
         tax_withholding_amount=$5, signed_by_employee_at=$6, signed_by_employer_at=$7, signed_by_advisor_at=$8,
         validation_status=$9, rejected_reason=$10 WHERE form_161_id=$1`,
      [f.form161Id, f.totalSeveranceAmount, f.redemptionAmount, f.fixationAmount,
       f.taxWithholdingAmount, f.signedByEmployeeAt ?? null, f.signedByEmployerAt ?? null,
       f.signedByAdvisorAt ?? null, f.validationStatus, f.rejectedReason ?? null],
    );
  }

  async getForm161(id: string): Promise<Form161 | null> {
    const { rows } = await this.db.pool.query(`SELECT * FROM form_161 WHERE form_161_id=$1`, [id]);
    return rows.length ? this.mapForm161(rows[0]) : null;
  }

  async listForms161ByTermination(terminationId: string): Promise<Form161[]> {
    const { rows } = await this.db.pool.query(`SELECT * FROM form_161 WHERE termination_event_id=$1`, [terminationId]);
    return rows.map((r) => this.mapForm161(r));
  }

  async listForms161ByAccount(accountId: string): Promise<Form161[]> {
    const { rows } = await this.db.pool.query(`SELECT * FROM form_161 WHERE account_id=$1`, [accountId]);
    return rows.map((r) => this.mapForm161(r));
  }

  // ---------- בקרת גבייה (פרק 9) ----------
  private mapDiscrepancy(r: any): CollectionDiscrepancy {
    return {
      discrepancyId: r.discrepancy_id,
      customerId: r.customer_id ?? undefined,
      employerId: r.employer_id ?? undefined,
      employmentId: r.employment_id ?? undefined,
      referenceMonth: r.reference_month,
      expectedAccountId: r.expected_account_id ?? undefined,
      expectedAmountEmployee: Number(r.expected_amount_employee),
      expectedAmountEmployer: Number(r.expected_amount_employer),
      expectedAmountSeverance: Number(r.expected_amount_severance),
      reportedByEmployer: r.reported_by_employer ?? undefined,
      reportedByClearing: r.reported_by_clearing ?? undefined,
      discrepancyType: r.discrepancy_type,
      discrepancyAmount: Number(r.discrepancy_amount),
      status: r.status,
      resolutionSummary: r.resolution_summary ?? undefined,
      detectedAt: r.detected_at?.toISOString?.() ?? r.detected_at,
      resolvedAt: r.resolved_at?.toISOString?.() ?? r.resolved_at ?? undefined,
    };
  }

  async findOpenDiscrepancy(
    customerId: string | undefined,
    employmentId: string | undefined,
    referenceMonth: string,
    type: DiscrepancyType,
  ): Promise<CollectionDiscrepancy | null> {
    const { rows } = await this.db.pool.query(
      `SELECT * FROM collection_discrepancy WHERE COALESCE(customer_id::text,'')=$1 AND COALESCE(employment_id::text,'')=$2
       AND reference_month=$3 AND discrepancy_type=$4 AND status NOT IN ('RESOLVED','DISMISSED') LIMIT 1`,
      [customerId ?? '', employmentId ?? '', referenceMonth, type],
    );
    return rows.length ? this.mapDiscrepancy(rows[0]) : null;
  }

  async createDiscrepancy(d: CollectionDiscrepancy): Promise<CollectionDiscrepancy> {
    const { rows } = await this.db.pool.query(
      `INSERT INTO collection_discrepancy (customer_id, employer_id, employment_id, reference_month,
         expected_account_id, expected_amount_employee, expected_amount_employer, expected_amount_severance,
         reported_by_employer, reported_by_clearing, discrepancy_type, discrepancy_amount, status,
         resolution_summary, detected_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING discrepancy_id`,
      [d.customerId ?? null, d.employerId ?? null, d.employmentId ?? null, d.referenceMonth,
       d.expectedAccountId ?? null, d.expectedAmountEmployee, d.expectedAmountEmployer, d.expectedAmountSeverance,
       d.reportedByEmployer ? JSON.stringify(d.reportedByEmployer) : null,
       d.reportedByClearing ? JSON.stringify(d.reportedByClearing) : null,
       d.discrepancyType, d.discrepancyAmount, d.status, d.resolutionSummary ?? null, d.detectedAt],
    );
    return { ...d, discrepancyId: rows[0].discrepancy_id };
  }

  async saveDiscrepancy(d: CollectionDiscrepancy): Promise<void> {
    await this.db.pool.query(
      `UPDATE collection_discrepancy SET status=$2, resolution_summary=$3, resolved_at=$4
       WHERE discrepancy_id=$1`,
      [d.discrepancyId, d.status, d.resolutionSummary ?? null, d.resolvedAt ?? null],
    );
  }

  async getDiscrepancy(id: string): Promise<CollectionDiscrepancy | null> {
    const { rows } = await this.db.pool.query(`SELECT * FROM collection_discrepancy WHERE discrepancy_id=$1`, [id]);
    return rows.length ? this.mapDiscrepancy(rows[0]) : null;
  }

  async listDiscrepanciesByEmployer(employerId: string, referenceMonth?: string): Promise<CollectionDiscrepancy[]> {
    const params: any[] = [employerId];
    let sql = `SELECT * FROM collection_discrepancy WHERE employer_id=$1`;
    if (referenceMonth) { params.push(referenceMonth); sql += ` AND reference_month=$2`; }
    const { rows } = await this.db.pool.query(sql, params);
    return rows.map((r) => this.mapDiscrepancy(r));
  }

  async listDiscrepanciesByMonth(referenceMonth: string): Promise<CollectionDiscrepancy[]> {
    const { rows } = await this.db.pool.query(`SELECT * FROM collection_discrepancy WHERE reference_month=$1`, [referenceMonth]);
    return rows.map((r) => this.mapDiscrepancy(r));
  }

  // ---------- ייפוי כוח ופרטיות (פרק 10) ----------
  private mapAuth(r: any): Authorization {
    return {
      authorizationId: r.authorization_id, customerId: r.customer_id,
      scope: r.scope, scopeDetailsJson: r.scope_details_json ?? undefined,
      templateId: r.template_id ?? undefined, signatureHash: r.signature_hash ?? undefined,
      signedAt: r.signed_at?.toISOString?.() ?? r.signed_at,
      validFrom: (r.valid_from?.toISOString?.()?.slice(0, 10) ?? r.valid_from) as string,
      validTo: (r.valid_until?.toISOString?.()?.slice(0, 10) ?? r.valid_until) as string,
      channel: r.channel, digitalSignatureProvider: r.digital_signature_provider ?? undefined,
      documentId: r.document_id ?? undefined, status: r.status,
      revokedAt: r.revoked_at?.toISOString?.() ?? r.revoked_at ?? undefined,
      revokedReason: r.revoked_reason ?? undefined, revokedBy: r.revoked_by ?? undefined,
    };
  }

  async getCustomerStatus(customerId: string): Promise<{ status: string; legalCapacityStatus: string; residenceCountry?: string } | null> {
    const { rows } = await this.db.pool.query(
      `SELECT status, legal_capacity_status, residence_country FROM customer WHERE customer_id=$1`,
      [customerId],
    );
    return rows.length ? { status: rows[0].status, legalCapacityStatus: rows[0].legal_capacity_status, residenceCountry: rows[0].residence_country } : null;
  }

  async findActiveAuthorization(customerId: string, scope: AuthScope): Promise<Authorization | null> {
    const { rows } = await this.db.pool.query(
      `SELECT * FROM "authorization" WHERE customer_id=$1 AND scope=$2 AND status='active' LIMIT 1`,
      [customerId, scope],
    );
    return rows.length ? this.mapAuth(rows[0]) : null;
  }

  async listAuthorizations(customerId: string): Promise<Authorization[]> {
    const { rows } = await this.db.pool.query(`SELECT * FROM "authorization" WHERE customer_id=$1`, [customerId]);
    return rows.map((r) => this.mapAuth(r));
  }

  async createAuthorization(a: Authorization): Promise<Authorization> {
    const { rows } = await this.db.pool.query(
      `INSERT INTO "authorization" (customer_id, scope, scope_details_json, template_id, signature_hash,
         signed_at, valid_from, valid_until, channel, digital_signature_provider, document_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING authorization_id`,
      [a.customerId, a.scope, a.scopeDetailsJson ? JSON.stringify(a.scopeDetailsJson) : null,
       a.templateId ?? null, a.signatureHash ?? null, a.signedAt, a.validFrom, a.validTo,
       a.channel, a.digitalSignatureProvider ?? null, a.documentId ?? null, a.status],
    );
    return { ...a, authorizationId: rows[0].authorization_id };
  }

  async saveAuthorization(a: Authorization): Promise<void> {
    await this.db.pool.query(
      `UPDATE "authorization" SET status=$2, revoked_at=$3, revoked_reason=$4, revoked_by=$5
       WHERE authorization_id=$1`,
      [a.authorizationId, a.status, a.revokedAt ?? null, a.revokedReason ?? null, a.revokedBy ?? null],
    );
  }

  async getAuthorization(id: string): Promise<Authorization | null> {
    const { rows } = await this.db.pool.query(`SELECT * FROM "authorization" WHERE authorization_id=$1`, [id]);
    return rows.length ? this.mapAuth(rows[0]) : null;
  }

  async listExpirableAuthorizations(now: Date): Promise<Authorization[]> {
    const { rows } = await this.db.pool.query(
      `SELECT * FROM "authorization" WHERE status='active' AND valid_until < $1`,
      [now.toISOString().slice(0, 10)],
    );
    return rows.map((r) => this.mapAuth(r));
  }

  async createAuthorizationTemplate(t: AuthorizationTemplate): Promise<AuthorizationTemplate> {
    const { rows } = await this.db.pool.query(
      `INSERT INTO authorization_template (version, effective_from, effective_to, text_he, text_en,
         regulator_approved, approval_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING template_id`,
      [t.version, t.effectiveFrom, t.effectiveTo ?? null, t.textHe ?? null, t.textEn ?? null,
       t.regulatorApproved, t.approvalReference ?? null],
    );
    return { ...t, templateId: rows[0].template_id };
  }

  async getActiveTemplate(at: Date): Promise<AuthorizationTemplate | null> {
    const iso = at.toISOString().slice(0, 10);
    const { rows } = await this.db.pool.query(
      `SELECT * FROM authorization_template WHERE regulator_approved = true
       AND effective_from <= $1 AND (effective_to IS NULL OR effective_to > $1) LIMIT 1`,
      [iso],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      templateId: r.template_id, version: r.version,
      effectiveFrom: r.effective_from?.toISOString?.()?.slice(0, 10) ?? r.effective_from,
      effectiveTo: r.effective_to?.toISOString?.()?.slice(0, 10) ?? r.effective_to ?? undefined,
      textHe: r.text_he ?? undefined, textEn: r.text_en ?? undefined,
      regulatorApproved: r.regulator_approved, approvalReference: r.approval_reference ?? undefined,
    };
  }

  async appendAudit(entry: { actor: string; action: string; entity?: string; entityId?: string; meta?: any }): Promise<void> {
    await this.db.pool.query(
      `INSERT INTO audit_log (actor, action, entity, entity_id, meta) VALUES ($1,$2,$3,$4,$5)`,
      [entry.actor, entry.action, entry.entity ?? null, entry.entityId ?? null, entry.meta ? JSON.stringify(entry.meta) : null],
    );
  }

  // ---------- שאילתות UI (פרק 12) ----------
  async dashboardStats(now: Date): Promise<DashboardStats> {
    const nowIso = now.toISOString();
    const dayAgo = new Date(now.getTime() - 86400_000).toISOString();
    const [{ rows: rejBySev }, { rows: rejOver }, { rows: ingest }, { rows: terms }, { rows: discr }] = await Promise.all([
      this.db.pool.query(
        `SELECT severity, count(*)::int AS n FROM reject
         WHERE status NOT IN ('RESOLVED','DISMISSED') GROUP BY severity`,
      ),
      this.db.pool.query(
        `SELECT count(*)::int AS n FROM reject
         WHERE status NOT IN ('RESOLVED','DISMISSED','ESCALATED')
         AND sla_due_at IS NOT NULL AND sla_due_at < $1`,
        [nowIso],
      ),
      this.db.pool.query(
        `SELECT
           count(*) FILTER (WHERE received_at >= $1)::int AS last24h,
           count(*) FILTER (WHERE received_at >= $1 AND status = 'failed')::int AS failed24h
         FROM ingestion_run`,
        [dayAgo],
      ),
      this.db.pool.query(`SELECT count(*)::int AS n FROM termination_event WHERE status NOT IN ('COMPLETED','DISMISSED')`),
      this.db.pool.query(`SELECT count(*)::int AS n FROM collection_discrepancy WHERE status NOT IN ('RESOLVED','DISMISSED')`),
    ]);

    const bySev = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } as DashboardStats['rejects']['bySeverity'];
    let total = 0;
    for (const r of rejBySev) {
      const sev = r.severity as keyof typeof bySev;
      if (sev in bySev) bySev[sev] = r.n;
      total += r.n;
    }
    return {
      rejects: { total, bySeverity: bySev, overdue: rejOver[0]?.n ?? 0 },
      ingestion: { last24h: ingest[0]?.last24h ?? 0, failed24h: ingest[0]?.failed24h ?? 0 },
      terminations: { active: terms[0]?.n ?? 0 },
      collection: { openDiscrepancies: discr[0]?.n ?? 0 },
    };
  }

  async listRejectsForUi(filters: RejectFilters): Promise<RejectListItem[]> {
    const conds: string[] = [];
    const params: any[] = [];
    if (filters.status) {
      params.push(filters.status);
      conds.push(`r.status = $${params.length}`);
    } else {
      conds.push(`r.status NOT IN ('RESOLVED','DISMISSED')`);
    }
    if (filters.severity) { params.push(filters.severity); conds.push(`r.severity = $${params.length}`); }
    if (filters.rejectType) { params.push(filters.rejectType); conds.push(`r.reject_type = $${params.length}`); }
    params.push(Math.min(filters.limit ?? 100, 500));
    const sql = `
      SELECT r.reject_id, r.reject_code, r.reject_type, r.severity, r.status,
             r.customer_id, r.source_entity, r.detected_at, r.sla_due_at, r.assignee,
             c.israel_id, c.first_name, c.last_name
      FROM reject r LEFT JOIN customer c USING (customer_id)
      WHERE ${conds.join(' AND ')}
      ORDER BY
        CASE r.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
        r.sla_due_at NULLS LAST
      LIMIT $${params.length}`;
    const { rows } = await this.db.pool.query(sql, params);
    return rows.map((r) => ({
      rejectId: r.reject_id, rejectCode: r.reject_code, rejectType: r.reject_type,
      severity: r.severity, status: r.status,
      customerId: r.customer_id ?? undefined,
      customerName: r.first_name ? `${r.first_name} ${r.last_name ?? ''}`.trim() : undefined,
      customerIsraelId: r.israel_id ?? undefined,
      sourceEntity: r.source_entity ?? undefined,
      detectedAt: r.detected_at?.toISOString?.() ?? r.detected_at,
      slaDueAt: r.sla_due_at?.toISOString?.() ?? r.sla_due_at ?? undefined,
      assignee: r.assignee ?? undefined,
    }));
  }

  async searchCustomers(q: string, limit: number): Promise<CustomerSearchResult[]> {
    const term = `%${q.trim()}%`;
    const { rows } = await this.db.pool.query(
      `SELECT customer_id, israel_id, first_name, last_name, city
       FROM customer
       WHERE israel_id ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1
       ORDER BY last_name, first_name LIMIT $2`,
      [term, Math.min(limit, 100)],
    );
    return rows.map((r) => ({
      customerId: r.customer_id, israelId: r.israel_id,
      firstName: r.first_name, lastName: r.last_name, city: r.city ?? undefined,
    }));
  }

  async customer360(customerId: string, now: Date): Promise<Customer360 | null> {
    const { rows: cRows } = await this.db.pool.query(
      `SELECT customer_id, israel_id, first_name, last_name, birth_date, city, status FROM customer WHERE customer_id = $1`,
      [customerId],
    );
    if (!cRows.length) return null;
    const c = cRows[0];

    const [authRows, accRows, depRows, rejRows, termRows] = await Promise.all([
      this.db.pool.query(
        `SELECT authorization_id, scope, status, valid_until FROM "authorization"
         WHERE customer_id = $1 AND status = 'active' ORDER BY signed_at DESC LIMIT 1`,
        [customerId],
      ),
      this.db.pool.query(
        `SELECT a.account_id, a.policy_number, a.product_id, a.current_status, a.opened_date, a.closed_date,
                m.official_code AS manufacturer_code, m.name AS manufacturer_name,
                p.product_code,
                (SELECT row_to_json(b) FROM (
                  SELECT bs.snapshot_date, bs.total FROM balance_snapshot bs
                  WHERE bs.account_id = a.account_id ORDER BY bs.snapshot_date DESC LIMIT 1) b
                ) AS latest_balance
         FROM account a JOIN manufacturer m USING (manufacturer_id)
         LEFT JOIN product p USING (product_id)
         WHERE a.customer_id = $1
         ORDER BY a.opened_date DESC NULLS LAST`,
        [customerId],
      ),
      this.db.pool.query(
        `SELECT d.account_id, d.deposit_month, d.total, a.policy_number
         FROM deposit d JOIN account a USING (account_id)
         WHERE a.customer_id = $1 ORDER BY d.deposit_month DESC LIMIT 12`,
        [customerId],
      ),
      this.db.pool.query(
        `SELECT reject_id, reject_code, severity, status, detected_at FROM reject
         WHERE customer_id = $1 ORDER BY detected_at DESC LIMIT 20`,
        [customerId],
      ),
      this.db.pool.query(
        `SELECT termination_event_id, status, detected_at, confirmed_termination_date
         FROM termination_event WHERE customer_id = $1 ORDER BY detected_at DESC LIMIT 10`,
        [customerId],
      ),
    ]);

    const auth = authRows.rows[0]
      ? {
          authorizationId: authRows.rows[0].authorization_id,
          scope: authRows.rows[0].scope,
          status: authRows.rows[0].status,
          validTo: authRows.rows[0].valid_until?.toISOString?.()?.slice(0, 10) ?? authRows.rows[0].valid_until,
          daysUntilExpiry: Math.floor(
            (new Date(authRows.rows[0].valid_until).getTime() - now.getTime()) / 86400_000,
          ),
        }
      : undefined;

    const accounts = accRows.rows.map((r) => ({
      accountId: r.account_id, policyNumber: r.policy_number,
      manufacturerCode: r.manufacturer_code, manufacturerName: r.manufacturer_name,
      productCode: r.product_code ?? undefined,
      currentStatus: r.current_status,
      openedDate: r.opened_date?.toISOString?.()?.slice(0, 10) ?? r.opened_date ?? undefined,
      closedDate: r.closed_date?.toISOString?.()?.slice(0, 10) ?? r.closed_date ?? undefined,
      latestBalance: r.latest_balance
        ? {
            snapshotDate: typeof r.latest_balance.snapshot_date === 'string'
              ? r.latest_balance.snapshot_date.slice(0, 10)
              : new Date(r.latest_balance.snapshot_date).toISOString().slice(0, 10),
            total: Number(r.latest_balance.total),
          }
        : undefined,
    }));

    // risk flags
    const activeRejects = rejRows.rows.filter((r) => r.status !== 'RESOLVED' && r.status !== 'DISMISSED');
    const riskFlags: string[] = [];
    if (activeRejects.some((r) => r.severity === 'HIGH' || r.severity === 'CRITICAL')) riskFlags.push('OPEN_REJECT_HIGH');
    if (activeRejects.some((r) => (now.getTime() - new Date(r.detected_at).getTime()) / 86400_000 > 30)) riskFlags.push('STALE_REJECT_30D');
    if (activeRejects.length > 3) riskFlags.push('MULTIPLE_REJECTS');

    return {
      customer: {
        customerId: c.customer_id, israelId: c.israel_id,
        firstName: c.first_name, lastName: c.last_name,
        birthDate: c.birth_date?.toISOString?.()?.slice(0, 10) ?? c.birth_date ?? undefined,
        city: c.city ?? undefined, status: c.status ?? undefined,
      },
      authorization: auth,
      accounts,
      recentDeposits: depRows.rows.map((d) => ({
        accountId: d.account_id, policyNumber: d.policy_number,
        depositMonth: d.deposit_month, total: Number(d.total),
      })),
      rejects: rejRows.rows.map((r) => ({
        rejectId: r.reject_id, rejectCode: r.reject_code,
        severity: r.severity, status: r.status,
        detectedAt: r.detected_at?.toISOString?.() ?? r.detected_at,
      })),
      terminations: termRows.rows.map((t) => ({
        terminationEventId: t.termination_event_id, status: t.status,
        detectedAt: t.detected_at?.toISOString?.() ?? t.detected_at,
        confirmedTerminationDate: t.confirmed_termination_date?.toISOString?.()?.slice(0, 10) ?? t.confirmed_termination_date ?? undefined,
      })),
      riskFlags,
    };
  }

  // ---------- AGENT_CONTEXT (פרק 11 + §5.6) ----------
  private mapAgentContext(r: any): AgentContextRow {
    return {
      customerId: r.customer_id,
      summary: r.summary,
      embedding: Array.isArray(r.embedding) ? r.embedding.map(Number) : [],
      riskFlags: r.risk_flags ?? [],
      opportunityFlags: r.opportunity_flags ?? [],
      refreshedAt: r.refreshed_at?.toISOString?.() ?? r.refreshed_at,
      version: r.version,
      summaryHash: r.summary_hash ?? '',
    };
  }

  async getAgentContext(customerId: string): Promise<AgentContextRow | null> {
    const { rows } = await this.db.pool.query(`SELECT * FROM agent_context WHERE customer_id = $1`, [customerId]);
    return rows.length ? this.mapAgentContext(rows[0]) : null;
  }

  async upsertAgentContext(row: AgentContextRow): Promise<AgentContextRow> {
    const { rows } = await this.db.pool.query(
      `INSERT INTO agent_context (customer_id, summary, embedding, risk_flags, opportunity_flags, summary_hash, version)
       VALUES ($1, $2::jsonb, $3::float8[], $4::text[], $5::text[], $6, 1)
       ON CONFLICT (customer_id) DO UPDATE SET
         summary = EXCLUDED.summary,
         embedding = EXCLUDED.embedding,
         risk_flags = EXCLUDED.risk_flags,
         opportunity_flags = EXCLUDED.opportunity_flags,
         summary_hash = EXCLUDED.summary_hash,
         refreshed_at = now(),
         version = agent_context.version + 1
       RETURNING *`,
      [row.customerId, JSON.stringify(row.summary), row.embedding, row.riskFlags, row.opportunityFlags, row.summaryHash],
    );
    return this.mapAgentContext(rows[0]);
  }

  async customerIdsAffectedByRun(runId: string): Promise<string[]> {
    const { rows } = await this.db.pool.query(
      `SELECT DISTINCT customer_id FROM (
         SELECT customer_id FROM customer  WHERE ingestion_run_id = $1
         UNION
         SELECT customer_id FROM employment WHERE ingestion_run_id = $1
       ) t`,
      [runId],
    );
    return rows.map((r) => r.customer_id);
  }

  // ---------- מסכים נוספים (§12.2 #3,#4,#6,#7,#8) ----------
  async collectionMonthView(referenceMonth: string): Promise<CollectionMonthView> {
    const [{ rows: totals }, { rows: byType }, { rows: topEmp }, { rows: recent }] = await Promise.all([
      this.db.pool.query(
        `SELECT
           count(*)::int AS all,
           count(*) FILTER (WHERE status NOT IN ('RESOLVED','DISMISSED'))::int AS open,
           count(*) FILTER (WHERE status IN ('RESOLVED','DISMISSED'))::int AS resolved,
           COALESCE(SUM(discrepancy_amount) FILTER (WHERE status NOT IN ('RESOLVED','DISMISSED')), 0)::float AS sum_amount
         FROM collection_discrepancy WHERE reference_month = $1`,
        [referenceMonth],
      ),
      this.db.pool.query(
        `SELECT discrepancy_type, count(*)::int AS n
         FROM collection_discrepancy WHERE reference_month = $1
         GROUP BY discrepancy_type`,
        [referenceMonth],
      ),
      this.db.pool.query(
        `SELECT d.employer_id, e.employer_name,
                count(*)::int AS open_count,
                COALESCE(SUM(d.discrepancy_amount), 0)::float AS total_amount,
                jsonb_object_agg(d.discrepancy_type, n) AS by_type
         FROM (
           SELECT employer_id, discrepancy_type, discrepancy_amount, count(*) OVER (PARTITION BY employer_id, discrepancy_type) AS n
           FROM collection_discrepancy
           WHERE reference_month = $1 AND status NOT IN ('RESOLVED','DISMISSED') AND employer_id IS NOT NULL
         ) d LEFT JOIN employer e USING (employer_id)
         GROUP BY d.employer_id, e.employer_name
         ORDER BY open_count DESC LIMIT 10`,
        [referenceMonth],
      ),
      this.db.pool.query(
        `SELECT d.*, c.first_name, c.last_name, e.employer_name
         FROM collection_discrepancy d
         LEFT JOIN customer c USING (customer_id)
         LEFT JOIN employer e USING (employer_id)
         WHERE d.reference_month = $1
         ORDER BY d.detected_at DESC LIMIT 30`,
        [referenceMonth],
      ),
    ]);

    const byTypeMap: Record<string, number> = {};
    for (const r of byType) byTypeMap[r.discrepancy_type] = r.n;

    return {
      referenceMonth,
      totals: {
        all: totals[0]?.all ?? 0, open: totals[0]?.open ?? 0,
        resolved: totals[0]?.resolved ?? 0, sumAmount: Number(totals[0]?.sum_amount ?? 0),
      },
      byType: byTypeMap,
      topEmployers: topEmp.map((r) => ({
        employerId: r.employer_id, employerName: r.employer_name ?? undefined,
        openCount: r.open_count, totalAmount: Number(r.total_amount),
        byType: r.by_type ?? {},
      })),
      recentDiscrepancies: recent.map((r) => ({
        discrepancyId: r.discrepancy_id, referenceMonth: r.reference_month,
        customerId: r.customer_id ?? undefined,
        customerName: r.first_name ? `${r.first_name} ${r.last_name ?? ''}`.trim() : undefined,
        employerId: r.employer_id ?? undefined, employerName: r.employer_name ?? undefined,
        discrepancyType: r.discrepancy_type, discrepancyAmount: Number(r.discrepancy_amount),
        status: r.status, detectedAt: r.detected_at?.toISOString?.() ?? r.detected_at,
        resolvedAt: r.resolved_at?.toISOString?.() ?? r.resolved_at ?? undefined,
      })),
    };
  }

  async listTerminationsForUi(filters: { status?: string; limit?: number }): Promise<TerminationListItem[]> {
    const params: any[] = [];
    const conds: string[] = [];
    if (filters.status) { params.push(filters.status); conds.push(`t.status = $${params.length}`); }
    else conds.push(`t.status NOT IN ('COMPLETED','DISMISSED')`);
    params.push(Math.min(filters.limit ?? 100, 500));
    const { rows } = await this.db.pool.query(
      `SELECT t.*, c.first_name, c.last_name, c.israel_id,
              (SELECT count(*) FROM form_161 f WHERE f.termination_event_id = t.termination_event_id)::int AS forms_count,
              (SELECT f.validation_status FROM form_161 f
                WHERE f.termination_event_id = t.termination_event_id
                ORDER BY f.form_161_id DESC LIMIT 1) AS latest_form_status
       FROM termination_event t
       LEFT JOIN customer c USING (customer_id)
       WHERE ${conds.join(' AND ')}
       ORDER BY t.detected_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map((r) => ({
      terminationEventId: r.termination_event_id, customerId: r.customer_id,
      customerName: r.first_name ? `${r.first_name} ${r.last_name ?? ''}`.trim() : undefined,
      customerIsraelId: r.israel_id ?? undefined,
      detectionSource: r.detection_source, status: r.status,
      detectedAt: r.detected_at?.toISOString?.() ?? r.detected_at,
      confirmedTerminationDate: r.confirmed_termination_date?.toISOString?.()?.slice(0, 10) ?? r.confirmed_termination_date ?? undefined,
      formsCount: r.forms_count, latestFormStatus: r.latest_form_status ?? undefined, notes: r.notes ?? undefined,
    }));
  }

  async terminationDetailForUi(id: string): Promise<TerminationDetail | null> {
    const list = await this.listTerminationsForUi({ status: undefined, limit: 500 });
    let base = list.find((t) => t.terminationEventId === id);
    if (!base) {
      // ייתכן שהאירוע טרמינלי — נשלוף ישירות
      const { rows } = await this.db.pool.query(
        `SELECT t.*, c.first_name, c.last_name, c.israel_id,
                (SELECT count(*) FROM form_161 f WHERE f.termination_event_id = t.termination_event_id)::int AS forms_count
         FROM termination_event t LEFT JOIN customer c USING (customer_id)
         WHERE t.termination_event_id = $1`,
        [id],
      );
      if (!rows.length) return null;
      const r = rows[0];
      base = {
        terminationEventId: r.termination_event_id, customerId: r.customer_id,
        customerName: r.first_name ? `${r.first_name} ${r.last_name ?? ''}`.trim() : undefined,
        customerIsraelId: r.israel_id ?? undefined,
        detectionSource: r.detection_source, status: r.status,
        detectedAt: r.detected_at?.toISOString?.() ?? r.detected_at,
        confirmedTerminationDate: r.confirmed_termination_date?.toISOString?.()?.slice(0, 10) ?? r.confirmed_termination_date ?? undefined,
        formsCount: r.forms_count, notes: r.notes ?? undefined,
      };
    }
    const { rows: forms } = await this.db.pool.query(
      `SELECT * FROM form_161 WHERE termination_event_id = $1 ORDER BY form_161_id`,
      [id],
    );
    // §11.2 A8 — חילוץ accountId+employerId מהאירוע/מהעסקות של הלקוח (יצירת FORM_161 מצריך את שלושתם)
    const { rows: aux } = await this.db.pool.query(
      `SELECT t.account_id,
              (SELECT employer_id FROM employment e
               WHERE e.customer_id = t.customer_id ORDER BY start_date DESC LIMIT 1) AS employer_id
       FROM termination_event t WHERE t.termination_event_id = $1`,
      [id],
    );
    return {
      ...base,
      accountId: aux[0]?.account_id ?? undefined,
      employerId: aux[0]?.employer_id ?? undefined,
      forms: forms.map((f) => ({
        form161Id: f.form_161_id, formNumber: f.form_number ?? undefined,
        totalSeveranceAmount: Number(f.total_severance_amount),
        redemptionAmount: Number(f.redemption_amount), fixationAmount: Number(f.fixation_amount),
        validationStatus: f.validation_status, rejectedReason: f.rejected_reason ?? undefined,
        signedByEmployeeAt: f.signed_by_employee_at?.toISOString?.()?.slice(0, 10) ?? f.signed_by_employee_at ?? undefined,
        signedByEmployerAt: f.signed_by_employer_at?.toISOString?.()?.slice(0, 10) ?? f.signed_by_employer_at ?? undefined,
        signedByAdvisorAt: f.signed_by_advisor_at?.toISOString?.()?.slice(0, 10) ?? f.signed_by_advisor_at ?? undefined,
      })),
    };
  }

  async authorizationsView(now: Date): Promise<AuthorizationsView> {
    const { rows } = await this.db.pool.query(
      `SELECT a.*, c.first_name, c.last_name, c.israel_id
       FROM "authorization" a LEFT JOIN customer c USING (customer_id)
       ORDER BY a.signed_at DESC LIMIT 500`,
    );
    const items = rows.map((r) => {
      const validTo = r.valid_until?.toISOString?.()?.slice(0, 10) ?? r.valid_until;
      const days = Math.floor((new Date(validTo).getTime() - now.getTime()) / 86400_000);
      return {
        authorizationId: r.authorization_id, customerId: r.customer_id,
        customerName: r.first_name ? `${r.first_name} ${r.last_name ?? ''}`.trim() : undefined,
        customerIsraelId: r.israel_id ?? undefined,
        scope: r.scope, channel: r.channel, status: r.status,
        signedAt: r.signed_at?.toISOString?.() ?? r.signed_at, validTo,
        daysUntilExpiry: days,
        revokedAt: r.revoked_at?.toISOString?.() ?? r.revoked_at ?? undefined,
        revokedBy: r.revoked_by ?? undefined, revokedReason: r.revoked_reason ?? undefined,
      };
    });
    return {
      active: items.filter((x) => x.status === 'active' && x.daysUntilExpiry > 30),
      expiringSoon: items.filter((x) => x.status === 'active' && x.daysUntilExpiry <= 30),
      expired: items.filter((x) => x.status === 'expired'),
      revoked: items.filter((x) => x.status === 'revoked' || x.status === 'superseded'),
    };
  }

  async managerStats(now: Date): Promise<ManagerStats> {
    const dayAgo30 = new Date(now.getTime() - 30 * 86400_000).toISOString();
    const [{ rows: ov }, { rows: rs }, { rows: rc }, { rows: cs }, { rows: te }, { rows: mfr }] = await Promise.all([
      this.db.pool.query(
        `SELECT
           (SELECT count(*) FROM customer)::int AS customers,
           (SELECT count(*) FROM account WHERE current_status IN ('ACTIVE','AC'))::int AS active_accounts,
           (SELECT COALESCE(SUM(total), 0) FROM (
             SELECT DISTINCT ON (account_id) total FROM balance_snapshot
             ORDER BY account_id, snapshot_date DESC) bs)::float AS total_assets,
           (SELECT count(*) FROM ingestion_run WHERE received_at >= $1)::int AS runs30d,
           (SELECT count(*) FROM ingestion_run WHERE received_at >= $1 AND status = 'failed')::int AS fail30d
        `,
        [dayAgo30],
      ),
      this.db.pool.query(
        `SELECT
           count(*) FILTER (WHERE status NOT IN ('RESOLVED','DISMISSED'))::int AS open,
           count(*) FILTER (WHERE status = 'RESOLVED' AND resolved_at >= $1)::int AS resolved30d,
           AVG(EXTRACT(EPOCH FROM (resolved_at - detected_at))/3600.0) FILTER (WHERE status='RESOLVED' AND resolved_at >= $1)::float AS avg_hours
         FROM reject`,
        [dayAgo30],
      ),
      this.db.pool.query(
        `SELECT reject_code, count(*)::int AS n FROM reject
         WHERE status NOT IN ('RESOLVED','DISMISSED')
         GROUP BY reject_code ORDER BY n DESC LIMIT 10`,
      ),
      this.db.pool.query(
        `SELECT
           count(*) FILTER (WHERE status NOT IN ('RESOLVED','DISMISSED'))::int AS open,
           COALESCE(SUM(discrepancy_amount) FILTER (WHERE status NOT IN ('RESOLVED','DISMISSED')), 0)::float AS sum_amount
         FROM collection_discrepancy`,
      ),
      this.db.pool.query(
        `SELECT e.employer_name, count(*)::int AS open_count
         FROM collection_discrepancy d LEFT JOIN employer e USING (employer_id)
         WHERE d.status NOT IN ('RESOLVED','DISMISSED')
         GROUP BY e.employer_name ORDER BY open_count DESC LIMIT 5`,
      ),
      this.db.pool.query(
        `SELECT m.name AS manufacturer_name, count(*)::int AS open_rejects
         FROM reject r JOIN manufacturer m ON m.manufacturer_id = r.manufacturer_id
         WHERE r.status NOT IN ('RESOLVED','DISMISSED')
         GROUP BY m.name ORDER BY open_rejects DESC LIMIT 5`,
      ),
    ]);

    return {
      overview: {
        customers: ov[0]?.customers ?? 0,
        activeAccounts: ov[0]?.active_accounts ?? 0,
        totalAssets: Number(ov[0]?.total_assets ?? 0),
        ingestionRuns30d: ov[0]?.runs30d ?? 0,
        ingestionFailures30d: ov[0]?.fail30d ?? 0,
      },
      rejects: {
        open: rs[0]?.open ?? 0, resolved30d: rs[0]?.resolved30d ?? 0,
        avgResolutionHours: rs[0]?.avg_hours != null ? Number(rs[0].avg_hours) : undefined,
        byCode: rc.map((r) => ({ rejectCode: r.reject_code, count: r.n })),
      },
      collection: {
        openDiscrepancies: cs[0]?.open ?? 0, sumOpenAmount: Number(cs[0]?.sum_amount ?? 0),
        topEmployers: te.map((r) => ({ employerName: r.employer_name ?? undefined, openCount: r.open_count })),
      },
      manufacturers: mfr.map((r) => ({ manufacturerName: r.manufacturer_name, openRejects: r.open_rejects })),
    };
  }

  async searchAuditLog(filters: AuditSearchFilters): Promise<AuditLogEntry[]> {
    const params: any[] = [];
    const conds: string[] = ['1=1'];
    if (filters.actor) { params.push(filters.actor); conds.push(`actor = $${params.length}`); }
    if (filters.action) { params.push(filters.action); conds.push(`action = $${params.length}`); }
    if (filters.entity) { params.push(filters.entity); conds.push(`entity = $${params.length}`); }
    if (filters.since) { params.push(filters.since); conds.push(`occurred_at >= $${params.length}`); }
    params.push(Math.min(filters.limit ?? 100, 500));
    const { rows } = await this.db.pool.query(
      `SELECT audit_id, occurred_at, actor, action, entity, entity_id, meta
       FROM audit_log WHERE ${conds.join(' AND ')}
       ORDER BY occurred_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map((r) => ({
      auditId: Number(r.audit_id),
      occurredAt: r.occurred_at?.toISOString?.() ?? r.occurred_at,
      actor: r.actor, action: r.action,
      entity: r.entity ?? undefined, entityId: r.entity_id ?? undefined, meta: r.meta ?? undefined,
    }));
  }

  // ---------- אימות והרשאות (פרק 13) ----------
  async findUserByEmail(email: string): Promise<UserWithPassword | null> {
    const { rows } = await this.db.pool.query(
      `SELECT * FROM users WHERE email = $1 AND active = true LIMIT 1`,
      [email],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      userId: r.user_id, email: r.email, role: r.role as UserRole,
      fullName: r.full_name ?? undefined, active: r.active,
      lastLoginAt: r.last_login_at?.toISOString?.() ?? r.last_login_at ?? undefined,
      passwordHash: r.password_hash,
    };
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    const { rows } = await this.db.pool.query(`SELECT * FROM users WHERE user_id = $1`, [userId]);
    if (!rows.length) return null;
    const r = rows[0];
    return {
      userId: r.user_id, email: r.email, role: r.role as UserRole,
      fullName: r.full_name ?? undefined, active: r.active,
      lastLoginAt: r.last_login_at?.toISOString?.() ?? r.last_login_at ?? undefined,
    };
  }

  async createUser(input: Omit<UserWithPassword, 'userId' | 'active' | 'lastLoginAt'>): Promise<UserRecord> {
    const { rows } = await this.db.pool.query(
      `INSERT INTO users (email, password_hash, role, full_name)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.email, input.passwordHash, input.role, input.fullName ?? null],
    );
    const r = rows[0];
    return {
      userId: r.user_id, email: r.email, role: r.role as UserRole,
      fullName: r.full_name ?? undefined, active: r.active,
    };
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.db.pool.query(`UPDATE users SET last_login_at = now() WHERE user_id = $1`, [userId]);
  }

  async listUsers(): Promise<UserRecord[]> {
    const { rows } = await this.db.pool.query(`SELECT * FROM users ORDER BY created_at DESC LIMIT 200`);
    return rows.map((r) => ({
      userId: r.user_id, email: r.email, role: r.role as UserRole,
      fullName: r.full_name ?? undefined, active: r.active,
      lastLoginAt: r.last_login_at?.toISOString?.() ?? r.last_login_at ?? undefined,
    }));
  }

  async setUserActive(userId: string, active: boolean): Promise<UserRecord | null> {
    const { rows } = await this.db.pool.query(
      `UPDATE users SET active=$2 WHERE user_id=$1 RETURNING *`,
      [userId, active],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      userId: r.user_id, email: r.email, role: r.role as UserRole,
      fullName: r.full_name ?? undefined, active: r.active,
      lastLoginAt: r.last_login_at?.toISOString?.() ?? undefined,
    };
  }

  async setUserPassword(userId: string, passwordHash: string): Promise<void> {
    await this.db.pool.query(`UPDATE users SET password_hash=$2 WHERE user_id=$1`, [userId, passwordHash]);
  }

  // ---------- מסך קליטה (פרק 12) ----------
  async listIngestionRuns(limit: number): Promise<IngestionRunListItem[]> {
    const { rows } = await this.db.pool.query(
      `SELECT r.*,
              (SELECT count(*)::int FROM raw_staging rs WHERE rs.ingestion_run_id = r.ingestion_run_id) AS raw_count,
              (SELECT count(*)::int FROM ingestion_error e WHERE e.ingestion_run_id = r.ingestion_run_id) AS error_count,
              (SELECT count(*)::int FROM ingestion_error e WHERE e.ingestion_run_id = r.ingestion_run_id AND e.severity = 'CRITICAL') AS critical_count,
              (SELECT count(*)::int FROM reject rj WHERE rj.ingestion_run_id = r.ingestion_run_id) AS rejects_count
       FROM ingestion_run r
       ORDER BY r.received_at DESC
       LIMIT $1`,
      [Math.min(Math.max(limit, 1), 500)],
    );
    return rows.map((r) => this.mapRunRow(r));
  }

  async getIngestionRunDetail(id: string): Promise<IngestionRunDetail | null> {
    const { rows } = await this.db.pool.query(
      `SELECT r.*,
              (SELECT count(*)::int FROM raw_staging rs WHERE rs.ingestion_run_id = r.ingestion_run_id) AS raw_count,
              (SELECT count(*)::int FROM ingestion_error e WHERE e.ingestion_run_id = r.ingestion_run_id) AS error_count,
              (SELECT count(*)::int FROM ingestion_error e WHERE e.ingestion_run_id = r.ingestion_run_id AND e.severity = 'CRITICAL') AS critical_count,
              (SELECT count(*)::int FROM reject rj WHERE rj.ingestion_run_id = r.ingestion_run_id) AS rejects_count
       FROM ingestion_run r WHERE r.ingestion_run_id = $1`,
      [id],
    );
    if (!rows.length) return null;
    const base = this.mapRunRow(rows[0]);
    const [{ rows: errors }, { rows: promoted }] = await Promise.all([
      this.db.pool.query(
        `SELECT code, severity, message, block_code, record_seq, field
         FROM ingestion_error WHERE ingestion_run_id = $1
         ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'ERROR' THEN 1 WHEN 'WARN' THEN 2 ELSE 3 END
         LIMIT 200`,
        [id],
      ),
      this.db.pool.query(
        `SELECT COALESCE(target_entity, 'unmapped') AS entity, count(*)::int AS n
         FROM raw_staging WHERE ingestion_run_id = $1
         GROUP BY target_entity ORDER BY n DESC`,
        [id],
      ),
    ]);
    return {
      ...base,
      errors: errors.map((e) => ({
        code: e.code, severity: e.severity, message: e.message,
        blockCode: e.block_code ?? undefined, recordSeq: e.record_seq ?? undefined, field: e.field ?? undefined,
      })),
      promotedByEntity: promoted.map((p) => ({ entity: p.entity, count: p.n })),
    };
  }

  private mapRunRow(r: any): IngestionRunListItem {
    return {
      ingestionRunId: r.ingestion_run_id, sourceFileName: r.source_file_name ?? undefined,
      fileHash: r.file_hash, source: r.source ?? undefined, parserVersion: r.parser_version ?? undefined,
      status: r.status, error: r.error ?? undefined,
      receivedAt: r.received_at?.toISOString?.() ?? r.received_at,
      completedAt: r.completed_at?.toISOString?.() ?? r.completed_at ?? undefined,
      rawCount: r.raw_count, errorCount: r.error_count, criticalCount: r.critical_count, rejectsCount: r.rejects_count,
    };
  }

  async listRegulationVersions(): Promise<RegulationVersionEntry[]> {
    const { rows } = await this.db.pool.query(
      `SELECT parser_version, effective_from, notes FROM regulation_version ORDER BY effective_from DESC`,
    );
    return rows.map((r) => ({
      parserVersion: r.parser_version,
      effectiveFrom: r.effective_from?.toISOString?.()?.slice(0, 10) ?? r.effective_from,
      notes: r.notes ?? undefined,
    }));
  }

  private dateOrNull(v: string | undefined): string | null {
    return v && /\d/.test(v) ? v : null;
  }

  private async mark(c: PoolClient, runId: string, seq: number, entity: string, id: string): Promise<void> {
    await c.query(
      `UPDATE raw_staging SET target_entity = $3, target_id = $4 WHERE ingestion_run_id = $1 AND record_seq = $2`,
      [runId, seq, entity, id],
    );
  }
}
