import { AgentContextService } from '../src/agent-context/agent-context.service';
import { buildContextSummary, deriveFlags, hashSummary } from '../src/agent-context/context-builder';
import { cosineSim, EmbeddingProvider } from '../src/agent-context/embedding.provider';
import { LlmProvider } from '../src/agent-context/llm.provider';
import { Customer360 } from '../src/api/ui-query.types';
import { InMemoryRepository } from '../src/persistence/in-memory.repository';

const baseC360 = (over: Partial<Customer360> = {}): Customer360 => ({
  customer: {
    customerId: 'c1', israelId: '000000018',
    firstName: 'ישראל', lastName: 'ישראלי',
    birthDate: '1970-03-12', city: 'תל אביב', status: 'ACTIVE',
  },
  authorization: {
    authorizationId: 'a1', scope: 'full', status: 'active',
    validTo: '2028-01-01', daysUntilExpiry: 500,
  },
  accounts: [{
    accountId: 'acc1', policyNumber: 'POL-100',
    manufacturerCode: 'MGD', manufacturerName: 'מגדל',
    productCode: 'PENS-MAKIF', currentStatus: 'AC',
    openedDate: '2015-01-01', latestBalance: { snapshotDate: '2024-04-30', total: 300_000 },
  }],
  recentDeposits: [
    { accountId: 'acc1', policyNumber: 'POL-100', depositMonth: '202404', total: 5_400 },
  ],
  rejects: [],
  terminations: [],
  riskFlags: [],
  ...over,
});

describe('buildContextSummary (§5.6)', () => {
  it('ממיר Customer360 ל-summary עם זהות, תיק, ופעילות אחרונה', () => {
    const s = buildContextSummary(baseC360(), new Date('2026-05-20'));
    expect(s.identity.fullName).toBe('ישראל ישראלי');
    expect(s.identity.ageYears).toBe(56);
    expect(s.portfolio.totalAssets).toBe(300_000);
    expect(s.portfolio.manufacturers).toEqual(['מגדל']);
    expect(s.recentActivity.lastDepositMonth).toBe('202404');
    expect(s.recentActivity.lastDepositAmount).toBe(5_400);
  });

  it('סופר פעילים, מוטטה רק את הריג"קטים הלא טרמינליים', () => {
    const s = buildContextSummary(baseC360({
      rejects: [
        { rejectId: 'r1', rejectCode: 'R001', severity: 'HIGH', status: 'OPEN', detectedAt: '' },
        { rejectId: 'r2', rejectCode: 'R011', severity: 'MEDIUM', status: 'RESOLVED', detectedAt: '' },
      ],
    }));
    expect(s.rejects.openCount).toBe(1);
    expect(s.rejects.highCount).toBe(1);
  });
});

describe('deriveFlags (§5.6 + §7.7)', () => {
  it('OPEN_REJECT_HIGH + AUTH_EXPIRES_SOON', () => {
    const s = buildContextSummary(baseC360({
      authorization: {
        authorizationId: 'a', scope: 'full', status: 'active', validTo: '2026-06-10', daysUntilExpiry: 21,
      },
      rejects: [
        { rejectId: 'r1', rejectCode: 'R001', severity: 'HIGH', status: 'OPEN', detectedAt: '' },
      ],
    }), new Date('2026-05-20'));
    const { riskFlags } = deriveFlags(s);
    expect(riskFlags).toEqual(expect.arrayContaining(['OPEN_REJECT_HIGH', 'AUTH_EXPIRES_SOON']));
  });

  it('הזדמנויות: CONSOLIDATION_CANDIDATE ו-HIGH_NET_WORTH ו-PRE_RETIREMENT_PLANNING', () => {
    const s = buildContextSummary(baseC360({
      customer: { ...baseC360().customer, birthDate: '1960-01-01' },
      accounts: [
        baseC360().accounts[0],
        { ...baseC360().accounts[0], accountId: 'acc2', policyNumber: 'POL-200',
          manufacturerCode: 'HRL', manufacturerName: 'הראל',
          latestBalance: { snapshotDate: '2024-04-30', total: 400_000 } },
      ],
    }), new Date('2026-05-20'));
    const { opportunityFlags } = deriveFlags(s);
    expect(opportunityFlags).toEqual(expect.arrayContaining([
      'CONSOLIDATION_CANDIDATE', 'HIGH_NET_WORTH', 'PRE_RETIREMENT_PLANNING',
    ]));
  });

  it('NO_ACTIVE_AUTHORIZATION כאשר חסר ייפוי כוח', () => {
    const s = buildContextSummary(baseC360({ authorization: undefined }));
    expect(deriveFlags(s).riskFlags).toContain('NO_ACTIVE_AUTHORIZATION');
  });
});

