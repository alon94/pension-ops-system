import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { HealthController } from './health.controller';

@Module({
  imports: [PersistenceModule],
  controllers: [HealthController],
})
export class HealthModule {}
