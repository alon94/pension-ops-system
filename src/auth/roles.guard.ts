import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRecord, UserRole } from './auth.types';
import { ROLES_KEY } from './decorators';

/**
 * RolesGuard — בודק @Roles(...) על handler/class. אם אין דקורטור, מאשר.
 * §13.1 — Operator | Manager | Auditor | Regulator.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (!allowed || allowed.length === 0) return true;
    const user: UserRecord | undefined = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('דרושה הזדהות');
    if (!allowed.includes(user.role)) {
      throw new ForbiddenException(`תפקיד ${user.role} לא מורשה — נדרש: ${allowed.join(' / ')}`);
    }
    return true;
  }
}
