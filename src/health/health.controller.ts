import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { DbService } from '../persistence/db.service';

/**
 * Healthchecks סטנדרטיים ל-orchestration (Kubernetes/ECS/docker-compose):
 *  - /health/live  — האם התהליך חי (תמיד 200; אם לא 200 → restart)
 *  - /health/ready — האם השירות מסוגל לשרת בקשות (DB ping + schema sanity)
 *
 * Public — אין JWT.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'live', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  async ready() {
    try {
      const { rows: [pg] } = await this.db.pool.query('SELECT 1 AS ok');
      // טבלאות הליבה חייבות להיות זמינות (ifnotexists של schema.sql);
      // נספור על customer ועל users כדי לוודא ש-schema.sql ו-schema.auth.sql הוחלו.
      const { rows: [counts] } = await this.db.pool.query(
        `SELECT
           (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='customer')::int AS has_customer,
           (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='users')::int AS has_users,
           (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='agent_context')::int AS has_agent_ctx`,
      );
      const ok = pg?.ok === 1 && counts.has_customer === 1 && counts.has_users === 1 && counts.has_agent_ctx === 1;
      if (!ok) throw new HttpException({ status: 'not-ready', counts }, HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'ready', timestamp: new Date().toISOString(), checks: counts };
    } catch (e) {
      throw new HttpException(
        { status: 'not-ready', error: (e as Error).message },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
