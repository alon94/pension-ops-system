import { Module } from '@nestjs/common';
import { DbService } from './db.service';
import { PgRepository } from './pg.repository';
import { REPOSITORY } from './repository.port';

/**
 * שכבת הנתונים. ברירת מחדל בפרודקשן: PostgreSQL.
 * בבדיקות מחליפים את ה-provider של REPOSITORY ב-InMemoryRepository.
 */
@Module({
  providers: [DbService, { provide: REPOSITORY, useClass: PgRepository }],
  exports: [REPOSITORY, DbService],
})
export class PersistenceModule {}
