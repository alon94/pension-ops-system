import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PersistenceModule } from '../persistence/persistence.module';
import { AuditInterceptor } from './audit.interceptor';
import { AdminUsersController, AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PiiMaskInterceptor } from './pii-mask.interceptor';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    PersistenceModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('jwtSecret') ?? process.env.JWT_SECRET ?? 'dev-secret-change-me-32chars-min!!',
        signOptions: { expiresIn: (cfg.get<string>('jwtExpiry') ?? '12h') as any },
      }),
    }),
  ],
  controllers: [AuthController, AdminUsersController],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: PiiMaskInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuthService],
})
export class AuthModule {}
