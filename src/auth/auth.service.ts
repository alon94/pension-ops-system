import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { REPOSITORY, Repository } from '../persistence/repository.port';
import { AuthJwtPayload, LoginResponse, UserRecord, UserRole } from './auth.types';

/**
 * AuthService — login עם bcrypt + JWT (פרק 13 §13.1).
 *
 * סוד JWT נטען מ-JWT_SECRET (env). בפרודקשן חובה לקבוע ערך באורך 32+ תווים.
 * בפיתוח יש ברירת מחדל כדי שהמערכת תעלה ללא קונפיגורציה ידנית.
 */
@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');
  static readonly BCRYPT_COST = 10;

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** §13 — אימות email+password והנפקת JWT. */
  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.repo.findUserByEmail(email.trim().toLowerCase());
    if (!user) {
      this.log.warn(`login fail: unknown email ${email}`);
      throw new UnauthorizedException('שם משתמש או סיסמה שגויים');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      this.log.warn(`login fail: bad password for ${email}`);
      throw new UnauthorizedException('שם משתמש או סיסמה שגויים');
    }
    await this.repo.touchLastLogin(user.userId);
    const payload: AuthJwtPayload = {
      sub: user.userId, email: user.email, role: user.role, name: user.fullName,
    };
    const token = await this.jwt.signAsync(payload);
    const { passwordHash, ...publicUser } = user;
    this.log.log(`login ok: ${email} (${user.role})`);
    return { token, user: publicUser };
  }

  /** משמש את ה-JwtAuthGuard לאחר verify. */
  async validatePayload(payload: AuthJwtPayload): Promise<UserRecord> {
    const user = await this.repo.getUserById(payload.sub);
    if (!user || !user.active) throw new UnauthorizedException('משתמש לא פעיל');
    return user;
  }

  /** עוזר לזריעת משתמשים בפיתוח (וגם לאדמין דרך /admin/users). */
  async createUser(email: string, password: string, role: UserRole, fullName?: string): Promise<UserRecord> {
    if (password.length < 8) throw new Error('סיסמה חייבת להכיל לפחות 8 תווים');
    const passwordHash = await bcrypt.hash(password, AuthService.BCRYPT_COST);
    return this.repo.createUser({ email: email.toLowerCase(), passwordHash, role, fullName });
  }

  async listUsers(): Promise<UserRecord[]> {
    return this.repo.listUsers();
  }

  async setActive(userId: string, active: boolean): Promise<UserRecord | null> {
    return this.repo.setUserActive(userId, active);
  }

  /** §13 — שינוי סיסמה ע"י המשתמש עצמו (דורש סיסמה נוכחית). */
  async changeOwnPassword(userId: string, current: string, next: string): Promise<void> {
    if (next.length < 8) throw new UnauthorizedException('סיסמה חדשה — לפחות 8 תווים');
    const me = await this.repo.getUserById(userId);
    if (!me) throw new UnauthorizedException('משתמש לא נמצא');
    const withPw = await this.repo.findUserByEmail(me.email);
    if (!withPw) throw new UnauthorizedException('משתמש לא נמצא');
    if (!(await bcrypt.compare(current, withPw.passwordHash))) {
      throw new UnauthorizedException('סיסמה נוכחית שגויה');
    }
    await this.repo.setUserPassword(userId, await bcrypt.hash(next, AuthService.BCRYPT_COST));
  }

  /** §13 — אדמין יכול לאפס סיסמה (ללא דרישה לסיסמה הנוכחית). */
  async resetPassword(userId: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) throw new Error('סיסמה — לפחות 8 תווים');
    await this.repo.setUserPassword(userId, await bcrypt.hash(newPassword, AuthService.BCRYPT_COST));
  }
}
