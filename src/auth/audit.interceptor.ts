import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { REPOSITORY, Repository } from '../persistence/repository.port';
import { UserRecord } from './auth.types';

/**
 * §13.1 — אודיט של כל פעולה מסוג mutation.
 * רק POST/PUT/PATCH/DELETE/HEAD נכנסים ל-audit_log (GET לא נרשם — רעש).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const method: string = req.method;
    if (method === 'GET' || method === 'OPTIONS') return next.handle();

    const user: UserRecord | undefined = req.user;
    const route = req.route?.path ?? req.url ?? '';

    return next.handle().pipe(
      tap({
        next: () => {
          void this.repo.appendAudit({
            actor: user ? `${user.role}:${user.email}` : 'anonymous',
            action: `HTTP_${method}`,
            entity: extractEntityFromRoute(route),
            entityId: req.params?.id ?? req.params?.customerId ?? undefined,
            meta: { route, params: req.params },
          });
        },
      }),
    );
  }
}

function extractEntityFromRoute(route: string): string | undefined {
  const m = /^\/?([\w-]+)/.exec(route);
  return m?.[1];
}