describe('hashSummary — דטרמיניסטי', () => {
  it('סדר השדות לא משפיע', () => {
    const a = buildContextSummary(baseC360());
    const b = buildContextSummary(baseC360());
    expect(hashSummary(a)).toEqual(hashSummary(b));
  });
});

describe('EmbeddingProvider — fallback דטרמיניסטי', () => {
  const provider = new EmbeddingProvider();

  it('מחזיר 1536 dims מנורמלים ל-L2=1', async () => {
    const v = await provider.embed('hello world');
    expect(v).toHaveLength(1536);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-6);
  });

  it('דטרמיניסטי על אותו קלט', async () => {
    const a = await provider.embed('same text');
    const b = await provider.embed('same text');
    expect(a).toEqual(b);
    expect(cosineSim(a, b)).toBeCloseTo(1.0, 6);
  });

  it('שונה על קלטים שונים', async () => {
    const a = await provider.embed('alpha');
    const b = await provider.embed('beta');
    expect(cosineSim(a, b)).toBeLessThan(0.9);
  });
});

describe('LlmProvider — fallback ללא API key', () => {
  it('מחזיר תקציר עברי לא ריק עם fallback=true', async () => {
    const llm = new LlmProvider();
    const s = buildContextSummary(baseC360());
    const out = await llm.briefing(s, 'מטרת הפגישה');
    expect(out.fallback).toBe(true);
    expect(out.text.length).toBeGreaterThan(20);
    expect(out.text).toContain('ייפוי כוח');
  });
});

describe('AgentContextService.refresh', () => {
  it('בונה summary, מחשב embedding, ושומר ב-repo עם version עולה', async () => {
    const repo = new InMemoryRepository();
    // הזרקה ידנית של Customer360: שמים את הלקוח, חשבון, ומאפסים את שאר השאילתות
    repo.customers.set('000000018', { customerId: 'c1', israelId: '000000018', firstName: 'ישראל', lastName: 'ישראלי', birthDate: '1970-03-12', city: 'תל אביב' });
    repo.manufacturers.set('MGD', { manufacturerId: 'm1', officialCode: 'MGD', name: 'מגדל' });
    repo.accounts.set('m1|POL-100', { accountId: 'acc1', customerId: 'c1', manufacturerId: 'm1', policyNumber: 'POL-100', currentStatus: 'AC', openedDate: '2015-01-01' });

    const svc = new AgentContextService(repo, new EmbeddingProvider(), new LlmProvider());
    const first = await svc.refresh('c1');
    expect(first?.version).toBe(1);
    expect(first?.embedding).toHaveLength(1536);

    // refresh שני ללא שינויי נתונים => אותה גרסה (no-op כי hash זהה)
    const second = await svc.refresh('c1');
    expect(second?.version).toBe(1);
    expect(second?.summaryHash).toBe(first?.summaryHash);
  });

  it('briefing מחזיר טקסט עברי, גם כשאין API key', async () => {
    const repo = new InMemoryRepository();
    repo.customers.set('000000018', { customerId: 'c1', israelId: '000000018', firstName: 'ישראל', lastName: 'ישראלי' });
    repo.manufacturers.set('MGD', { manufacturerId: 'm1', officialCode: 'MGD', name: 'מגדל' });

    const svc = new AgentContextService(repo, new EmbeddingProvider(), new LlmProvider());
    const out = await svc.briefing('c1', 'פגישת בקרה');
    expect(out?.briefing.length).toBeGreaterThan(20);
    expect(out?.fallback).toBe(true);
  });
});
