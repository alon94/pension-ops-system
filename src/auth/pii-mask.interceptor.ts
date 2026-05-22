import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { maskIsraelId } from '../authorization/pseudonymization';
import { UserRecord } from './auth.types';

/** שדות שמופיעים בתגובות API ומכילים ת.ז. — יעברו mask ל-OPERATOR. */
const ID_FIELDS = new Set(['israelId', 'customerIsraelId', 'beneficiaryIdNum', 'companyId']);

/**
 * §13.1 + §10.6 — Operator רואה רק 4 ספרות אחרונות של ת.ז.
 * שאר התפקידים רואים מלא. מבצע walk רקורסיבי על המבנה התשובה.
 */
@Injectable()
export class PiiMaskInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user: UserRecord | undefined = context.switchToHttp().getRequest().user;
    if (!user || user.role !== 'OPERATOR') return next.handle();
    return next.handle().pipe(map((data) => maskWalk(data)));
  }
}

function maskWalk(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(maskWalk);
  if (typeof v === 'object') {
    const out: any = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (ID_FIELDS.has(k) && typeof val === 'string' && /^\d+$/.test(val)) {
        out[k] = maskIsraelId(val);
      } else {
        out[k] = maskWalk(val);
      }
    }
    return out;
  }
  return v;
}
