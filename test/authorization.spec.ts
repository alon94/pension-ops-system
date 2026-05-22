import { AuthorizationService, AuthorizationDeniedError } from '../src/authorization/authorization.service';
import { Authorization, NewAuthorization } from '../src/authorization/authorization.types';
import { coversInquiry, isActiveNow } from '../src/authorization/scope';
import { anonymizeCustomerRow, maskIsraelId, tokenizeIsraelId } from '../src/authorization/pseudonymization';
import { InMemoryRepository } from '../src/persistence/in-memory.repository';

const newAuth = (over: Partial<NewAuthorization> = {}): NewAuthorization => ({
  customerId: 'c1',
  scope: 'full',
  signedAt: '2026-05-20T00:00:00Z',
  validFrom: '2026-05-20',
  validTo: '2028-05-20',
  channel: 'digital',
  digitalSignatureProvider: 'DigitalSign',
  ...over,
});

describe('Scope check (§10.2)', () => {
  const base: Authorization = {
    authorizationId: 'a', customerId: 'c', scope: 'full',
    signedAt: '2026-05-20T00:00:00Z', validFrom: '2026-05-20', validTo: '2028-05-20',
    channel: 'digital', status: 'active',
  };

  it('full מכסה הכל; expired לא מכסה', () => {
    expect(coversInquiry(base, { action: 'WRITE' })).toBe(true);
    expect(coversInquiry({ ...base, status: 'expired' }, { action: 'READ' })).toBe(false);
  });

  it('read_only — WRITE נדחה', () => {
    expect(coversInquiry({ ...base, scope: 'read_only' }, { action: 'WRITE' })).toBe(false);
    expect(coversInquiry({ ...base, scope: 'read_only' }, { action: 'READ' })).toBe(true);
  });

  it('specific_products — דורש מוצר ברשימה', () => {
    const a = { ...base, scope: 'specific_products' as const, scopeDetailsJson: { products: ['PENS'] } };
    expect(coversInquiry(a, { action: 'READ', productCode: 'PENS' })).toBe(true);
    expect(coversInquiry(a, { action: 'READ', productCode: 'OTHER' })).toBe(false);
  });

  it('valid_to בעבר => לא active', () => {
    expect(isActiveNow({ ...base, validTo: '2024-01-01' }, new Date('2026-05-20'))).toBe(false);
  });
});

describe('Pseudonymization (§10.6)', () => {
  it('tokenizeIsraelId דטרמיניסטי באותו secret', () => {
    expect(tokenizeIsraelId('000000018', 'k1')).toEqual(tokenizeIsraelId('000000018', 'k1'));
    expect(tokenizeIsraelId('000000018', 'k1')).not.toEqual(tokenizeIsraelId('000000018', 'k2'));
  });

  it('maskIsraelId מציג 4 ספרות אחרונות בלבד', () => {
    expect(maskIsraelId('123456789')).toBe('*****6789');
  });

  it('anonymizeCustomerRow מסיר PII', () => {
    const a = anonymizeCustomerRow({ customerId: 'c1', israelId: '123456789', firstName: 'X' });
    expect((a as any).firstName).toBeUndefined();
    expect(a.status).toBe('ANONYMIZED');
  });
});

describe('AuthorizationService', () => {
  it('§10.5(1) — יצירה שנייה לאותו scope מסמנת ישן כ-superseded', async () => {
    const repo = new InMemoryRepository();
    const svc = new AuthorizationService(repo);
    const a = await svc.create(newAuth());
    const b = await svc.create(newAuth());
    expect((await repo.getAuthorization(a.authorizationId))?.status).toBe('superseded');
    expect((await repo.getAuthorization(b.authorizationId))?.status).toBe('active');
  });

  it('§10.5(6) — DECEASED חוסם יצירה', async () => {
    const repo = new InMemoryRepository();
    repo.customerProfiles.set('c1', { status: 'DECEASED', legalCapacityStatus: 'FULL' });
    const svc = new AuthorizationService(repo);
    await expect(svc.create(newAuth())).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it('§10.5(4) — חסר כשירות משפטית חוסם יצירה', async () => {
    const repo = new InMemoryRepository();
    repo.customerProfiles.set('c1', { status: 'ACTIVE', legalCapacityStatus: 'MINOR' });
    const svc = new AuthorizationService(repo);
    await expect(svc.create(newAuth())).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it('§10.4 — expireDue מעביר ל-expired', async () => {
    const repo = new InMemoryRepository();
    const svc = new AuthorizationService(repo);
    await svc.create(newAuth({ validTo: '2024-01-01' }));
    const out = await svc.expireDueAuthorizations(new Date('2026-05-20'));
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('expired');
  });

  it('assertCanInquire — NO_AUTH / EXPIRED / OUT_OF_SCOPE / OK', async () => {
    const repo = new InMemoryRepository();
    const svc = new AuthorizationService(repo);
    await expect(svc.assertCanInquire('c1', { action: 'READ' })).rejects.toMatchObject({ reason: 'NO_AUTH' });

    await svc.create(newAuth({ validTo: '2024-01-01' }));
    await expect(svc.assertCanInquire('c1', { action: 'READ' }, new Date('2026-05-20'))).rejects.toMatchObject({ reason: 'EXPIRED' });

    await svc.create(newAuth({ scope: 'specific_products', scopeDetailsJson: { products: ['PENS'] } }));
    await expect(svc.assertCanInquire('c1', { action: 'READ', productCode: 'OTHER' })).rejects.toMatchObject({ reason: 'OUT_OF_SCOPE' });
    const ok = await svc.assertCanInquire('c1', { action: 'READ', productCode: 'PENS' });
    expect(ok.scope).toBe('specific_products');
  });

  it('audit log נכתב על create/revoke/inquiry', async () => {
    const repo = new InMemoryRepository();
    const svc = new AuthorizationService(repo);
    const a = await svc.create(newAuth());
    await svc.revoke(a.authorizationId, 'customer', 'אני רוצה לבטל');
    expect(repo.auditLog.map((l) => l.action)).toEqual(expect.arrayContaining(['AUTH_CREATE', 'AUTH_REVOKE']));
  });

  it('Right-to-Access — מחזיר רשימת AUTHs ורושם audit', async () => {
    const repo = new InMemoryRepository();
    const svc = new AuthorizationService(repo);
    await svc.create(newAuth());
    const out = await svc.exportForCustomer('c1');
    expect(out.authorizations).toHaveLength(1);
    expect(repo.auditLog.some((l) => l.action === 'GDPR_EXPORT')).toBe(true);
  });
});
