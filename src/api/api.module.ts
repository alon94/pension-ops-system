import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { ApiController } from './api.controller';

@Module({
  imports: [PersistenceModule],
  controllers: [ApiController],
})
export class ApiModule {}
