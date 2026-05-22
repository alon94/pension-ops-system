import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { UserRecord, UserRole } from './auth.types';

/** @Public() — מסיר את דרישת JWT עבור route ספציפי (לדוגמה /auth/login). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** @Roles('MANAGER','AUDITOR') — הגבלת גישה לתפקידים נתמכים. */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);

/** @CurrentUser() — מזריק את הלקוח המאומת ל-handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserRecord | undefined =>
    ctx.switchToHttp().getRequest().user,
);
