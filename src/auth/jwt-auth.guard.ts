import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './decorators';

/**
 * JwtAuthGuard — הגארד הגלובלי. כל route דורש JWT תקין, פרט ל-@Public.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization ?? req.headers.Authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('חסר טוקן אימות');
    const token = header.slice('Bearer '.length).trim();
    try {
      const payload = await this.jwt.verifyAsync(token);
      req.user = await this.auth.validatePayload(payload);
      return true;
    } catch {
      throw new UnauthorizedException('טוקן לא תקין');
    }
  }
}
