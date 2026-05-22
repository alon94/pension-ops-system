import { A1MeetingQualityAgent, MeetingPrepReport } from '../src/agents/a1.meeting-quality';
import { A11AuditAgent } from '../src/agents/a11.audit';
import { A2InternalRejectAgent, A3ManufacturerRejectAgent } from '../src/agents/a2-a3.rejects';
import { A6TerminationAgent } from '../src/agents/a6.termination';
import { AUTONOMY } from '../src/agents/agent.types';
import { OrchestratorService } from '../src/agents/orchestrator.service';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { InMemoryRepository } from '../src/persistence/in-memory.repository';
import { RejectLifecycleService } from '../src/rejects/reject-lifecycle.service';
import { RejectService } from '../src/rejects/reject.service';
import { Form161LifecycleService } from '../src/termination/form-161-lifecycle.service';
import { TerminationLifecycleService } from '../src/termination/termination-lifecycle.service';
import { TerminationService } from '../src/termination/termination.service';
import { AgentContextService } from '../src/agent-context/agent-context.service';
import { EmbeddingProvider } from '../src/agent-context/embedding.provider';
import { LlmProvider } from '../src/agent-context/llm.provider';

function makeAgentContext(repo: InMemoryRepository): AgentContextService {
  return new AgentContextService(repo, new EmbeddingProvider(), new LlmProvider());
}

describe('Orchestrator (§11.4) + Agent autonomy (§11.5)', () => {
  it("autonomy levels של 11 האייג'נטים", () => {
    expect(AUTONOMY.A1).toBe('FULL');
    expect(AUTONOMY.A2).toBe('SEMI');
    expect(AUTONOMY.A6).toBe('PARTIAL');
    expect(AUTONOMY.A11).toBe('FULL');
  });

  it("Orchestrator מריץ טסקים לפי priority (CRITICAL לפני NORMAL)", async () => {
    const repo = new InMemoryRepository();
    const orch = new OrchestratorService(repo);
    const a11 = new A11AuditAgent(repo);
    orch.register(a11);
    orch.enqueue('A11', { alert: { actor: 'sys', reason: 'normal' } }, { priority: 'NORMAL' });
    orch.enqueue('A11', { alert: { actor: 'sys', reason: 'critical' } }, { priority: 'CRITICAL' });
    const out = await orch.drain();
    expect(out[0].summary).toContain('critical');
    expect(out[1].summary).toContain('normal');
  });

  it("Orchestrator עוקף retry על כשל ורושם audit", async () => {
    const repo = new InMemoryRepository();
    const orch = new OrchestratorService(repo);
    let calls = 0;
    orch.register({
      id: 'A11' as const, autonomy: AUTONOMY.A11,
      run: async () => {
        calls++;
        if (calls < 2) throw new Error('transient');
        return { ok: true, summary: 'ok after retry' };
      },
    });
    orch.enqueue('A11', {});
    const out = await orch.drain({ maxRetries: 2 });
    expect(out[0].ok).toBe(true);
    expect(calls).toBe(2);
    expect(repo.auditLog.some((l) => l.action === 'AGENT_RUN')).toBe(true);
  });
});

