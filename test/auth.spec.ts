import { UnauthorizedException, ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom, of } from 'rxjs';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { RolesGuard } from '../src/auth/roles.guard';
import { PiiMaskInterceptor } from '../src/auth/pii-mask.interceptor';
import { AuditInterceptor } from '../src/auth/audit.interceptor';
import { InMemoryRepository } from '../src/persistence/in-memory.repository';

const SECRET = 'test-secret-32-chars-min-aaaaaaaa';
const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '1h' } });
const cfg = { get: () => undefined } as unknown as ConfigService;

function ctxFor(req: any, handlerMeta: Record<string, unknown> = {}, classMeta: Record<string, unknown> = {}): ExecutionContext {
  return {
    getHandler: () => ({ __metadata: handlerMeta }) as any,
    getClass: () => ({ __metadata: classMeta }) as any,
    switchToHttp: () => ({ getRequest: () => req }) as any,
  } as ExecutionContext;
}

class FakeReflector extends Reflector {
  constructor(private readonly map: Record<string, any> = {}) {
    super();
  }
  override getAllAndOverride<T>(key: string): T {
    return this.map[key];
  }
}

describe('AuthService (פרק 13)', () => {
  it('login שגוי => UnauthorizedException', async () => {
    const repo = new InMemoryRepository();
    const svc = new AuthService(repo, jwt, cfg);
    await expect(svc.login('nobody@demo.local', 'x')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login תקין מחזיר JWT עם role + מעדכן last_login_at', async () => {
    const repo = new InMemoryRepository();
    const svc = new AuthService(repo, jwt, cfg);
    const u = await svc.createUser('op@demo.local', 'pw123456', 'OPERATOR', 'אופ');
    const out = await svc.login('op@demo.local', 'pw123456');
    expect(out.user.userId).toBe(u.userId);
    expect(out.user.role).toBe('OPERATOR');
    const payload = await jwt.verifyAsync(out.token);
    expect(payload.role).toBe('OPERATOR');
    expect(payload.email).toBe('op@demo.local');
    const fresh = await repo.getUserById(u.userId);
    expect(fresh?.lastLoginAt).toBeDefined();
  });

  it('סיסמה שגויה => UnauthorizedException', async () => {
    const repo = new InMemoryRepository();
    const svc = new AuthService(repo, jwt, cfg);
    await svc.createUser('mgr@demo.local', 'right-password', 'MANAGER');
    await expect(svc.login('mgr@demo.local', 'wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('JwtAuthGuard', () => {
  const repo = new InMemoryRepository();
  const svc = new AuthService(repo, jwt, cfg);

  it('@Public => עובר ללא טוקן', async () => {
    const guard = new JwtAuthGuard(new FakeReflector({ isPublic: true }), jwt, svc);
    expect(await guard.canActivate(ctxFor({ headers: {} }))).toBe(true);
  });

  it('חסר Bearer => זורק', async () => {
    const guard = new JwtAuthGuard(new FakeReflector({}), jwt, svc);
    await expect(guard.canActivate(ctxFor({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('JWT תקין מחבר user ל-request', async () => {
    const user = await svc.createUser('a@demo.local', 'xxxxxxxx', 'AUDITOR');
    const token = (await svc.login('a@demo.local', 'xxxxxxxx')).token;
    const guard = new JwtAuthGuard(new FakeReflector({}), jwt, svc);
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    await guard.canActivate(ctxFor(req));
    expect(req.user.userId).toBe(user.userId);
    expect(req.user.role).toBe('AUDITOR');
  });
});

describe('RolesGuard', () => {
  it('ללא @Roles => מאשר', () => {
    const guard = new RolesGuard(new FakeReflector({}));
    expect(guard.canActivate(ctxFor({ user: { role: 'OPERATOR' } }))).toBe(true);
  });

  it('תפקיד מורשה => מאשר', () => {
    const guard = new RolesGuard(new FakeReflector({ roles: ['OPERATOR', 'MANAGER'] }));
    expect(guard.canActivate(ctxFor({ user: { role: 'OPERATOR' } }))).toBe(true);
  });

  it('תפקיד לא מורשה => ForbiddenException', () => {
    const guard = new RolesGuard(new FakeReflector({ roles: ['MANAGER'] }));
    expect(() => guard.canActivate(ctxFor({ user: { role: 'OPERATOR' } }))).toThrow(ForbiddenException);
  });
});

describe('PiiMaskInterceptor (§13.1 + §10.6)', () => {
  const interceptor = new PiiMaskInterceptor();

  it('OPERATOR — מסך israelId ל-4 ספרות אחרונות', async () => {
    const req = { user: { role: 'OPERATOR' } };
    const out = await lastValueFrom(
      interceptor.intercept(ctxFor(req), {
        handle: () => of({ customer: { israelId: '123456789' }, list: [{ customerIsraelId: '987654321' }] }),
      }),
    );
    expect((out as any).customer.israelId).toBe('*****6789');
    expect((out as any).list[0].customerIsraelId).toBe('*****4321');
  });

  it('MANAGER — לא מסך', async () => {
    const req = { user: { role: 'MANAGER' } };
    const out = await lastValueFrom(
      interceptor.intercept(ctxFor(req), { handle: () => of({ israelId: '123456789' }) }),
    );
    expect((out as any).israelId).toBe('123456789');
  });
});

describe('AuditInterceptor', () => {
  it('POST נרשם ב-audit_log; GET לא', async () => {
    const repo = new InMemoryRepository();
    const interceptor = new AuditInterceptor(repo);
    const req = { method: 'POST', url: '/rejects/abc/transition', params: { id: 'abc' }, route: { path: '/rejects/:id/transition' }, user: { role: 'OPERATOR', email: 'op@demo.local' } };
    await lastValueFrom(interceptor.intercept(ctxFor(req), { handle: () => of({}) }));
    // הקריאה ל-appendAudit נעשית ב-tap; ניתן לראות אותה ביומן
    expect(repo.auditLog.some((l) => l.action === 'HTTP_POST' && l.actor === 'OPERATOR:op@demo.local')).toBe(true);

    repo.auditLog = [];
    const getReq = { method: 'GET', url: '/dashboard/stats', params: {}, route: { path: '/dashboard/stats' }, user: { role: 'OPERATOR', email: 'op@demo.local' } };
    await lastValueFrom(interceptor.intercept(ctxFor(getReq), { handle: () => of({}) }));
    expect(repo.auditLog).toHaveLength(0);
  });
});
