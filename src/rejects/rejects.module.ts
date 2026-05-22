import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { RejectLifecycleService } from './reject-lifecycle.service';
import { RejectService } from './reject.service';
import { RejectsController } from './rejects.controller';

@Module({
  imports: [PersistenceModule],
  controllers: [RejectsController],
  providers: [RejectLifecycleService, RejectService],
  exports: [RejectService, RejectLifecycleService],
})
export class RejectsModule {}