describe("A1 — Meeting Quality (§11.2)", () => {
  it("מפיק דוח עם דגלים מאת REJECT + AUTH + TERMINATION", async () => {
    const repo = new InMemoryRepository();
    repo.customers.set('000000018', { customerId: 'c1', israelId: '000000018' });
    const rejects = new RejectService(repo, new RejectLifecycleService());
    const auth = new AuthorizationService(repo);
    await auth.create({
      customerId: 'c1', scope: 'full', signedAt: '2026-05-20T00:00:00Z',
      validFrom: '2026-05-20', validTo: '2028-05-20', channel: 'digital',
    });
    await rejects.open({ rejectType: 'INTERNAL', rejectCode: 'R007', severity: 'HIGH', customerId: 'c1' });

    const a1 = new A1MeetingQualityAgent(repo, rejects, auth, makeAgentContext(repo));
    const r = await a1.run({ taskId: 't1', agent: 'A1', trigger: 'MANUAL', reason: '', payload: { customerId: 'c1' }, enqueuedAt: new Date().toISOString() });
    expect(r.ok).toBe(true);
    const report = r.data as MeetingPrepReport;
    expect(report.authorization.active).toBe(true);
    expect(report.rejects.high).toBe(1);
    expect(report.warnings).toContain('HIGH_SEVERITY_REJECTS');
  });

  it("AUTH פג תוקף => אזהרת NO_ACTIVE_AUTHORIZATION", async () => {
    const repo = new InMemoryRepository();
    const rejects = new RejectService(repo, new RejectLifecycleService());
    const auth = new AuthorizationService(repo);
    const a1 = new A1MeetingQualityAgent(repo, rejects, auth, makeAgentContext(repo));
    const r = await a1.run({ taskId: 't', agent: 'A1', trigger: 'MANUAL', reason: '', payload: { customerId: 'c1' }, enqueuedAt: new Date().toISOString() });
    expect((r.data as MeetingPrepReport).warnings).toContain('NO_ACTIVE_AUTHORIZATION');
  });
});

describe("A2/A3 — Rejects via agents", () => {
  it("A2 פותח ריג'קטים פנימיים ומסמן CRITICAL לאישור אדם", async () => {
    const repo = new InMemoryRepository();
    const rejects = new RejectService(repo, new RejectLifecycleService());
    const a2 = new A2InternalRejectAgent(rejects);
    const r = await a2.run({
      taskId: 't', agent: 'A2', trigger: 'EVENT', reason: '',
      payload: { issues: [{ code: 'E001_BAD_ISRAEL_ID', severity: 'CRITICAL', message: '' }] },
      enqueuedAt: new Date().toISOString(),
    });
    expect(r.requiresHumanApproval).toBe(true);
    expect(repo.rejects).toHaveLength(1);
  });

  it("A3 מעביר ריג'קט ל-WAITING_MANUFACTURER", async () => {
    const repo = new InMemoryRepository();
    const rejects = new RejectService(repo, new RejectLifecycleService());
    const opened = await rejects.open({ rejectType: 'MANUFACTURER', rejectCode: 'R001', severity: 'HIGH' });
    await rejects.transition(opened.rejectId, { to: 'IN_PROGRESS', by: 'ref' });
    const a3 = new A3ManufacturerRejectAgent(rejects);
    const r = await a3.run({
      taskId: 't', agent: 'A3', trigger: 'EVENT', reason: '',
      payload: { rejectId: opened.rejectId, manufacturerKey: 'MGD' },
      enqueuedAt: new Date().toISOString(),
    });
    expect(r.ok).toBe(true);
    expect((await repo.getReject(opened.rejectId))?.status).toBe('WAITING_MANUFACTURER');
  });
});

describe("A6 — Termination via agent", () => {
  it("A6 scan דורש אישור אדם אם נפתח CONFIRMED", async () => {
    const repo = new InMemoryRepository();
    repo.employments.set('k1', {
      employmentId: 'e1', customerId: 'c1', employerId: 'er1', accountId: 'a1',
      startDate: '20180101', endDate: '20240501',
    });
    repo.deposits.set('a1|202404', { accountId: 'a1', depositMonth: '202404' });
    repo.accounts.set('m1|p1', { accountId: 'a1', manufacturerId: 'm1', policyNumber: 'p1', currentStatus: 'ACTIVE' });
    const term = new TerminationService(repo, new TerminationLifecycleService(), new Form161LifecycleService());
    const a6 = new A6TerminationAgent(term);
    const r = await a6.run({ taskId: 't', agent: 'A6', trigger: 'CRON', reason: '', payload: {}, enqueuedAt: new Date().toISOString() });
    expect(r.ok).toBe(true);
    expect(repo.terminations).toHaveLength(1);
    expect(r.requiresHumanApproval).toBe(true);
  });
});
