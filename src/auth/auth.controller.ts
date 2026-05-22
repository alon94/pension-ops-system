import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserRecord, UserRole } from './auth.types';
import { CurrentUser, Public, Roles } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() body: { email?: string; password?: string }) {
    if (!body?.email || !body?.password) throw new BadRequestException('email + password נדרשים');
    return this.auth.login(body.email, body.password);
  }

  @Get('me')
  me(@CurrentUser() user: UserRecord) {
    return user;
  }

  /** §13 — שינוי סיסמה עצמית. נדרשת הסיסמה הנוכחית. */
  @Post('me/password')
  async changePassword(
    @CurrentUser() user: UserRecord,
    @Body() body: { current?: string; next?: string },
  ) {
    if (!body?.current || !body?.next) throw new BadRequestException('current + next נדרשים');
    await this.auth.changeOwnPassword(user.userId, body.current, body.next);
    return { status: 'ok' };
  }
}

@Controller('admin/users')
@Roles('MANAGER')
export class AdminUsersController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  list() {
    return this.auth.listUsers();
  }

  @Post()
  async create(@Body() body: { email?: string; password?: string; role?: UserRole; fullName?: string }) {
    if (!body?.email || !body?.password || !body?.role) {
      throw new BadRequestException('email + password + role נדרשים');
    }
    if (!['OPERATOR', 'MANAGER', 'AUDITOR', 'REGULATOR'].includes(body.role)) {
      throw new BadRequestException('role לא חוקי');
    }
    return this.auth.createUser(body.email, body.password, body.role, body.fullName);
  }

  @Patch(':id/active')
  async setActive(@Param('id') id: string, @Body() body: { active: boolean }) {
    const out = await this.auth.setActive(id, !!body.active);
    if (!out) throw new NotFoundException(`משתמש לא נמצא: ${id}`);
    return out;
  }

  @Post(':id/reset-password')
  async resetPassword(@Param('id') id: string, @Body() body: { newPassword?: string }) {
    if (!body?.newPassword) throw new BadRequestException('newPassword נדרשת');
    await this.auth.resetPassword(id, body.newPassword);
    return { status: 'ok' };
  }
}
