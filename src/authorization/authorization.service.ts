import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { REPOSITORY, Repository } from '../persistence/repository.port';
import { Authorization, AuthChannel, AuthScope, NewAuthorization } from './authorization.types';
import { coversInquiry, InquiryRequirement, isActiveNow } from './scope';

export class AuthorizationDeniedError extends Error {
  constructor(public readonly reason: 'NO_AUTH' | 'EXPIRED' | 'OUT_OF_SCOPE' | 'DECEASED' | 'NO_LEGAL_CAPACITY') {
    super(`גישה נדחתה: ${reason}`);
  }
}

const DEFAULT_VALID_YEARS = 2; // §10.1(4) — תוקף לרוב 2-3 שנים

/** §10.x — שירות ניהול ייפויי כוח, פקיעה אוטומטית, ביטול ובדיקת scope. */
@Injectable()
export class AuthorizationService {
  private readonly log = new Logger('Authorization');

  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  /**
   * §10.3 — יצירת AUTHORIZATION חדש לאחר חתימה.
   * §10.5(1) — אם קיים AUTH פעיל עם אותו scope: הקודם מסומן superseded.
   * §10.5(6) — חסום אם הלקוח DECEASED.
   * §10.5(4) — חסום אם legal_capacity_status אינו FULL (דורש אפוטרופוס).
   */
  async create(input: NewAuthorization, signatureBytes?: Buffer, now = new Date()): Promise<Authorization> {
    const profile = await this.repo.getCustomerStatus(input.customerId);
    if (profile?.status === 'DECEASED') {
      throw new AuthorizationDeniedError('DECEASED');
    }
    if (profile && profile.legalCapacityStatus !== 'FULL') {
      throw new AuthorizationDeniedError('NO_LEGAL_CAPACITY');
    }

    // §10.5(1) — supersede אם יש פעיל עם אותו scope
    const existing = await this.repo.findActiveAuthorization(input.customerId, input.scope);
    if (existing) {
      await this.repo.saveAuthorization({
        ...existing, status: 'superseded',
        revokedAt: now.toISOString(), revokedReason: 'SUPERSEDED_BY_NEW', revokedBy: 'system_auto',
      });
    }

    const validTo = input.validTo ?? new Date(new Date(input.signedAt).getTime() + DEFAULT_VALID_YEARS * 365 * 86400_000).toISOString().slice(0, 10);
    const signatureHash = input.signatureHash ?? (signatureBytes ? createHash('sha256').update(signatureBytes).digest('hex') : undefined);

    const auth: Authorization = {
      ...input,
      authorizationId: randomUUID(),
      validTo,
      signatureHash,
      status: input.status ?? 'active',
    };
    const saved = await this.repo.createAuthorization(auth);
    await this.repo.appendAudit({ actor: 'agent', action: 'AUTH_CREATE', entity: 'authorization', entityId: saved.authorizationId, meta: { scope: saved.scope, channel: saved.channel } });
    this.log.log(`CREATE auth=${saved.authorizationId} customer=${saved.customerId} scope=${saved.scope}`);
    return saved;
  }

  /** §10.4 — ביטול ע"י לקוח/סוכן/מערכת. */
  async revoke(id: string, by: 'customer' | 'agent' | 'system_auto', reason: string): Promise<Authorization> {
    const a = await this.repo.getAuthorization(id);
    if (!a) throw new Error(`AUTH לא נמצא: ${id}`);
    const next: Authorization = { ...a, status: 'revoked', revokedAt: new Date().toISOString(), revokedReason: reason, revokedBy: by };
    await this.repo.saveAuthorization(next);
    await this.repo.appendAudit({ actor: by, action: 'AUTH_REVOKE', entity: 'authorization', entityId: id, meta: { reason } });
    return next;
  }

  /** §10.4 — סריקת AUTH-ים שפג תוקפם והעברה אוטומטית ל-expired. */
  async expireDueAuthorizations(now = new Date()): Promise<Authorization[]> {
    const due = await this.repo.listExpirableAuthorizations(now);
    const expired: Authorization[] = [];
    for (const a of due) {
      const next: Authorization = { ...a, status: 'expired' };
      await this.repo.saveAuthorization(next);
      await this.repo.appendAudit({ actor: 'system_auto', action: 'AUTH_EXPIRE', entity: 'authorization', entityId: a.authorizationId });
      expired.push(next);
    }
    return expired;
  }

  /**
   * §10.2 — בדיקת הרשאה לפני INQUIRY. זורק AuthorizationDeniedError אם נדחה.
   * מחזיר את ה-Authorization שכיסה אם אושר.
   */
  async assertCanInquire(customerId: string, req: InquiryRequirement, now = new Date()): Promise<Authorization> {
    const profile = await this.repo.getCustomerStatus(customerId);
    if (profile?.status === 'DECEASED') throw new AuthorizationDeniedError('DECEASED');

    const all = await this.repo.listAuthorizations(customerId);
    if (all.length === 0) throw new AuthorizationDeniedError('NO_AUTH');

    const candidates = all.filter((a) => isActiveNow(a, now));
    if (candidates.length === 0) throw new AuthorizationDeniedError('EXPIRED');

    const cover = candidates.find((a) => coversInquiry(a, req, now));
    if (!cover) throw new AuthorizationDeniedError('OUT_OF_SCOPE');

    await this.repo.appendAudit({ actor: 'agent', action: 'INQUIRY_AUTHORIZED', entity: 'authorization', entityId: cover.authorizationId, meta: req });
    return cover;
  }

  /** §10.6 Right-to-Access — מחזיר את כל ה-AUTH-ים של הלקוח. */
  async exportForCustomer(customerId: string): Promise<{ customerId: string; authorizations: Authorization[] }> {
    await this.repo.appendAudit({ actor: 'system_auto', action: 'GDPR_EXPORT', entity: 'customer', entityId: customerId });
    return { customerId, authorizations: await this.repo.listAuthorizations(customerId) };
  }
}
